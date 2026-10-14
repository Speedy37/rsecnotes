import { test as base, expect, type Browser, type BrowserContextOptions, type Page, type Request } from "@playwright/test";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as http from "node:http";

/// Secret of e2e/config.toml [server_settings.totp]
const TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

/// Current code of an authenticator app (RFC 6238: HMAC-SHA256, 6 digits, 30 seconds)
function totp(secret = TOTP_SECRET, unix_secs = Date.now() / 1000) {
	let bits = "";
	for (const c of secret) bits += "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(c).toString(2).padStart(5, "0");
	const key = Buffer.from(bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2)));
	const counter = Buffer.alloc(8);
	counter.writeBigUInt64BE(BigInt(Math.floor(unix_secs / 30)));
	const hash = createHmac("sha256", key).update(counter).digest();
	const offset = hash[hash.length - 1] & 0xf;
	return ((hash.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}

/// What a browser sent to the server, as it goes on the wire (the URL fragment is never sent)
type Sent = { method: string; target: string; headers: Record<string, string>; body: Buffer | null };

/// A page in its own browser context (another person), with what it sent and any CSP violation or script error.
/// Blob bodies (the encrypted notes) are not exposed by Chromium and WebKit, so `uploaded` gets them from the page.
type Person = { page: Page; sent: Promise<Sent>[]; uploaded: Buffer[]; problems: string[] };

const test = base.extend<{ person: (options?: BrowserContextOptions) => Promise<Person> }>({
	person: async ({ browser, baseURL, locale }, use) => {
		const people: Person[] = [];
		await use(async (options) => {
			const person = await new_person(browser, { baseURL, locale, ...options });
			people.push(person);
			return person;
		});
		for (const { page, problems } of people) {
			expect(problems, "CSP violations and script errors").toEqual([]);
			await page.context().close();
		}
	},
});

async function new_person(browser: Browser, options: BrowserContextOptions): Promise<Person> {
	const context = await browser.newContext(options);
	const person: Person = { page: await context.newPage(), sent: [], uploaded: [], problems: [] };
	await context.exposeFunction("__csp_violation", (violation: string) => person.problems.push(violation));
	await context.exposeFunction("__uploaded", (base64: string) => person.uploaded.push(Buffer.from(base64, "base64")));
	await context.addInitScript(() => {
		document.addEventListener("securitypolicyviolation", (e) => {
			const target = e.target instanceof Element ? e.target.outerHTML.substring(0, 200) : `${e.target}`;
			const source = `${e.sourceFile.substring(0, 100)}:${e.lineNumber}:${e.columnNumber}`;
			(window as any).__csp_violation(`CSP ${e.violatedDirective} blocked ${e.blockedURI} at ${source} sample "${e.sample}" on ${target}`);
		});
		const send = XMLHttpRequest.prototype.send;
		XMLHttpRequest.prototype.send = function (body) {
			if (body instanceof Blob) {
				body.arrayBuffer().then((buffer) => {
					let binary = "";
					for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
					(window as any).__uploaded(btoa(binary));
				});
			}
			return send.call(this, body);
		};
	});
	// CSP violations are reported by the securitypolicyviolation event above, with more details than the console
	person.page.on("pageerror", (err) => person.problems.push(`page error: ${err.message}`));
	context.on("request", (request) => person.sent.push(sent(request)));
	return person;
}

async function sent(request: Request): Promise<Sent> {
	const url = new URL(request.url());
	return {
		method: request.method(),
		target: url.pathname + url.search,
		headers: await request.allHeaders(),
		body: request.postDataBuffer(),
	};
}

/// The server must only ever see ciphertext: neither the key nor any plaintext, in any request part
async function expect_never_sent(people: Person[], secrets: string[]) {
	expect(people.some((person) => person.uploaded.length > 0), "an uploaded note was captured").toBe(true);
	for (const person of people) {
		const bodies = person.uploaded.map((body) => ({ what: "uploaded note", body }));
		for (const { method, target, headers, body } of await Promise.all(person.sent)) {
			const what = `${method} ${target}`;
			if (body) bodies.push({ what: `${what} body`, body });
			for (const secret of secrets) {
				expect(target, what).not.toContain(secret);
				for (const [name, value] of Object.entries(headers)) expect(value, `${what} ${name}`).not.toContain(secret);
			}
		}
		for (const { what, body } of bodies) {
			for (const secret of secrets) expect(body.includes(Buffer.from(secret)), what).toBe(false);
		}
	}
}

/// Creates a note from the new note page already filled by `fill`, returns its share link and key
async function create_note(sender: Person, fill: (page: Page) => Promise<void>) {
	const page = sender.page;
	await page.goto("/");
	await page.locator("#input_note").waitFor();
	await fill(page);
	await page.locator("#input_createbtn").click();
	const link = await page.locator("#link_url").inputValue();
	const key = new URL(link).hash.substring(1);
	expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
	return { link, key };
}

/// Opens the link and shows the note, consuming a view
async function read_note(reader: Person, link: string) {
	const page = reader.page;
	await page.goto(link);
	await page.locator("#consume_btn").click();
}

async function expect_note_gone(reader: Person, link: string) {
	await read_note(reader, link);
	await expect(reader.page.locator("#consume_btn")).toHaveClass("error");
	await expect(reader.page.locator("#read_block")).toHaveCount(0);
}

test("serves the page with a strict CSP", async ({ person }) => {
	const { page } = await person();
	const response = await page.goto("/");
	const headers = response!.headers();
	expect(headers["content-security-policy"]).toMatch(/script-src 'sha256-/);
	expect(headers["referrer-policy"]).toBe("no-referrer");
	await expect(page.locator("#input_note")).toBeVisible();
	// Hidden without inline styles, which the CSP blocks
	await expect(page.locator("#btn_newnote")).toBeHidden();
	await expect(page.locator("#input_filelist")).toBeHidden();
});

test("about shows the version", async ({ person }) => {
	const { page } = await person();
	await page.goto("/");
	await page.locator("#input_note").waitFor();
	await page.getByRole("button", { name: "About" }).click();
	await expect(page.locator("#about .version")).toHaveText(/^v\d+\.\d+\.\d+/);
});

test("text note is readable once, then destroyed", async ({ person }) => {
	const text = "my secret text 🔐";
	const sender = await person();
	const { link, key } = await create_note(sender, (page) => page.locator("#input_note").fill(text));

	const reader = await person();
	await read_note(reader, link);
	await expect(reader.page.locator("#read_note")).toHaveValue(text);
	const status = reader.page.locator("#read_settings_status");
	await expect(status).toHaveClass(/last-view/);
	await expect(status).toHaveAttribute("role", "alert");

	await expect_note_gone(await person(), link);
	await expect_never_sent([sender, reader], [key, text]);
});

test("opening the link only consumes a view when showing the note", async ({ person }) => {
	const text = "not consumed by opening";
	const sender = await person();
	const { link } = await create_note(sender, (page) => page.locator("#input_note").fill(text));

	const opener = await person();
	await opener.page.goto(link);
	await expect(opener.page.locator("#consume_btn")).toBeVisible();

	const reader = await person();
	await read_note(reader, link);
	await expect(reader.page.locator("#read_note")).toHaveValue(text);
});

test("views limit", async ({ person }) => {
	const text = "two views";
	const sender = await person();
	const { link } = await create_note(sender, async (page) => {
		await page.locator("#input_note").fill(text);
		await page.locator("#input_remaining_views").fill("2");
	});

	const first = await person();
	await read_note(first, link);
	await expect(first.page.locator("#read_note")).toHaveValue(text);
	await expect(first.page.locator("#read_settings_status")).not.toHaveClass(/last-view/);

	const second = await person();
	await read_note(second, link);
	await expect(second.page.locator("#read_note")).toHaveValue(text);
	await expect(second.page.locator("#read_settings_status")).toHaveClass(/last-view/);

	await expect_note_gone(await person(), link);
});

test("expiration unit", async ({ person }) => {
	const sender = await person();
	await create_note(sender, async (page) => {
		await page.locator("#input_note").fill("expires in 2 minutes");
		// The default of 1h starts in hours
		const units = page.locator(".duration > .switch");
		await expect(units.locator(".selected")).toHaveText("hours");
		await page.locator("#input_expires_after").fill("2");
		await units.getByRole("button", { name: "minutes" }).click();
		await expect(units.locator(".selected")).toHaveText("minutes");
	});
	const [upload] = (await Promise.all(sender.sent)).filter(({ method, target }) => method === "POST" && target === "/notes");
	expect(upload.headers["x-note-expires-after"]).toBe("120");
});

test("a wrong key fails without showing anything",async ({ person }) => {
	const text = "wrong key";
	const sender = await person();
	const { link, key } = await create_note(sender, async (page) => {
		await page.locator("#input_note").fill(text);
		await page.locator("#input_remaining_views").fill("2");
	});

	// Same format, another key: fetched (a view is consumed) but the GCM tag does not match
	const wrong_key = (key[0] === "A" ? "B" : "A") + key.substring(1);
	const attacker = await person();
	await read_note(attacker, link.replace(`#${key}`, `#${wrong_key}`));
	const consume_btn = attacker.page.locator("#consume_btn");
	await expect(consume_btn).toHaveClass("error");
	await expect(consume_btn).toHaveText(/^Decryption failed/);
	await expect(attacker.page.locator("#read_block")).toHaveCount(0);

	// A malformed key is refused before fetching, without consuming a view
	const malformed = await person();
	await read_note(malformed, link.replace(`#${key}`, "#not-a-key"));
	await expect(malformed.page.locator("#consume_btn")).toHaveClass("error");

	const reader = await person();
	await read_note(reader, link);
	await expect(reader.page.locator("#read_note")).toHaveValue(text);
});

test("small notes are padded to the same size", async ({ person }) => {
	const sender = await person();
	await create_note(sender, (page) => page.locator("#input_note").fill("a"));
	await create_note(sender, (page) => page.locator("#input_note").fill("a longer text, still under the minimum padded length"));
	const [short, long] = sender.uploaded;
	// Version and IV (13 bytes), the minimum padded data length (128), GCM tag (16)
	expect(short.byteLength).toBe(157);
	expect(long.byteLength).toBe(short.byteLength);
});

test("generated credentials", async ({ person }) => {
	const sender = await person();
	let pwd = "";
	const { link, key } = await create_note(sender, async (page) => {
		await page.locator("#input_pwd_checkbox").check();
		const view = page.locator("#input_pwd .pwd");
		await expect(view).not.toHaveText("");
		pwd = (await view.textContent())!;
	});

	const reader = await person();
	await read_note(reader, link);
	await expect(reader.page.locator("#read_pwd .pwd")).toHaveText(pwd);
	await expect(reader.page.locator("#read_note")).toHaveCount(0);
	await expect_never_sent([sender, reader], [key, pwd]);
});

test("files", async ({ person }) => {
	const content = "file secret content\n";
	const sender = await person();
	const { link, key } = await create_note(sender, async (page) => {
		await page.locator("#input_file").setInputFiles({
			name: "secret.txt",
			mimeType: "text/plain",
			buffer: Buffer.from(content),
		});
		await expect(page.locator("#input_filelist")).toContainText("secret.txt");
	});

	const reader = await person();
	await read_note(reader, link);
	const filelist = reader.page.locator("#read_filelist");
	await expect(filelist).toContainText("secret.txt");
	const [download] = await Promise.all([
		reader.page.waitForEvent("download"),
		filelist.getByRole("button").click(),
	]);
	expect(download.suggestedFilename()).toBe("secret.txt");
	expect(await readFile(await download.path(), "utf8")).toBe(content);
	await expect_never_sent([sender, reader], [key, content.trim(), "secret.txt"]);
});

test("big notes require a TOTP code", async ({ person, baseURL }) => {
	// RFC 6238 appendix B SHA256, last 6 digits
	expect(totp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA", 59)).toBe("119246");

	// The server refuses big notes without a code before receiving them: only the headers are sent
	const big = Buffer.alloc(100 * 1024);
	const status = await new Promise<number | undefined>((resolve, reject) => {
		const post = http.request(`${baseURL}/notes`, { method: "POST", headers: { "content-length": big.byteLength } });
		post.on("response", (response) => {
			resolve(response.statusCode);
			post.destroy();
		});
		post.on("error", reject);
		post.flushHeaders();
	});
	expect(status).toBe(403);

	const sender = await person();
	const page = sender.page;
	await page.goto("/");
	await page.locator("#input_note").fill("big note");
	const input = page.locator("#input_totp");
	const create = page.locator("#input_createbtn");
	await expect(input).toBeHidden();
	await expect(create).toBeEnabled();

	await page.locator("#input_file").setInputFiles({ name: "big.bin", mimeType: "application/octet-stream", buffer: big });
	await expect(input).toBeVisible();
	await expect(create).toBeDisabled();

	const code = totp();
	await input.fill(((+code + 1) % 1_000_000).toString().padStart(6, "0"));
	await create.click();
	await expect(create).toHaveClass("error");
	await expect(create).toContainText("TOTP");
	// A refused code is cleared
	await expect(input).toHaveValue("");
	await expect(create).toBeDisabled();

	await input.fill(totp());
	await create.click();
	const link = await page.locator("#link_url").inputValue();

	const reader = await person();
	await read_note(reader, link);
	await expect(reader.page.locator("#read_filelist")).toContainText("big.bin");
});

test("copy buttons",async ({ person }) => {
	const text = "copied text";
	// Records what is copied, reading the clipboard back would need a permission
	const copying = async () => {
		const copier = await person();
		await copier.page.addInitScript(() => {
			navigator.clipboard.writeText = async (copied) => {
				(window as any).__copied = copied;
			};
		});
		return copier;
	};
	const clipboard = (page: Page) => page.evaluate(() => (window as any).__copied);

	const sender = await copying();
	const { link } = await create_note(sender, (page) => page.locator("#input_note").fill(text));
	await sender.page.locator("#link_block > .copy").click();
	expect(await clipboard(sender.page)).toBe(link);

	const reader = await copying();
	await read_note(reader, link);
	await reader.page.locator("#read_block .text-copy > .copy").click();
	expect(await clipboard(reader.page)).toBe(text);
});
