// The install docs and the skills tell agents which tools to call. These tests keep that
// text in step with the tools that exist, and keep the exact tool lists that the
// verification scripts assert from drifting away from the runtime's own list.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const manifest = JSON.parse(read("install-manifest.json"));
const install = read("INSTALL.md");
const SKILLS = ["literature-research", "literature-manager", "literature-writing"];
const skill = (name) => read(`skills/${name}/SKILL.md`);

// Quoted tool names inside the first array or Set literal that follows `marker`.
function namesAfter(source, marker) {
	const start = source.indexOf(marker);
	assert.notEqual(start, -1, `${marker} not found`);
	const open = source.indexOf("[", start);
	const close = source.indexOf("]", open);
	return [...source.slice(open, close).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
}

function sameList(actual, expected) {
	return JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}

test("the runtime's workbench list, verify-bundles and verify-runtime name the same tools", () => {
	const runtime = namesAfter(read("runtime/src/server.ts"), "WORKBENCH_TOOL_NAMES = new Set(");
	const bundles = namesAfter(read("scripts/verify-bundles.mjs"), "const EXPECTED_RUNTIME_TOOLS");
	const verifyRuntime = namesAfter(read("scripts/verify-runtime.mjs"), "const expected");
	assert.equal(runtime.length, 22);
	assert.ok(sameList(runtime, bundles), "scripts/verify-bundles.mjs is out of step with WORKBENCH_TOOL_NAMES");
	assert.ok(sameList(runtime, verifyRuntime), "scripts/verify-runtime.mjs is out of step with WORKBENCH_TOOL_NAMES");
	assert.ok(runtime.includes("setup_status") && runtime.includes("open_setup") && runtime.includes("install_search_helper"));
});

test("negative control: the list comparison notices a missing or extra tool", () => {
	assert.equal(sameList(["a", "b"], ["a", "b"]), true);
	assert.equal(sameList(["a", "b"], ["a"]), false);
	assert.equal(sameList(["a"], ["a", "c"]), false);
});

test("the tools the docs and skills name exist", () => {
	const sources = readdirSync(new URL("../runtime/src/tools/", import.meta.url))
		.map((name) => read(`runtime/src/tools/${name}`))
		.join("\n");
	for (const name of ["setup_status", "open_setup"]) {
		assert.match(sources, new RegExp(`name: '${name}'`), `${name} is not a registered tool`);
	}
});

test("INSTALL.md and install-manifest.json describe the setup tools and the launchers", () => {
	for (const text of [install, JSON.stringify(manifest)]) {
		for (const word of ["setup_status", "open_setup", "Setup AI4S.bat", "Setup AI4S.command", "--setup", "ai4s-setup"]) {
			assert.ok(text.includes(word), `${word} is missing`);
		}
	}
	assert.equal(manifest.first_run.skill, "ai4s-setup");
	assert.equal(manifest.first_run.status_tool, "setup_status");
	assert.equal(manifest.keys.tool, "open_setup");
	assert.deepEqual(manifest.keys.available_keys, ["zotero", "pubmed", "easyscholar"]);
	assert.doesNotMatch(install, /not available yet|is planned/i, "INSTALL.md still says key setup is missing");
	assert.doesNotMatch(JSON.stringify(manifest.get_files.release_archive), /not in the archive, so the skills skip/);
});

test("INSTALL.md keeps keys out of chat and onboard.mjs out of the beginner path", () => {
	assert.match(install, /Never ask for a key in chat and never put one in a command/);
	const mentions = install.split("\n").filter((line) => line.includes("onboard.mjs"));
	assert.equal(mentions.length, 1);
	assert.match(mentions[0], /developers/);
});

test("every skill starts by calling setup_status and stops with the agreed words", () => {
	for (const name of SKILLS) {
		const text = skill(name);
		assert.match(text, /## Step 0/, `${name} has no Step 0`);
		assert.ok(text.includes("setup_status"), `${name} does not call setup_status`);
		assert.ok(text.includes("My search tools are not connected yet"), `${name} has no stop message`);
		assert.ok(text.includes("ai4s-setup"), `${name} gives no next action`);
		assert.ok(text.indexOf("setup_status") < text.indexOf("## Overview"), `${name}: the check must come before the work`);
	}
});

test("no skill sends a beginner to onboard.mjs, and none names an internal ID", () => {
	for (const name of [...SKILLS, "ai4s-setup"]) {
		const text = skill(name);
		assert.doesNotMatch(text, /onboard\.mjs/, `${name} mentions onboard.mjs`);
		assert.doesNotMatch(text, /\b(D12|R12|M4|T5\.2)\b/, `${name} names an internal ID`);
	}
});

test("INSTALL.md and install-manifest.json agree on the archive check and the Windows host results", () => {
	const blob = JSON.stringify(manifest);
	assert.equal(manifest.get_files.release_archive.status, "published");
	assert.match(manifest.get_files.release_archive.note, /\.codex-plugin\/plugin\.json/);
	for (const phrase of [
		"https://raw.githubusercontent.com/Frankkk1912/ai4s-literature-workbench/main/.codex-plugin/plugin.json",
		"ChatGPT desktop",
		"config.toml",
		"Skills are not loaded by this route",
		"uv 0.13.7",
		"bundle/index.mjs",
	]) {
		assert.ok(install.includes(phrase), `INSTALL.md missing ${phrase}`);
		assert.ok(blob.includes(phrase), `install-manifest.json missing ${phrase}`);
	}
	assert.equal(manifest.hosts["chatgpt-desktop"].routes.mcp_config.status, "verified");
	assert.equal(manifest.hosts["chatgpt-desktop"].routes.mcp_config.verified_on, "Windows 11");
	assert.equal(manifest.hosts["chatgpt-desktop"].routes.codex_plugin.status, "unverified");
	assert.equal(manifest.hosts.workbuddy.routes.marketplace.status, "unverified");
	assert.equal(manifest.hosts.workbuddy.routes.mcp_json.status, "verified");
	assert.equal(manifest.hosts.workbuddy.routes.mcp_json.verified_on, "Windows 11");
	assert.equal(manifest.hosts.codebuddy.status, "unverified");
	const setup = read("skills/ai4s-setup/SKILL.md");
	assert.match(setup, /ChatGPT desktop/);
	assert.match(setup, /\.codex-plugin\/plugin\.json/);
	assert.match(setup, /config\.toml/);
	assert.match(setup, /https:\/\/raw\.githubusercontent\.com\/Frankkk1912\/ai4s-literature-workbench\/main\/INSTALL\.md/);
	assert.doesNotMatch(setup, /blob\/main\/INSTALL\.md/);
	assert.doesNotMatch(install, /Use the release archive whenever the releases page lists one/);
});

test("the setup skill follows the plan: INSTALL.md, setup_status, open_setup, launchers, a real search", () => {
	const text = skill("ai4s-setup");
	assert.match(text, /^name: ai4s-setup$/m);
	for (const word of [
		"INSTALL.md",
		"setup_status",
		"open_setup",
		"Setup AI4S.bat",
		"Setup AI4S.command",
		"node runtime/bundle/index.mjs --setup",
		"literature_search.py review",
		"Never ask for a key in chat",
		"My search tools are not connected yet",
		"Works now",
		"Needs you",
		"Optional",
	]) {
		assert.ok(text.includes(word), `ai4s-setup does not mention ${word}`);
	}
	// The one-line terminal command comes only after the double-click file failed.
	assert.ok(text.indexOf("Setup AI4S.bat") < text.indexOf("node runtime/bundle/index.mjs --setup"));
	assert.match(text, /Only if the double-click file also failed/);
	assert.ok(existsSync(new URL("../skills/ai4s-setup/agents/openai.yaml", import.meta.url)));
});

test("the search skills use the helper the workbench downloads, not one the user installs", () => {
	for (const name of ["literature-research", "literature-manager", "ai4s-setup"]) {
		const text = skill(name);
		assert.ok(text.includes("install_search_helper"), `${name} does not offer install_search_helper`);
		assert.ok(text.includes("search_helper.run"), `${name} does not say what replaces uv run`);
		// The official installer is the fallback, offered only after the download failed.
		const official = text.indexOf("official installer");
		if (official !== -1) assert.ok(text.indexOf("install_search_helper") < official, `${name}: official installer comes first`);
	}
	assert.match(install, /search_helper\.run/);
});

test("the setup skill is registered and ships in the plugin archive", () => {
	const registry = JSON.parse(read("bundle-manifest.json"));
	assert.ok(registry.bundles.some((b) => b.id === "ai4s-setup" && b.path === "skills/ai4s-setup"));
	// package-release copies the whole skills folder, so a registered skill needs no extra line.
	assert.match(read("scripts/package-release.mjs"), /copyTree\(join\(repoRoot, 'skills'\)/);
});

test("Claude routes distinguish terminal, desktop Code and Chat's zip plus two extensions", () => {
	const terminal = install.split("### Claude Code terminal\n")[1].split("### Claude desktop Code tab\n")[0];
	const code = install.split("### Claude desktop Code tab\n")[1].split("### Codex\n")[0];
	const chat = install.split("### Claude desktop Chat\n")[1].split("## Check at the end\n")[0];
	assert.match(terminal, /claude plugin marketplace add Frankkk1912\/ai4s-literature-workbench/);
	assert.match(terminal, /terminal Claude Code prompt/);
	assert.match(code, /`\/plugin` opens Settings → Plugins/);
	assert.match(code, /Add → Upload plugin/);
	assert.match(code, /Alternative \(unverified\).*Add → Add marketplace/);
	assert.match(code, /\/reload-plugins/);
	assert.match(code, /MCP startup.*not yet verified/);
	assert.match(chat, /all four skills/);
	assert.match(chat, /Chat ignores plugin-local MCP/);
	assert.match(chat, /Install two separate/);
	for (const server of ["zotero", "fulltext"]) {
		assert.ok(chat.includes(`ai4s-literature-${server}-<version>.mcpb`));
	}
	assert.match(chat, /both unverified live/);
	assert.match(chat, /If either file is missing or not listed/);
	assert.match(chat, /fulltext_capabilities/);
	assert.doesNotMatch(chat, /full.text tools are currently unavailable|Zotero tools only|does not.*make full-text tools available/i);
	const fallback = JSON.parse(chat.match(/```json\n([\s\S]*?)```/)[1]).mcpServers;
	assert.deepEqual(Object.keys(fallback).sort(), ["ai4s-literature-fulltext", "ai4s-literature-zotero"]);
	assert.deepEqual(fallback["ai4s-literature-fulltext"].args, ["<plugin-root>/fulltext-runtime/bundle/index.mjs"]);
	assert.equal(fallback["ai4s-literature-fulltext"].env, undefined);
	assert.deepEqual(fallback["ai4s-literature-zotero"].env, { LITERATURE_ZOTERO_MCP_TOOL_PROFILE: "workbench" });
	assert.deepEqual(manifest.hosts["claude-desktop"].routes.mcpb.assets, [
		"ai4s-literature-zotero-<version>.mcpb", "ai4s-literature-fulltext-<version>.mcpb",
	]);
	assert.match(chat, /Never read, create, back up, or edit files under/);
	assert.ok(chat.indexOf("**1. Upload") < chat.indexOf("**2. Install"));
	assert.ok(chat.indexOf("**2. Install") < chat.indexOf("**3. Last resort"));
	assert.equal(manifest.hosts["claude-desktop-code"].routes.upload_plugin.status, "verified");
	assert.equal(manifest.hosts["claude-desktop-code"].routes.upload_plugin.mcp_startup_status, "unverified");
	assert.equal(manifest.hosts["claude-desktop-code"].routes.marketplace.status, "unverified");
	assert.equal(manifest.hosts["claude-desktop"].routes.upload_plugin.status, "verified");
	assert.equal(manifest.hosts["claude-desktop"].routes.mcpb.status, "unverified");
	assert.equal(manifest.hosts["claude-desktop"].routes.mcp_config.user_only, true);
});

test("the setup skill recognizes Claude Chat before asking which app", () => {
	const text = skill("ai4s-setup");
	const detect = text.split("## Step 2:")[1].split("## Step 3:")[0];
	assert.match(detect, /skills are visible but neither `setup_status` nor any `zotero_\*` tools/);
	assert.match(detect, /host looks like Claude desktop Chat or cannot run commands/);
	assert.match(detect, /Do not\n\s+ask which app/);
	assert.match(detect, /Ask once only when the host is genuinely unclear/);
	assert.match(detect, /Never read or edit anything under/);
	assert.match(detect, /Do not retry permission requests/);
	assert.match(detect, /Do not run Steps 3–6/);
	assert.match(detect, /ai4s-literature-fulltext-<version>\.mcpb/);
	assert.match(detect, /no required settings/);
	assert.match(detect, /not live-verified/);
});

test("key onboarding lists only missing keys and mentions how to change configured keys", () => {
	const allSet = "All keys are set; ask for the key page any time to change one.";
	for (const text of [install, skill("ai4s-setup"), manifest.first_run.finish]) {
		assert.ok(text.includes(allSet), "all-set onboarding reminder missing");
		for (const flag of ["zotero_key_present", "pubmed_key_present", "easyscholar_key_present"]) {
			assert.ok(text.includes(flag), `missing setup_status presence flag: ${flag}`);
		}
		assert.match(text, /only missing keys|only keys.*not configured/);
	}
	const template = install.split("3. Report in this shape:")[1].split("4. Use")[0];
	assert.doesNotMatch(template, /Key page: Zotero key.*PubMed key.*EasyScholar key/);
	assert.match(template, /only keys setup_status reports as not configured/);
});

test("install docs do not send people to the removed database browser or DeepSeek package", () => {
	for (const text of [install, JSON.stringify(manifest), read("README.md"), read("README_CN.md")]) {
		assert.doesNotMatch(text, /database-browser|database_browser|database_session|dsh-ai4s|DeepSeek Harness/);
	}
});
