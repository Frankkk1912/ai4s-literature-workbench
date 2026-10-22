import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve, relative } from "node:path";
import { unzipSync, zipSync } from "fflate";
import { checkFeed, newestEntry, sha256Hex } from "./update-feed.mjs";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"));
const output = resolve(dist, `literature-metrics-${manifest.version}.xpi`);
// update.json carries the hash of this very archive, so it cannot be inside it.
const excluded = new Set(["dist", "node_modules", ".git", ".gitignore", "update.json"]);
// fflate writes the DOS timestamp from local-time fields and rejects years before 1980,
// so a UTC midnight date fails west of UTC. Local midnight is valid in every timezone and
// gives the same stored timestamp everywhere.
const stableMtime = new Date(1980, 0, 1, 0, 0, 0);

function collectFiles(directory, files = {}) {
  for (const entry of readdirSync(directory).sort()) {
    if (directory === root && excluded.has(entry)) continue;
    const absolute = resolve(directory, entry);
    const info = lstatSync(absolute);
    if (info.isSymbolicLink()) {
      throw new Error(`Refusing to package symbolic link: ${absolute}`);
    }
    if (info.isDirectory()) {
      collectFiles(absolute, files);
      continue;
    }
    if (!info.isFile()) continue;
    const archivePath = relative(root, absolute).replaceAll("\\", "/");
    files[archivePath] = [new Uint8Array(readFileSync(absolute)), { mtime: stableMtime }];
  }
  return files;
}

const check = await import("./check.mjs");
void check;
mkdirSync(dist, { recursive: true });
// A leftover add-on from an earlier version must not be mistaken for this build.
for (const name of readdirSync(dist)) {
  if (/^literature-metrics-.+\.xpi$/.test(name)) rmSync(resolve(dist, name), { force: true });
}

const archive = zipSync(collectFiles(root), { level: 9 });
writeFileSync(output, archive);

const packaged = unzipSync(new Uint8Array(readFileSync(output)));
for (const required of ["manifest.json", "bootstrap.js", "src/literature-metrics.js"]) {
  if (!Object.prototype.hasOwnProperty.call(packaged, required)) {
    throw new Error(`Generated XPI is missing required entry: ${required}`);
  }
}
if (!existsSync(output) || readFileSync(output).byteLength === 0) {
  throw new Error("Generated XPI is empty.");
}

// The feed Zotero reads must describe exactly these bytes. --update-feed rewrites the hash.
const feedPath = resolve(root, "update.json");
const feed = JSON.parse(readFileSync(feedPath, "utf8"));
const entry = newestEntry(feed);
if (process.argv.includes("--update-feed") && entry) {
  entry.update_hash = `sha256:${sha256Hex(archive)}`;
  writeFileSync(feedPath, `${JSON.stringify(feed, null, 2)}\n`);
}
const problems = checkFeed({ manifest, feed, xpiBytes: archive });
if (problems.length > 0) throw new Error(`update.json does not describe this XPI:\n- ${problems.join("\n- ")}`);

console.log(`Success! Literature Metrics XPI written to: ${output}`);
