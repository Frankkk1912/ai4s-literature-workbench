import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { test } from "node:test";

import {
	fetchJson,
	onboardingPaths,
	redactedStatus,
	saveAcademicKey,
	saveZoteroKey,
	verifyEasyScholarKey,
	verifyPubmedKey,
	verifyZoteroKey,
} from "../scripts/onboarding-core.mjs";

function temporaryPaths(prefix = "ai4s-onboarding-core-") {
	const root = mkdtempSync(join(tmpdir(), prefix));
	return {
		root,
		paths: {
			zoteroEnv: join(root, "native", "zotero.env"),
			legacyZoteroEnv: join(root, "legacy", "zotero.env"),
			academicConfig: join(root, "native", "academic-research.json"),
			legacyAcademicConfig: join(root, "legacy", "academic-research.json"),
			state: join(root, "native", "onboarding.json"),
		},
	};
}

function jsonResponse(value, status = 200) {
	return new Response(JSON.stringify(value), { status });
}

test("onboardingPaths covers win32, darwin, linux, and explicit overrides", () => {
	const windows = onboardingPaths({}, "win32", "C:\\Users\\Frank");
	assert.equal(
		windows.zoteroEnv,
		win32.join(
			"C:\\Users\\Frank",
			"AppData",
			"Local",
			"ai4s-literature-workbench",
			"zotero.env",
		),
	);
	assert.equal(
		windows.academicConfig,
		win32.join(
			"C:\\Users\\Frank",
			"AppData",
			"Local",
			"frank-ai4s",
			"academic-research.json",
		),
	);

	const darwin = onboardingPaths({}, "darwin", "/Users/frank");
	assert.equal(
		darwin.zoteroEnv,
		"/Users/frank/Library/Application Support/ai4s-literature-workbench/zotero.env",
	);
	assert.equal(
		darwin.academicConfig,
		"/Users/frank/.config/frank-ai4s/academic-research.json",
	);

	const linux = onboardingPaths(
		{ XDG_CONFIG_HOME: "/srv/config" },
		"linux",
		"/home/frank",
	);
	assert.equal(
		linux.zoteroEnv,
		"/srv/config/ai4s-literature-workbench/zotero.env",
	);
	assert.equal(
		linux.academicConfig,
		"/srv/config/frank-ai4s/academic-research.json",
	);

	const overridden = onboardingPaths(
		{
			LITERATURE_ZOTERO_MCP_ENV_FILE: "/private/zotero.env",
			AI4S_ACADEMIC_CONFIG_FILE: "/private/academic.json",
			AI4S_ONBOARDING_STATE_FILE: "/private/onboarding.json",
		},
		"linux",
		"/home/frank",
	);
	assert.equal(overridden.zoteroEnv, "/private/zotero.env");
	assert.equal(overridden.academicConfig, "/private/academic.json");
	assert.equal(overridden.state, "/private/onboarding.json");
});

test("shared saves reuse legacy content, write native files atomically, and keep private permissions", () => {
	const { root, paths } = temporaryPaths("ai4s-onboarding-save-");
	mkdirSync(join(root, "legacy"), { recursive: true });
	writeFileSync(
		paths.legacyZoteroEnv,
		"PRESERVED=value\nZOTERO_API_KEY=old-value\n",
		"utf8",
	);
	writeFileSync(
		paths.legacyAcademicConfig,
		JSON.stringify({ preserved: true, pubmed_api_key: "old-value" }),
		"utf8",
	);

	saveZoteroKey(paths.zoteroEnv, paths.legacyZoteroEnv, "new-zotero-value");
	saveAcademicKey(
		paths.academicConfig,
		paths.legacyAcademicConfig,
		"pubmed_api_key",
		"new-pubmed-value",
	);

	assert.equal(
		readFileSync(paths.zoteroEnv, "utf8"),
		"PRESERVED=value\nZOTERO_API_KEY=new-zotero-value\n",
	);
	assert.deepEqual(JSON.parse(readFileSync(paths.academicConfig, "utf8")), {
		preserved: true,
		pubmed_api_key: "new-pubmed-value",
	});
	assert.equal(
		existsSync(join(root, "native", `.${process.pid}.zotero.env.tmp`)),
		false,
	);
	assert.equal(
		existsSync(
			join(root, "native", `.${process.pid}.academic-research.json.tmp`),
		),
		false,
	);
	if (process.platform !== "win32") {
		assert.equal(statSync(paths.zoteroEnv).mode & 0o777, 0o600);
		assert.equal(statSync(paths.academicConfig).mode & 0o777, 0o600);
	}
});

test("redactedStatus adds artifact, host, connection, and XPI evidence without changing old fields", () => {
	const { root, paths } = temporaryPaths("ai4s-onboarding-status-");
	const repositoryRoot = join(root, "repository");
	mkdirSync(join(repositoryRoot, "runtime", "dist"), { recursive: true });
	mkdirSync(join(repositoryRoot, ".claude-plugin"), { recursive: true });
	writeFileSync(join(repositoryRoot, "runtime", "dist", "index.js"), "", "utf8");
	writeFileSync(join(repositoryRoot, ".claude-plugin", "plugin.json"), "{}", "utf8");

	const status = redactedStatus(paths, {}, { repositoryRoot });
	assert.deepEqual(Object.keys(status).slice(0, 8), [
		"schema_version",
		"first_run",
		"onboarding_completed",
		"baseline_available",
		"providers",
		"application_links",
		"zotero_desktop_xpi",
		"privacy",
	]);
	assert.equal(status.schema_version, 1);
	assert.equal(status.build_artifacts.runtime.exists, true);
	assert.equal(status.build_artifacts.fulltext_runtime.exists, false);
	for (const artifact of Object.values(status.build_artifacts)) {
		assert.match(artifact.evidence, /not (?:be )?proof of connectivity/i);
	}
	assert.equal(status.hosts.find(({ id }) => id === "claude_code").level, "pending_manual");
	assert.equal(status.hosts.find(({ id }) => id === "codex").level, "unknown");
	assert.equal(status.hosts.find(({ id }) => id === "workbuddy").level, "pending_manual");
	assert.ok(status.hosts.every(({ level }) => level !== "verified"));
	assert.ok(status.connections.every(({ level }) => level !== "verified"));
	assert.equal(status.zotero_desktop_xpi.verification.level, "pending_manual");
	assert.match(
		status.zotero_desktop_xpi.verification.evidence,
		/not verified in this milestone/i,
	);
});

test("only explicitly measured host and connection observations become verified", () => {
	const { root, paths } = temporaryPaths("ai4s-onboarding-evidence-");
	const unmeasured = redactedStatus(paths, {}, {
		repositoryRoot: root,
		hosts: { codex: { level: "verified" } },
		connections: { zotero_mcp: { level: "verified" } },
	});
	assert.ok(unmeasured.hosts.every(({ level }) => level !== "verified"));
	assert.ok(unmeasured.connections.every(({ level }) => level !== "verified"));

	const measured = redactedStatus(paths, {}, {
		repositoryRoot: root,
		hosts: { codex: { measured: true } },
		connections: { zotero_mcp: { measured: true } },
	});
	assert.equal(measured.hosts.find(({ id }) => id === "codex").level, "verified");
	assert.equal(
		measured.connections.find(({ id }) => id === "zotero_mcp").level,
		"verified",
	);
	assert.equal(
		measured.connections.find(({ id }) => id === "fulltext_mcp").level,
		"unknown",
	);
});

test("validators keep the approved Zotero header and official query-parameter key paths", async () => {
	const requests = [];
	const mockFetch = async (url, options = {}) => {
		requests.push({ url: new URL(String(url)), options });
		if (String(url).includes("api.zotero.org")) {
			return jsonResponse({
				userID: 7,
				username: "researcher",
				access: { user: { library: true }, groups: {} },
			});
		}
		if (String(url).includes("einfo.fcgi")) {
			return jsonResponse({ einforesult: {} });
		}
		return jsonResponse({ code: 200, data: {} });
	};

	await verifyZoteroKey("zotero-route-value", mockFetch);
	await verifyPubmedKey("pubmed-route-value", mockFetch);
	await verifyEasyScholarKey("easy-route-value", mockFetch);

	const [zotero, pubmed, easy] = requests;
	assert.equal(zotero.url.href, "https://api.zotero.org/keys/current");
	assert.equal(zotero.options.headers["Zotero-API-Key"], "zotero-route-value");
	assert.equal(zotero.url.search, "");
	assert.equal(pubmed.url.origin, "https://eutils.ncbi.nlm.nih.gov");
	assert.equal(pubmed.url.searchParams.get("api_key"), "pubmed-route-value");
	assert.equal(pubmed.options.headers["Zotero-API-Key"], undefined);
	assert.equal(easy.url.origin, "https://www.easyscholar.cc");
	assert.equal(easy.url.searchParams.get("secretKey"), "easy-route-value");
	assert.equal(easy.options.headers["Zotero-API-Key"], undefined);
});

test("fetchJson redacts credential-bearing URLs from HTTP 4xx, 5xx, and 429 errors", async (t) => {
	const secret = "do-not-expose-http-value";
	const url = `https://provider.invalid/check?api_key=${secret}`;
	for (const status of [400, 503, 429]) {
		await t.test(`HTTP ${status}`, async () => {
			let attempts = 0;
			const waits = [];
			await assert.rejects(
				fetchJson(
					url,
					{},
					"Provider",
					async () => {
						attempts += 1;
						return new Response("failure", { status });
					},
					async (milliseconds) => waits.push(milliseconds),
				),
				(error) => {
					assert.equal(error.message.includes(secret), false);
					assert.equal(error.message.includes(url), false);
					assert.match(error.message, /Provider/);
					return true;
				},
			);
			assert.equal(attempts, status === 503 ? 3 : 1);
			assert.deepEqual(waits, status === 503 ? [1000, 2000] : []);
		});
	}
});

test("fetchJson retries server failures without exposing the request URL", async () => {
	const secret = "do-not-expose-retry-value";
	const url = `https://provider.invalid/check?secretKey=${secret}`;
	let attempts = 0;
	const waits = [];
	const result = await fetchJson(
		url,
		{},
		"Provider",
		async () => {
			attempts += 1;
			return attempts < 3
				? new Response("failure", { status: 500 })
				: jsonResponse({ valid: true });
		},
		async (milliseconds) => waits.push(milliseconds),
	);
	assert.deepEqual(result, { valid: true });
	assert.equal(attempts, 3);
	assert.deepEqual(waits, [1000, 2000]);
	assert.equal(JSON.stringify(result).includes(secret), false);
	assert.equal(JSON.stringify(result).includes(url), false);
});

test("fetchJson retries network exceptions and emits only a generic redacted error", async () => {
	const secret = "do-not-expose-network-value";
	const url = `https://provider.invalid/check?api_key=${secret}`;
	let attempts = 0;
	const waits = [];
	await assert.rejects(
		fetchJson(
			url,
			{},
			"Provider",
			async () => {
				attempts += 1;
				throw new Error(`request rejected for ${url}`);
			},
			async (milliseconds) => waits.push(milliseconds),
		),
		(error) => {
			assert.equal(error.message.includes(secret), false);
			assert.equal(error.message.includes(url), false);
			assert.equal(
				error.message,
				"Provider could not be reached; the existing configuration was not changed.",
			);
			return true;
		},
	);
	assert.equal(attempts, 3);
	assert.deepEqual(waits, [1000, 2000]);
});
