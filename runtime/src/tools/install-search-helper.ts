import type { ToolDefinition } from '../registry/registry.js';
import { ok } from '../registry/registry.js';
import { INSTALL_WAIT_MS, UV_VERSION, startSearchHelperInstall, type InstallResult, type InstallState } from '../lib/search-helper.js';

const MESSAGES: Record<InstallState, { zh: string; en: string }> = {
  installed: {
    zh: '检索辅助工具已经装好，可以开始检索了。',
    en: 'The search helper is ready. You can search now.',
  },
  downloading: {
    zh: '正在下载检索辅助工具（约 15 MB），请稍等，我过一会儿再检查。',
    en: 'Downloading the search helper (about 15 MB). I will check again in a moment.',
  },
  preparing_python: {
    zh: '辅助工具已下载，正在准备它需要的 Python（约 30 MB，只需一次），请稍等。',
    en: 'The helper is downloaded and is now fetching the Python it needs (about 30 MB, once). I will check again in a moment.',
  },
  failed: {
    zh: '没能装好检索辅助工具。',
    en: 'The search helper could not be installed.',
  },
  unsupported: {
    zh: '这台电脑的系统没有现成的辅助工具版本。',
    en: 'There is no ready-made helper for this computer’s system.',
  },
  not_installed: {
    zh: '检索辅助工具还没有安装。',
    en: 'The search helper is not installed yet.',
  },
};

function wait<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([promise, new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms).unref())]);
}

const installSearchHelperTool: ToolDefinition = {
  name: 'install_search_helper',
  title: 'Install the search helper',
  description:
    `Download the small helper program (uv ${UV_VERSION}, about 15 MB, plus Python on first use if the computer has none) that runs the literature search and Zotero-manager scripts. Call this only when setup_status lists search under Needs you, and only after the user agreed in chat. It downloads one pinned release from GitHub, checks it against a fixed checksum, and keeps it in the workbench's own folder; Python, if needed, goes into uv's own folder in the user's account. No admin rights, nothing added to PATH, no system setting or registry change. It answers within about 40 seconds; if \`state\` is downloading or preparing_python, call it again (or setup_status) until it says installed. When installed, use \`run.posix\` (bash, zsh) or \`run.powershell\` (PowerShell) in place of \`uv run\` in the skills' commands; setup_status also reports it as search_helper.run. If \`state\` is failed or unsupported, tell the user the reason in plain words and offer the official installer at https://docs.astral.sh/uv/getting-started/installation/ instead.`,
  inputSchema: {},
  annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
  handler: async () => {
    const running = startSearchHelperInstall();
    const result: InstallResult | undefined = running.result ?? (await wait(running.promise, INSTALL_WAIT_MS));
    const state = result?.state ?? running.state;
    const text = MESSAGES[state];
    const reason = result?.error ? { zh: `原因：${result.error}`, en: `Reason: ${result.error}` } : undefined;
    const pythonNote =
      result?.state === 'installed' && !result.python_ready
        ? { zh: '第一次检索时还会自动下载 Python，会稍慢一点。', en: 'The first search also fetches Python, so it is a little slower.' }
        : undefined;
    const message = {
      zh: [text.zh, reason?.zh, pythonNote?.zh].filter(Boolean).join(' '),
      en: [text.en, reason?.en, pythonNote?.en].filter(Boolean).join(' '),
    };
    return ok(
      {
        state,
        done: Boolean(result),
        python_ready: result?.python_ready ?? false,
        run: result?.run ?? null,
        ...(result?.error ? { error: result.error } : {}),
        message,
      },
      message.en,
    );
  },
};

export default installSearchHelperTool;
