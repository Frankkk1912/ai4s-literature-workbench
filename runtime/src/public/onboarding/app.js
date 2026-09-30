/* eslint-env browser */

const PROVIDER_ORDER = ['zotero', 'pubmed', 'easyscholar'];
const PROVIDER_NAMES = {
  zotero: 'Zotero',
  pubmed: 'PubMed',
  easyscholar: 'EasyScholar',
};
const SOURCE_EVIDENCE = {
  environment: '来源：环境变量。',
  private_config: '来源：私有配置。',
};
const XPI_RELEASES_HREF = 'https://github.com/Frankkk1912/ai4s-literature-workbench/releases';
const XPI_EVIDENCE =
  '在 Zotero 中选择 Tools → Add-ons → 齿轮菜单 → Install Add-on From File…，选择下载的 .xpi 文件。';
const SENSITIVE_URL = /[^\s"'<>]*((?:api_key|secretKey|secret_key)=)[^\s"'<>]*/gi;

const providers = {
  zotero: {
    label: 'Zotero Web API',
    purpose: '云端文献库身份、条目/标签写入及可选文件访问',
    applyUrl: 'https://www.zotero.org/settings/keys',
  },
  pubmed: {
    label: 'PubMed / NCBI',
    purpose: '提高 E-utilities 请求额度并稳定批量检索',
    applyUrl: 'https://www.ncbi.nlm.nih.gov/datasets/docs/v2/api/api-keys/',
  },
  easyscholar: {
    label: 'EasyScholar',
    purpose: '可选的期刊分区与指标补充',
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
    statusLabel: '状态未知',
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
      label: '重新申请',
      href: providerApplyHref(id, applicationLinks),
      target: '_blank',
      rel: 'noreferrer',
    };
  }
  return {
    label: '前往配置',
    href: './',
  };
}

export function mapProvider(id, provider, applicationLinks) {
  const name = PROVIDER_NAMES[id] ?? id;
  const action = providerAction(id, provider?.configured === true, applicationLinks);
  if (!asRecord(provider)) {
    return unknownRow(name, '缺少该凭证的状态字段，不能判断为已配置或未配置。');
  }
  if (typeof provider.configured !== 'boolean') {
    return {
      ...unknownRow(name, 'configured 字段缺失或无法识别，不能判断为已配置或未配置。'),
      action,
    };
  }
  if (provider.configured) {
    const sourceKey = typeof provider.source === 'string' ? provider.source : '';
    return {
      name,
      statusLabel: '凭证存在',
      statusTone: 'verified',
      action,
      evidence: fieldMark(SOURCE_EVIDENCE[sourceKey] ?? '未设置。'),
    };
  }
  const optional = provider.optional === true;
  return {
    name,
    statusLabel: optional ? '未配置 · 可选' : '未配置',
    statusTone: 'neutral',
    action,
    evidence: fieldMark(optional ? '未设置，可选。' : '未设置。'),
  };
}

export function mapXpi(xpi) {
  const record = asRecord(xpi);
  if (!record) {
    return unknownRow('literature-metrics', '缺少 zotero_desktop_xpi 字段，不能判断安装状态。');
  }
  return {
    name: 'literature-metrics',
    statusLabel: '点击下载',
    statusTone: 'verified',
    action: {
      label: '下载',
      href: XPI_RELEASES_HREF,
      target: '_blank',
      rel: 'noreferrer',
    },
    evidence: fieldMark(XPI_EVIDENCE),
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
        title: '凭证',
        rows: PROVIDER_ORDER.map((id) => mapProvider(id, providerStatus[id], applicationLinks)),
      },
      {
        id: 'xpi',
        title: 'Zotero 插件',
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
      const pill = documentRef.createElement('p');
      pill.className = `status status--${row.statusTone}`;
      setText(pill, row.statusLabel);
      primary.append(name, pill);

      const evidence = documentRef.createElement('p');
      evidence.className = 'row-evidence';
      setText(evidence, row.evidence);

      if (row.action?.href) {
        const link = documentRef.createElement('a');
        link.className = 'row-action';
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
        primary.append(link);
      }

      article.append(primary, evidence);
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

export function applyOnboardingLayout(elements, { paired, fullyConfigured }) {
  const pairing = elements?.pairing;
  const wizard = elements?.wizard;
  const statusView = elements?.statusView;
  if (!paired) {
    if (pairing) pairing.hidden = false;
    if (wizard) wizard.hidden = true;
    if (statusView) statusView.hidden = true;
    return;
  }
  if (pairing) pairing.hidden = true;
  if (wizard) wizard.hidden = Boolean(fullyConfigured);
  if (statusView) statusView.hidden = false;
}

function formatReadAt(date) {
  return date.toLocaleString('zh-CN', { hour12: false });
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
  const body = await response.json().catch(() => ({ error: '请求失败。' }));
  if (!response.ok) {
    const error = new Error(body.error || '请求失败。');
    error.status = response.status;
    throw error;
  }
  return body;
}

function setResult(node, message, error = false) {
  node.textContent = message;
  node.classList.toggle('error', error);
}

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
    application.textContent = '申请凭证';
    const state = documentRef.createElement('p');
    state.className = 'status';
    state.textContent = current.configured
      ? `已配置 · 来源：${current.source}`
      : '未配置 · 来源：none';
    const label = documentRef.createElement('label');
    label.htmlFor = `key-${id}`;
    label.textContent = `${definition.label} 凭证`;
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
    verify.textContent = '仅校验';
    const save = documentRef.createElement('button');
    save.type = 'button';
    save.textContent = '校验并保存';
    const result = documentRef.createElement('p');
    result.className = 'result';
    result.setAttribute('role', 'status');

    const submit = async (action) => {
      const key = input.value.trim();
      if (!key) return setResult(result, '请输入凭证。', true);
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
            ? '校验成功，已保存到私有配置。'
            : `校验成功：${JSON.stringify(response.capabilities)}`,
        );
        if (action === 'save') await refreshPairedView(documentRef);
      } catch (error) {
        input.value = '';
        setResult(result, error instanceof Error ? error.message : '请求失败。', true);
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
  };
}

function renderPairedDashboard(status, documentRef, readAt = new Date()) {
  const root = documentRef.querySelector('#dashboard-root');
  const statusEl = documentRef.querySelector('#dashboard-status');
  const metaEl = documentRef.querySelector('#dashboard-read-meta');
  if (!root) return;
  renderDashboard(root, mapDashboard(status), documentRef);
  delete root.dataset.stale;
  if (metaEl) {
    metaEl.textContent = `本机工作台 · 状态读取时间：${formatReadAt(readAt)}`;
  }
  if (statusEl) {
    statusEl.classList.remove('error');
    statusEl.textContent = '状态已更新。';
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
    if (!hasResult) statusEl.textContent = '正在读取状态';
    else {
      statusEl.textContent = '正在刷新状态。以下为上次读取结果。';
      if (root) root.dataset.stale = 'true';
    }
  }
  try {
    const status = await api('/dashboard', {}, documentRef);
    applyOnboardingLayout(layoutElements(documentRef), {
      paired: true,
      fullyConfigured: providersFullyConfigured(status),
    });
    const wizard = documentRef.querySelector('#wizard');
    if (wizard && !wizard.hidden) renderStatus(status, documentRef);
    renderPairedDashboard(status, documentRef);
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
        statusEl.textContent = '需要重新配对后才能读取状态。';
      }
      const metaEl = documentRef.querySelector('#dashboard-read-meta');
      if (metaEl) metaEl.textContent = '';
      return;
    }
    if (statusEl) {
      statusEl.classList.add('error');
      statusEl.textContent = `${error instanceof Error ? error.message : '读取失败。'}可重试；失败不会改写为全部未配置。`;
    }
  } finally {
    for (const button of refreshButtons) button.disabled = false;
  }
}

function boot(documentRef = typeof document === 'undefined' ? undefined : document) {
  if (!documentRef) return;
  const pairForm = documentRef.querySelector('#pair-form');
  const pairResult = documentRef.querySelector('#pair-result');
  const pairCode = documentRef.querySelector('#pair-code');
  pairForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = pairCode?.value.trim() ?? '';
    if (pairCode) pairCode.value = '';
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
      const body = await response.json().catch(() => ({ error: '配对失败。' }));
      if (!response.ok) throw new Error(body.error || '配对失败。');
      if (pairResult) {
        setResult(pairResult, '配对成功。会话仅限此管理路由，并将在短时限后失效。');
      }
      await refreshPairedView(documentRef);
    } catch (error) {
      if (pairResult) {
        setResult(pairResult, error instanceof Error ? error.message : '配对失败。', true);
      }
    }
  });
  documentRef.querySelector('#refresh-status')?.addEventListener('click', () => {
    documentRef.querySelector('#dashboard-status')?.classList.remove('error');
    refreshPairedView(documentRef);
  });
  documentRef.querySelector('#refresh-dashboard')?.addEventListener('click', () => {
    documentRef.querySelector('#dashboard-status')?.classList.remove('error');
    refreshPairedView(documentRef);
  });
  refreshPairedView(documentRef);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => boot());
  } else {
    boot();
  }
}
