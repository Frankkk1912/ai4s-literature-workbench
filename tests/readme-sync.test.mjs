// The README is what a beginner follows; INSTALL.md and the manifests are what the agent follows.
// These tests fail when a command or link in the README has no counterpart there.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const install = read("INSTALL.md");
const manifestText = read("install-manifest.json");
const READMES = ["README.md", "README_CN.md"];

// Lines inside ```bash / ```text fences that look like a command.
function commands(markdown) {
	const found = [];
	for (const block of markdown.matchAll(/```(?:bash|text|sh)\n([\s\S]*?)```/g)) {
		for (const line of block[1].split("\n").map((l) => l.trim())) {
			if (/^(claude |codex |node scripts\/|git clone |cd |\/plugin )/.test(line)) found.push(line);
		}
	}
	return found;
}

// A command typed from a checkout. Placeholders in the README may be spelled differently.
const normal = (line) => line.replace(/\/path\/to\/project|<project-folder>/g, "<target>");

test("every plugin install command in the README is also in INSTALL.md", () => {
	for (const name of READMES) {
		const lines = commands(read(name)).filter((l) => /^(claude|codex|node scripts\/install-host)/.test(l));
		assert.ok(lines.length >= 4, `${name}: expected the host commands`);
		const known = normal(install);
		for (const line of lines) assert.ok(known.includes(normal(line)), `${name}: "${line}" is not in INSTALL.md`);
	}
});

test("the bootstrap line in the README exists in INSTALL.md, and its script exists", () => {
	for (const name of READMES) {
		assert.ok(commands(read(name)).includes("node scripts/bootstrap.mjs"), `${name}: no bootstrap line`);
	}
	assert.ok(install.includes("scripts/bootstrap.mjs"));
	assert.ok(existsSync(new URL("../scripts/bootstrap.mjs", import.meta.url)));
});

test("the install prompt is the same in both languages' sources of truth", () => {
	for (const name of READMES) {
		assert.ok(read(name).includes("https://github.com/Frankkk1912/ai4s-literature-workbench.git"), `${name}: install address`);
		assert.ok(read(name).includes("INSTALL.md"), `${name}: does not point at INSTALL.md`);
	}
});

test("the README's Claude Desktop route names the file the release builds", () => {
	for (const name of READMES) assert.match(read(name), /ai4s-literature-zotero-<(version|版本号)>\.mcpb/);
	assert.match(install, /ai4s-literature-zotero-<version>\.mcpb/);
	assert.match(read("scripts/package-release.mjs"), /ai4s-literature-zotero-\$\{version\}\.mcpb/);
	assert.ok(manifestText.includes(".mcpb"));
});

test("every relative link in the README and the getting-started pages points at a file that exists", () => {
	const files = [...READMES, "docs/getting-started.md", "docs/getting-started_CN.md"];
	for (const file of files) {
		const base = new URL(`../${file}`, import.meta.url);
		// Screenshot placeholders live in HTML comments until the pictures exist.
		const visible = read(file).replace(/<!--[\s\S]*?-->/g, "");
		for (const m of visible.matchAll(/\]\((?!https?:|#|mailto:)([^)\s#]+)(#[^)]*)?\)/g)) {
			assert.ok(existsSync(new URL(m[1], base)), `${file}: broken link ${m[1]}`);
		}
	}
});

test("what a beginner reads names no internal ID and does not send them to a build", () => {
	for (const file of ["docs/getting-started.md", "docs/getting-started_CN.md", "docs/zotero-xpi.md"]) {
		assert.doesNotMatch(read(file), /\b(D12|R12|M4|T5\.2)\b/, `${file} names an internal ID`);
	}
	for (const name of READMES) {
		const start = read(name).indexOf(name === "README.md" ? "## Get started" : "## 开始使用");
		const end = read(name).indexOf("<details>", start);
		assert.doesNotMatch(read(name).slice(start, end), /npm (ci|run)|node scripts\/bootstrap/, `${name}: the beginner path mentions a build`);
	}
});

test("negative control: the command extractor sees a command that INSTALL.md lacks", () => {
	const fake = "```bash\nclaude plugin install nothing-real@nowhere\n```";
	const lines = commands(fake);
	assert.deepEqual(lines, ["claude plugin install nothing-real@nowhere"]);
	assert.equal(normal(install).includes(lines[0]), false);
});

// --- DeepSeek Harness ---------------------------------------------------------------------

// The README may offer a route only while it says, in the same section, that it is untested.
function saysUntested(text, pattern) {
	return pattern.test(text);
}

test("both READMEs carry the DeepSeek Harness block, with the release file and an untested warning", () => {
	const asset = /dsh-ai4s-literature-workbench-<(version|版本号)>\.tgz/;
	for (const name of READMES) {
		const text = read(name);
		assert.match(text, asset, `${name}: no DeepSeek Harness download line`);
		assert.ok(text.includes("releases/latest/download/dsh-ai4s-literature-workbench.tgz"), `${name}: the fixed-name address is missing`);
		const start = text.indexOf("**DeepSeek Harness**");
		assert.notEqual(start, -1, `${name}: no DeepSeek Harness install block`);
		const block = text.slice(start, text.indexOf("**Claude Code", start));
		assert.ok(saysUntested(block, /not yet tested|还没有在真实电脑上测试过/), `${name}: the block does not say it is untested`);
		assert.doesNotMatch(block, /npm |node scripts|\bdsh plugin\b/, `${name}: the block sends a beginner to a command`);
	}
	assert.match(install, /dsh-ai4s-literature-workbench-<version>\.tgz/);
	assert.ok(install.includes("releases/latest/download/dsh-ai4s-literature-workbench.tgz"));
});

test("the getting-started pages list DeepSeek Harness and keep the untested warning", () => {
	for (const file of ["docs/getting-started.md", "docs/getting-started_CN.md"]) {
		const text = read(file);
		assert.match(text, /dsh-ai4s-literature-workbench-<(version|版本号)>\.tgz/, `${file}: no DeepSeek Harness row`);
		assert.ok(saysUntested(text, /not yet tested|还没有在真实电脑上测试过/), `${file}: no untested warning`);
	}
});

test("negative control: a block without the untested warning is noticed", () => {
	assert.equal(saysUntested("**DeepSeek Harness** (Desktop)", /not yet tested/), false);
	assert.equal(saysUntested("**DeepSeek Harness** (not yet tested on a real machine)", /not yet tested/), true);
});
