/**
 * Runtime bridge to the repository-wide onboarding core.
 *
 * The CLI and HTTP wizard intentionally load the same ESM module so validation,
 * redaction, and persistence cannot drift. A URL-based dynamic import works from
 * both src/lib and dist/lib without pulling files outside tsconfig.rootDir into
 * the TypeScript build.
 */

export type ProviderName = 'zotero' | 'pubmed' | 'easyscholar';

export interface OnboardingPaths {
  zoteroEnv: string;
  academicConfig: string;
  legacyZoteroEnv: string;
  legacyAcademicConfig: string;
  state: string;
}

export interface ProviderDefinition {
  label: string;
  apply_url: string;
  purpose: string;
}

export interface ProviderStatus {
  configured: boolean;
  source: 'environment' | 'private_config' | 'none';
  optional: boolean;
  /** Partial preview of a real credential; never the full value. */
  masked_key?: string | null;
}

/**
 * Status payload returned by the onboarding API.
 * `providers.*.masked_key` is a partial preview (first 6 chars + `******`
 * for keys of length ≥ 12; shorter keys use a stricter mask) and never
 * the full credential.
 */
export interface RedactedOnboardingStatus {
  providers: Record<ProviderName, ProviderStatus>;
  application_links: Record<ProviderName, string>;
  zotero_desktop_xpi: Record<string, unknown>;
  privacy: string;
  [key: string]: unknown;
}

export interface OnboardingCore {
  PROVIDERS: Record<ProviderName, ProviderDefinition>;
  onboardingPaths(
    env?: NodeJS.ProcessEnv,
    platform?: NodeJS.Platform,
    home?: string,
  ): OnboardingPaths;
  redactedStatus(
    paths?: OnboardingPaths,
    env?: NodeJS.ProcessEnv,
    observations?: Record<string, unknown>,
  ): RedactedOnboardingStatus;
  verifyZoteroKey(key: string, fetchImpl?: typeof fetch): Promise<Record<string, unknown>>;
  verifyPubmedKey(key: string, fetchImpl?: typeof fetch): Promise<Record<string, unknown>>;
  verifyEasyScholarKey(key: string, fetchImpl?: typeof fetch): Promise<Record<string, unknown>>;
  saveZoteroKey(path: string, legacyPath: string, key: string): void;
  saveAcademicKey(path: string, legacyPath: string, name: string, key: string): void;
}

let sharedCore: Promise<OnboardingCore> | undefined;

export function loadOnboardingCore(): Promise<OnboardingCore> {
  sharedCore ??= import(
    new URL('../../../scripts/onboarding-core.mjs', import.meta.url).href
  ) as Promise<OnboardingCore>;
  return sharedCore;
}
