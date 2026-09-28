/* eslint-env browser */

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

const pairing = document.querySelector('#pairing');
const wizard = document.querySelector('#wizard');
const providerGrid = document.querySelector('#providers');
const pairResult = document.querySelector('#pair-result');

function cookie(name) {
  const prefix = `${encodeURIComponent(name)}=`;
  const item = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  return item ? decodeURIComponent(item.slice(prefix.length)) : '';
}

async function api(path, options = {}) {
  const response = await fetch(`./api${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.method && options.method !== 'GET'
        ? { 'X-CSRF-Token': cookie('ai4s_onboarding_csrf') }
        : {}),
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({ error: '请求失败。' }));
  if (!response.ok) throw new Error(body.error || '请求失败。');
  return body;
}

function setResult(node, message, error = false) {
  node.textContent = message;
  node.classList.toggle('error', error);
}

function renderStatus(status) {
  providerGrid.replaceChildren();
  for (const [id, definition] of Object.entries(providers)) {
    const current = status.providers[id];
    const article = document.createElement('article');
    article.className = 'provider';

    const title = document.createElement('h3');
    title.textContent = definition.label;
    const meta = document.createElement('p');
    meta.className = 'meta';
    meta.textContent = definition.purpose;
    const application = document.createElement('a');
    application.href = definition.applyUrl;
    application.target = '_blank';
    application.rel = 'noreferrer';
    application.textContent = '申请凭证';
    const state = document.createElement('p');
    state.className = 'status';
    state.textContent = current.configured
      ? `已配置 · 来源：${current.source}`
      : '未配置 · 来源：none';
    const label = document.createElement('label');
    label.htmlFor = `key-${id}`;
    label.textContent = `${definition.label} 凭证`;
    const input = document.createElement('input');
    input.id = `key-${id}`;
    input.type = 'password';
    input.autocomplete = 'off';
    input.spellcheck = false;
    const actions = document.createElement('div');
    actions.className = 'actions';
    const verify = document.createElement('button');
    verify.type = 'button';
    verify.className = 'secondary';
    verify.textContent = '仅校验';
    const save = document.createElement('button');
    save.type = 'button';
    save.textContent = '校验并保存';
    const result = document.createElement('p');
    result.className = 'result';
    result.setAttribute('role', 'status');

    const submit = async (action) => {
      const key = input.value.trim();
      if (!key) return setResult(result, '请输入凭证。', true);
      verify.disabled = true;
      save.disabled = true;
      try {
        const response = await api(`/providers/${id}/${action}`, {
          method: 'POST',
          body: JSON.stringify({ key }),
        });
        input.value = '';
        setResult(
          result,
          action === 'save'
            ? '校验成功，已保存到私有配置。'
            : `校验成功：${JSON.stringify(response.capabilities)}`,
        );
        if (action === 'save') await refreshStatus();
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

async function refreshStatus() {
  try {
    const status = await api('/status');
    pairing.hidden = true;
    wizard.hidden = false;
    renderStatus(status);
  } catch {
    pairing.hidden = false;
    wizard.hidden = true;
  }
}

document.querySelector('#pair-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = document.querySelector('#pair-code');
  const code = input.value;
  input.value = '';
  try {
    const response = await fetch('./api/pair', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-CSRF-Token': cookie('ai4s_onboarding_pair_csrf'),
      },
      body: JSON.stringify({ code }),
    });
    const body = await response.json().catch(() => ({ error: '配对失败。' }));
    if (!response.ok) throw new Error(body.error || '配对失败。');
    setResult(pairResult, '配对成功。会话仅限此管理路由，并将在短时限后失效。');
    await refreshStatus();
  } catch (error) {
    setResult(pairResult, error instanceof Error ? error.message : '配对失败。', true);
  }
});

document.querySelector('#refresh-status').addEventListener('click', refreshStatus);
refreshStatus();
