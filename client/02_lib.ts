declare namespace JSX {
	type IntrinsicElements = {
		[k in keyof HTMLElementTagNameMap]:
			| Partial<HTMLElementTagNameMap[k]>
			| { style: Partial<CSSStyleDeclaration> };
	};
}

/// Very simple jsx handler that return DOMElements
function h<K extends keyof HTMLElementTagNameMap>(
	type: K,
	props: Partial<HTMLElementTagNameMap[K]> | null,
	...children: (HTMLElement | string)[]
): HTMLElementTagNameMap[K] {
	const el = document.createElement(type);
	Object.assign(el, props);
	el.append(...children);
	return el;
}

const _base64abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const _base64rabc = new Uint8Array(256);
for (let i = 0; i < _base64abc.length; i++) {
	_base64rabc[_base64abc.charCodeAt(i)] = i;
}

function base64urlEncode(bytes: Uint8Array): string {
	let result = "";
	const l = bytes.length;
	for (let i = 0; i < l; i += 3) {
		const a = bytes[i];
		const b = i + 1 < l ? bytes[i + 1] : 0;
		const c = i + 2 < l ? bytes[i + 2] : 0;
		const triplet = (a << 16) + (b << 8) + c;

		result += _base64abc[(triplet >> 18) & 0x3f];
		result += _base64abc[(triplet >> 12) & 0x3f];
		if (i + 1 < l) result += _base64abc[(triplet >> 6) & 0x3f];
		if (i + 2 < l) result += _base64abc[triplet & 0x3f];
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
			(_base64rabc[s.charCodeAt(i)] << 18) |
			(_base64rabc[s.charCodeAt(i + 1)] << 12) |
			(i + 2 < l ? _base64rabc[s.charCodeAt(i + 2)] << 6 : 0) |
			(i + 3 < l ? _base64rabc[s.charCodeAt(i + 3)] : 0);

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
	const sizes = tr(i18n.humanSizes);

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
	if (d) parts.push(`${d} ${tr(d > 1 ? i18n.days : i18n.day)}`);
	if (h) parts.push(`${h} ${tr(h > 1 ? i18n.hours : i18n.hour)}`);
	if (m) parts.push(`${m} ${tr(m > 1 ? i18n.minutes : i18n.minute)}`);
	if (s || parts.length === 0) parts.push(`${s} ${tr(s > 1 ? i18n.seconds : i18n.second)}`);

	return parts.join(" ");
}

function cryptoRandInt(max: number) {
	if (max > 0xffff_ffff) throw new Error("max must be < u32::max");
	if (max <= 0) throw new Error("max must be > 0");

	const range = 4294967296; // number of storable values in u32 (2**32)
	const limit = range - (range % max); // highest acceptable value
	const buf = new Uint32Array(1);
	while (true) {
		crypto.getRandomValues(buf);
		if (buf[0] < limit) return buf[0] % max;
	}
}

type PwdOpts = {
	len: number;
	lower?: number;
	upper?: number;
	numbers?: number;
	symbols?: number;
};
type PwdOptsBias = {
	lower_bias?: number;
	upper_bias?: number;
	numbers_bias?: number;
	symbols_bias?: number;
};
function generatePassword(opts: PwdOpts & PwdOptsBias) {
	// Character sets
	const sets = {
		lower: "abcdefghijklmnopqrstuvwxyz",
		upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
		numbers: "0123456789",
		symbols: "!@#$%^&*()-_=+[]{}|;:,.<>/?`~",
	};
	const classes = Object.keys(sets) as (keyof typeof sets)[];

	const enabled_classes = classes.filter(c => opts[c] !== 0);
	if (enabled_classes.length === 0) throw tr(i18n.pwd_err_noclass);

	let min_len = 0;
	for (const c of enabled_classes) {
		min_len += opts[c] || 0;
	}
	if (min_len > opts.len) throw tr(i18n.pwd_err_nofit);

	// Character sets selection bias (so passwords aren't filled with too much symbols for example)
	const bias = {
		lower: opts.lower_bias || 3,
		upper: opts.upper_bias || 3,
		numbers: opts.numbers_bias || 2,
		symbols: opts.symbols_bias || 1,
	};
	const bias_sum = enabled_classes.reduce((acc, c) => acc + bias[c], 0);

	// Select `len` characters
	let result: string[] = [];
	for (const c of enabled_classes) {
		const set = sets[c];
		let n = opts[c] || 0;
		for (let i = 0; i < n; i++) {
			result.push(set[cryptoRandInt(set.length)]);
		}
	}
	for (let i = result.length; i < opts.len; i++) {
		let rnd = cryptoRandInt(bias_sum);
		let pos = 0;
		let set;
		for (const c of enabled_classes) {
			pos += bias[c];
			if (rnd < pos) {
				set = sets[c];
				break;
			}
		}
		if  (!set)
			throw new Error("Internal error finding class");
		result.push(set[cryptoRandInt(set.length)]);
	}

	// Shuffle
	for (let i = result.length - 1; i > 0; i--) {
		const j = cryptoRandInt(i + 1);
		[result[i], result[j]] = [result[j], result[i]];
	}

	return result.join("");
}
