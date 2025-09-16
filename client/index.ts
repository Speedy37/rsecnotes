async function generateAesGcmKey(): Promise<{
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

async function importAesGcmKey(rawKey: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
	return await crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["decrypt"]);
}

const VERSION_1 = 1;
const V1_HEADER_LEN = 1 /* version */ + 12; /* iv*/
const V1_DATA_HEADER_LEN = 4 /* text len */ + 4; /* files len */
const V1_FILE_HEADER_LEN = 4 /* name len */ + 4; /* file len */

function utf8_len(s: string): number {
	return new TextEncoder().encode(s).byteLength;
}

class Pkg {
	private _text: string = "";
	private _files: { file: File; name_len: number }[] = [];
	private _text_len: number | null = null;
	private _file_len: number = 0;

	constructor() {}

	addFile(file: File) {
		let name_len = utf8_len(file.name);
		this._files.push({ file, name_len });
		this._file_len += V1_FILE_HEADER_LEN + name_len + file.size;
	}

	removeFile(i: number) {
		if (i < this._files.length) {
			let { file, name_len } = this._files[i];
			this._files.splice(i, 1);
			this._file_len -= V1_FILE_HEADER_LEN + name_len + file.size;
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
		if (this._text_len === null) this._text_len = utf8_len(this._text);
		return this._text_len;
	}
	get total_len(): number {
		return V1_HEADER_LEN + V1_DATA_HEADER_LEN + this.text_len + this._file_len;
	}

	get empty(): boolean {
		return this._text.length === 0 && this._files.length === 0;
	}

	async encode(): Promise<Uint8Array<ArrayBuffer>> {
		const buffer = new ArrayBuffer(this.total_len);
		const data_u8 = new Uint8Array(buffer);
		const data_dv = new DataView(buffer);
		let pos = 0;
		const write_u32le = (v: number) => {
			data_dv.setUint32(pos, v, true);
			pos += 4;
		};
		const write_utf8 = (s: string) => {
			let { written } = new TextEncoder().encodeInto(s, data_u8.subarray(pos));
			pos += written;
		};
		write_u32le(this.text_len);
		write_utf8(this._text);
		write_u32le(this._files.length);
		for (const { file, name_len } of this._files) {
			write_u32le(name_len);
			write_utf8(file.name);
			write_u32le(file.size);
			const reader = file.stream().getReader();
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				data_u8.set(value, pos);
				pos += value.byteLength;
			}
		}

		return data_u8;
	}

	async encrypt(): Promise<{ key: Uint8Array; blob: Blob }> {
		const data = await this.encode();

		const { keyObj, rawKey } = await generateAesGcmKey();
		const iv = crypto.getRandomValues(new Uint8Array(12));
		const encrypted_data = await crypto.subtle.encrypt(
			{ name: "AES-GCM", iv: iv },
			keyObj,
			data,
		);
		const header = new Uint8Array(V1_HEADER_LEN);
		header[0] = VERSION_1;
		header.set(iv, 1);
		const blob = new Blob([header, encrypted_data], {
			type: "application/octet-stream",
		});

		return { key: rawKey, blob };
	}
}

type DecryptedNote = { text: string; files: { name: string; data: Uint8Array<ArrayBuffer> }[] };
async function decrypt(keyb64: string, buffer: ArrayBuffer): Promise<DecryptedNote> {
	const data_u8 = new Uint8Array(buffer);
	const version = data_u8[0];
	if (version == VERSION_1) {
		if (data_u8.byteLength < V1_HEADER_LEN)
			throw new Error(
				`raw_note_len(${data_u8.byteLength}) < V1_HEADER_LEN(${V1_HEADER_LEN})`,
			);
		let iv = data_u8.subarray(1, 1 + 12);
		let rawkey = base64urlDecode(keyb64);
		let key = await importAesGcmKey(rawkey);
		const decrypted_data = await crypto.subtle.decrypt(
			{ name: "AES-GCM", iv },
			key,
			data_u8.subarray(13),
		);
		return decodev1(decrypted_data);
	}
	throw new Error(`unknown version ${version}`);
}

async function decodev1(buffer: ArrayBuffer) {
	const data_u8 = new Uint8Array(buffer);
	const data_dv = new DataView(buffer);
	let pos = 0;
	const read_u32le = () => {
		const start = pos;
		pos += 4;
		if (data_dv.byteLength < pos)
			throw new Error(`read_u32le plain_note_len(${data_dv.byteLength}) < ${pos}`);
		return data_dv.getUint32(start, true);
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
	const files_len = read_u32le();
	const files = [];
	for (let i = 0; i < files_len; ++i) {
		const name_len = read_u32le();
		const file_name = read_utf8(name_len);
		const file_size = read_u32le();
		const file_data = data_u8.subarray(pos, pos + file_size);
		pos += file_size;
		files.push({ name: file_name, data: file_data });
	}

	return { text, files };
}

const X_EXPIRES_AFTER = "x-note-expires-after";
const X_REMAINING_VIEWS = "x-note-remaining-views";

async function post_note(
	blob: Blob,
	settings: {
		remaining_views: number;
		expires_after: number;
	},
	onprogress?: (loaded: number, total: number) => void,
): Promise<string> {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open("POST", "/notes");

		// Update progress bar
		xhr.upload.onprogress = (event) => {
			if (event.lengthComputable) {
				onprogress && onprogress(event.loaded, event.total);
			}
		};

		xhr.onload = () => {
			if (xhr.status === 200) {
				resolve(xhr.responseText);
			} else {
				reject(`Upload failed. Status: ${xhr.status}`);
			}
		};
		xhr.setRequestHeader(X_EXPIRES_AFTER, settings.expires_after.toFixed());
		xhr.setRequestHeader(X_REMAINING_VIEWS, settings.remaining_views.toFixed());
		xhr.onerror = () => {
			reject("Upload error.");
		};

		xhr.send(blob);
	});
}

type EncryptedNote = {
	data: ArrayBuffer;
	remaining_views: number;
	expires_after: number;
};
async function get_note(
	note_id: string,
	onprogress?: (loaded: number, total: number) => void,
): Promise<EncryptedNote> {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open("GET", `/notes/${note_id}`);
		xhr.responseType = "arraybuffer";

		// Download progress bar
		xhr.onprogress = (event) => {
			if (event.lengthComputable) {
				onprogress && onprogress(event.loaded, event.total);
			}
		};

		xhr.onload = () => {
			if (xhr.status === 200) {
				const res = {
					data: xhr.response as ArrayBuffer,
					expires_after: +(xhr.getResponseHeader(X_EXPIRES_AFTER) || "0"),
					remaining_views: +(xhr.getResponseHeader(X_REMAINING_VIEWS) || "0"),
				};

				resolve(res);
			} else if (xhr.status === 404) {
				reject(`Note not found (probably expired)`);
			} else {
				reject(`Download failed. Status code: ${xhr.status}`);
			}
		};
		xhr.onerror = () => {
			reject("Upload error.");
		};

		xhr.send();
	});
}

const base64abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const base64rabc = new Uint8Array(256);
for (let i = 0; i < base64abc.length; i++) {
	base64rabc[base64abc.charCodeAt(i)] = i;
}

function base64urlEncode(bytes: Uint8Array): string {
	let result = "";
	const l = bytes.length;
	for (let i = 0; i < l; i += 3) {
		const a = bytes[i];
		const b = i + 1 < l ? bytes[i + 1] : 0;
		const c = i + 2 < l ? bytes[i + 2] : 0;
		const triplet = (a << 16) + (b << 8) + c;

		result += base64abc[(triplet >> 18) & 0x3f];
		result += base64abc[(triplet >> 12) & 0x3f];
		if (i + 1 < l) result += base64abc[(triplet >> 6) & 0x3f];
		if (i + 2 < l) result += base64abc[triplet & 0x3f];
	}

	return result;
}

function base64urlDecode(s: string): Uint8Array<ArrayBuffer> {
	const l = s.length;
	if (l % 4 === 1) throw new Error("Invalid base64 string");
	const bytesLength = Math.floor((l * 3) / 4);
	const bytes = new Uint8Array(bytesLength);
	let pos = 0;
	for (let i = 0; i < l; i += 4) {
		const v =
			(base64rabc[s.charCodeAt(i)] << 18) |
			(base64rabc[s.charCodeAt(i + 1)] << 12) |
			(i + 2 < l ? base64rabc[s.charCodeAt(i + 2)] << 6 : 0) |
			(i + 3 < l ? base64rabc[s.charCodeAt(i + 3)] : 0);

		if (pos < bytesLength) bytes[pos++] = (v >> 16) & 0xff;
		if (pos < bytesLength) bytes[pos++] = (v >> 8) & 0xff;
		if (pos < bytesLength) bytes[pos++] = v & 0xff;
	}

	return bytes;
}

function humanSize(bytes: number, decimals = 2) {
	if (bytes === 0) return "0 B";

	const k = 1024;
	const dm = decimals < 0 ? 0 : decimals;
	const sizes = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];

	const i = Math.floor(Math.log(bytes) / Math.log(k));

	return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

function humanReadableSecs(secs: number) {
	secs = Math.floor(secs);
	const d = Math.floor(secs / 86400);
	const h = Math.floor((secs % 86400) / 3600);
	const m = Math.floor((secs % 3600) / 60);
	const s = secs % 60;

	const parts = [];
	if (d) parts.push(`${d} day${d > 1 ? "s" : ""}`);
	if (h) parts.push(`${h} hour${h > 1 ? "s" : ""}`);
	if (m) parts.push(`${m} minute${m > 1 ? "s" : ""}`);
	if (s || parts.length === 0) parts.push(`${s} second${s > 1 ? "s" : ""}`);

	return parts.join(" ");
}

//# UI
const input_block = document.getElementById("input_block") as HTMLDivElement;
const input_note = document.getElementById("input_note") as HTMLTextAreaElement;
const input_files = document.getElementById("input_files") as HTMLDivElement;
const input_filedrop = document.getElementById("input_filedrop") as HTMLDivElement;
const input_file = document.getElementById("input_file") as HTMLInputElement;
const input_filelist = document.getElementById("input_filelist") as HTMLDivElement;
const input_remaining_views = document.getElementById("input_remaining_views") as HTMLInputElement;
const input_expires_after = document.getElementById("input_expires_after") as HTMLInputElement;
const input_createbtn = document.getElementById("input_createbtn") as HTMLButtonElement;
const input_status = document.getElementById("input_status") as HTMLDivElement;
const input_settings_status = document.getElementById("input_settings_status") as HTMLDivElement;

input_note.addEventListener("input", (event) => {
	pkg.text = input_note.value;
	renderNoteStatus();
});
input_remaining_views.addEventListener("input", (e) => renderNoteStatus());
input_expires_after.addEventListener("input", (e) => renderNoteStatus());

// Click to choose file
input_filedrop.addEventListener("click", () => input_file.click());
input_file.addEventListener("change", (e) => {
	addFiles(input_file.files);
	input_file.value = "";
});

input_filedrop.addEventListener("dragover", (e) => {
	e.preventDefault();
	input_filedrop.className = "drop dragover";
});
input_filedrop.addEventListener("dragleave", (e) => {
	input_filedrop.className = "drop";
});
input_filedrop.addEventListener("drop", (e) => {
	e.preventDefault();
	input_filedrop.className = "drop";
	addFiles(e.dataTransfer?.files);
});

input_createbtn.addEventListener("click", async () => {
	try {
		input_createbtn.disabled = true;
		input_createbtn.className = "progress";
		input_createbtn.textContent = "Encrypting...";
		pkg.text = input_note.value;
		const { key, blob } = await pkg.encrypt();
		const keyb64 = base64urlEncode(key);
		input_createbtn.textContent = "Uploading...";

		let note_id = await post_note(
			blob,
			{
				remaining_views: +input_remaining_views.value,
				expires_after: +input_expires_after.value * 60,
			},
			(loaded, total) => {
				const percent = (loaded / total) * 100;
				input_createbtn.style.setProperty("--progress", percent.toFixed(2) + "%");
			},
		);

		renderLink(note_id, keyb64);
		input_createbtn.className = "";
	} catch (err) {
		input_createbtn.className = "error";
		input_createbtn.textContent = `Error: ${err instanceof Error ? err.message : err}, Retry?`;
	} finally {
		input_createbtn.disabled = false;
	}
});

const pkg = new Pkg();
function addFiles(files: FileList | null | undefined) {
	if (!files) return;
	for (const file of files) {
		if (pkg.files.length < server_config.max_files) pkg.addFile(file);
	}
	renderFiles();
	renderNoteStatus();
}

function buildSettingsStatus(remaining_views: number, expires_after: number, bView = false) {
	let text = "";
	if (remaining_views < 0 && expires_after < 0)
		text = `The note will not expire and will be destroyed when the server restarts or to free up memory.`;
	else if (remaining_views === 0)
		text = `This is the last possible view of this note, and it's now destroyed from the server.`;
	else {
		text = `The note will expire and be destroyed from the server after `;
		if (remaining_views >= 0)
			text += `${remaining_views} ${bView ? "more " : ""} view${
				remaining_views > 1 ? "s" : ""
			}`;
		if (remaining_views >= 0 && expires_after >= 0) text += ` or ${bView ? "in" : "after"} `;
		if (expires_after >= 0) text += `${humanReadableSecs(expires_after)}`;
		if (remaining_views >= 0 && expires_after >= 0) text += `, whichever happens first`;
		text += ".";
	}
	return text;
}

function renderNoteStatus() {
	if (pkg.empty) {
		input_status.textContent = "";
		input_settings_status.textContent = "";
		input_createbtn.disabled = true;
		return;
	}
	const doesnt_fit = pkg.total_len > server_config.max_note_size;
	input_createbtn.disabled = doesnt_fit;
	const total_len_h = humanSize(pkg.total_len);
	const max_note_size_h = humanSize(server_config.max_note_size);
	input_status.textContent = `Note size: ${total_len_h} / ${max_note_size_h}.`;
	if (doesnt_fit)
		input_status.textContent += ` Too big, remove some contents.`
	input_status.className = doesnt_fit ? "error" : "";
	let remaining_views = +input_remaining_views.value;
	let expires_after = +input_expires_after.value * 60;
	if (!Number.isSafeInteger(remaining_views)) remaining_views = 1;
	if (!Number.isSafeInteger(expires_after)) expires_after = 0;
	if (remaining_views === 0) remaining_views = -1;
	if (expires_after === 0) expires_after = -1;
	input_settings_status.textContent = buildSettingsStatus(remaining_views, expires_after);
}

function renderFiles() {
	if (pkg.files.length === 0) {
		input_filelist.innerText = "No files selected.";
		return;
	}
	input_filelist.innerHTML = "";
	pkg.files.forEach(({ file: f }, i) => {
		const div = document.createElement("div");
		div.textContent = `${i + 1}. ${f.name}`;
		input_filelist.appendChild(div);

		const span = document.createElement("span");
		span.textContent = `(${humanSize(f.size)})`;
		input_filelist.appendChild(span);

		const btn = document.createElement("button");
		btn.textContent = "Remove";
		btn.onclick = () => {
			pkg.removeFile(i);
			renderFiles();
			renderNoteStatus();
		};
		input_filelist.appendChild(btn);
	});
}

const link_block = document.getElementById("link_block") as HTMLDivElement;
const link_url = document.getElementById("link_url") as HTMLInputElement;
const link_qrcode = document.getElementById("link_qrcode") as HTMLDivElement;
const link_copy = document.getElementById("link_copy") as HTMLButtonElement;

link_url.addEventListener("click", async () => {
	link_url.select();
});
link_copy.addEventListener("click", async () => {
	await navigator.clipboard.writeText(link_url.value);
	link_copy.textContent = "Copied!";
});

declare var QRCode: any;
function renderLink(note_id: string, keyb64: string) {
	showBlock("link_block");
	btn_newnote.style.display = "";

	let url = new URL(document.location.href);
	url.search = "";
	url.searchParams.append("note", note_id);
	url.hash = keyb64;
	link_url.value = url.href;
	new QRCode(link_qrcode, {
		text: url.href,
		width: 512,
		height: 512,
		colorDark: "#000000",
		colorLight: "#ffffff",
		correctLevel: QRCode.CorrectLevel.H,
	});
}

const read_block = document.getElementById("read_block") as HTMLDivElement;
const read_note = document.getElementById("read_note") as HTMLTextAreaElement;
const read_copy = document.getElementById("read_copy") as HTMLButtonElement;
const read_filelist = document.getElementById("read_filelist") as HTMLDivElement;
const read_settings_status = document.getElementById("read_settings_status") as HTMLElement;
const consume_block = document.getElementById("consume_block") as HTMLDivElement;
const consume_btn = document.getElementById("consume_btn") as HTMLButtonElement;

read_copy.addEventListener("click", async () => {
	await navigator.clipboard.writeText(read_note.value);
	read_copy.textContent = "Copied!";
});

function showBlock(block: "input_block" | "link_block" | "read_block" | "consume_block") {
	input_block.style.display = block === "input_block" ? "" : "none";
	link_block.style.display = block === "link_block" ? "" : "none";
	read_block.style.display = block === "read_block" ? "" : "none";
	consume_block.style.display = block === "consume_block" ? "" : "none";
}

function renderNote(raw_note: EncryptedNote, note: DecryptedNote) {
	read_note.value = note.text;

	if (note.files.length === 0) {
		read_filelist.innerText = "No files included.";
	} else {
		read_filelist.innerHTML = "";
		note.files.forEach((f, i) => {
			const div = document.createElement("div");
			div.textContent = `${i + 1}. ${f.name}`;
			read_filelist.appendChild(div);

			const span = document.createElement("span");
			span.textContent = `(${humanSize(f.data.byteLength)})`;
			read_filelist.appendChild(span);

			const btn = document.createElement("button");
			btn.textContent = "Download";
			btn.onclick = () => {
				const blob = new Blob([f.data]);
				const url = URL.createObjectURL(blob);
				const a = document.createElement("a");
				a.href = url;
				a.download = f.name;
				document.body.appendChild(a);
				a.click();
				document.body.removeChild(a);
				URL.revokeObjectURL(url);
			};
			read_filelist.appendChild(btn);
		});
	}

	read_settings_status.textContent = buildSettingsStatus(
		raw_note.remaining_views,
		raw_note.expires_after,
		true,
	);
	if (raw_note.expires_after > 0) {
		const remaining_views = raw_note.remaining_views;
		const expires_at = Date.now() + raw_note.expires_after * 1000;
		const renderExpiresAfter = () => {
			const now = Date.now();
			if (expires_at > now) {
				const expires_after = (expires_at - now) / 1000;
				read_settings_status.textContent = buildSettingsStatus(
					remaining_views,
					expires_after,
					true,
				);
				const delay = (expires_after - Math.floor(expires_after)) * 1000;
				setTimeout(renderExpiresAfter, delay + 100);
			} else {
				read_settings_status.textContent = buildSettingsStatus(0, 0, true);
			}
		};
		renderExpiresAfter();
	}
	showBlock("read_block");
	btn_newnote.style.display = "";
}

const btn_newnote = document.getElementById("btn_newnote") as HTMLButtonElement;
btn_newnote.addEventListener("click", () => {
	let url = new URL(document.location.href);
	url.search = "";
	url.hash = "";
	document.location = url.href;
});

let server_config = {
	/// Maximum final size of a note (after encryption and packaging)
	max_note_size: 0,
	/// Maximum number of files, 0 means no file allowed
	max_files: 0,
	/// Number of seconds before this note is removed, 0 for never
	default_expires_after: 0,
	/// Number of views before this note is removed, 0 for never
	default_remaining_views: 0,
};
async function main() {
	const page_url = new URL(document.location.href);
	const note_id = page_url.searchParams.get("note");
	const keyb64 = page_url.hash.substring(1);
	if (!note_id || !keyb64) {
		let res = await fetch("./config");
		server_config = await res.json();
		input_remaining_views.value = server_config.default_remaining_views
			? server_config.default_remaining_views.toString()
			: "";
		input_expires_after.value = server_config.default_expires_after
			? server_config.default_expires_after.toString()
			: "";
		if (server_config.max_files === 0) {
			input_files.style.display = "none";
		}
		return;
	}
	showBlock("consume_block");
	consume_btn.onclick = async () => {
		try {
			consume_btn.disabled = true;
			consume_btn.className = "progress";
			let raw_note = await get_note(note_id, (loaded, total) => {
				const percent = (loaded / total) * 100;
				consume_btn.style.setProperty("--progress", percent.toFixed(2) + "%");
			});
			let note = await decrypt(keyb64, raw_note.data);
			renderNote(raw_note, note);
		} catch (e) {
			consume_btn.textContent = e instanceof Error ? e.message : `${e}`;
			consume_btn.className = "error";
			btn_newnote.style.display = "";
		}
	};
}
main();
