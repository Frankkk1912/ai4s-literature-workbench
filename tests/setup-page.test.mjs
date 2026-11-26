// Pure parts of the setup page script: the fragment, the language choice, the
// one-key-at-a-time steps, and the English text. The page is checked in a real
// browser by hand and over HTTP by setup-session.test.mjs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";

import {
	applyOnboardingLayout,
	chooseLanguage,
	codeFromHash,
	guidedSteps,
	mapDashboard,
	setLanguage,
	t,
} from "../runtime/src/public/onboarding/app.js";

afterEach(() => setLanguage("zh"));

test("the code is read from the fragment, and only the code", () => {
	assert.equal(codeFromHash("#code=abc_DEF-123"), "abc_DEF-123");
	assert.equal(codeFromHash("code=abc"), "abc");
	assert.equal(codeFromHash("#other=1&code=abc%2B"), "abc+");
	assert.equal(codeFromHash("#key=secret"), "");
	assert.equal(codeFromHash("#xcode=abc"), "");
	assert.equal(codeFromHash(""), "");
	assert.equal(codeFromHash(undefined), "");
	assert.equal(codeFromHash("#code=%E0%A4%A"), "");
});

test("language: a stored choice beats the agent's hint, which beats the browser; Chinese is the default", () => {
	assert.equal(chooseLanguage({}), "zh");
	assert.equal(chooseLanguage({ browser: "zh-CN" }), "zh");
	assert.equal(chooseLanguage({ browser: "fr-FR" }), "zh");
	assert.equal(chooseLanguage({ browser: "en-US" }), "en");
	assert.equal(chooseLanguage({ hint: "zh", browser: "en-US" }), "zh");
	assert.equal(chooseLanguage({ stored: "en", hint: "zh", browser: "zh-CN" }), "en");
	assert.equal(chooseLanguage({ stored: "klingon", hint: "nope", browser: "en" }), "en");
});

test("the status view is Chinese unless English is chosen", () => {
	const status = { providers: { zotero: { configured: false, optional: true } } };
	const zh = JSON.stringify(mapDashboard(status));
	assert.match(zh, /未配置 · 可选/);
	setLanguage("en");
	assert.equal(t("中", "en"), "en");
	const en = JSON.stringify(mapDashboard(status));
	assert.match(en, /Not set · optional/);
	assert.doesNotMatch(en, /未配置/);
});

test("keys are offered one at a time, in the order asked, and only the known ones", () => {
	const status = {
		requested_providers: ["pubmed", "zotero", "pubmed", "nope"],
		providers: { zotero: { configured: true }, pubmed: { configured: false } },
	};
	assert.deepEqual(guidedSteps(status), [
		{ id: "pubmed", configured: false },
		{ id: "zotero", configured: true },
	]);
	assert.deepEqual(guidedSteps({ providers: {} }), []);
	assert.deepEqual(guidedSteps({ requested_providers: "zotero" }), []);
});

test("the layout shows one question while guided, and falls back to the old layout otherwise", () => {
	const make = () => ({
		pairing: { hidden: false },
		wizard: { hidden: true },
		statusView: { hidden: true },
		guided: { hidden: true },
	});
	const active = make();
	applyOnboardingLayout(active, { paired: true, fullyConfigured: false, guided: "active" });
	assert.deepEqual(
		[active.pairing.hidden, active.guided.hidden, active.wizard.hidden, active.statusView.hidden],
		[true, false, true, true],
	);
	const done = make();
	applyOnboardingLayout(done, { paired: true, fullyConfigured: false, guided: "done" });
	assert.deepEqual([done.guided.hidden, done.wizard.hidden, done.statusView.hidden], [false, true, false]);
	const classic = make();
	applyOnboardingLayout(classic, { paired: true, fullyConfigured: false });
	assert.deepEqual([classic.guided.hidden, classic.wizard.hidden, classic.statusView.hidden], [true, false, false]);
	const unpaired = make();
	applyOnboardingLayout(unpaired, { paired: false, fullyConfigured: false, guided: "active" });
	assert.deepEqual([unpaired.pairing.hidden, unpaired.guided.hidden], [false, true]);
});

test("the page script takes the code out of the address bar before it does anything else", () => {
	const source = readFileSync(new URL("../runtime/src/public/onboarding/app.js", import.meta.url), "utf8");
	const take = source.indexOf("codeFromHash(win?.location?.hash)");
	const clear = source.indexOf("win.history.replaceState(null, '', win.location.pathname)");
	const redeem = source.indexOf("redeemPairing(code, documentRef, pairResult);\n    return;");
	assert.ok(take > 0 && clear > take && redeem > clear, "read the fragment, clear it, then redeem");
	// The browser stores one thing: the language choice. Never a code or a key.
	const stores = source.match(/localStorage\??\.setItem\(([^)]*)\)/g) ?? [];
	assert.deepEqual(stores, ["localStorage?.setItem(LANG_STORE_KEY, value)"]);
	assert.doesNotMatch(source, /sessionStorage|document\.cookie\s*=/);
});

test("the page explains the self-check groups, the network check, and hidden tools in plain words", () => {
	const html = readFileSync(new URL("../runtime/src/public/onboarding/index.html", import.meta.url), "utf8");
	for (const id of ["self-check-help", "self-check-summary", "self-check-text"]) {
		assert.ok(html.includes(`id="${id}"`), `index.html is missing #${id}`);
	}
	const source = readFileSync(new URL("../runtime/src/public/onboarding/app.js", import.meta.url), "utf8");
	// Both languages exist for the two new nodes, and the page's own no-network
	// promise stays untouched: only the agent's self-check probes the network.
	for (const id of ["#self-check-summary", "#self-check-text"]) {
		const at = source.indexOf(`'${id}'`);
		assert.ok(at > 0, `app.js STATIC_TEXT is missing ${id}`);
		const block = source.slice(at, source.indexOf("],", at));
		assert.match(block, /现在可用|需要你处理|可选/, `${id}: Chinese text missing`);
		assert.match(block, /Works now|Needs you|Optional/, `${id}: English text missing`);
	}
	const note = source.split("'#status-note'")[1].split("],")[0];
	assert.match(note, /读取状态不代表执行连接测试/);
	assert.match(note, /does not test any connection/);
});

test("the self-check explanation names the three groups and says search waits for the network", () => {
	const source = readFileSync(new URL("../runtime/src/public/onboarding/app.js", import.meta.url), "utf8");
	const text = source.split("'#self-check-text'")[1].split("],")[0];
	// The groups are explained in plain words, not by field names.
	assert.doesNotMatch(text, /diagnostics|probe_network|hidden_tools/);
	assert.match(text, /隐藏了哪些工具|which tools the current setup hides/);
	assert.match(text, /不带密钥的只读小请求|key-free, read-only/);
});
