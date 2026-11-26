import type { InstallState, RunCommand } from './search-helper.js';
import * as core from './onboarding-core.mjs';
import type { OnboardingPaths, ProviderName } from './onboarding-core.mjs';
import type { HiddenToolInfo } from './tool-profiles.js';
import type { NetworkSummary, ProbeResult } from './net-probe.js';

// Capabilities, not components. Each item says what the user can do, in plain words
// and in two languages, and every item lands in exactly one of three groups:
// what works now, what needs the user, and what is optional. Nothing here names an
// internal part (server, runtime, build, bundle). `diagnostics` carries the raw
// facts for a bug report and is not meant to be read out to the user.

export type Lang = 'zh' | 'en';
export interface Text {
  zh: string;
  en: string;
}
export type Group = 'works_now' | 'needs_you' | 'optional';
export type CapabilityId =
  | 'search'
  | 'zotero_read'
  | 'zotero_save'
  | 'pubmed_key'
  | 'journal_metrics'
  | 'partition_columns';

export const CAPABILITY_IDS: readonly CapabilityId[] = [
  'search',
  'zotero_read',
  'zotero_save',
  'pubmed_key',
  'journal_metrics',
  'partition_columns',
];

export type SetupAction =
  | { type: 'open_setup'; keys: ProviderName[]; label: Text }
  | { type: 'link'; url: string; label: Text }
  | { type: 'restart_app'; label: Text }
  | { type: 'install_helper'; tool: 'install_search_helper'; label: Text }
  | { type: 'ask_to_install'; url: string; label: Text };

export interface SetupItem {
  id: CapabilityId;
  group: Group;
  title: Text;
  detail: Text;
  action?: SetupAction;
}

export type AddonState = 'active' | 'unconfirmed' | 'absent' | 'no_zotero';

export interface SetupFacts {
  /** The search helper (uv) starts on this computer. */
  uvAvailable: boolean;
  /** The workbench can download its own pinned copy here (false on an unusual system). */
  uvCanInstall?: boolean;
  /** An install started in this session and not finished yet. */
  uvInstalling?: InstallState;
  /** What replaces `uv run` in the skills' commands, quoted per shell. */
  uvRun?: RunCommand | null;
  zotero: {
    /** A key exists in the environment or in a private file. */
    keyPresent: boolean;
    /** The running tools were started with a key. A key saved later needs a restart. */
    keyLoadedAtStart: boolean;
    /** Zotero accepted that key at start. */
    cloudOk: boolean;
    /** The accepted key may write. */
    write: boolean;
    /** Zotero desktop answered on its local connection. */
    localApi: boolean;
    /** Why it did not: Zotero is closed, or it is open with "allow other applications" off. */
    localState?: 'ok' | 'forbidden' | 'unreachable';
    /** Zotero 10 or later is open, so saving works without a key (Zotero asks once in its own window). */
    localSave?: boolean;
  };
  pubmedKey: boolean;
  easyscholarKey: boolean;
  addon: AddonState;
}

export interface SetupStatus {
  language: Lang;
  summary: Text;
  works_now: SetupItem[];
  needs_you: SetupItem[];
  optional: SetupItem[];
  next_action: SetupAction | null;
  /** How the skills run their scripts: use `run` in place of `uv run`. */
  search_helper: { ready: boolean; run: RunCommand | null };
  /** Read-only, key-free network probes; `checked: false` when they were skipped. */
  network: { checked: boolean; ok: boolean; results: ProbeResult[] };
  /** Registered tools the active profile/read-only/remote setup hides. */
  hidden_tools: HiddenToolInfo[];
  rendered: Text;
  diagnostics: Record<string, unknown>;
}

const LINKS = {
  zoteroKeys: 'https://www.zotero.org/settings/keys',
  // Every release carries the add-on under this fixed name, so the link is always the newest one.
  addon: 'https://github.com/Frankkk1912/ai4s-literature-workbench/releases/latest/download/literature-metrics.xpi',
  addonReleases: 'https://github.com/Frankkk1912/ai4s-literature-workbench/releases',
  uv: 'https://docs.astral.sh/uv/getting-started/installation/',
};

const text = (zh: string, en: string): Text => ({ zh, en });

function openSetup(keys: ProviderName[], zh: string, en: string): SetupAction {
  return { type: 'open_setup', keys, label: text(zh, en) };
}

function classify(ready: boolean, wanted: boolean): Group {
  if (ready) return 'works_now';
  return wanted ? 'needs_you' : 'optional';
}

export function evaluateSetup(facts: SetupFacts, wanted: readonly CapabilityId[] = []): SetupItem[] {
  const want = new Set(wanted);
  const items: SetupItem[] = [];

  // Search and drafting need nothing from the user except the helper that runs them.
  const searchTitle = text('检索并排序文献；根据已保存的证据起草', 'Search and rank papers; draft from saved evidence');
  if (facts.uvAvailable) {
    items.push({ id: 'search', group: 'works_now', title: searchTitle, detail: text('不需要任何密钥。', 'No key needed.') });
  } else if (facts.uvInstalling === 'downloading' || facts.uvInstalling === 'preparing_python') {
    items.push({
      id: 'search',
      group: 'needs_you',
      title: text('检索文献', 'Search papers'),
      detail: text('检索辅助工具正在下载，几分钟内就好，请稍等。', 'The search helper is downloading; it should be ready in a few minutes.'),
      action: { type: 'install_helper', tool: 'install_search_helper', label: text('查看下载进度', 'Check the download') },
    });
  } else if (facts.uvCanInstall !== false) {
    items.push({
      id: 'search',
      group: 'needs_you',
      title: text('检索文献', 'Search papers'),
      detail: text(
        '检索还需要一个小的辅助工具（约 15 MB；如果电脑上没有合适的 Python，还会再下载约 30 MB）。你同意后，我会把它下载到你用户账户下的文件夹里，不需要管理员权限，也不会改动系统设置。',
        'Search needs a small helper tool (about 15 MB, plus about 30 MB of Python if the computer has none it can use). With your OK, I will download it into folders in your user account; no admin rights, and no system settings change.',
      ),
      action: { type: 'install_helper', tool: 'install_search_helper', label: text('下载辅助工具', 'Download the helper') },
    });
  } else {
    items.push({
      id: 'search',
      group: 'needs_you',
      title: text('检索文献', 'Search papers'),
      detail: text(
        '这台电脑还缺一个小的辅助工具（uv）。我会先征得你同意，再用官方安装程序装上。',
        'This computer is missing a small helper tool (uv). I will ask first, then install it with the official installer.',
      ),
      action: { type: 'ask_to_install', url: LINKS.uv, label: text('让我安装辅助工具', 'Let me install the helper') },
    });
  }

  const canRead = facts.zotero.localApi || facts.zotero.cloudOk;
  const readDetail = canRead
    ? text('已连接。', 'Connected.')
    : facts.zotero.localState === 'forbidden'
    ? text(
        'Zotero 已打开，但不允许其他应用访问。请在 Zotero 的 设置 → 高级 里勾选“允许这台电脑上的其他应用与 Zotero 通信”（读取文献库不需要密钥）。',
        'Zotero is open, but it does not let other applications talk to it. In Zotero, open Settings → Advanced and tick “Allow other applications on this computer to communicate with Zotero” (reading your library needs no key).',
      )
    : text(
        '请先打开这台电脑上的 Zotero，并在 设置 → 高级 里勾选“允许这台电脑上的其他应用与 Zotero 通信”（读取文献库不需要密钥）；也可以改用 Zotero 密钥。',
        'Open Zotero on this computer and tick “Allow other applications on this computer to communicate with Zotero” in Settings → Advanced (reading your library needs no key); a Zotero key also works.',
      );
  items.push({
    id: 'zotero_read',
    group: classify(canRead, want.has('zotero_read')),
    title: text('读取你的 Zotero 文献库', 'Read your Zotero library'),
    detail: readDetail,
  });

  const z = facts.zotero;
  let save: SetupItem;
  const saveTitle = text('保存到 Zotero', 'Save to Zotero');
  if (z.cloudOk && z.write) {
    save = { id: 'zotero_save', group: 'works_now', title: saveTitle, detail: text('密钥有效，可以写入。', 'Your key works and can write.') };
  } else if (z.cloudOk) {
    save = {
      id: 'zotero_save',
      group: 'needs_you',
      title: saveTitle,
      detail: text(
        `现在的密钥只能读取。请到 ${LINKS.zoteroKeys} 新建一个允许写入的密钥，再粘贴到我刚打开的页面。`,
        `Your current key can only read. Create one that allows writing at ${LINKS.zoteroKeys}, then paste it into the page I just opened.`,
      ),
      action: openSetup(['zotero'], '打开设置页', 'Open the setup page'),
    };
  } else if (z.localSave && !z.cloudOk && !z.keyLoadedAtStart) {
    save = {
      id: 'zotero_save',
      group: 'works_now',
      title: saveTitle,
      detail: text(
        '不需要密钥：第一次保存时，Zotero 会弹出一个窗口询问，请选“始终允许”，以后就不再询问。',
        'No key needed: the first time you save, Zotero asks in its own window. Choose “Always Allow” and it will not ask again.',
      ),
    };
  } else if (z.keyPresent && !z.keyLoadedAtStart) {
    save = {
      id: 'zotero_save',
      group: 'needs_you',
      title: saveTitle,
      detail: text('密钥已保存。请重启这个应用，让它开始使用。', 'Your key is saved. Restart this app so it starts using it.'),
      action: { type: 'restart_app', label: text('重启应用', 'Restart the app') },
    };
  } else if (z.keyPresent) {
    save = {
      id: 'zotero_save',
      group: 'needs_you',
      title: saveTitle,
      detail: text(
        `Zotero 没有接受现在的密钥（可能已失效，也可能当时没联网）。请到 ${LINKS.zoteroKeys} 新建一个，再粘贴到设置页。`,
        `Zotero did not accept the saved key (it may have expired, or there was no connection). Create a new one at ${LINKS.zoteroKeys} and paste it into the setup page.`,
      ),
      action: openSetup(['zotero'], '打开设置页', 'Open the setup page'),
    };
  } else {
    save = {
      id: 'zotero_save',
      group: want.has('zotero_save') ? 'needs_you' : 'optional',
      title: saveTitle,
      detail: text(
        `需要一个 Zotero 密钥：到 ${LINKS.zoteroKeys} 创建（勾选允许写入），再粘贴到我打开的页面。不用也能检索。`,
        `Needs a Zotero key: create one at ${LINKS.zoteroKeys} (allow writing), then paste it into the page I open. Searching works without it.`,
      ),
      action: openSetup(['zotero'], '打开设置页', 'Open the setup page'),
    };
  }
  items.push(save);

  items.push({
    id: 'pubmed_key',
    group: classify(facts.pubmedKey, want.has('pubmed_key')),
    title: text('更快、更稳的 PubMed 检索', 'Faster, steadier PubMed search'),
    detail: facts.pubmedKey
      ? text('PubMed 密钥已设置。', 'Your PubMed key is set.')
      : text(
          `可选：免费申请一个 PubMed 密钥（${core.PROVIDERS.pubmed.apply_url}），粘贴到设置页。不填也能检索。`,
          `Optional: get a free PubMed key (${core.PROVIDERS.pubmed.apply_url}) and paste it into the setup page. Search works without it.`,
        ),
    action: facts.pubmedKey ? undefined : openSetup(['pubmed'], '打开设置页', 'Open the setup page'),
  });

  items.push({
    id: 'journal_metrics',
    group: classify(facts.easyscholarKey, want.has('journal_metrics')),
    title: text('报告里更多的期刊指标', 'More journal ratings in reports'),
    detail: facts.easyscholarKey
      ? text('EasyScholar 密钥已设置。', 'Your EasyScholar key is set.')
      : text(
          `可选：到 ${core.PROVIDERS.easyscholar.apply_url} 申请 EasyScholar 密钥，粘贴到设置页，报告会多出期刊分区和影响因子。`,
          `Optional: get an EasyScholar key at ${core.PROVIDERS.easyscholar.apply_url} and paste it into the setup page; reports then gain journal ratings.`,
        ),
    action: facts.easyscholarKey ? undefined : openSetup(['easyscholar'], '打开设置页', 'Open the setup page'),
  });

  const addonTitle = text('Zotero 里的期刊分区列（IF / JCR / 中科院分区）', 'Journal partition columns in Zotero (IF / JCR / CAS)');
  if (facts.addon === 'active') {
    items.push({
      id: 'partition_columns',
      group: 'works_now',
      title: addonTitle,
      detail: text(
        '在你的 Zotero 配置里找到了这个插件（我无法确认它已加载）。',
        'The add-on was found in your Zotero profile (I cannot confirm it loaded).',
      ),
    });
  } else {
    const detail =
      facts.addon === 'unconfirmed'
        ? text(
            `在 Zotero 配置里发现了这个插件，但无法确认它已启用或来自本项目。可以重新下载这个文件再装一次：${LINKS.addon}`,
            `An add-on with this name is in your Zotero profile, but I cannot confirm it is turned on or comes from this project. You can download this file and install it again: ${LINKS.addon}`,
          )
        : facts.addon === 'no_zotero'
        ? text(
            `这台电脑上没有找到 Zotero。装好 Zotero 后，再下载并安装这个插件（一个文件）：${LINKS.addon} （没有开始下载就打开 ${LINKS.addonReleases}）`,
            `I could not find Zotero on this computer. After installing Zotero, install this add-on (one file): ${LINKS.addon} (if nothing downloads, open ${LINKS.addonReleases})`,
          )
        : text(
            `尚未安装。下载插件（一个文件）：${LINKS.addon} ，然后在 Zotero 中选择 工具 → 插件，点齿轮 → 从文件安装插件，选下载的文件，最后重启 Zotero。（没有开始下载就打开 ${LINKS.addonReleases}）`,
            `Not installed yet. Download the add-on (one file): ${LINKS.addon} , then in Zotero choose Tools → Add-ons, click the gear → Install Add-on From File, pick the downloaded file, and restart Zotero. (If nothing downloads, open ${LINKS.addonReleases}.)`,
          );
    items.push({
      id: 'partition_columns',
      group: want.has('partition_columns') ? 'needs_you' : 'optional',
      title: addonTitle,
      detail,
      action: { type: 'link', url: LINKS.addon, label: text('下载插件', 'Download the add-on') },
    });
  }

  return items;
}

const HEADINGS: Record<Group, Text> = {
  works_now: text('现在可用', 'Works now'),
  needs_you: text('需要你处理', 'Needs you'),
  optional: text('可选', 'Optional'),
};

export function renderSetup(items: readonly SetupItem[], lang: Lang): string {
  const lines: string[] = [];
  for (const group of ['works_now', 'needs_you', 'optional'] as const) {
    const inGroup = items.filter((item) => item.group === group);
    const count = group === 'needs_you' ? (lang === 'zh' ? `（${inGroup.length}）` : ` (${inGroup.length})`) : '';
    lines.push(`${HEADINGS[group][lang]}${count}`);
    if (inGroup.length === 0) {
      lines.push(`  ${lang === 'zh' ? '暂时没有。' : 'Nothing right now.'}`);
      continue;
    }
    for (const item of inGroup) {
      const colon = lang === 'zh' ? '：' : ': ';
      lines.push(`  ${item.title[lang]}${item.detail[lang] ? colon + item.detail[lang] : ''}`);
    }
  }
  return lines.join('\n');
}

// --- The extra, read-only sections under the three groups. Same rule as the
// groups themselves: plain words, no build or component names, both languages.

function msText(ms: number, lang: Lang): string {
  return lang === 'zh' ? `${ms} 毫秒` : `${ms} ms`;
}

function renderInsecureWarning(lang: Lang): string {
  return lang === 'zh'
    ? '⚠️ 警告：LITERATURE_TLS_INSECURE 已开启——本进程的对外请求不校验 TLS 证书。请只在受信任的网络上临时使用，修好证书后尽快关闭。'
    : '⚠️ Warning: LITERATURE_TLS_INSECURE is on — outbound requests in this process skip TLS certificate verification. Use it only temporarily on a trusted network, and turn it off once certificates work.';
}

function probeLine(result: ProbeResult, lang: Lang): string {
  const optional = result.optional
    ? lang === 'zh'
      ? `${result.name}（可选）`
      : `${result.name} (optional)`
    : result.name;
  const timing = msText(result.ms, lang);
  const keylessNote =
    result.http_status !== null && result.http_status >= 400 && result.http_status < 500
      ? lang === 'zh'
        ? '；不带密钥的探测收到 4xx 也算连通'
        : '; a keyless probe answered 4xx, which still counts as reachable'
      : '';
  let status: string;
  switch (result.error_class) {
    case 'ok':
      status = lang === 'zh' ? `已连通（HTTP ${result.http_status}，${timing}）` : `reachable (HTTP ${result.http_status}, ${timing})`;
      break;
    case 'http':
      status = lang === 'zh'
        ? `已连通，但服务端返回错误（HTTP ${result.http_status}，${timing}）`
        : `reachable, but the server answered HTTP ${result.http_status} (${timing})`;
      break;
    case 'tls':
      status = lang === 'zh'
        ? '证书校验失败：常见原因是代理或学校/公司网关用自己的根证书重签流量。修复：把根证书导出为 PEM 文件，设置 SSL_CERT_FILE（本工具的检索脚本）或 NODE_EXTRA_CA_CERTS（Node 部分），然后重启。'
        : 'TLS certificate check failed: usually a proxy or school/company gateway re-signs traffic with its own root. Fix: export that root as a PEM file, set SSL_CERT_FILE (the search scripts) or NODE_EXTRA_CA_CERTS (Node), and restart.';
      break;
    case 'dns':
      status = lang === 'zh'
        ? '域名解析失败：请检查网络或 DNS 设置（这不是证书问题）。'
        : 'name resolution failed: check the network or DNS settings (not a certificate problem).';
      break;
    case 'timeout':
      status = lang === 'zh' ? `超时（${timing} 内没有响应）。` : `timed out (no answer within ${timing}).`;
      break;
    default:
      status = lang === 'zh' ? `连接失败（${result.error ?? ''}）` : `connection failed (${result.error ?? ''})`;
  }
  return `  ${optional}${lang === 'zh' ? '：' : ': '}${status}${keylessNote}`;
}

function renderNetwork(probes: NetworkSummary, lang: Lang): string {
  const heading = lang === 'zh' ? '网络自检' : 'Network check';
  const lines = [heading];
  for (const result of probes.results) lines.push(probeLine(result, lang));
  if (!probes.ok) {
    lines.push(
      lang === 'zh'
        ? '  ——部分必测端点不通，检索和联网功能可能受影响。'
        : '  — some required endpoints are unreachable; search and online features may be affected.',
    );
  }
  return lines.join('\n');
}

function renderHiddenTools(hidden: readonly HiddenToolInfo[], lang: Lang): string {
  const byReason = new Map<string, string[]>();
  for (const tool of hidden) {
    const names = byReason.get(tool.reason) ?? [];
    names.push(tool.name);
    byReason.set(tool.reason, names);
  }
  const join = (names: string[]) => (lang === 'zh' ? names.join('、') : names.join(', '));
  const lines: string[] = [
    lang === 'zh' ? `当前隐藏的工具（${hidden.length}）` : `Tools hidden by the current setup (${hidden.length})`,
  ];
  const workbenchNames = byReason.get('workbench_profile');
  if (workbenchNames) {
    lines.push(
      lang === 'zh'
        ? `  未进入 workbench 档案：${join(workbenchNames)}`
        : `  Not in the workbench profile: ${join(workbenchNames)}`,
    );
    lines.push(
      lang === 'zh'
        ? '  切换方法：把 LITERATURE_ZOTERO_MCP_TOOL_PROFILE 设为 full（这是默认值），然后重启这个应用。'
        : '  To switch: set LITERATURE_ZOTERO_MCP_TOOL_PROFILE to full (the default), then restart this app.',
    );
  }
  const readOnlyNames = byReason.get('read_only');
  if (readOnlyNames) {
    lines.push(
      lang === 'zh'
        ? `  因只读模式隐藏：${join(readOnlyNames)}`
        : `  Hidden by read-only mode: ${join(readOnlyNames)}`,
    );
    lines.push(
      lang === 'zh'
        ? '  切换方法：取消 ZOTEUS_READ_ONLY（或设为 false），然后重启这个应用。'
        : '  To switch: unset ZOTEUS_READ_ONLY (or set it to false), then restart this app.',
    );
  }
  const remoteNames = byReason.get('remote_deployment');
  if (remoteNames) {
    lines.push(
      lang === 'zh'
        ? `  因远程部署隐藏：${join(remoteNames)}`
        : `  Hidden because this is a remote deployment: ${join(remoteNames)}`,
    );
    lines.push(
      lang === 'zh'
        ? '  原因：它们操作的是运行工具的这台电脑（打开本机设置页、下载检索辅助工具），远程使用时不适用。'
        : '  Why: they act on the computer the tools run on (a local setup page, a local helper download), which a remote caller cannot reach.',
    );
  }
  const names = hidden.map((t) => t.name);
  if (names.some((n) => n === 'zotero_trash_items' || n === 'zotero_delete_items')) {
    lines.push(
      lang === 'zh'
        ? '  说明：回收站与永久删除工具仅用于你明确要求的清理，workbench 档案默认不提供它们是既定设计。'
        : '  Note: the trash and delete tools are only for cleanups you explicitly ask for; the workbench profile deliberately leaves them out.',
    );
  }
  return lines.join('\n');
}

export function buildSetupStatus(
  facts: SetupFacts,
  options: {
    wanted?: readonly CapabilityId[];
    language?: Lang;
    /** Read-only probe results; omit or pass null when probing was skipped. */
    probes?: NetworkSummary | null;
    /** Tools hidden by the active profile, computed by listHiddenTools. */
    hiddenTools?: readonly HiddenToolInfo[];
    /** LITERATURE_TLS_INSECURE is explicitly enabled in this process. */
    tlsInsecure?: boolean;
  } = {},
): SetupStatus {
  const language = options.language ?? 'zh';
  const items = evaluateSetup(facts, options.wanted);
  const works_now = items.filter((item) => item.group === 'works_now');
  const needs_you = items.filter((item) => item.group === 'needs_you');
  const optional = items.filter((item) => item.group === 'optional');
  const summary = needs_you.length === 0
    ? text('可以开始用了。', 'You can start now.')
    : text(`还有 ${needs_you.length} 件事需要你处理。`, `${needs_you.length} thing(s) still need you.`);
  const probes = options.probes ?? null;
  const hiddenTools = options.hiddenTools ?? [];
  // Sections under the three groups: the insecure warning first (it is the one
  // thing the user should notice), then the network self-check, then the
  // hidden-tool list. Each stays out of the text entirely when it has nothing
  // to say, so a fully-working fresh install renders exactly as before.
  const sectionsOf = (lang: Lang): string => {
    const parts = [renderSetup(items, lang)];
    if (options.tlsInsecure) parts.push(renderInsecureWarning(lang));
    if (probes) parts.push(renderNetwork(probes, lang));
    if (hiddenTools.length > 0) parts.push(renderHiddenTools(hiddenTools, lang));
    return parts.join('\n\n');
  };
  return {
    language,
    summary,
    works_now,
    needs_you,
    optional,
    next_action: needs_you.find((item) => item.action)?.action ?? null,
    search_helper: { ready: facts.uvAvailable, run: facts.uvAvailable ? facts.uvRun ?? { posix: 'uv run', powershell: 'uv run' } : null },
    network: probes
      ? { checked: true, ok: probes.ok, results: probes.results }
      : { checked: false, ok: true, results: [] },
    hidden_tools: [...hiddenTools],
    rendered: text(sectionsOf('zh'), sectionsOf('en')),
    diagnostics: {
      tls_insecure: Boolean(options.tlsInsecure),
      network: probes ? probes.results : null,
      search_helper: facts.uvAvailable,
      search_helper_installing: facts.uvInstalling ?? null,
      zotero_local_connection: facts.zotero.localApi,
      zotero_local_state: facts.zotero.localState ?? null,
      zotero_local_save: Boolean(facts.zotero.localSave),
      zotero_key_present: facts.zotero.keyPresent,
      zotero_key_loaded_at_start: facts.zotero.keyLoadedAtStart,
      zotero_key_accepted: facts.zotero.cloudOk,
      zotero_key_can_write: facts.zotero.write,
      pubmed_key_present: facts.pubmedKey,
      easyscholar_key_present: facts.easyscholarKey,
      addon: facts.addon,
    },
  };
}

function addonState(report: Record<string, unknown>): AddonState {
  const verification = report.verification as { level?: string; evidence?: string } | undefined;
  const profiles = Array.isArray(report.profiles) ? (report.profiles as Array<{ state?: string }>) : [];
  if (profiles.length === 0) return 'no_zotero';
  if (profiles.some((p) => p.state === 'installed_active')) return 'active';
  if (profiles.some((p) => p.state === 'installed_unconfirmed') || verification?.level === 'pending_manual') {
    return 'unconfirmed';
  }
  return 'absent';
}

export interface FactSources {
  env?: NodeJS.ProcessEnv;
  paths?: OnboardingPaths;
  /** Key the running tools were started with, if any. */
  startedWithKey: boolean;
  cloud: { access?: Record<string, unknown> } | null;
  localApi: boolean;
  localState?: 'ok' | 'forbidden' | 'unreachable';
  /** Zotero answered with a server id, which only Zotero 10 and later send. */
  localServerId?: string;
  uvAvailable: boolean;
  uvCanInstall?: boolean;
  uvInstalling?: InstallState;
  uvRun?: RunCommand | null;
}

/** Collect the facts from the machine. Reads files and the environment; sends nothing anywhere. */
export function gatherFacts(sources: FactSources): SetupFacts {
  const env = sources.env ?? process.env;
  const paths = sources.paths ?? core.onboardingPaths(env);
  const status = core.redactedStatus(paths, env);
  const user = sources.cloud?.access?.user as { write?: boolean } | undefined;
  return {
    uvAvailable: sources.uvAvailable,
    uvCanInstall: sources.uvCanInstall,
    uvInstalling: sources.uvInstalling,
    uvRun: sources.uvRun,
    zotero: {
      keyPresent: status.providers.zotero.configured,
      keyLoadedAtStart: sources.startedWithKey,
      cloudOk: sources.cloud !== null,
      write: Boolean(user?.write),
      localApi: sources.localApi,
      localState: sources.localState,
      localSave: sources.localApi && Boolean(sources.localServerId),
    },
    pubmedKey: status.providers.pubmed.configured,
    easyscholarKey: status.providers.easyscholar.configured,
    addon: addonState(status.zotero_desktop_xpi),
  };
}
