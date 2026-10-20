/* eslint-env browser */

// Chinese is the default. English is chosen from the page switch, from the language the
// agent passed when it opened the page, or from the browser language.
let lang = 'zh';
const LANG_STORE_KEY = 'ai4s_setup_lang';

export function setLanguage(next) {
  lang = next === 'en' ? 'en' : 'zh';
}

export function currentLanguage() {
  return lang;
}

export function t(zh, en) {
  return lang === 'en' ? en : zh;
}

/** Stored choice first, then the agent's hint, then the browser language. */
export function chooseLanguage({ stored, hint, browser } = {}) {
  for (const value of [stored, hint]) {
    if (value === 'zh' || value === 'en') return value;
  }
  return String(browser ?? '').toLowerCase().startsWith('en') ? 'en' : 'zh';
}

/** Pulls the one-time code out of a URL fragment such as "#code=abc". Returns '' when absent. */
export function codeFromHash(hash) {
  const raw = String(hash ?? '').replace(/^#/, '');
  for (const part of raw.split('&')) {
    const separator = part.indexOf('=');
    if (separator > 0 && part.slice(0, separator) === 'code') {
      try {
        return decodeURIComponent(part.slice(separator + 1)).trim();
      } catch {
        return '';
      }
    }
  }
  return '';
}

const PROVIDER_ORDER = ['zotero', 'pubmed', 'easyscholar'];
const PROVIDER_NAMES = {
  zotero: 'Zotero',
  pubmed: 'PubMed',
  easyscholar: 'EasyScholar',
};
const XPI_RELEASES_HREF = 'https://github.com/Frankkk1912/ai4s-literature-workbench/releases';
const xpiEvidence = () =>
  t(
    '在 Zotero 中选择 Tools → Add-ons → 齿轮菜单 → Install Add-on From File…，选择下载的 .xpi 文件。',
    'In Zotero choose Tools → Add-ons → gear menu → Install Add-on From File…, then pick the downloaded .xpi file.',
  );
const xpiDetails = () => [
  {
    label: t('完整步骤', 'Full steps'),
    value: t(
      '1. 访问 GitHub Releases：https://github.com/Frankkk1912/ai4s-literature-workbench/releases\n2. 下载最新的 .xpi 文件\n3. 在 Zotero 中选择 Tools → Add-ons → 齿轮菜单 → Install Add-on From File…\n4. 选择下载的 .xpi 文件\n5. 重启 Zotero',
      '1. Open GitHub Releases: https://github.com/Frankkk1912/ai4s-literature-workbench/releases\n2. Download the latest .xpi file\n3. In Zotero choose Tools → Add-ons → gear menu → Install Add-on From File…\n4. Pick the downloaded .xpi file\n5. Restart Zotero',
    ),
    mono: false,
  },
];
const SENSITIVE_URL = /[^\s"'<>]*((?:api_key|secretKey|secret_key)=)[^\s"'<>]*/gi;

// What each key unlocks, in words a beginner can act on. Search itself needs none of them.
const providers = {
  zotero: {
    label: 'Zotero',
    get purpose() {
      return t(
        '把文献存进你的 Zotero 资料库需要它。它只保存在这台电脑的私有文件里。不填也能检索。',
        'Needed to save papers into your Zotero library. It is kept only in a private file on this computer. Search works without it.',
      );
    },
    get how() {
      return t(
        '打开申请页面，登录 Zotero，新建一个密钥并勾选“允许写入”，再把密钥粘贴到下面。',
        'Open the page, sign in to Zotero, create a key and tick “Allow write access”, then paste it below.',
      );
    },
    applyUrl: 'https://www.zotero.org/settings/keys',
  },
  pubmed: {
    label: 'PubMed',
    get purpose() {
      return t(
        '让 PubMed 检索更快、更稳定。不填也能检索。',
        'Makes PubMed searches faster and steadier. Search works without it.',
      );
    },
    get how() {
      return t(
        '打开申请页面，登录 NCBI 账号，在账号设置里生成 API 密钥，再粘贴到下面。免费。',
        'Open the page, sign in to your NCBI account, create an API key in the account settings and paste it below. It is free.',
      );
    },
    applyUrl: 'https://www.ncbi.nlm.nih.gov/datasets/docs/v2/api/api-keys/',
  },
  easyscholar: {
    label: 'EasyScholar',
    get purpose() {
      return t(
        '让报告里多出期刊分区和影响因子。不填也能检索。',
        'Adds journal partitions and impact factors to your reports. Search works without it.',
      );
    },
    get how() {
      return t(
        '打开 EasyScholar，登录后在“我的”页面找到开放接口密钥，再粘贴到下面。免费。',
        'Open EasyScholar, sign in, find your open-API key on your profile page and paste it below. It is free.',
      );
    },
    applyUrl: 'https://www.easyscholar.cc/',
  },
};

export function redactSensitive(value) {
  return String(value ?? '').replace(SENSITIVE_URL, '[redacted-credential-url]');
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

export function fieldMark(evidence) {
  return evidence;
}

export function unknownRow(name, reason) {
  return {
    name,
    statusLabel: t('状态未知', 'Status unknown'),
    statusTone: 'neutral',
    action: undefined,
    evidence: fieldMark(reason),
  };
}

function providerApplyHref(id, applicationLinks) {
  const fromApi = asRecord(applicationLinks)?.[id];
  if (typeof fromApi === 'string' && fromApi) return fromApi;
  return providers[id]?.applyUrl || './';
}

function providerAction(id, configured, applicationLinks) {
  if (configured) {
    return {
      label: t('重新申请', 'Get a new key'),
      href: providerApplyHref(id, applicationLinks),
      target: '_blank',
      rel: 'noreferrer',
      variant: 'action-pill',
    };
  }
  return {
    label: t('前往配置', 'Set up'),
    href: './',
  };
}

export function mapProvider(id, provider, applicationLinks) {
  const name = PROVIDER_NAMES[id] ?? id;
  const action = providerAction(id, provider?.configured === true, applicationLinks);
  if (!asRecord(provider)) {
    return unknownRow(
      name,
      t('缺少该凭证的状态字段，不能判断为已配置或未配置。', 'The status for this key is missing, so it cannot be called set or unset.'),
    );
  }
  if (typeof provider.configured !== 'boolean') {
    return {
      ...unknownRow(
        name,
        t('configured 字段缺失或无法识别，不能判断为已配置或未配置。', 'The configured field is missing or unreadable, so it cannot be called set or unset.'),
      ),
      action,
    };
  }
  if (provider.configured) {
    const masked =
      typeof provider.masked_key === 'string' && provider.masked_key.trim()
        ? provider.masked_key
        : '';
    return {
      name,
      statusLabel: t('凭证存在', 'Key present'),
      statusTone: 'verified',
      action,
      evidence: fieldMark(masked || t('已设置', 'Set')),
    };
  }
  const optional = provider.optional === true;
  return {
    name,
    statusLabel: optional ? t('未配置 · 可选', 'Not set · optional') : t('未配置', 'Not set'),
    statusTone: 'neutral',
    action,
    evidence: fieldMark(optional ? t('未设置，可选。', 'Not set; optional.') : t('未设置。', 'Not set.')),
  };
}

export function mapXpi(xpi) {
  const record = asRecord(xpi);
  if (!record) {
    return unknownRow(
      'literature-metrics',
      t('缺少 zotero_desktop_xpi 字段，不能判断安装状态。', 'The add-on status is missing, so installation cannot be judged.'),
    );
  }
  return {
    name: 'literature-metrics',
    statusLabel: t('安装步骤', 'Install steps'),
    statusTone: 'verified',
    action: {
      label: t('点击下载', 'Download'),
      href: XPI_RELEASES_HREF,
      target: '_blank',
      rel: 'noreferrer',
      variant: 'action-pill',
    },
    evidence: fieldMark(xpiEvidence()),
    details: xpiDetails(),
  };
}

export function mapDashboard(status) {
  const record = asRecord(status) ?? {};
  const providerStatus = asRecord(record.providers) ?? {};
  const applicationLinks = asRecord(record.application_links);

  return {
    sections: [
      {
        id: 'credentials',
        title: t('凭证', 'Keys'),
        rows: PROVIDER_ORDER.map((id) => mapProvider(id, providerStatus[id], applicationLinks)),
      },
      {
        id: 'xpi',
        title: t('Zotero 插件', 'Zotero add-on'),
        rows: [mapXpi(record.zotero_desktop_xpi)],
      },
    ],
  };
}

export function setText(node, value) {
  node.textContent = redactSensitive(value);
}

export function renderDashboard(root, view, doc) {
  const documentRef = doc ?? (typeof document === 'undefined' ? undefined : document);
  if (!root || !documentRef) return root;
  if (typeof root.replaceChildren === 'function') root.replaceChildren();
  else root.textContent = '';

  for (const section of view.sections) {
    const block = documentRef.createElement('section');
    block.className = `dashboard-section dashboard-section-${section.id}`;
    const heading = documentRef.createElement('h2');
    setText(heading, section.title);
    const list = documentRef.createElement('div');
    list.className = 'dashboard-rows';

    for (const row of section.rows) {
      const article = documentRef.createElement('article');
      article.className = 'dashboard-row';

      const primary = documentRef.createElement('div');
      primary.className = 'row-primary';
      const name = documentRef.createElement('h3');
      setText(name, row.name);
      const pills = documentRef.createElement('div');
      pills.className = 'row-pills';
      const hasDetails = Array.isArray(row.details) && row.details.length > 0;
      const pill = documentRef.createElement(hasDetails ? 'button' : 'p');
      pill.className = `status status--${row.statusTone}`;
      if (hasDetails) {
        pill.type = 'button';
        pill.setAttribute('type', 'button');
        pill.setAttribute('aria-expanded', 'false');
      }
      setText(pill, row.statusLabel);
      pills.append(pill);

      const evidence = documentRef.createElement('p');
      evidence.className = 'row-evidence';
      setText(evidence, row.evidence);

      if (row.action?.href) {
        const link = documentRef.createElement('a');
        link.className = row.action.variant === 'action-pill' ? 'action-pill' : 'row-action';
        link.href = row.action.href;
        if (row.action.target) {
          link.target = row.action.target;
          link.setAttribute('target', row.action.target);
        }
        if (row.action.rel) {
          link.rel = row.action.rel;
          link.setAttribute('rel', row.action.rel);
        }
        setText(link, row.action.label);
        pills.append(link);
      }

      primary.append(name, pills);
      article.append(primary, evidence);

      if (hasDetails) {
        const details = documentRef.createElement('details');
        details.className = 'row-details';
        const summary = documentRef.createElement('summary');
        setText(summary, t('完整步骤', 'Full steps'));
        details.append(summary);
        for (const item of row.details) {
          const line = documentRef.createElement('p');
          line.className = item.mono ? 'row-detail mono' : 'row-detail';
          setText(line, `${item.label}${t('：', ': ')}${item.value}`);
          details.append(line);
        }
        const syncExpanded = () => {
          pill.setAttribute('aria-expanded', details.open ? 'true' : 'false');
        };
        pill.addEventListener?.('click', () => {
          details.open = !details.open;
          syncExpanded();
        });
        details.addEventListener?.('toggle', syncExpanded);
        article.append(details);
      }

      list.append(article);
    }

    block.append(heading, list);
    root.append(block);
  }
  return root;
}

export function serializeRendered(root) {
  const walk = (node) => {
    if (!node) return '';
    if (node.nodeType === 3) return node.textContent ?? '';
    const tag = String(node.tagName || '').toLowerCase();
    if (!tag) return node.textContent ?? '';
    const attrEntries = {
      ...(node.attributes && !Array.isArray(node.attributes) && typeof node.attributes === 'object'
        ? Object.fromEntries(
            typeof node.attributes.length === 'number'
              ? Array.from(node.attributes).map((attr) => [attr.name, attr.value])
              : Object.entries(node.attributes),
          )
        : {}),
    };
    if (node.className && !attrEntries.class) attrEntries.class = node.className;
    if (node.href && !attrEntries.href) attrEntries.href = node.href;
    if (node.target && !attrEntries.target) attrEntries.target = node.target;
    if (node.rel && !attrEntries.rel) attrEntries.rel = node.rel;
    const attrs = Object.entries(attrEntries)
      .map(
        ([key, value]) =>
          ` ${key}="${String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"`,
      )
      .join('');
    const children = node.childNodes?.length
      ? Array.from(node.childNodes).map(walk).join('')
      : String(node.textContent ?? '')
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;');
    return `<${tag}${attrs}>${children}</${tag}>`;
  };
  return (
    Array.from(root.childNodes ?? [])
      .map(walk)
      .join('') || walk(root)
  );
}

export function providersFullyConfigured(status) {
  const providerStatus = asRecord(status?.providers) ?? {};
  return PROVIDER_ORDER.every((id) => providerStatus[id]?.configured === true);
}


/** The keys to walk through, one at a time, when an agent asked for specific ones. */
export function guidedSteps(status) {
  const requested = Array.isArray(status?.requested_providers) ? status.requested_providers : [];
  const providerStatus = asRecord(status?.providers) ?? {};
  return [...new Set(requested)]
    .filter((id) => PROVIDER_ORDER.includes(id))
    .map((id) => ({ id, configured: providerStatus[id]?.configured === true }));
}

export function applyOnboardingLayout(elements, { paired, fullyConfigured, guided = false }) {
  const pairing = elements?.pairing;
  const wizard = elements?.wizard;
  const statusView = elements?.statusView;
  const guidedPanel = elements?.guided;
  if (!paired) {
    if (pairing) pairing.hidden = false;
    if (wizard) wizard.hidden = true;
    if (statusView) statusView.hidden = true;
    if (guidedPanel) guidedPanel.hidden = true;
    return;
  }
  if (pairing) pairing.hidden = true;
  if (guidedPanel) guidedPanel.hidden = guided === false;
  // While keys are being offered one at a time, the all-keys grid and the long status
  // list would only compete with the single question on screen.
  if (wizard) wizard.hidden = guided !== false || Boolean(fullyConfigured);
  if (statusView) statusView.hidden = guided === 'active';
}

function formatReadAt(date) {
  return date.toLocaleString(lang === 'en' ? 'en-US' : 'zh-CN', { hour12: false });
}

function cookie(name, documentRef) {
  const prefix = `${encodeURIComponent(name)}=`;
  const item = String(documentRef?.cookie ?? '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  return item ? decodeURIComponent(item.slice(prefix.length)) : '';
}

function isAuthError(error) {
  const status = error && typeof error === 'object' ? error.status : undefined;
  return status === 401 || status === 403;
}

async function api(
  path,
  options = {},
  documentRef = typeof document === 'undefined' ? undefined : document,
) {
  const response = await fetch(`./api${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.method && options.method !== 'GET'
        ? { 'X-CSRF-Token': cookie('ai4s_onboarding_csrf', documentRef) }
        : {}),
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({ error: t('请求失败。', 'The request failed.') }));
  if (!response.ok) {
    const error = new Error(body.error || t('请求失败。', 'The request failed.'));
    error.status = response.status;
    throw error;
  }
  return body;
}

function setResult(node, message, error = false) {
  node.textContent = message;
  node.classList.toggle('error', error);
}

const SAVE_REJECTED = () =>
  t(
    '这个密钥没有通过检查，已有的设置没有改动。请检查后再试一次。',
    'That key was not accepted, and nothing was changed. Check it and try again.',
  );

// Page state that survives a language switch or a refresh of the status.
const view = { status: undefined, step: 0, saved: [], skipped: [], finished: false };

function renderStatus(status, documentRef) {
  const providerGrid = documentRef.querySelector('#providers');
  if (!providerGrid) return;
  providerGrid.replaceChildren();
  for (const [id, definition] of Object.entries(providers)) {
    const current = status.providers?.[id] ?? { configured: false, source: 'none' };
    const article = documentRef.createElement('article');
    article.className = 'provider';

    const title = documentRef.createElement('h3');
    title.textContent = definition.label;
    const meta = documentRef.createElement('p');
    meta.className = 'meta';
    meta.textContent = definition.purpose;
    const application = documentRef.createElement('a');
    application.href = definition.applyUrl;
    application.target = '_blank';
    application.rel = 'noreferrer';
    application.textContent = t('申请凭证', 'Get a key');
    const state = documentRef.createElement('p');
    state.className = 'status';
    state.textContent = current.configured
      ? t(`已配置 · 来源：${current.source}`, `Set · source: ${current.source}`)
      : t('未配置', 'Not set');
    const label = documentRef.createElement('label');
    label.htmlFor = `key-${id}`;
    label.textContent = t(`${definition.label} 凭证`, `${definition.label} key`);
    const input = documentRef.createElement('input');
    input.id = `key-${id}`;
    input.type = 'password';
    input.autocomplete = 'off';
    input.spellcheck = false;
    const actions = documentRef.createElement('div');
    actions.className = 'actions';
    const verify = documentRef.createElement('button');
    verify.type = 'button';
    verify.className = 'secondary';
    verify.textContent = t('仅校验', 'Check only');
    const save = documentRef.createElement('button');
    save.type = 'button';
    save.textContent = t('校验并保存', 'Check and save');
    const result = documentRef.createElement('p');
    result.className = 'result';
    result.setAttribute('role', 'status');

    const submit = async (action) => {
      const key = input.value.trim();
      if (!key) return setResult(result, t('请输入凭证。', 'Please enter a key.'), true);
      verify.disabled = true;
      save.disabled = true;
      try {
        const response = await api(
          `/providers/${id}/${action}`,
          {
            method: 'POST',
            body: JSON.stringify({ key }),
          },
          documentRef,
        );
        input.value = '';
        setResult(
          result,
          action === 'save'
            ? t('校验成功，已保存到私有配置。', 'The key checks out and is saved to a private file.')
            : t(`校验成功：${JSON.stringify(response.capabilities)}`, `The key checks out: ${JSON.stringify(response.capabilities)}`),
        );
        if (action === 'save') await refreshPairedView(documentRef);
      } catch (error) {
        input.value = '';
        setResult(result, isAuthError(error) ? t('配对已失效，请重新配对。', 'Pairing has expired; pair again.') : SAVE_REJECTED(), true);
      } finally {
        verify.disabled = false;
        save.disabled = false;
      }
    };

    verify.addEventListener('click', () => submit('verify'));
    save.addEventListener('click', () => submit('save'));
    actions.append(verify, save);
    article.append(title, meta, application, state, label, input, actions, result);
    providerGrid.append(article);
  }
}

function layoutElements(documentRef) {
  return {
    pairing: documentRef.querySelector('#pairing'),
    wizard: documentRef.querySelector('#wizard'),
    statusView: documentRef.querySelector('#status-view'),
    guided: documentRef.querySelector('#guided'),
  };
}

function paragraph(documentRef, className, text) {
  const node = documentRef.createElement('p');
  if (className) node.className = className;
  node.textContent = text;
  return node;
}

function renderGuidedStep(steps, documentRef) {
  const root = documentRef.querySelector('#guided-root');
  if (!root) return;
  root.replaceChildren();
  const step = steps[view.step];
  const definition = providers[step.id];

  root.append(
    paragraph(documentRef, 'eyebrow', t(`第 ${view.step + 1} 步，共 ${steps.length} 步`, `Step ${view.step + 1} of ${steps.length}`)),
  );
  const heading = documentRef.createElement('h2');
  heading.textContent = t(`${definition.label} 密钥`, `${definition.label} key`);
  root.append(heading, paragraph(documentRef, '', definition.purpose), paragraph(documentRef, 'meta', definition.how));

  const link = documentRef.createElement('a');
  link.className = 'action-pill';
  link.href = definition.applyUrl;
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.textContent = t('打开申请页面', 'Open the page to get a key');
  root.append(link);

  if (step.configured) {
    root.append(
      paragraph(
        documentRef,
        'status',
        t('这个密钥已经设置过。可以直接跳过，或粘贴新的密钥替换它。', 'This key is already set. You can skip it, or paste a new key to replace it.'),
      ),
    );
  }

  const label = documentRef.createElement('label');
  label.htmlFor = 'guided-key';
  label.textContent = t('把密钥粘贴在这里（输入内容会被遮住）', 'Paste the key here (it stays hidden)');
  const input = documentRef.createElement('input');
  input.id = 'guided-key';
  input.type = 'password';
  input.autocomplete = 'off';
  input.spellcheck = false;
  const actions = documentRef.createElement('div');
  actions.className = 'actions';
  const save = documentRef.createElement('button');
  save.type = 'button';
  save.textContent = t('检查并保存', 'Check and save');
  const skip = documentRef.createElement('button');
  skip.type = 'button';
  skip.className = 'secondary';
  skip.textContent = t('跳过', 'Skip');
  const result = documentRef.createElement('p');
  result.className = 'result';
  result.setAttribute('role', 'status');
  actions.append(save, skip);
  root.append(label, input, actions, result);

  const advance = async () => {
    view.step += 1;
    await refreshPairedView(documentRef);
  };
  skip.addEventListener('click', () => {
    view.skipped.push(step.id);
    advance();
  });
  save.addEventListener('click', async () => {
    const key = input.value.trim();
    if (!key) return setResult(result, t('请输入密钥。', 'Please enter a key.'), true);
    save.disabled = true;
    skip.disabled = true;
    try {
      await api(`/providers/${step.id}/save`, { method: 'POST', body: JSON.stringify({ key }) }, documentRef);
      input.value = '';
      view.saved.push(step.id);
      await advance();
    } catch (error) {
      input.value = '';
      setResult(result, isAuthError(error) ? t('配对已失效，请让助手重新打开设置页。', 'Pairing has expired; ask your assistant to open the setup page again.') : SAVE_REJECTED(), true);
      save.disabled = false;
      skip.disabled = false;
    }
  });
}

function renderGuidedDone(documentRef) {
  const root = documentRef.querySelector('#guided-root');
  if (!root) return;
  root.replaceChildren();
  const heading = documentRef.createElement('h2');
  heading.textContent = view.finished ? t('可以关闭这个页面了', 'You can close this page now') : t('设置完成', 'All done');
  root.append(heading);
  const names = (ids) => ids.map((id) => providers[id].label).join('、');
  if (view.saved.length > 0) {
    root.append(paragraph(documentRef, 'status', t(`已保存：${names(view.saved)}。`, `Saved: ${names(view.saved).replaceAll('、', ', ')}.`)));
  }
  if (view.skipped.length > 0) {
    root.append(paragraph(documentRef, 'meta', t(`已跳过：${names(view.skipped)}。以后需要时可以再让助手打开这个页面。`, `Skipped: ${names(view.skipped).replaceAll('、', ', ')}. Ask your assistant to open this page again whenever you want them.`)));
  }
  if (view.saved.includes('zotero')) {
    root.append(
      paragraph(documentRef, 'meta', t('Zotero 密钥需要重启这个应用后才会开始使用。', 'The Zotero key starts working after you restart this app.')),
    );
  }
  if (!view.finished) {
    const finish = documentRef.createElement('button');
    finish.type = 'button';
    finish.textContent = t('完成并关闭', 'Finish');
    finish.addEventListener('click', async () => {
      finish.disabled = true;
      try {
        await api('/finish', { method: 'POST', body: '{}' }, documentRef);
        view.finished = true;
        renderGuidedDone(documentRef);
      } catch {
        finish.disabled = false;
      }
    });
    root.append(finish);
  }
}

function renderGuided(status, documentRef) {
  const steps = guidedSteps(status);
  if (view.step < steps.length) renderGuidedStep(steps, documentRef);
  else renderGuidedDone(documentRef);
}

function renderPairedDashboard(status, documentRef, readAt = new Date()) {
  const root = documentRef.querySelector('#dashboard-root');
  const statusEl = documentRef.querySelector('#dashboard-status');
  const metaEl = documentRef.querySelector('#dashboard-read-meta');
  if (!root) return;
  renderDashboard(root, mapDashboard(status), documentRef);
  delete root.dataset.stale;
  if (metaEl) {
    metaEl.textContent = t(`本机工作台 · 状态读取时间：${formatReadAt(readAt)}`, `This computer · status read at ${formatReadAt(readAt)}`);
  }
  if (statusEl) {
    statusEl.classList.remove('error');
    statusEl.textContent = t('状态已更新。', 'Status updated.');
  }
}

// Text that is in the HTML already in Chinese; this swaps it when the language changes.
const STATIC_TEXT = [
  ['#page-title', '配置向导', 'Setup'],
  ['#eyebrow', '本机设置', 'LOCAL SETUP'],
  ['#pairing-title', '连接这个页面', 'Connect this page'],
  ['#pairing-help', '通常这一步会自动完成。如果页面要求输入配对码，请输入助手给你的配对码；它五分钟内有效，只能用一次。', 'This normally happens by itself. If the page asks for a code, type the code your assistant gave you. It works once and expires in five minutes.'],
  ['#pair-code-label', '配对码', 'Pairing code'],
  ['#pair-submit', '连接', 'Connect'],
  ['#wizard-title', '检查并保存密钥', 'Check and save keys'],
  ['#wizard-help', '已保存的密钥不会再显示；这里只显示是否已设置，以及它来自哪里。', 'A saved key is never shown again; this page only shows whether it is set and where it comes from.'],
  ['#refresh-status', '刷新状态', 'Refresh'],
  ['#status-title', '配置状态', 'Configuration status'],
  ['#status-note', '读取状态不代表执行连接测试。', 'Reading the status does not test any connection.'],
  ['#refresh-dashboard', '刷新状态', 'Refresh'],
  ['#lang-toggle', 'English', '中文'],
];

export function applyStaticText(documentRef) {
  documentRef.documentElement?.setAttribute?.('lang', lang === 'en' ? 'en' : 'zh-CN');
  for (const [selector, zh, en] of STATIC_TEXT) {
    const node = documentRef.querySelector(selector);
    if (node) node.textContent = t(zh, en);
  }
  if (documentRef.title !== undefined) {
    documentRef.title = t('AI4S Literature Workbench 配置向导', 'AI4S Literature Workbench setup');
  }
}

async function refreshPairedView(documentRef) {
  const root = documentRef.querySelector('#dashboard-root');
  const statusEl = documentRef.querySelector('#dashboard-status');
  const refreshButtons = [
    documentRef.querySelector('#refresh-status'),
    documentRef.querySelector('#refresh-dashboard'),
  ].filter(Boolean);
  const hasResult = Boolean(root?.childNodes?.length);
  for (const button of refreshButtons) button.disabled = true;
  if (statusEl) {
    if (!hasResult) statusEl.textContent = t('正在读取状态', 'Reading status');
    else {
      statusEl.textContent = t('正在刷新状态。以下为上次读取结果。', 'Refreshing. What is shown is the last reading.');
      if (root) root.dataset.stale = 'true';
    }
  }
  try {
    const [status, setup] = await Promise.all([api('/dashboard', {}, documentRef), api('/status', {}, documentRef)]);
    const merged = {
      ...status,
      requested_providers: setup.requested_providers,
      ui_language: setup.ui_language,
    };
    view.status = merged;
    if (!view.languageChosen && !storedLanguage(documentRef) && (setup.ui_language === 'zh' || setup.ui_language === 'en')) {
      if (setup.ui_language !== lang) {
        setLanguage(setup.ui_language);
        applyStaticText(documentRef);
      }
      view.languageChosen = true;
    }
    const steps = guidedSteps(merged);
    const guided = steps.length === 0 ? false : view.step < steps.length ? 'active' : 'done';
    applyOnboardingLayout(layoutElements(documentRef), {
      paired: true,
      fullyConfigured: providersFullyConfigured(merged),
      guided,
    });
    if (guided !== false) renderGuided(merged, documentRef);
    const wizard = documentRef.querySelector('#wizard');
    if (wizard && !wizard.hidden) renderStatus(merged, documentRef);
    renderPairedDashboard(merged, documentRef);
  } catch (error) {
    if (isAuthError(error)) {
      applyOnboardingLayout(layoutElements(documentRef), {
        paired: false,
        fullyConfigured: false,
      });
      if (root) {
        if (typeof root.replaceChildren === 'function') root.replaceChildren();
        else root.textContent = '';
        delete root.dataset.stale;
      }
      if (statusEl) {
        statusEl.classList.remove('error');
        statusEl.textContent = t('需要重新配对后才能读取状态。', 'Pair again to read the status.');
      }
      const metaEl = documentRef.querySelector('#dashboard-read-meta');
      if (metaEl) metaEl.textContent = '';
      return;
    }
    if (statusEl) {
      statusEl.classList.add('error');
      statusEl.textContent = t(
        `${error instanceof Error ? error.message : '读取失败。'}可重试；失败不会改写为全部未配置。`,
        `${error instanceof Error ? error.message : 'Reading failed.'} You can retry; a failure is never shown as “everything unset”.`,
      );
    }
  } finally {
    for (const button of refreshButtons) button.disabled = false;
  }
}

function storedLanguage(documentRef) {
  try {
    const value = documentRef.defaultView?.localStorage?.getItem(LANG_STORE_KEY);
    return value === 'zh' || value === 'en' ? value : undefined;
  } catch {
    return undefined;
  }
}

function rememberLanguage(documentRef, value) {
  try {
    documentRef.defaultView?.localStorage?.setItem(LANG_STORE_KEY, value);
  } catch {
    // A browser that refuses storage just forgets the choice.
  }
}

async function redeemPairing(code, documentRef, pairResult) {
  try {
    const response = await fetch('./api/pair', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-CSRF-Token': cookie('ai4s_onboarding_pair_csrf', documentRef),
      },
      body: JSON.stringify({ code }),
    });
    if (!response.ok) {
      throw new Error(
        response.status === 429
          ? t('尝试次数太多。请让助手重新打开设置页。', 'Too many tries. Ask your assistant to open the setup page again.')
          : t('配对码不对或已失效。请让助手重新打开设置页。', 'That code is wrong or has expired. Ask your assistant to open the setup page again.'),
      );
    }
    if (pairResult) setResult(pairResult, t('已连接。', 'Connected.'));
    await refreshPairedView(documentRef);
    return true;
  } catch (error) {
    if (pairResult) {
      setResult(pairResult, error instanceof Error ? error.message : t('配对失败。', 'Pairing failed.'), true);
    }
    return false;
  }
}

function boot(documentRef = typeof document === 'undefined' ? undefined : document) {
  if (!documentRef) return;
  const win = documentRef.defaultView;

  setLanguage(chooseLanguage({ stored: storedLanguage(documentRef), browser: win?.navigator?.language }));
  applyStaticText(documentRef);

  const pairForm = documentRef.querySelector('#pair-form');
  const pairResult = documentRef.querySelector('#pair-result');
  const pairCode = documentRef.querySelector('#pair-code');
  pairForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = pairCode?.value.trim() ?? '';
    if (pairCode) pairCode.value = '';
    await redeemPairing(code, documentRef, pairResult);
  });
  documentRef.querySelector('#lang-toggle')?.addEventListener('click', () => {
    const next = lang === 'en' ? 'zh' : 'en';
    setLanguage(next);
    rememberLanguage(documentRef, next);
    view.languageChosen = true;
    applyStaticText(documentRef);
    refreshPairedView(documentRef);
  });
  documentRef.querySelector('#refresh-status')?.addEventListener('click', () => {
    documentRef.querySelector('#dashboard-status')?.classList.remove('error');
    refreshPairedView(documentRef);
  });
  documentRef.querySelector('#refresh-dashboard')?.addEventListener('click', () => {
    documentRef.querySelector('#dashboard-status')?.classList.remove('error');
    refreshPairedView(documentRef);
  });

  // The launching process opens this page with the one-time code in the fragment. The
  // browser never sends a fragment to the server. Take it out of the address bar before
  // anything else, so it is not left in the visible URL or copied along with it.
  const code = codeFromHash(win?.location?.hash);
  if (code) {
    win.history.replaceState(null, '', win.location.pathname);
    redeemPairing(code, documentRef, pairResult);
    return;
  }
  refreshPairedView(documentRef);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => boot());
  } else {
    boot();
  }
}
