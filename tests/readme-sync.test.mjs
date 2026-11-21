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

const PROMPT_URLS = [
	"https://github.com/Frankkk1912/ai4s-literature-workbench.git",
	"https://raw.githubusercontent.com/Frankkk1912/ai4s-literature-workbench/main/INSTALL.md",
];
const INSTALL_PROMPTS = {
	"README.md": `Please install the plugin from
https://github.com/Frankkk1912/ai4s-literature-workbench.git
into this app. Follow INSTALL.md exactly, and if you cannot open the repository read
https://raw.githubusercontent.com/Frankkk1912/ai4s-literature-workbench/main/INSTALL.md
Do not add steps of your own. When it's done, tell me in plain language what works now and what I need to do myself.`,
	"README_CN.md": `请帮我从
https://github.com/Frankkk1912/ai4s-literature-workbench.git
安装这个插件到当前应用。严格按 INSTALL.md 操作；如果打不开仓库，就读
https://raw.githubusercontent.com/Frankkk1912/ai4s-literature-workbench/main/INSTALL.md
不要自己添加步骤。装好后，用通俗的话告诉我现在能用什么、我自己还需要做什么。`,
};

// ASCII URL, then the next source character. A full-width 。 glued on becomes part of the link.
function nonAsciiRightAfterUrl(text) {
	const bad = [];
	for (const m of text.matchAll(/https?:\/\/[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+/g)) {
		const next = text[m.index + m[0].length];
		if (next !== undefined && next.charCodeAt(0) > 127) bad.push(`${m[0]}${next}`);
	}
	return bad;
}

test("the install prompt is the same in both languages' sources of truth", () => {
	const raw = PROMPT_URLS[1];
	for (const name of READMES) {
		const page = read(name);
		assert.ok(page.includes(INSTALL_PROMPTS[name]), `${name}: install prompt drifted`);
		assert.ok(page.includes(PROMPT_URLS[0]), `${name}: install address`);
		assert.ok(page.includes("INSTALL.md"), `${name}: does not point at INSTALL.md`);
		assert.ok(page.includes(raw), `${name}: raw INSTALL.md URL`);
		assert.match(page, /ChatGPT/);
		const prompt = INSTALL_PROMPTS[name];
		assert.deepEqual(nonAsciiRightAfterUrl(prompt), [], `${name}: a prompt URL is glued to non-ASCII text`);
		for (const url of PROMPT_URLS) {
			assert.ok(prompt.split("\n").includes(url), `${name}: ${url} is not on its own line`);
		}
	}
	const setup = read("skills/ai4s-setup/SKILL.md");
	assert.ok(setup.split("\n").some((line) => line.trim() === raw), "ai4s-setup: raw INSTALL.md URL is not alone on its line");
	assert.match(read("docs/getting-started.md"), /ChatGPT desktop/);
	assert.match(read("docs/getting-started_CN.md"), /ChatGPT/);
	for (const name of [...READMES, "docs/getting-started.md", "docs/getting-started_CN.md"]) {
		assert.doesNotMatch(
			read(name),
			/WorkBuddy and CodeBuddy have not been tested|WorkBuddy 与 CodeBuddy 目前还没有在真实电脑上测试过/,
			`${name}: still says WorkBuddy was never tested`,
		);
	}
});

test("negative control: a URL glued to full-width punctuation is caught", () => {
	const glued = "https://raw.githubusercontent.com/Frankkk1912/ai4s-literature-workbench/main/INSTALL.md。不要";
	assert.deepEqual(nonAsciiRightAfterUrl(glued), [
		"https://raw.githubusercontent.com/Frankkk1912/ai4s-literature-workbench/main/INSTALL.md。",
	]);
	assert.deepEqual(nonAsciiRightAfterUrl(`${glued.split("。")[0]}\n不要`), []);
});

test("the README's Claude Desktop route names the file the release builds", () => {
	for (const name of READMES) assert.match(read(name), /ai4s-literature-zotero-<(version|版本号)>\.mcpb/);
	assert.match(install, /ai4s-literature-zotero-<version>\.mcpb/);
	assert.match(read("scripts/package-release.mjs"), /ai4s-literature-zotero-\$\{version\}\.mcpb/);
	assert.ok(manifestText.includes(".mcpb"));
});

test("READMEs and getting-started pages keep Claude desktop upload separate from tools", () => {
	for (const file of [...READMES, "docs/getting-started.md", "docs/getting-started_CN.md"]) {
		const text = read(file);
		assert.match(text, /Upload plugin/);
		assert.match(text, /Add marketplace/);
		assert.match(text, /\/reload-plugins/);
		assert.ok(text.includes("~/Library/Application Support/Claude/"), `${file}: missing protected-config warning`);
		assert.doesNotMatch(text, /if your Claude Desktop agent can edit files|如果你的 Claude Desktop 里的 [Aa]gent 能编辑文件/);
		for (const block of text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
			assert.doesNotMatch(block[1], /\[[^\]]+\]\(https?:\/\//, `${file}: Markdown link inside a code block`);
		}
	}
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
		const start = read(name).indexOf(name === "README.md" ? "## 🚀 Quick Start" : "## 🚀 快速开始");
		assert.notEqual(start, -1, `${name}: beginner section heading missing`);
		const end = read(name).indexOf("<details>", start);
		assert.ok(end > start, `${name}: beginner section has no manual-install details`);
		assert.doesNotMatch(read(name).slice(start, end), /npm (ci|run)|node scripts\/bootstrap/, `${name}: the beginner path mentions a build`);
	}
});

test("negative control: the command extractor sees a command that INSTALL.md lacks", () => {
	const fake = "```bash\nclaude plugin install nothing-real@nowhere\n```";
	const lines = commands(fake);
	assert.deepEqual(lines, ["claude plugin install nothing-real@nowhere"]);
	assert.equal(normal(install).includes(lines[0]), false);
});
