// A checkout path with a space used to reach node.exe through cmd.exe, which
// split the script argument. Node then failed with "Cannot find module" for
// the text before the first space. These tests run that spawn on every OS
// (the shell option splits the same way on Linux) and, on Windows, through a
// .cmd shim as well.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdCommandLine, quoteCmdArg, spawnCommand } from "../scripts/spawn-command.mjs";

const spacedName = "AI4S Test 文献";

function spacedDir() {
  const parent = mkdtempSync(join(tmpdir(), "ai4s-spawn-"));
  const dir = join(parent, spacedName);
  mkdirSync(dir);
  return { parent, dir };
}

test("cmd quoting keeps a path with spaces as one token", () => {
  assert.equal(quoteCmdArg("ci"), "ci");
  assert.equal(quoteCmdArg(""), '""');
  assert.equal(quoteCmdArg("C:\\AI4S Test\\verify-runtime.mjs"), '"C:\\AI4S Test\\verify-runtime.mjs"');
  assert.equal(quoteCmdArg("C:\\AI4S Test\\文献\\verify-runtime.mjs"), '"C:\\AI4S Test\\文献\\verify-runtime.mjs"');
  assert.equal(
    cmdCommandLine("C:\\Program Files\\nodejs\\node.exe", ["C:\\AI4S Test\\文献\\verify-runtime.mjs"]),
    '""C:\\Program Files\\nodejs\\node.exe" "C:\\AI4S Test\\文献\\verify-runtime.mjs""',
  );
  assert.equal(quoteCmdArg('say "hello"'), '"say ""hello"""');
});

test("node keeps a script path that contains a space and non-ASCII characters", () => {
  const { parent, dir } = spacedDir();
  try {
    const script = join(dir, "verify runtime.mjs");
    const marker = `${spacedName} & more`;
    writeFileSync(script, "console.log(JSON.stringify({ argv: process.argv[1], extra: process.argv[2], cwd: process.cwd() }));\n");
    const result = spawnCommand(process.execPath, [script, marker], { cwd: dir, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    const body = JSON.parse(result.stdout);
    assert.equal(body.argv, script);
    assert.equal(body.extra, marker);
    // macOS tmpdir is /var/folders, a symlink to /private/var. process.cwd()
    // returns the resolved path; the argument above stays the path we passed.
    assert.equal(realpathSync(body.cwd), realpathSync(dir));
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("npm --version runs without a shell", () => {
  const result = spawnCommand("npm", ["--version"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+/);
});

test("a Windows cmd shim receives a path with a space and non-ASCII characters as one argument", { skip: process.platform !== "win32" }, () => {
  const { parent, dir } = spacedDir();
  try {
    const script = join(dir, "dump-arg.mjs");
    const command = join(dir, "dump-arg.cmd");
    const out = join(dir, "out.txt");
    const payload = join(dir, "AI4S Test & 文献.txt");
    writeFileSync(script, "import { writeFileSync } from 'node:fs';\nwriteFileSync(process.argv[2], process.argv[3], 'utf8');\n");
    // ASCII batch file. %~3 is the argument after cmd.exe has parsed it, with
    // quotes removed. Quoting it again is what fails if the path was split.
    writeFileSync(command, `@echo off\r\n"%~1" "%~dp0dump-arg.mjs" "%~2" "%~3"\r\n`, "ascii");
    const result = spawnCommand(command, [process.execPath, out, payload], { encoding: "utf8" });
    assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.equal(readFileSync(out, "utf8"), payload);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("script entry points do not pass arguments through an unquoted shell", () => {
  const files = [
    "scripts/bootstrap.mjs",
    "scripts/package-release.mjs",
    "scripts/assemble-plugin.mjs",
    "scripts/install-host.mjs",
    "scripts/verify-launchers.mjs",
    "scripts/verify-release.mjs",
    "tests/packed-install.test.mjs",
    "tests/admin-http.test.mjs",
    "tests/onboarding-status.test.mjs",
  ];
  for (const rel of files) {
    const source = readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
    assert.match(source, /spawnCommand\(/, rel);
    assert.doesNotMatch(source, /shell\s*:\s*(?:true|isWindows|process\.platform)/, rel);
  }
});
