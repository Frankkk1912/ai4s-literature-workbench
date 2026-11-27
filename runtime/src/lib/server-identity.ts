// The stable identity of this tool server, as every published bundle names it.
// setup_status and zotero_whoami report it so a host (and the model inside it)
// can always tell which server answered — the retired desktop extension from
// this project used a different name, and the two must not be confused.
// This module reads nothing but its arguments; it never touches the network,
// never reads the host's configuration directories, and never returns a key.

export const SERVER_NAME = 'ai4s-literature-zotero';

// Keep in step with the `version` in runtime/package.json and the release
// manifests. No automatic bump: releasing is a separate, manual step.
export const SERVER_VERSION = '0.3.0';

/** How this server was installed, when that can be told reliably. */
export type InstallRoute =
  /** A host plugin (Claude Code / desktop Code tab set CLAUDE_PLUGIN_ROOT). */
  | 'plugin'
  /** A Claude Desktop extension (.mcpb): the entry script runs from the
   * "Claude Extensions" folder Claude Desktop extracted the bundle into. */
  | 'desktop_extension'
  /** Anything else (a hand-written host config, a source checkout, a test).
   * No guessing beyond that. */
  | 'unknown';

export interface ServerIdentity {
  name: string;
  version: string;
  install: InstallRoute;
}

export function detectInstallRoute(
  env: NodeJS.ProcessEnv = process.env,
  entryPath: string = process.argv[1] ?? '',
): InstallRoute {
  if (env.CLAUDE_PLUGIN_ROOT) return 'plugin';
  // Claude Desktop extracts an installed .mcpb into ".../Claude Extensions/<id>/"
  // and launches the entry point from there. Separator-agnostic on purpose;
  // a substring anywhere in the entry path is signal enough and never a secret.
  if (/Claude Extensions[\\/]/i.test(entryPath)) return 'desktop_extension';
  return 'unknown';
}

export function serverIdentity(
  env: NodeJS.ProcessEnv = process.env,
  entryPath: string = process.argv[1] ?? '',
): ServerIdentity {
  return { name: SERVER_NAME, version: SERVER_VERSION, install: detectInstallRoute(env, entryPath) };
}

/** The two ways writes reach Zotero, plus the process-wide read-only switch.
 * Reported by setup_status and zotero_whoami so the model never has to guess
 * whether saving is possible and through which channel. */
export interface WriteChannel {
  /** A Zotero Web API key with write access is loaded and was accepted. */
  cloud_key: boolean;
  /** Zotero 10 or later is open on its local connection, so saving works
   * without a key (Zotero asks once in its own window). */
  local_desktop: boolean;
  /** ZOTEUS_READ_ONLY=true removes every write tool in this process. */
  read_only: boolean;
}
