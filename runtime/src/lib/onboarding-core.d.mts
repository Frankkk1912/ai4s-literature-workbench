// Type declarations for the single onboarding-core implementation in
// onboarding-core.mjs. The .mjs file is the only runtime source; this file only
// describes its shape for the TypeScript build.

export type ProviderName = "zotero" | "pubmed" | "easyscholar";

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
  source: "environment" | "private_config" | "none";
  optional: boolean;
  /** Partial preview of a real credential; never the full value. */
  masked_key?: string | null;
}

/**
 * Status payload returned by the onboarding API. `providers.*.masked_key` is a
 * partial preview and never the full credential.
 */
export interface RedactedOnboardingStatus {
  providers: Record<ProviderName, ProviderStatus>;
  application_links: Record<ProviderName, string>;
  zotero_desktop_xpi: Record<string, unknown>;
  privacy: string;
  [key: string]: unknown;
}

export declare const PROVIDERS: Record<ProviderName, ProviderDefinition>;

export declare function onboardingPaths(
  env?: Readonly<Record<string, string | undefined>>,
  platform?: "aix" | "android" | "darwin" | "freebsd" | "haiku" | "linux" | "openbsd" | "sunos" | "win32" | "cygwin" | "netbsd",
  home?: string,
): OnboardingPaths;

export declare function redactedStatus(
  paths?: OnboardingPaths,
  env?: Readonly<Record<string, string | undefined>>,
  observations?: Record<string, unknown>,
): RedactedOnboardingStatus;

export declare function verifyZoteroKey(
  key: string,
  fetchImpl?: typeof fetch,
): Promise<Record<string, unknown>>;
export declare function verifyPubmedKey(
  key: string,
  fetchImpl?: typeof fetch,
): Promise<Record<string, unknown>>;
export declare function verifyEasyScholarKey(
  key: string,
  fetchImpl?: typeof fetch,
): Promise<Record<string, unknown>>;

export declare function saveZoteroKey(path: string, legacyPath: string, key: string): void;
export declare function saveAcademicKey(
  path: string,
  legacyPath: string,
  name: string,
  key: string,
): void;
