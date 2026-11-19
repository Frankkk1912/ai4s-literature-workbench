import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';

/** OS-appropriate default data directory for MCP caches, reports, and the search index. */
export function defaultDataDir(
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
  home = homedir(),
): string {
  if (env.LITERATURE_ZOTERO_MCP_DATA_DIR) return env.LITERATURE_ZOTERO_MCP_DATA_DIR;
  // Backward-compatible override for installations migrated from upstream Zoteus.
  if (env.ZOTEUS_DATA_DIR) return env.ZOTEUS_DATA_DIR;
  const platformPath = platform === 'win32' ? win32 : posix;
  if (platform === 'win32') {
    const appData = env.APPDATA?.trim() || platformPath.join(home, 'AppData', 'Roaming');
    return platformPath.join(appData, 'literature-zotero-mcp');
  }
  if (platform === 'darwin') {
    return platformPath.join(home, 'Library', 'Application Support', 'literature-zotero-mcp');
  }
  return platformPath.join(env.XDG_DATA_HOME ?? platformPath.join(home, '.local', 'share'), 'literature-zotero-mcp');
}

/**
 * Where the workbench keeps helper programs it downloads itself (today: the pinned `uv`).
 * Per user and per machine, so on Windows it is under LOCALAPPDATA, not the roaming profile.
 */
export function defaultToolsDir(
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
  home = homedir(),
): string {
  if (env.AI4S_TOOLS_DIR) return env.AI4S_TOOLS_DIR;
  const platformPath = platform === 'win32' ? win32 : posix;
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA?.trim() || platformPath.join(home, 'AppData', 'Local');
    return platformPath.join(localAppData, 'ai4s-literature-workbench', 'tools');
  }
  if (platform === 'darwin') {
    return platformPath.join(home, 'Library', 'Application Support', 'ai4s-literature-workbench', 'tools');
  }
  return platformPath.join(env.XDG_DATA_HOME ?? platformPath.join(home, '.local', 'share'), 'ai4s-literature-workbench', 'tools');
}

/** Shared, owner-private exchange root for verified Fulltext MCP artifacts/handoffs. */
export function defaultFulltextExchangeRoot(
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
  home = homedir(),
): string {
  if (env.LITERATURE_FULLTEXT_EXCHANGE_ROOT) return env.LITERATURE_FULLTEXT_EXCHANGE_ROOT;
  const platformPath = platform === 'win32' ? win32 : posix;
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA?.trim() || platformPath.join(home, 'AppData', 'Local');
    return platformPath.join(localAppData, 'ai4s-literature-workbench', 'fulltext-exchange');
  }
  if (platform === 'darwin') {
    return platformPath.join(home, 'Library', 'Application Support', 'ai4s-literature-workbench', 'fulltext-exchange');
  }
  return platformPath.join(
    env.XDG_DATA_HOME ?? platformPath.join(home, '.local', 'share'),
    'ai4s-literature-workbench',
    'fulltext-exchange',
  );
}
