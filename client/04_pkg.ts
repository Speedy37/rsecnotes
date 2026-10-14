async function _generateAesGcmKey(): Promise<{
	keyObj: CryptoKey;
	rawKey: Uint8Array;
}> {
	const key = await crypto.subtle.generateKey(
		{ name: "AES-GCM", length: 256 },
		true, // extractable so we can export raw key to show user (be careful!)
		["encrypt", "decrypt"],
	);
	const raw = await crypto.subtle.exportKey("raw", key);
	return { keyObj: key, rawKey: new Uint8Array(raw) };
}

async function _importAesGcmKey(rawKey: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
	return await crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["decrypt"]);
}

/// Data is followed by zeros up to the padded length, to hide the content length from the server
const _VERSION_1 = 1;
const _V1_HEADER_LEN = 1 /* version */ + 12; /* iv*/
const _V1_DATA_HEADER_LEN = 4 /* text len */ + 4 /* pwd len */ + 4; /* files len */
const _V1_FILE_HEADER_LEN = 4 /* name len */ + 8; /* file len */
const _GCM_TAG_LEN = 16;
/// Small notes (eg. only a password) are all padded to this length
const _V1_MIN_DATA_LEN = 128;
/// Below this length, padding is to the next power of two (at most 2x, a few hundred bytes)
const _V1_POW2_MAX_DATA_LEN = 1024;

/// Padded length: the minimum, then powers of two (128, 256, 512, 1024),
/// then Padmé (https://lbarman.ch/blog/padme/) that leaks O(log log len) bits of the length, at most ~12% overhead
function _pad_len(len: number): number {
	len = Math.max(len, _V1_MIN_DATA_LEN);
	if (len <= _V1_POW2_MAX_DATA_LEN) return 2 ** Math.ceil(Math.log2(len));
	const e = Math.floor(Math.log2(len));
	const s = Math.floor(Math.log2(e)) + 1;
	const step = 2 ** (e - s);
	return Math.ceil(len / step) * step;
}

function _utf8_len(s: string): number {
	return new TextEncoder().encode(s).byteLength;
}

class Pkg {
	private _text: string = "";
	private _pwd: string = "";
	private _files: { file: File; name_len: number }[] = [];
	private _text_len: number | null = null;
	private _pwd_len: number | null = null;
	private _file_len: number = 0;

	constructor() {}

	addFile(file: File) {
		let name_len = _utf8_len(file.name);
		this._files.push({ file, name_len });
		this._file_len += _V1_FILE_HEADER_LEN + name_len + file.size;
	}

	removeFile(i: number) {
		if (i < this._files.length) {
			let { file, name_len } = this._files[i];
			this._files.splice(i, 1);
			this._file_len -= _V1_FILE_HEADER_LEN + name_len + file.size;
		}
	}

	get files(): ReadonlyArray<{ file: File; name_len: number }> {
		return this._files;
	}

	get text(): string {
		return this._text;
	}
	set text(text: string) {
		this._text = text;
		this._text_len = null;
	}
	get text_len(): number {
		if (this._text_len === null) this._text_len = _utf8_len(this._text);
		return this._text_len;
	}

	get pwd(): string {
		return this._pwd;
	}
	set pwd(pwd: string) {
		this._pwd = pwd;
		this._pwd_len = null;
	}
	get pwd_len(): number {
		if (this._pwd_len === null) this._pwd_len = _utf8_len(this._pwd);
		return this._pwd_len;
	}

	/// Maximum final size of a note, 0 for no limits, padding is reduced to stay below it
	max_total_len: number = 0;

	private get data_len(): number {
		return _V1_DATA_HEADER_LEN + this.text_len + this.pwd_len + this._file_len;
	}

	private get padded_data_len(): number {
		const data_len = this.data_len;
		let padded = _pad_len(data_len);
		if (this.max_total_len > 0)
			padded = Math.min(padded, this.max_total_len - _V1_HEADER_LEN - _GCM_TAG_LEN);
		return Math.max(padded, data_len);
	}

	/// Final size of the note (after padding, encryption and packaging)
	get total_len(): number {
		return _V1_HEADER_LEN + this.padded_data_len + _GCM_TAG_LEN;
	}

	get empty(): boolean {
		return this._text.length === 0 && this._pwd.length === 0 && this._files.length === 0;
	}

	async encode(): Promise<Uint8Array<ArrayBuffer>> {
		// Zero initialized, the padding is what is left after the data
		const buffer = new ArrayBuffer(this.padded_data_len);
		const data_u8 = new Uint8Array(buffer);
		const data_dv = new DataView(buffer);
		let pos = 0;
		const write_u32le = (v: number) => {
			if (v > 0xffff_ffff)
				throw new Error(`cannot safely encode to u32le, ${v} > 0xFFFF_FFFF`);
			data_dv.setUint32(pos, v, true);
			pos += 4;
		};
		const write_u64le = (v: number) => {
			if (v > Number.MAX_SAFE_INTEGER)
				throw new Error(`cannot safely encode to u64le, ${v} > Number.MAX_SAFE_INTEGER`);
			data_dv.setBigUint64(pos, BigInt(v), true);
			pos += 8;
		};
		const write_utf8 = (s: string) => {
			let { written } = new TextEncoder().encodeInto(s, data_u8.subarray(pos));
			pos += written;
		};
		write_u32le(this.text_len);
		write_utf8(this._text);
		write_u32le(this.pwd_len);
		write_utf8(this.pwd);
		write_u32le(this._files.length);
		for (const { file, name_len } of this._files) {
			write_u32le(name_len);
			write_utf8(file.name);
			write_u64le(file.size);
			const reader = file.stream().getReader();
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				data_u8.set(value, pos);
				pos += value.byteLength;
			}
		}
		if (pos != this.data_len)
			throw new Error(`ASSERT(${pos} == ${this.data_len}) failed`);

		return data_u8;
	}

	async encrypt(): Promise<{ key: Uint8Array; blob: Blob }> {
		const data = await this.encode();

		const { keyObj, rawKey } = await _generateAesGcmKey();
		const iv = crypto.getRandomValues(new Uint8Array(12));
		const encrypted_data = await crypto.subtle.encrypt(
			{ name: "AES-GCM", iv: iv },
			keyObj,
			data,
		);
		const header = new Uint8Array(_V1_HEADER_LEN);
		header[0] = _VERSION_1;
		header.set(iv, 1);
		const blob = new Blob([header, encrypted_data], {
			type: "application/octet-stream",
		});

		return { key: rawKey, blob };
	}
}

type DecryptedNote = {
	text: string;
	pwd: string;
	files: { name: string; data: Uint8Array<ArrayBuffer> }[];
};
async function decrypt(keyb64: string, buffer: ArrayBuffer): Promise<DecryptedNote> {
	const data_u8 = new Uint8Array(buffer);
	const version = data_u8[0];
	if (version == _VERSION_1) {
		if (data_u8.byteLength < _V1_HEADER_LEN)
			throw new Error(
				`raw_note_len(${data_u8.byteLength}) < V1_HEADER_LEN(${_V1_HEADER_LEN})`,
			);
		let iv = data_u8.subarray(1, _V1_HEADER_LEN);
		let rawkey = base64urlDecode(keyb64);
		let key = await _importAesGcmKey(rawkey);
		const decrypted_data = await crypto.subtle.decrypt(
			{ name: "AES-GCM", iv },
			key,
			data_u8.subarray(_V1_HEADER_LEN),
		);
		return _decodev1(decrypted_data);
	}
	throw new Error(`unknown version ${version}`);
}

async function _decodev1(buffer: ArrayBuffer) {
	const data_u8 = new Uint8Array(buffer);
	const data_dv = new DataView(buffer);
	let pos = 0;
	const read_u32le = () => {
		const start = pos;
		pos += 4;
		if (data_dv.byteLength < pos)
			throw new Error(`read_u32le plain_note_len(${data_dv.byteLength}) < ${pos}`);
		return data_dv.getUint32(start, true); // 0..=u32::MAX
	};
	const read_u64le = () => {
		const start = pos;
		pos += 8;
		if (data_dv.byteLength < pos)
			throw new Error(`read_u64le plain_note_len(${data_dv.byteLength}) < ${pos}`);
		const v = data_dv.getBigUint64(start, true);
		if (v > Number.MAX_SAFE_INTEGER)
			throw new Error(`cannot safely decode from u64le, ${v} > Number.MAX_SAFE_INTEGER`);
		return Number(v); // 0..=u64::MAX_SAFE_INTEGER
	};
	const read_utf8 = (len: number) => {
		const start = pos;
		pos += len;
		if (data_u8.byteLength < pos)
			throw new Error(`read_utf8 plain_note_len(${data_u8.byteLength}) < ${pos}`);
		return new TextDecoder().decode(data_u8.subarray(start, pos));
	};
	const text_len = read_u32le();
	const text = read_utf8(text_len);
	const pwd_len = read_u32le();
	const pwd = read_utf8(pwd_len);
	const files_len = read_u32le();
	const files = [];
	for (let i = 0; i < files_len; ++i) {
		const name_len = read_u32le();
		const file_name = read_utf8(name_len);
		const file_size = read_u64le();
		const start = pos;
		pos += file_size;
		if (data_u8.byteLength < pos)
			throw new Error(`read_file plain_note_len(${data_u8.byteLength}) < ${pos}`);
		const file_data = data_u8.subarray(start, pos);
		files.push({ name: file_name, data: file_data });
	}
	if (data_u8.subarray(pos).some((b) => b !== 0)) throw new Error(`invalid padding after ${pos}`);

	return { text, pwd, files };
}
