import { execFile } from 'node:child_process';
import * as core from './onboarding-core.mjs';
import type { OnboardingPaths, ProviderName } from './onboarding-core.mjs';

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
  items.push(
    facts.uvAvailable
      ? {
          id: 'search',
          group: 'works_now',
          title: text('检索并排序文献；根据已保存的证据起草', 'Search and rank papers; draft from saved evidence'),
          detail: text('不需要任何密钥。', 'No key needed.'),
        }
      : {
          id: 'search',
          group: 'needs_you',
          title: text('检索文献', 'Search papers'),
          detail: text(
            '这台电脑还缺一个小的辅助工具（uv）。我会先征得你同意，再用官方安装程序装上。',
            'This computer is missing a small helper tool (uv). I will ask first, then install it with the official installer.',
          ),
          action: {
            type: 'ask_to_install',
            url: LINKS.uv,
            label: text('让我安装辅助工具', 'Let me install the helper'),
          },
        },
  );

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

export function buildSetupStatus(
  facts: SetupFacts,
  options: { wanted?: readonly CapabilityId[]; language?: Lang } = {},
): SetupStatus {
  const language = options.language ?? 'zh';
  const items = evaluateSetup(facts, options.wanted);
  const works_now = items.filter((item) => item.group === 'works_now');
  const needs_you = items.filter((item) => item.group === 'needs_you');
  const optional = items.filter((item) => item.group === 'optional');
  const summary = needs_you.length === 0
    ? text('可以开始用了。', 'You can start now.')
    : text(`还有 ${needs_you.length} 件事需要你处理。`, `${needs_you.length} thing(s) still need you.`);
  return {
    language,
    summary,
    works_now,
    needs_you,
    optional,
    next_action: needs_you.find((item) => item.action)?.action ?? null,
    rendered: text(renderSetup(items, 'zh'), renderSetup(items, 'en')),
    diagnostics: {
      search_helper: facts.uvAvailable,
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

/** Run `uv --version`. A missing or broken helper is an answer, not an error. */
export function probeUv(timeoutMs = 4000): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      execFile('uv', ['--version'], { timeout: timeoutMs, windowsHide: true }, (error) => resolve(!error));
    } catch {
      resolve(false);
    }
  });
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
}

/** Collect the facts from the machine. Reads files and the environment; sends nothing anywhere. */
export function gatherFacts(sources: FactSources): SetupFacts {
  const env = sources.env ?? process.env;
  const paths = sources.paths ?? core.onboardingPaths(env);
  const status = core.redactedStatus(paths, env);
  const user = sources.cloud?.access?.user as { write?: boolean } | undefined;
  return {
    uvAvailable: sources.uvAvailable,
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
