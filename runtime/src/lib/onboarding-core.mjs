import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, posix, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";

import {
	envKeyExists,
	readJsonObject,
	updateEnvKey,
	writeJsonPrivate,
	writePrivateFile,
} from "./credential-utils.mjs";

import { scanZoteroAddon } from "./zotero-addon-status.mjs";
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LEVELS = new Set(["unknown", "pending_manual", "verified"]);

export const ZOTERO_XPI_ONBOARDING = {
	status: "manual_install_required",
	purpose:
		"Display AI4S literature metrics, Agent Tags, AI Summary, and the interactive Priority control in Zotero Desktop.",
	artifact: "literature-metrics/dist/literature-metrics-<version>.xpi",
	install:
		"In Zotero Desktop, open Tools → Add-ons, choose the gear menu, then Install Add-on From File… and select the built XPI.",
	note: "The credential wizard and MCP never install or modify Zotero Desktop add-ons automatically.",
	verification: {
		level: "pending_manual",
		evidence: "Installation status was not verified in this milestone.",
	},
};

// Map the read-only profile scan onto the existing evidence levels. A file that
// is present and active proves installation, not that the add-on works, so the
// highest level here is "pending_manual", never "verified".
export function zoteroXpiStatus(scan = scanZoteroAddon()) {
	const base = { ...ZOTERO_XPI_ONBOARDING };
	if (scan.profileCount === 0) {
		base.verification = {
			level: "unknown",
			evidence: "No Zotero profile was found on this machine, so the add-on cannot be checked here.",
		};
		return { ...base, profiles: scan.profiles };
	}
	const active = scan.profiles.filter((p) => p.state === "installed_active");
	const unconfirmed = scan.profiles.filter((p) => p.state === "installed_unconfirmed");
	const disabled = scan.profiles.filter((p) => p.evidence?.includes("disabled"));
	let verification;
	if (active.length > 0) {
		verification = {
			level: "pending_manual",
			evidence: `Installed and active in ${active.length} of ${scan.profileCount} Zotero profile(s), from this repository. Whether it loads and works still needs a manual check in Zotero.`,
		};
	} else if (unconfirmed.length > 0) {
		verification = {
			level: "pending_manual",
			evidence: `Found in ${unconfirmed.length} profile(s), but not confirmed: active from another source, or disabled. Reinstall the release XPI.`,
		};
	} else {
		verification = {
			level: "unknown",
			evidence: `Not installed in any of the ${scan.profileCount} Zotero profile(s) found.`,
		};
	}
	base.verification = verification;
	return { ...base, profiles: scan.profiles };
}

export const PROVIDERS = {
	zotero: {
		label: "Zotero Web API",
		apply_url: "https://www.zotero.org/settings/keys",
		purpose:
			"cloud library identity, item/tag writes, and optional file access",
	},
	pubmed: {
		label: "PubMed / NCBI",
		apply_url: "https://www.ncbi.nlm.nih.gov/datasets/docs/v2/api/api-keys/",
		purpose:
			"higher E-utilities request allowance and more stable batch retrieval",
	},
	easyscholar: {
		label: "EasyScholar",
		apply_url: "https://www.easyscholar.cc/",
		purpose: "optional journal rank and metric enrichment",
	},
};

export function onboardingPaths(
	env = process.env,
	platform = process.platform,
	home = homedir(),
) {
	const platformPath = platform === "win32" ? win32 : posix;
	let workbenchDir;
	let academicConfig;
	if (platform === "win32") {
		const local =
			env.LOCALAPPDATA?.trim() || platformPath.join(home, "AppData", "Local");
		workbenchDir = platformPath.join(local, "ai4s-literature-workbench");
		academicConfig = platformPath.join(
			local,
			"frank-ai4s",
			"academic-research.json",
		);
	} else if (platform === "darwin") {
		workbenchDir = platformPath.join(
			home,
			"Library",
			"Application Support",
			"ai4s-literature-workbench",
		);
		academicConfig = platformPath.join(
			home,
			".config",
			"frank-ai4s",
			"academic-research.json",
		);
	} else {
		const configHome =
			env.XDG_CONFIG_HOME?.trim() || platformPath.join(home, ".config");
		workbenchDir = platformPath.join(configHome, "ai4s-literature-workbench");
		academicConfig = platformPath.join(
			configHome,
			"frank-ai4s",
			"academic-research.json",
		);
	}
	return {
		zoteroEnv:
			env.LITERATURE_ZOTERO_MCP_ENV_FILE?.trim() ||
			platformPath.join(workbenchDir, "zotero.env"),
		academicConfig: env.AI4S_ACADEMIC_CONFIG_FILE?.trim() || academicConfig,
		legacyZoteroEnv: platformPath.join(
			home,
			".config",
			"ai4s-literature-workbench",
			"zotero.env",
		),
		legacyAcademicConfig: platformPath.join(
			home,
			".config",
			"frank-ai4s",
			"academic-research.json",
		),
		state:
			env.AI4S_ONBOARDING_STATE_FILE?.trim() ||
			platformPath.join(workbenchDir, "onboarding.json"),
	};
}

/** Partial credential preview: never the full value. Length is measured after trim. */
export function maskKey(value) {
	if (value == null) return null;
	const key = String(value).trim();
	if (!key) return null;
	if (key.length >= 12) return `${key.slice(0, 6)}******`;
	if (key.length >= 6) return `${key.slice(0, 2)}****`;
	return "****";
}

function readEnvFileKey(path, name) {
	if (!path || !existsSync(path)) return "";
	const match = readFileSync(path, "utf8").match(
		new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=(.*)$`, "m"),
	);
	return match ? String(match[1] ?? "").trim() : "";
}

export function academicKeyConfigured(
	path,
	legacyPath,
	configName,
	envName,
	env = process.env,
) {
	const envValue = env[envName]?.trim() ?? "";
	if (envValue) {
		return {
			configured: true,
			source: "environment",
			masked_key: maskKey(envValue),
		};
	}
	const sourcePath = existsSync(path) ? path : legacyPath;
	const config = readJsonObject(sourcePath);
	const configValue = String(config[configName] ?? "").trim();
	return {
		configured: Boolean(configValue),
		source: configValue ? "private_config" : "none",
		masked_key: maskKey(configValue),
	};
}

function artifactStatus(repositoryRoot, artifactPath) {
	const present = existsSync(join(repositoryRoot, artifactPath));
	return {
		path: artifactPath,
		exists: present,
		evidence: present
			? "Build artifact exists; existence is not proof of connectivity."
			: "Build artifact is absent; artifact existence would not be proof of connectivity.",
	};
}

function measured(observation) {
	return observation?.measured === true;
}

function hostEvidence(id, name, cluePath, repositoryRoot, observations) {
	if (measured(observations?.hosts?.[id])) {
		return {
			id,
			name,
			evidence: "Host availability was verified by a measured check.",
			level: "verified",
		};
	}
	if (existsSync(join(repositoryRoot, cluePath))) {
		return {
			id,
			name,
			evidence: `${cluePath} exists as an observable compatibility clue; host installation and connectivity await manual verification.`,
			level: "pending_manual",
		};
	}
	return {
		id,
		name,
		evidence: `No ${name} compatibility clue was observed.`,
		level: "unknown",
	};
}

function connectionEvidence(id, name, observations) {
	const verified = measured(observations?.connections?.[id]);
	return {
		id,
		name,
		evidence: verified
			? "Connection was verified by a measured check."
			: "No measured connection evidence was provided.",
		level: verified ? "verified" : "unknown",
	};
}

export function redactedStatus(
	paths = onboardingPaths(),
	env = process.env,
	observations = {},
) {
	const repositoryRoot = observations.repositoryRoot || REPOSITORY_ROOT;
	const state = readJsonObject(paths.state);
	const zoteroEnvValue = env.ZOTERO_API_KEY?.trim() ?? "";
	const zoteroFileValue =
		readEnvFileKey(paths.zoteroEnv, "ZOTERO_API_KEY") ||
		readEnvFileKey(paths.legacyZoteroEnv, "ZOTERO_API_KEY");
	const zoteroValue = zoteroEnvValue || zoteroFileValue;
	const zoteroConfigured =
		Boolean(zoteroEnvValue) ||
		envKeyExists(paths.zoteroEnv, "ZOTERO_API_KEY") ||
		envKeyExists(paths.legacyZoteroEnv, "ZOTERO_API_KEY");
	const pubmed = academicKeyConfigured(
		paths.academicConfig,
		paths.legacyAcademicConfig,
		"pubmed_api_key",
		"PUBMED_API_KEY",
		env,
	);
	const easyscholar = academicKeyConfigured(
		paths.academicConfig,
		paths.legacyAcademicConfig,
		"easyscholar_secret_key",
		"EASYSCHOLAR_SECRET_KEY",
		env,
	);
	const hosts = [
		hostEvidence(
			"claude_code",
			"Claude Code",
			".claude-plugin/plugin.json",
			repositoryRoot,
			observations,
		),
		hostEvidence(
			"codex",
			"Codex",
			".codex-plugin/plugin.json",
			repositoryRoot,
			observations,
		),
		hostEvidence(
			"workbuddy",
			"WorkBuddy",
			".claude-plugin/plugin.json",
			repositoryRoot,
			observations,
		),
	];
	const connections = [
		connectionEvidence("zotero_mcp", "Zotero MCP", observations),
		connectionEvidence("fulltext_mcp", "Full-text MCP", observations),
	];
	for (const item of [...hosts, ...connections]) {
		if (!LEVELS.has(item.level)) throw new Error("Invalid evidence level.");
	}
	return {
		schema_version: 1,
		first_run: !state.offered_at,
		onboarding_completed: Boolean(state.completed_at),
		baseline_available: true,
		providers: {
			zotero: {
				configured: zoteroConfigured,
				source: zoteroEnvValue
					? "environment"
					: zoteroConfigured
						? "private_config"
						: "none",
				optional: true,
				masked_key: maskKey(zoteroValue),
			},
			pubmed: { ...pubmed, optional: true },
			easyscholar: { ...easyscholar, optional: true },
		},
		application_links: Object.fromEntries(
			Object.entries(PROVIDERS).map(([name, provider]) => [
				name,
				provider.apply_url,
			]),
		),
		zotero_desktop_xpi: zoteroXpiStatus(),
		privacy: "No credential values are included in this report.",
		build_artifacts: {
			runtime: artifactStatus(repositoryRoot, "runtime/dist/index.js"),
			fulltext_runtime: artifactStatus(
				repositoryRoot,
				"fulltext-runtime/dist/index.js",
			),
		},
		hosts,
		connections,
	};
}

export function saveAcademicKey(path, legacyPath, name, key) {
	const sourcePath = existsSync(path) ? path : legacyPath;
	const config = readJsonObject(sourcePath);
	config[name] = key;
	writeJsonPrivate(path, config);
}

export function saveZoteroKey(path, legacyPath, key) {
	const sourcePath = existsSync(path) ? path : legacyPath;
	const existing = existsSync(sourcePath)
		? readFileSync(sourcePath, "utf8")
		: "";
	writePrivateFile(path, updateEnvKey(existing, "ZOTERO_API_KEY", key));
}

export async function fetchJson(
	url,
	options,
	provider,
	fetchImpl = fetch,
	wait = (milliseconds) =>
		new Promise((resolveWait) => setTimeout(resolveWait, milliseconds)),
) {
	for (let attempt = 0; attempt < 3; attempt += 1) {
		let response;
		let text;
		try {
			response = await fetchImpl(url, options);
			text = await response.text();
		} catch {
			if (attempt < 2) {
				await wait(2 ** attempt * 1000);
				continue;
			}
			break;
		}
		if (response.status === 429) {
			throw new Error(
				`${provider} rate limit reached (HTTP 429); retry later.`,
			);
		}
		if (response.status >= 500 && attempt < 2) {
			await wait(2 ** attempt * 1000);
			continue;
		}
		if (!response.ok) {
			throw new Error(
				`${provider} rejected the credential (HTTP ${response.status}).`,
			);
		}
		try {
			return JSON.parse(text);
		} catch {
			throw new Error(
				`${provider} returned an unexpected non-JSON response.`,
			);
		}
	}
	throw new Error(
		`${provider} could not be reached; the existing configuration was not changed.`,
	);
}

export async function verifyZoteroKey(key, fetchImpl = fetch) {
	const info = await fetchJson(
		"https://api.zotero.org/keys/current",
		{ headers: { "Zotero-API-Key": key } },
		"Zotero",
		fetchImpl,
	);
	if (!Number.isInteger(info.userID) || !info.username) {
		throw new Error("Zotero returned an unexpected key-validation response.");
	}
	const access = info.access?.user ?? {};
	return {
		library: Boolean(access.library),
		write: Boolean(access.write),
		files: Boolean(access.files),
		notes: Boolean(access.notes),
		groups: Object.keys(info.access?.groups ?? {}).length,
	};
}

export async function verifyPubmedKey(key, fetchImpl = fetch) {
	const params = new URLSearchParams({
		db: "pubmed",
		retmode: "json",
		api_key: key,
	});
	const data = await fetchJson(
		`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/einfo.fcgi?${params}`,
		{ headers: { "User-Agent": "AI4S-Literature-Workbench/onboarding" } },
		"PubMed",
		fetchImpl,
	);
	if (!data.einforesult) {
		throw new Error("PubMed returned an unexpected key-validation response.");
	}
	return { valid: true };
}

export async function verifyEasyScholarKey(key, fetchImpl = fetch) {
	const params = new URLSearchParams({
		publicationName: "Nature",
		secretKey: key,
	});
	const data = await fetchJson(
		`https://www.easyscholar.cc/open/getPublicationRank?${params}`,
		{ headers: { "User-Agent": "AI4S-Literature-Workbench/onboarding" } },
		"EasyScholar",
		fetchImpl,
	);
	if (data.code !== 200 || !data.data || typeof data.data !== "object") {
		throw new Error("EasyScholar rejected the credential.");
	}
	return { valid: true };
}
