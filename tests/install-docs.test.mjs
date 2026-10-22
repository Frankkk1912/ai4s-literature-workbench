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
	assert.equal(runtime.length, 19);
	assert.ok(sameList(runtime, bundles), "scripts/verify-bundles.mjs is out of step with WORKBENCH_TOOL_NAMES");
	assert.ok(sameList(runtime, verifyRuntime), "scripts/verify-runtime.mjs is out of step with WORKBENCH_TOOL_NAMES");
	assert.ok(runtime.includes("setup_status") && runtime.includes("open_setup"));
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

test("the setup skill is registered and ships in the plugin archive", () => {
	const registry = JSON.parse(read("bundle-manifest.json"));
	assert.ok(registry.bundles.some((b) => b.id === "ai4s-setup" && b.path === "skills/ai4s-setup"));
	// package-release copies the whole skills folder, so a registered skill needs no extra line.
	assert.match(read("scripts/package-release.mjs"), /copyTree\(join\(repoRoot, 'skills'\)/);
});

// --- DeepSeek Harness ---------------------------------------------------------------------

const dshRoute = () => install.slice(install.indexOf("### DeepSeek Harness"), install.indexOf("## Not in any install route"));
const WHAT_IS_UNTESTED = [/Plugins page/, /Desktop's own Node/, /Windows/, /open_setup/, /DeepSeek models/];

// True when a route's text admits every open risk instead of leaving one out.
function admitsUntested(text) {
	return WHAT_IS_UNTESTED.every((pattern) => pattern.test(text));
}

test("the DeepSeek Harness route is marked unverified and names the release asset", () => {
	const host = manifest.hosts["deepseek-harness"];
	assert.ok(host, "install-manifest.json has no deepseek-harness route");
	assert.equal(host.status, "unverified");
	assert.match(install, /^### DeepSeek Harness \(unverified\)$/m);
	assert.match(host.asset, /^dsh-ai4s-literature-workbench-<version>\.tgz$/);
	assert.equal(host.asset_fixed_name, "dsh-ai4s-literature-workbench.tgz");
	for (const text of [dshRoute(), JSON.stringify(host)]) assert.ok(text.includes("dsh-ai4s-literature-workbench"), "the route does not name the package file");
	// The release builds the files the route tells people to download.
	const packaging = read("scripts/package-release.mjs");
	assert.ok(packaging.includes("dsh-ai4s-literature-workbench-${version}.tgz"));
	assert.ok(packaging.includes("dsh-ai4s-literature-workbench.tgz"));
	assert.ok(host.address.endsWith("/releases/latest/download/dsh-ai4s-literature-workbench.tgz"));
	assert.ok(dshRoute().includes(host.address));
});

test("the DeepSeek Harness route admits what has not been tested, and claims no more", () => {
	assert.ok(admitsUntested(dshRoute()), "INSTALL.md leaves an open risk out of the DeepSeek Harness route");
	const open = manifest.hosts["deepseek-harness"].not_yet_tested;
	assert.ok(open.length >= 5 && open.some((item) => /Windows/.test(item)) && open.some((item) => /Electron/.test(item)));
	assert.doesNotMatch(dshRoute(), /\b(verified on|works on) (Desktop|Windows)/i);
	assert.match(dshRoute(), /Not yet tested/);
	// Keys: never in the package, never typed into the Plugins page.
	assert.doesNotMatch(dshRoute(), /paste (a|your|the) key/i);
});

test("negative control: a route that forgets an open risk is noticed", () => {
	assert.equal(admitsUntested("Plugins page, Desktop's own Node, Windows, open_setup, DeepSeek models"), true);
	assert.equal(admitsUntested("Plugins page, Desktop's own Node, open_setup, DeepSeek models"), false);
});

test("the package source and the install manifest agree on the package name and the host range", () => {
	const source = JSON.parse(read("dsh-plugin/package.json"));
	assert.equal(source.name, "dsh-ai4s-literature-workbench");
	assert.equal(source.version, JSON.parse(read(".claude-plugin/plugin.json")).version);
	assert.ok(manifest.hosts["deepseek-harness"].engines.includes(source.engines.dsh));
	assert.ok(dshRoute().includes("19 and 6"));
});
