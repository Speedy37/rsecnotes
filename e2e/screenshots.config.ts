import { defineConfig, devices } from "@playwright/test";
import base from "../playwright.config";

/// Generates the README screenshots in docs/assets, against the same server as the tests
export default defineConfig({
	...base,
	testDir: ".",
	testMatch: "screenshots.ts",
	outputDir: "../target/test-results",
	fullyParallel: false,
	retries: 0,
	use: {
		...base.use,
		...devices["Desktop Chrome"],
		viewport: { width: 900, height: 900 },
		deviceScaleFactor: 2,
		colorScheme: "dark",
	},
	projects: [{ name: "screenshots" }],
	// Paths are relative to this file, the server is started from the repository root
	webServer: { ...base.webServer!, cwd: ".." } as typeof base.webServer,
});
