/// QR code payloads that get a dedicated form and view: TOTP secrets (otpauth://) and Wi-Fi networks (WIFI:),
/// any other payload is shared as is

const _BASE32_ABC = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/// Secrets are often shown in groups, lowercase, or padded: keeps only the base32 characters
function normalizeBase32(s: string): string {
	return s.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
}

/// RFC 4648 base32 without padding, null if invalid
function base32Decode(s: string): Uint8Array<ArrayBuffer> | null {
	if (!/^[A-Z2-7]+$/.test(s)) return null;
	const bytes = new Uint8Array(Math.floor((s.length * 5) / 8));
	let bits = 0;
	let value = 0;
	let pos = 0;
	for (const c of s) {
		value = (value << 5) | _BASE32_ABC.indexOf(c);
		bits += 5;
		if (bits >= 8) {
			bits -= 8;
			bytes[pos++] = (value >> bits) & 0xff;
		}
	}
	return bytes.byteLength > 0 ? bytes : null;
}

const TOTP_ALGORITHMS = ["SHA1", "SHA256", "SHA512"] as const;
type TotpAlgorithm = (typeof TOTP_ALGORITHMS)[number];
type Totp = {
	/// Normalized base32 secret
	secret: string;
	issuer: string;
	account: string;
	algorithm: TotpAlgorithm;
	digits: number;
	/// Seconds
	period: number;
};
const TOTP_DEFAULTS = { algorithm: "SHA1", digits: 6, period: 30 } as const;

/// Error message if this TOTP can't be used, null if valid
function totpError(totp: Totp): string | null {
	if (!base32Decode(totp.secret)) return tr(i18n.qr_err_secret);
	if (!TOTP_ALGORITHMS.includes(totp.algorithm)) return tr(i18n.qr_err_algorithm);
	if (!Number.isInteger(totp.digits) || totp.digits < 6 || totp.digits > 8) return tr(i18n.qr_err_digits);
	if (!Number.isInteger(totp.period) || totp.period < 1) return tr(i18n.qr_err_period);
	return null;
}

/// otpauth://totp/ISSUER:ACCOUNT?secret=SECRET&issuer=ISSUER (https://github.com/google/google-authenticator/wiki/Key-Uri-Format),
/// default parameters are omitted, as some authenticator apps ignore or refuse them
function buildOtpauth(totp: Totp): string {
	const enc = encodeURIComponent;
	const label = totp.issuer ? `${enc(totp.issuer)}:${enc(totp.account)}` : enc(totp.account);
	let uri = `otpauth://totp/${label}?secret=${totp.secret}`;
	if (totp.issuer) uri += `&issuer=${enc(totp.issuer)}`;
	if (totp.algorithm !== TOTP_DEFAULTS.algorithm) uri += `&algorithm=${totp.algorithm}`;
	if (totp.digits !== TOTP_DEFAULTS.digits) uri += `&digits=${totp.digits}`;
	if (totp.period !== TOTP_DEFAULTS.period) uri += `&period=${totp.period}`;
	return uri;
}

/// Parsed by hand: browsers disagree on the host and path of non special URL schemes.
/// null if not an otpauth:// link, a string error message if not a usable TOTP one
function parseOtpauth(uri: string): Totp | string | null {
	const m = /^otpauth:\/\/([^/?#]*)\/([^?#]*)(?:\?([^#]*))?/i.exec(uri.trim());
	if (!m) return null;
	if (m[1].toLowerCase() !== "totp") return tr(i18n.qr_err_hotp);
	const decode = (s: string) => {
		try {
			return decodeURIComponent(s);
		} catch {
			return s;
		}
	};
	const label = decode(m[2]);
	const params = new URLSearchParams(m[3] ?? "");
	const sep = label.indexOf(":");
	const label_issuer = sep >= 0 ? label.substring(0, sep).trim() : "";
	const account = (sep >= 0 ? label.substring(sep + 1) : label).trim();
	const totp: Totp = {
		secret: normalizeBase32(params.get("secret") ?? ""),
		issuer: params.get("issuer") ?? label_issuer,
		account,
		algorithm: (params.get("algorithm") ?? TOTP_DEFAULTS.algorithm).toUpperCase() as TotpAlgorithm,
		digits: +(params.get("digits") ?? TOTP_DEFAULTS.digits),
		period: +(params.get("period") ?? TOTP_DEFAULTS.period),
	};
	return totpError(totp) ?? totp;
}

/// RFC 6238 code at `unix_secs`, and the seconds it remains valid
async function totpCode(totp: Totp, unix_secs = Date.now() / 1000): Promise<{ code: string; remaining: number }> {
	const key_bytes = base32Decode(totp.secret);
	if (!key_bytes) throw new Error(tr(i18n.qr_err_secret));
	const hash = { SHA1: "SHA-1", SHA256: "SHA-256", SHA512: "SHA-512" }[totp.algorithm];
	const key = await crypto.subtle.importKey("raw", key_bytes, { name: "HMAC", hash }, false, ["sign"]);
	const counter = Math.floor(unix_secs / totp.period);
	const msg = new DataView(new ArrayBuffer(8));
	msg.setBigUint64(0, BigInt(counter));
	const mac = new DataView(await crypto.subtle.sign("HMAC", key, msg.buffer));
	const offset = mac.getUint8(mac.byteLength - 1) & 0xf;
	const value = (mac.getUint32(offset) & 0x7fff_ffff) % 10 ** totp.digits;
	return {
		code: value.toString().padStart(totp.digits, "0"),
		remaining: (counter + 1) * totp.period - unix_secs,
	};
}

const WIFI_SECURITIES = ["WPA", "nopass"] as const;
type WifiSecurity = (typeof WIFI_SECURITIES)[number];
type Wifi = {
	ssid: string;
	password: string;
	security: WifiSecurity;
	hidden: boolean;
};

function _wifiEscape(s: string): string {
	return s.replace(/[\\;,:"]/g, (c) => `\\${c}`);
}

/// WIFI:T:WPA;S:SSID;P:PASSWORD;H:true;; (the ZXing format, read by Android and iOS cameras)
function buildWifi(wifi: Wifi): string {
	let payload = `WIFI:T:${wifi.security};S:${_wifiEscape(wifi.ssid)};`;
	if (wifi.security !== "nopass") payload += `P:${_wifiEscape(wifi.password)};`;
	if (wifi.hidden) payload += "H:true;";
	return payload + ";";
}

/// null if not a WIFI: network, or not a supported one (WEP)
function parseWifi(payload: string): Wifi | null {
	if (!payload.startsWith("WIFI:")) return null;
	const fields = new Map<string, string>();
	let key = "";
	let value = "";
	let in_value = false;
	for (let i = 5; i < payload.length; i++) {
		const c = payload[i];
		if (c === "\\" && i + 1 < payload.length) {
			value += payload[++i];
		} else if (!in_value && c === ":") {
			key = value;
			value = "";
			in_value = true;
		} else if (c === ";") {
			if (in_value) fields.set(key.toUpperCase(), value);
			key = value = "";
			in_value = false;
		} else {
			value += c;
		}
	}
	const ssid = fields.get("S");
	if (ssid === undefined) return null;
	const t = (fields.get("T") ?? "nopass").toUpperCase();
	let security: WifiSecurity;
	if (t === "WPA" || t === "WPA2" || t === "WPA3" || t === "SAE") security = "WPA";
	else if (t === "NOPASS" || t === "") security = "nopass";
	else return null;
	return {
		ssid,
		password: fields.get("P") ?? "",
		security,
		hidden: (fields.get("H") ?? "").toLowerCase() === "true",
	};
}
