import type { ProviderName } from './onboarding-core.mjs';
import { startSetupSession } from './setup-session.js';

// `node index.mjs --setup` is what the double-click launchers run. It is for agent
// hosts whose sandbox cannot start a server or a browser: the user opens the page from
// their own desktop instead. Messages are printed in Chinese and English, because a
// double-click window has no way to ask which one the user reads.

const REQUIRED_NODE = [22, 13] as const;
const PAIRING_TTL_MS = 15 * 60_000;
const VALID_KEYS = new Set<ProviderName>(['zotero', 'pubmed', 'easyscholar']);

export interface SetupCliOptions {
  /** Print the address and exit at once. Used by tests and by the launcher self-check. */
  check?: boolean;
  keys?: string;
  out?: (line: string) => void;
}

function nodeIsSupported(version = process.versions.node): boolean {
  const [major = 0, minor = 0] = version.split('.').map(Number);
  return major > REQUIRED_NODE[0] || (major === REQUIRED_NODE[0] && minor >= REQUIRED_NODE[1]);
}

function parseKeys(value?: string): ProviderName[] | undefined {
  if (!value) return undefined;
  const keys = value.split(',').map((item) => item.trim()).filter((item): item is ProviderName => VALID_KEYS.has(item as ProviderName));
  return keys.length > 0 ? keys : undefined;
}

/** Returns the process exit code. */
export async function runSetupCli(options: SetupCliOptions = {}): Promise<number> {
  const out = options.out ?? ((line: string) => process.stdout.write(`${line}\n`));

  if (!nodeIsSupported()) {
    out(`这台电脑的 Node.js 版本是 ${process.versions.node}，需要 ${REQUIRED_NODE.join('.')} 或更新。请到 https://nodejs.org/ 安装当前的 LTS 版本，然后再双击一次。`);
    out(`This computer has Node.js ${process.versions.node}, but ${REQUIRED_NODE.join('.')} or newer is needed. Install the current LTS from https://nodejs.org/ and double-click this file again.`);
    return 1;
  }

  const session = await startSetupSession({
    keys: parseKeys(options.keys),
    pairingTtlMs: PAIRING_TTL_MS,
    keepAlive: !options.check,
  });

  if (session.opened) {
    out('设置页正在你的浏览器里打开。请在页面里粘贴密钥，密钥不会出现在聊天里。');
    out('The setup page is opening in your browser. Paste your key there; it never goes into the chat.');
  } else {
    out('没能自动打开浏览器。请自己在浏览器里打开下面的地址，并输入配对码：');
    out('I could not open your browser. Open this address yourself and type in the code:');
    out(`  ${session.pageUrl}`);
    out(`  ${session.code}`);
  }
  out('做完后可以关闭这个窗口。 / You can close this window when you are done.');

  if (options.check) {
    session.close();
    return 0;
  }
  await session.finished;
  out('设置已结束。 / Setup has finished.');
  return 0;
}
