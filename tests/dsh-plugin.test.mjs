// The DeepSeek Harness package checks (scripts/verify-dsh-plugin.mjs) must pass on a sound
// package and fail on each way a package can be broken. The package here is built from the
// real patch and the real skills, with empty stand-ins for the two prebuilt servers.
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { expectedTools, inspectPackage, patchRows, sameTools, startServers } from "../scripts/verify-dsh-plugin.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));
const NAME = "dsh-ai4s-literature-workbench";
const pluginVersion = JSON.parse(readFileSync(join(repo, ".claude-plugin", "plugin.json"), "utf8")).version;
const roots = [];
after(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

// A package folder as DeepSeek Harness would hold it: <profile>/node_modules/<name>.
function fakePackage(entryScript = "") {
	const profileDir = mkdtempSync(join(tmpdir(), "ai4s-dsh-test-"));
	roots.push(profileDir);
	const dir = join(profileDir, "node_modules", NAME);
	mkdirSync(join(dir, "servers", "runtime"), { recursive: true });
	mkdirSync(join(dir, "servers", "fulltext-runtime"), { recursive: true });
	writeFileSync(join(dir, "servers", "runtime", "index.mjs"), entryScript);
	writeFileSync(join(dir, "servers", "fulltext-runtime", "index.mjs"), entryScript);
	for (const file of ["package.json", "cordis.patch.yml"]) cpSync(join(repo, "dsh-plugin", file), join(dir, file));
	for (const file of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) cpSync(join(repo, file), join(dir, file));
	for (const skill of ["ai4s-setup", "literature-manager", "literature-research", "literature-writing"]) {
		mkdirSync(join(dir, "skills", skill), { recursive: true });
		cpSync(join(repo, "skills", skill, "SKILL.md"), join(dir, "skills", skill, "SKILL.md"));
	}
	return { dir, profileDir };
}

const inspect = ({ dir, profileDir }) => inspectPackage(dir, { pluginVersion, profileDir });

test("the source package version equals the plugin version, so the build is not refused", () => {
	assert.equal(JSON.parse(readFileSync(join(repo, "dsh-plugin", "package.json"), "utf8")).version, pluginVersion);
});

test("a sound package has no problems", async () => {
	assert.deepEqual(await inspect(fakePackage()), []);
});

test("the patch mounts the two servers and one skills row, with the paths the checks expect", async () => {
	const { dir, profileDir } = fakePackage();
	const rows = await patchRows(dir, profileDir);
	assert.equal(rows.length, 3);
	const entries = rows.flatMap((row) => row.config.args ?? []);
	assert.deepEqual(entries.map((p) => p.slice(profileDir.length + 1).split(/[\\/]/).join("/")), [
		`node_modules/${NAME}/servers/runtime/index.mjs`,
		`node_modules/${NAME}/servers/fulltext-runtime/index.mjs`,
	]);
});

test("negative control: a version that differs from the plugin's is reported", async () => {
	const pkg = fakePackage();
	const file = join(pkg.dir, "package.json");
	writeFileSync(file, readFileSync(file, "utf8").replace(`"version": "${pluginVersion}"`, '"version": "9.9.9"'));
	assert.match((await inspect(pkg)).join("\n"), /version 9\.9\.9/);
});

test("negative control: a missing server file is reported", async () => {
	const pkg = fakePackage();
	rmSync(join(pkg.dir, "servers", "fulltext-runtime", "index.mjs"));
	assert.match((await inspect(pkg)).join("\n"), /ai4s-literature-fulltext: its entry file/);
});

test("negative control: a missing skills folder, a nameless skill and a descriptionless skill are reported", async () => {
	const missing = fakePackage();
	rmSync(join(missing.dir, "skills", "literature-writing"), { recursive: true });
	assert.match((await inspect(missing)).join("\n"), /Expected the skills/);

	const renamed = fakePackage();
	const file = join(renamed.dir, "skills", "ai4s-setup", "SKILL.md");
	writeFileSync(file, readFileSync(file, "utf8").replace(/^name: ai4s-setup$/m, "name: something-else"));
	assert.match((await inspect(renamed)).join("\n"), /has name "something-else"/);

	const bare = fakePackage();
	writeFileSync(join(bare.dir, "skills", "ai4s-setup", "SKILL.md"), "---\nname: ai4s-setup\n---\nBody\n");
	assert.match((await inspect(bare)).join("\n"), /has no description/);
});

test("negative control: node_modules, tests, key files and a missing licence are reported", async () => {
	const pkg = fakePackage();
	mkdirSync(join(pkg.dir, "servers", "node_modules"));
	mkdirSync(join(pkg.dir, "skills", "literature-manager", "tests"));
	writeFileSync(join(pkg.dir, "servers", ".env"), "x=1");
	rmSync(join(pkg.dir, "LICENSE"));
	const text = (await inspect(pkg)).join("\n");
	assert.match(text, /node_modules\/ must not be in the package/);
	assert.match(text, /tests\/ must not be in the package/);
	assert.match(text, /\.env must not be in the package/);
	assert.match(text, /LICENSE is missing/);
});

test("negative control: a patch that drops ELECTRON_RUN_AS_NODE or sets a key is reported", async () => {
	const pkg = fakePackage();
	const file = join(pkg.dir, "cordis.patch.yml");
	const patch = readFileSync(file, "utf8");
	writeFileSync(file, patch.replace(/^\s+ELECTRON_RUN_AS_NODE: '1'\n/gm, "").replace("ZOTEUS_EMBEDDINGS: 'off'", "ZOTERO_API_KEY: 'abc'"));
	const text = (await inspect(pkg)).join("\n");
	assert.match(text, /ELECTRON_RUN_AS_NODE is not set/);
	assert.match(text, /sets ZOTERO_API_KEY/);
});

test("negative control: a patch path that does not exist in the package is reported", async () => {
	const pkg = fakePackage();
	const file = join(pkg.dir, "cordis.patch.yml");
	writeFileSync(file, readFileSync(file, "utf8").replace("'servers', 'runtime'", "'servers', 'runtime-typo'"));
	assert.match((await inspect(pkg)).join("\n"), /ai4s-literature-zotero: its entry file/);
});

test("negative control: a package.json whose patch file is missing cannot be read", async () => {
	const pkg = fakePackage();
	rmSync(join(pkg.dir, "cordis.patch.yml"));
	assert.match((await inspect(pkg)).join("\n"), /The patch could not be read/);
	assert.equal(existsSync(join(pkg.dir, "package.json")), true);
});

test("the expected tool lists are the 19 workbench tools and the 6 full-text tools", () => {
	const { runtime, fulltext } = expectedTools();
	assert.equal(runtime.length, 19);
	assert.equal(fulltext.length, 6);
	assert.deepEqual(sameTools(runtime, runtime), []);
});

test("negative control: a missing or extra tool is reported", () => {
	assert.match(sameTools(["a"], ["a", "b"]).join(), /Missing: b/);
	assert.match(sameTools(["a", "c"], ["a"]).join(), /Unexpected: c/);
});

test("negative control: a server that exits at once is reported as not starting", async () => {
	const pkg = fakePackage("process.exit(3);\n");
	const work = mkdtempSync(join(tmpdir(), "ai4s-dsh-work-"));
	roots.push(work);
	const problems = await startServers(pkg.dir, { profileDir: pkg.profileDir, workDir: work });
	assert.equal(problems.length, 2, problems.join("\n"));
	assert.match(problems.join("\n"), /did not start from its patch row/);
});

test("negative control: an empty or half-installed profile fails the install check", async () => {
	const { checkProfile } = await import("../scripts/verify-dsh-install.mjs");
	const empty = mkdtempSync(join(tmpdir(), "ai4s-dsh-profile-"));
	roots.push(empty);
	const work = mkdtempSync(join(tmpdir(), "ai4s-dsh-work-"));
	roots.push(work);
	assert.match((await checkProfile(empty, { pluginVersion, workDir: work })).join("\n"), /is not installed/);

	// Installed, but the profile never lists it as a bundle: dsh would not load its patch.
	const pkg = fakePackage();
	writeFileSync(join(pkg.profileDir, "package.json"), JSON.stringify({ dsh: { profile: { bundles: ["@deepseek-ai/dsh-base"] } } }));
	assert.match((await checkProfile(pkg.profileDir, { pluginVersion, workDir: work })).join("\n"), /does not list the package among its bundles/);
});

test("negative control: a package with no patch file reports it instead of throwing", async () => {
	const pkg = fakePackage();
	rmSync(join(pkg.dir, "cordis.patch.yml"));
	const work = mkdtempSync(join(tmpdir(), "ai4s-dsh-work-"));
	roots.push(work);
	assert.match((await startServers(pkg.dir, { profileDir: pkg.profileDir, workDir: work })).join("\n"), /servers were not started/);
});
