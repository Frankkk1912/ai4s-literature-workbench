/* eslint-env browser */

const PROVIDER_ORDER = ['zotero', 'pubmed', 'easyscholar'];
const PROVIDER_NAMES = {
  zotero: 'Zotero',
  pubmed: 'PubMed',
  easyscholar: 'EasyScholar',
};
const SOURCE_LABELS = {
  environment: '环境变量',
  private_config: '私有配置',
  none: '无',
};
const ARTIFACT_NAMES = {
  runtime: 'Runtime（Zotero MCP）',
  fulltext_runtime: 'Fulltext Runtime',
};
const XPI_BUILD_COMMAND = 'cd literature-metrics && npm run package';
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
    details: [{ label: '说明', value: reason, mono: false }],
  };
}

export function mapProvider(id, provider) {
  const name = PROVIDER_NAMES[id] ?? id;
  const action = {
    label: provider?.configured ? '管理凭证' : '前往配置',
    href: './',
  };
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
    const sourceLabel = SOURCE_LABELS[sourceKey] ?? (sourceKey || '未知');
    return {
      name,
      statusLabel: '凭证存在',
      statusTone: 'neutral',
      action,
      evidence: fieldMark(`来源：${sourceLabel}；仅确认检测到凭证，未据此判断在线校验或连接。`),
      details: [
        { label: 'configured', value: 'true', mono: true },
        { label: 'source', value: sourceKey || '（缺字段）', mono: true },
        { label: 'optional', value: String(Boolean(provider.optional)), mono: true },
      ],
    };
  }
  const optional = provider.optional === true;
  return {
    name,
    statusLabel: optional ? '未配置 · 可选' : '未配置',
    statusTone: 'neutral',
    action,
    evidence: fieldMark(optional ? '未检测到凭证。该凭证为可选，不作为故障。' : '未检测到凭证。'),
    details: [
      { label: 'configured', value: 'false', mono: true },
      { label: 'source', value: String(provider.source ?? 'none'), mono: true },
      { label: 'optional', value: String(optional), mono: true },
    ],
  };
}

export function mapArtifact(id, artifact) {
  const name = ARTIFACT_NAMES[id] ?? id;
  if (!asRecord(artifact) || typeof artifact.exists !== 'boolean') {
    return unknownRow(name, '缺少构建产物 exists 字段，不能判断为存在或不存在。');
  }
  const path = typeof artifact.path === 'string' ? artifact.path : '';
  const apiEvidence =
    typeof artifact.evidence === 'string' && artifact.evidence.trim()
      ? artifact.evidence
      : artifact.exists
        ? 'Build artifact exists; existence is not proof of connectivity.'
        : 'Build artifact is absent; artifact existence would not be proof of connectivity.';
  if (artifact.exists) {
    return {
      name,
      statusLabel: '构建文件存在',
      statusTone: 'neutral',
      action: { label: '查看路径', openDetails: true },
      evidence: fieldMark(path ? '已找到构建产物。' : '已找到构建产物。'),
      details: [
        { label: 'path', value: path || '（缺字段）', mono: true },
        { label: 'exists', value: 'true', mono: true },
        { label: 'evidence', value: apiEvidence, mono: false },
      ],
    };
  }
  return {
    name,
    statusLabel: '未找到构建文件',
    statusTone: 'neutral',
    action: { label: '查看路径', openDetails: true },
    evidence: fieldMark(path ? '未找到构建产物。' : '未找到构建产物。'),
    details: [
      { label: 'path', value: path || '（缺字段）', mono: true },
      { label: 'exists', value: 'false', mono: true },
      { label: 'evidence', value: apiEvidence, mono: false },
    ],
  };
}

export function mapXpi(xpi) {
  const record = asRecord(xpi);
  if (!record) {
    return unknownRow('literature-metrics', '缺少 zotero_desktop_xpi 字段，不能判断安装状态。');
  }
  const artifact = typeof record.artifact === 'string' ? record.artifact : '';
  const install = typeof record.install === 'string' ? record.install : '';
  const note = typeof record.note === 'string' ? record.note : '';
  return {
    name: 'literature-metrics',
    statusLabel: '需要手动安装',
    statusTone: 'neutral',
    action: { label: '查看安装步骤', openDetails: true },
    evidence: fieldMark('请从 GitHub Releases 下载最新版本 XPI 后在 Zotero 里手动加载。'),
    details: [
      {
        label: '下载',
        value: 'https://github.com/Frankkk1912/ai4s-literature-workbench/releases',
        mono: false,
      },
      { label: '打包命令', value: XPI_BUILD_COMMAND, mono: true },
      { label: '安装步骤', value: install || '（参考 Zotero 文档）', mono: false },
      { label: '版本/校验', value: artifact || '（未提供）', mono: true },
      { label: '备注', value: note || '（无）', mono: false },
    ],
  };
}

export function mapHost(host) {
  const record = asRecord(host);
  if (!record) {
    return unknownRow('未知宿主', '缺少宿主状态字段，不能判断为已安装或已连接。');
  }
  const name = typeof record.name === 'string' && record.name ? record.name : '未知宿主';
  const level = typeof record.level === 'string' ? record.level : '';
  const apiEvidence = typeof record.evidence === 'string' ? record.evidence : '';
  const action = { label: '查看接入说明', openDetails: true };
  const details = [
    { label: 'id', value: String(record.id ?? '（缺字段）'), mono: true },
    { label: 'level', value: level || '（缺字段）', mono: true },
    { label: 'evidence', value: apiEvidence || '（缺字段）', mono: false },
  ];
  if (level === 'verified') {
    return {
      name,
      statusLabel: '宿主可用性已实测',
      statusTone: 'verified',
      action,
      evidence: fieldMark(
        `宿主可用性已实测；该结论仅针对宿主本身，不表示 MCP 已连接。返回依据：${apiEvidence || '缺少 evidence 字段'}。`,
      ),
      details,
    };
  }
  if (level === 'pending_manual') {
    return {
      name,
      statusLabel: '待人工核验',
      statusTone: 'neutral',
      action,
      evidence: fieldMark(
        `兼容清单仅为线索，不是宿主已安装或 MCP 已连接的证据。返回依据：${apiEvidence || '缺少 evidence 字段'}。`,
      ),
      details,
    };
  }
  if (level === 'unknown') {
    return {
      name,
      statusLabel: '未知',
      statusTone: 'neutral',
      action,
      evidence: fieldMark(
        `未知：未观察到宿主兼容线索，不等于未安装或失败。返回依据：${apiEvidence || '缺少 evidence 字段'}。`,
      ),
      details,
    };
  }
  return {
    ...unknownRow(name, `宿主 level 无法识别（${level || '缺字段'}），不能回退为成功。`),
    action,
    details,
  };
}

export function mapConnection(connection) {
  const record = asRecord(connection);
  if (!record) {
    return unknownRow('未知连接', '缺少连接状态字段，不能判断为已连接或失败。');
  }
  const name = typeof record.name === 'string' && record.name ? record.name : '未知连接';
  const level = typeof record.level === 'string' ? record.level : '';
  const apiEvidence = typeof record.evidence === 'string' ? record.evidence : '';
  const details = [
    { label: 'id', value: String(record.id ?? '（缺字段）'), mono: true },
    { label: 'level', value: level || '（缺字段）', mono: true },
    { label: 'evidence', value: apiEvidence || '（缺字段）', mono: false },
  ];
  if (level === 'verified') {
    return {
      name,
      statusLabel: '已连接（实测）',
      statusTone: 'verified',
      action: undefined,
      evidence: fieldMark(
        `已连接（实测）；该结论仅针对此连接对象。返回依据：${apiEvidence || '缺少 evidence 字段'}。`,
      ),
      details,
    };
  }
  if (level === 'pending_manual') {
    return {
      name,
      statusLabel: '待人工核验',
      statusTone: 'neutral',
      action: undefined,
      evidence: fieldMark(
        `连接仍待人工核验，不推断成功或失败。返回依据：${apiEvidence || '缺少 evidence 字段'}。`,
      ),
      details,
    };
  }
  if (level === 'unknown') {
    return {
      name,
      statusLabel: '未知',
      statusTone: 'neutral',
      action: undefined,
      evidence: fieldMark(
        `尚无连接实测证据。未知不等于已连接或失败。返回依据：${apiEvidence || '缺少 evidence 字段'}。`,
      ),
      details,
    };
  }
  return {
    ...unknownRow(name, `连接 level 无法识别（${level || '缺字段'}），不能回退为成功。`),
    details,
  };
}

export function mapDashboard(status) {
  const record = asRecord(status) ?? {};
  const providerStatus = asRecord(record.providers) ?? {};
  const artifacts = asRecord(record.build_artifacts);
  const hosts = Array.isArray(record.hosts) ? record.hosts : undefined;
  const connections = Array.isArray(record.connections) ? record.connections : undefined;

  return {
    sections: [
      {
        id: 'credentials',
        title: '凭证',
        rows: PROVIDER_ORDER.map((id) => mapProvider(id, providerStatus[id])),
      },
      {
        id: 'artifacts',
        title: '工作台核心',
        rows: artifacts
          ? Object.entries(artifacts).map(([id, artifact]) => mapArtifact(id, artifact))
          : [unknownRow('构建产物', '缺少 build_artifacts 字段，不能判断为存在或不存在。')],
      },
      {
        id: 'xpi',
        title: 'Zotero 插件',
        rows: [mapXpi(record.zotero_desktop_xpi)],
      },
      {
        id: 'hosts',
        title: '客户端工具',
        rows: hosts
          ? hosts.map((host) => mapHost(host))
          : [unknownRow('宿主线索', '缺少 hosts 字段，不能判断宿主安装或连接。')],
      },
      {
        id: 'connections',
        title: 'agent 连接',
        rows: connections
          ? connections.map((connection) => mapConnection(connection))
          : [unknownRow('连接证据', '缺少 connections 字段，不能判断为已连接或失败。')],
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
    block.className = 'dashboard-section';
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
      pill.className = `status status-${row.statusTone}`;
      setText(pill, row.statusLabel);
      primary.append(name, pill);

      const evidence = documentRef.createElement('p');
      evidence.className = 'row-evidence';
      setText(evidence, row.evidence);

      const details = documentRef.createElement('details');
      const summary = documentRef.createElement('summary');
      setText(summary, '完整路径、命令与技术说明');
      details.append(summary);

      if (row.action?.href) {
        const link = documentRef.createElement('a');
        link.className = 'row-action';
        link.href = row.action.href;
        setText(link, row.action.label);
        primary.append(link);
      } else if (row.action?.openDetails) {
        const button = documentRef.createElement('button');
        button.type = 'button';
        button.className = 'row-action';
        setText(button, row.action.label);
        primary.append(button);
        button.addEventListener?.('click', () => {
          details.open = true;
        });
      }
      for (const item of row.details) {
        const line = documentRef.createElement('p');
        line.className = item.mono ? 'row-detail mono' : 'row-detail';
        setText(line, `${item.label}：${item.value}`);
        details.append(line);
      }

      article.append(primary, evidence, details);
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
