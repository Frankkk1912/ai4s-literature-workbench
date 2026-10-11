import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
	defaultPrivateEnvFile,
	legacyPrivateEnvFile,
	loadStartupEnvFiles,
	preferredPrivateEnvFile,
	startupEnvFiles,
} from "../runtime/src/lib/env-files.ts";

test("historic ~/.config/ai4s-literature-workbench/zotero.env remains the legacy path", () => {
	assert.equal(
		legacyPrivateEnvFile("/Users/example"),
		"/Users/example/.config/ai4s-literature-workbench/zotero.env",
	);
	assert.equal(
		legacyPrivateEnvFile("C:\\Users\\Frank"),
		"C:\\Users\\Frank\\.config\\ai4s-literature-workbench\\zotero.env",
	);
});

test("native private env paths stay platform-specific", () => {
	assert.equal(
		defaultPrivateEnvFile({}, "darwin", "/Users/example"),
		"/Users/example/Library/Application Support/ai4s-literature-workbench/zotero.env",
	);
	assert.equal(
		defaultPrivateEnvFile(
			{ LOCALAPPDATA: "C:\\Users\\Frank\\AppData\\Local" },
			"win32",
			"C:\\Users\\Frank",
		),
		"C:\\Users\\Frank\\AppData\\Local\\ai4s-literature-workbench\\zotero.env",
	);
	assert.equal(
		defaultPrivateEnvFile({ XDG_CONFIG_HOME: "/srv/config" }, "linux", "/home/example"),
		"/srv/config/ai4s-literature-workbench/zotero.env",
	);
});

test("LITERATURE_ZOTERO_MCP_ENV_FILE overrides the interactive private env target", () => {
	assert.equal(
		preferredPrivateEnvFile(
			{ LITERATURE_ZOTERO_MCP_ENV_FILE: "/secure/zotero.env" },
			"darwin",
			"/Users/example",
		),
		"/secure/zotero.env",
	);
});

test("startup env order keeps legacy before native when they differ, then the explicit override", () => {
	const env = { LITERATURE_ZOTERO_MCP_ENV_FILE: "/secure/zotero.env" };
	const files = startupEnvFiles(env);
	const legacy = legacyPrivateEnvFile();
	const native = defaultPrivateEnvFile(env);
	if (legacy === native) {
		assert.equal(files.filter((file) => file === native).length, 1);
	} else {
		assert.ok(files.indexOf(legacy) >= 0);
		assert.ok(files.indexOf(native) > files.indexOf(legacy));
	}
	assert.equal(files.at(-1), "/secure/zotero.env");
});

test("legacy env file values load, and a later native file overrides them", () => {
	const dir = mkdtempSync(join(tmpdir(), "ai4s-env-files-"));
	try {
		const legacy = join(dir, "legacy.env");
		const native = join(dir, "native.env");
		writeFileSync(legacy, "ZOTERO_API_KEY=legacy-secret\nZOTEUS_LOCAL=off\n", "utf8");
		writeFileSync(native, "ZOTERO_API_KEY=native-secret\n", "utf8");

		const onlyLegacy = {};
		assert.deepEqual(
			loadStartupEnvFiles(onlyLegacy, [legacy, join(dir, "missing.env")]),
			[legacy],
		);
		assert.equal(onlyLegacy.ZOTERO_API_KEY, "legacy-secret");
		assert.equal(onlyLegacy.ZOTEUS_LOCAL, "off");

		const both = {};
		loadStartupEnvFiles(both, [legacy, native]);
		assert.equal(both.ZOTERO_API_KEY, "native-secret");
		assert.equal(both.ZOTEUS_LOCAL, "off");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
