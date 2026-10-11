#!/usr/bin/env node
/**
 * First-run credential onboarding for AI4S Literature Workbench.
 *
 * Secrets are accepted only through a masked local TTY prompt. Reports and
 * onboarding state contain capability/status metadata only. Shared status,
 * validation, and persistence behavior lives in runtime/src/lib/onboarding-core.mjs so a local
 * web onboarding flow can use the same implementation.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { linePrompt, maskedPrompt, readJsonObject, writeJsonPrivate } from "../runtime/src/lib/credential-utils.mjs";
import {
	PROVIDERS,
	ZOTERO_XPI_ONBOARDING,
	onboardingPaths,
	redactedStatus,
	saveAcademicKey,
	saveZoteroKey,
	verifyEasyScholarKey,
	verifyPubmedKey,
	verifyZoteroKey,
} from "../runtime/src/lib/onboarding-core.mjs";

export {
	PROVIDERS,
	ZOTERO_XPI_ONBOARDING,
	academicKeyConfigured,
	fetchJson,
	onboardingPaths,
	redactedStatus,
	saveAcademicKey,
	saveZoteroKey,
	verifyEasyScholarKey,
	verifyPubmedKey,
	verifyZoteroKey,
} from "../runtime/src/lib/onboarding-core.mjs";

async function configureProvider(provider, paths, dependencies = {}) {
	const definition = PROVIDERS[provider];
	const fetchImpl = dependencies.fetchImpl ?? fetch;
	const maskedPromptImpl = dependencies.maskedPromptImpl ?? maskedPrompt;
	process.stdout.write(
		`\n${definition.label}\n用途: ${definition.purpose}\n申请: ${definition.apply_url}\n`,
	);
	const key = String(
		await maskedPromptImpl(`Paste ${definition.label} key (input hidden): `),
	).trim();
	if (!key || /[\r\n]/.test(key)) {
		throw new Error("The key must be a single non-empty line.");
	}

	let capabilities = {};
	if (provider === "zotero") {
		capabilities = await verifyZoteroKey(key, fetchImpl);
		saveZoteroKey(paths.zoteroEnv, paths.legacyZoteroEnv, key);
	} else if (provider === "pubmed") {
		capabilities = await verifyPubmedKey(key, fetchImpl);
		saveAcademicKey(
			paths.academicConfig,
			paths.legacyAcademicConfig,
			"pubmed_api_key",
			key,
		);
	} else {
		capabilities = await verifyEasyScholarKey(key, fetchImpl);
		saveAcademicKey(
			paths.academicConfig,
			paths.legacyAcademicConfig,
			"easyscholar_secret_key",
			key,
		);
	}
	return { status: "configured", capabilities };
}

async function configureWithRetry(provider, paths, dependencies = {}) {
	const linePromptImpl = dependencies.linePromptImpl ?? linePrompt;
	while (true) {
		try {
			return await configureProvider(provider, paths, dependencies);
		} catch (error) {
			process.stderr.write(
				`${PROVIDERS[provider].label}: ${error instanceof Error ? error.message : String(error)}\n`,
			);
			const choice = String(
				await linePromptImpl("Retry? [r]etry / [s]kip: "),
			).toLowerCase();
			if (choice !== "r" && choice !== "retry") return { status: "skipped" };
		}
	}
}

function writeZoteroXpiReminder() {
	process.stdout.write(
		`\nZotero Desktop add-on required for the AI4S columns and Priority control:\n${ZOTERO_XPI_ONBOARDING.install}\nXPI: ${ZOTERO_XPI_ONBOARDING.artifact}\n`,
	);
}

async function setup(paths, onlyProvider, dependencies = {}) {
	const results = {};
	const providers = onlyProvider ? [onlyProvider] : Object.keys(PROVIDERS);
	const linePromptImpl = dependencies.linePromptImpl ?? linePrompt;
	for (const provider of providers) {
		const current = redactedStatus(paths).providers[provider];
		const prompt = current.configured
			? `${PROVIDERS[provider].label} is already configured. Reconfigure it? [y/N]: `
			: `Configure ${PROVIDERS[provider].label} now? [y/N]: `;
		const choice = String(await linePromptImpl(prompt)).toLowerCase();
		if (choice !== "y" && choice !== "yes") {
			results[provider] = {
				status: current.configured ? "unchanged" : "skipped",
			};
			continue;
		}
		results[provider] = await configureWithRetry(provider, paths, dependencies);
	}
	const state = readJsonObject(paths.state);
	const now = new Date().toISOString();
	state.schema_version = 1;
	state.offered_at ||= now;
	state.completed_at = now;
	state.last_results = Object.fromEntries(
		Object.entries(results).map(([provider, result]) => [
			provider,
			result.status,
		]),
	);
	writeJsonPrivate(paths.state, state);
	if (!onlyProvider || onlyProvider === "zotero") writeZoteroXpiReminder();
	return { ...redactedStatus(paths), setup_results: results };
}

function parseArgs(argv) {
	const command = argv[0];
	if (!["status", "setup", "reconfigure"].includes(command)) {
		throw new Error(
			"Usage: node scripts/onboard.mjs <status|setup|reconfigure> --output <result.json> [--provider zotero|pubmed|easyscholar] [--mark-offered]",
		);
	}
	const parsed = { command, markOffered: false };
	for (let index = 1; index < argv.length; index += 1) {
		const token = argv[index];
		if (token === "--mark-offered") parsed.markOffered = true;
		else if (token === "--output") parsed.output = argv[++index];
		else if (token === "--provider") parsed.provider = argv[++index];
		else throw new Error(`Unknown argument: ${token}`);
	}
	if (!parsed.output) throw new Error("--output is required.");
	if (command === "reconfigure" && !PROVIDERS[parsed.provider]) {
		throw new Error(
			"--provider must be zotero, pubmed, or easyscholar for reconfigure.",
		);
	}
	return parsed;
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
	const args = parseArgs(argv);
	const paths = onboardingPaths();
	let report;
	if (args.command === "status") {
		if (args.markOffered) {
			const state = readJsonObject(paths.state);
			state.schema_version = 1;
			state.offered_at ||= new Date().toISOString();
			writeJsonPrivate(paths.state, state);
		}
		report = redactedStatus(paths);
	} else {
		report = await setup(
			paths,
			args.command === "reconfigure" ? args.provider : undefined,
			dependencies,
		);
	}
	writeJsonPrivate(resolve(args.output), report);
	process.stdout.write(
		`Success! Redacted onboarding result written to: ${resolve(args.output)}\n`,
	);
}

const isMain =
	process.argv[1] &&
	resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
	main().catch((error) => {
		process.stderr.write(
			`Onboarding failed: ${error instanceof Error ? error.message : String(error)}\n`,
		);
		process.exitCode = 1;
	});
}
