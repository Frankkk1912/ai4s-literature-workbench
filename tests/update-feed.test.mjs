import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { checkFeed, newestEntry, sha256Hex } from "../literature-metrics/scripts/update-feed.mjs";

const read = (name) => JSON.parse(readFileSync(new URL(`../literature-metrics/${name}`, import.meta.url), "utf8"));
const manifest = read("manifest.json");
const feed = read("update.json");
const clone = (value) => JSON.parse(JSON.stringify(value));

test("the committed feed describes the committed add-on", () => {
  assert.deepEqual(checkFeed({ manifest, feed }), []);
  assert.equal(newestEntry(feed).version, manifest.version);
});

test("the feed hash is compared with the real bytes", () => {
  const bytes = Buffer.from("not the add-on");
  const [problem] = checkFeed({ manifest, feed, xpiBytes: bytes });
  assert.match(problem, /does not match the built add-on/);
  const own = clone(feed);
  newestEntry(own).update_hash = `sha256:${sha256Hex(bytes)}`;
  assert.deepEqual(checkFeed({ manifest, feed: own, xpiBytes: bytes }), []);
});

test("negative controls: each broken feed is reported", () => {
  const cases = {
    "version behind the add-on": (f) => { newestEntry(f).version = "0.0.1"; },
    "link to another repository": (f) => { newestEntry(f).update_link = "https://github.com/someone/else/releases/download/v1.0.0/literature-metrics-0.1.14.xpi"; },
    "link to another file name": (f) => { newestEntry(f).update_link = newestEntry(f).update_link.replace(".xpi", "-x.xpi"); },
    "missing hash": (f) => { delete newestEntry(f).update_hash; },
    "different Zotero range": (f) => { newestEntry(f).applications.zotero.strict_max_version = "8.*"; },
  };
  for (const [name, mutate] of Object.entries(cases)) {
    const broken = clone(feed);
    mutate(broken);
    assert.notDeepEqual(checkFeed({ manifest, feed: broken }), [], name);
  }
  assert.notDeepEqual(checkFeed({ manifest, feed: { addons: {} } }), []);
});

test("a link to a release newer than the one being built is refused", () => {
  assert.match(checkFeed({ manifest, feed, pluginVersion: "0.0.9" }).join(" "), /newer than the release/);
  assert.deepEqual(checkFeed({ manifest, feed, pluginVersion: "0.1.0" }), []);
});

test("the manifest's update_url is the published feed of this repository", () => {
  assert.equal(
    manifest.applications.zotero.update_url,
    "https://raw.githubusercontent.com/Frankkk1912/ai4s-literature-workbench/main/literature-metrics/update.json",
  );
});
