/// <reference types="node" />
// Not in a tsconfig: the root one compiles the client, e2e/tsconfig.json the tests
import { defineConfig, devices } from "@playwright/test";

/// Port of the server started for the tests, see e2e/config.toml
const PORT = 3100;

export default defineConfig({
	testDir: "./e2e",
	outputDir: "./target/test-results",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? "github" : "list",
	use: {
		baseURL: `http://127.0.0.1:${PORT}`,
		// Strings are asserted in english
		locale: "en-US",
		trace: "retain-on-failure",
	},
	projects: [
		{ name: "chromium", use: { ...devices["Desktop Chrome"] } },
		{ name: "firefox", use: { ...devices["Desktop Firefox"] } },
		{ name: "webkit", use: { ...devices["Desktop Safari"] } },
	],
	webServer: {
		// build.rs compiles and inlines the client, so this also tests the shipped index.html and its CSP
		command: "cargo run -- run --config e2e/config.toml",
		url: `http://127.0.0.1:${PORT}/config`,
		// The first run builds the server
		timeout: 600_000,
		reuseExistingServer: false,
		stdout: "ignore",
		stderr: "pipe",
	},
});
