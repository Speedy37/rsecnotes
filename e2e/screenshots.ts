import { expect, test } from "@playwright/test";

/// README screenshots, run with `npm run screenshots` (see screenshots.config.ts)
const shot = (name: string) => ({ path: `docs/assets/rsecnotes_${name}.png`, fullPage: true });

const TEXT = `Hi Alice,

Here is the access to the staging server, the password is below.
The certificate and the configuration are attached.

ssh deploy@staging.example.com`;

test("README screenshots", async ({ page }) => {
	await page.goto("/");
	await page.locator("#input_note").fill(TEXT);
	await page.locator("#input_file").setInputFiles([
		{ name: "staging.crt", mimeType: "application/x-x509-ca-cert", buffer: Buffer.alloc(1_870) },
		{ name: "config.yaml", mimeType: "text/yaml", buffer: Buffer.alloc(2_950) },
	]);
	await page.locator("#input_pwd_checkbox").check();
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
	await page.screenshot(shot("create"));

	await page.locator("#input_createbtn").click();
	const link = await page.locator("#link_url").inputValue();
	await expect(page.locator("#link_qrcode img")).toBeVisible();
	await page.screenshot(shot("link"));

	await page.goto(link);
	await expect(page.locator("#consume_btn")).toBeVisible();
	await page.screenshot(shot("warn"));

	await page.locator("#consume_btn").click();
	await expect(page.locator("#read_settings_status")).toHaveClass(/last-view/);
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
	await page.screenshot(shot("read"));
});
