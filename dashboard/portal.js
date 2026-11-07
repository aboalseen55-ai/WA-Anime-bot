'use strict';
(() => {
  const $ = id => document.getElementById(id);
  let csrf = '';
  let role = '';
  let pollTimer = null;

  async function api(path, { method = 'GET', body } = {}) {
    const response = await fetch(`/portal/api/${path}`, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-Portal-Csrf': csrf } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(data.error || 'صار خطأ'); error.status = response.status; throw error; }
    return data;
  }

  function show(view) {
    for (const id of ['login-view', 'admin-view', 'tenant-view']) $(id).hidden = id !== view;
    $('logout').hidden = view === 'login-view';
    $('back-admin').hidden = !(view === 'tenant-view' && role === 'admin');
    if (view !== 'tenant-view' && pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'class') node.className = value; else if (key.startsWith('on')) node.addEventListener(key.slice(2), value); else node.setAttribute(key, value);
    }
    for (const child of children) if (child != null) node.append(child);
    return node;
  }

  const time = value => value ? new Date(value).toLocaleString('ar-JO', { dateStyle: 'short', timeStyle: 'short' }) : '';

  async function boot() {
    try {
      const me = await api('me');
      csrf = me.csrf; role = me.role;
      if (me.tenant) return openTenant(me.tenant);
      if (role === 'admin') return openAdmin();
    } catch { /* not signed in */ }
    show('login-view');
  }

  $('login-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = new FormData(event.target);
    $('login-error').textContent = '';
    try {
      const result = await api('login', { method: 'POST', body: { username: form.get('username'), password: form.get('password') } });
      csrf = result.csrf; role = result.role;
      event.target.reset();
      boot();
    } catch (error) { $('login-error').textContent = error.message; }
  });

  $('logout').addEventListener('click', async () => {
    try { await api('logout', { method: 'POST' }); } catch { /* ignore */ }
    csrf = ''; role = ''; show('login-view');
  });
  $('back-admin').addEventListener('click', openAdmin);

  // ---------- admin ----------
  async function openAdmin() {
    show('admin-view');
    $('title').textContent = 'بوابة الأعمال · المسؤول';
    const data = await api('admin/tenants');
    const select = $('preset-select');
    select.replaceChildren(el('option', { value: '' }, 'بدون'), ...data.presets.map(preset => el('option', { value: preset.key }, preset.name)));
    const list = $('tenant-list');
    list.replaceChildren(...(data.tenants.length ? data.tenants.map(tenant => el('div', { class: 'item' },
      el('div', { class: 'item-head' },
        el('b', {}, `${tenant.name} (${tenant.slug})`),
        el('span', { class: 'badge' }, tenant.status.connection === 'open' ? `متصل ${tenant.status.phone || ''}` : tenant.enabled ? 'غير متصل' : 'موقوف')),
      el('div', { class: 'row' },
        el('button', { onclick: async () => { await api(`admin/tenants/${tenant.id}/open`, { method: 'POST' }); boot(); } }, 'فتح'),
        el('button', { class: 'ghost', onclick: async () => { await api(`admin/tenants/${tenant.id}`, { method: 'PUT', body: { enabled: !tenant.enabled } }); openAdmin(); } }, tenant.enabled ? 'إيقاف' : 'تفعيل'),
        el('button', { class: 'ghost', onclick: async () => {
          const password = prompt('كلمة مرور جديدة (8 أحرف على الأقل)');
          if (password) { try { await api(`admin/tenants/${tenant.id}`, { method: 'PUT', body: { password } }); } catch (error) { alert(error.message); } }
        } }, 'تغيير كلمة المرور'),
        el('button', { class: 'danger', onclick: async () => {
          if (confirm(`حذف ${tenant.name} وكل محادثاته؟`)) { await api(`admin/tenants/${tenant.id}`, { method: 'DELETE' }); openAdmin(); }
        } }, 'حذف'))
    )) : [el('p', { class: 'muted' }, 'ما في حسابات لسا.')]));
  }

  $('create-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.target));
    $('create-error').textContent = '';
    try { await api('admin/tenants', { method: 'POST', body: form }); event.target.reset(); openAdmin(); } catch (error) { $('create-error').textContent = error.message; }
  });

  // ---------- account ----------
  function fillSettings(settings) {
    const form = $('settings-form');
    for (const [key, value] of Object.entries(settings)) {
      const field = form.elements[key];
      if (!field) continue;
      if (field.type === 'checkbox') field.checked = Boolean(value);
      else field.value = Array.isArray(value) ? value.join('\n') : value ?? '';
    }
  }

  function renderStatus(status) {
    const label = { open: `✅ متصل${status.phone ? ` بالرقم ${status.phone}` : ''}`, connecting: '⏳ جاري الاتصال...', reconnecting: '⏳ جاري إعادة الاتصال...', logged_out: '⚠️ الرقم طلع من واتساب؛ اربطه من جديد', disabled: '⛔ الحساب موقوف', error: `❌ ${status.error || 'خطأ'}` }[status.connection] || 'غير مربوط';
    $('wa-status').textContent = status.qr ? '📱 امسح الرمز خلال دقيقة' : label;
    $('wa-status').className = `status ${status.connection === 'open' ? 'open' : status.qr || /connect/.test(status.connection) ? 'wait' : ''}`;
    $('wa-qr').hidden = !status.qr;
    $('wa-hint').hidden = !status.qr;
    if (status.qr) $('wa-qr').src = status.qr.image;
    $('wa-connect').hidden = status.connection === 'open' || Boolean(status.qr);
    $('wa-disconnect').hidden = status.connection !== 'open';
  }

  async function refreshStatus() {
    try { renderStatus(await api('status')); } catch { /* keep last */ }
  }

  async function loadChats() {
    const { chats } = await api('chats');
    $('chat-list').replaceChildren(...(chats.length ? chats.map(chat => {
      const paused = chat.pausedUntil && new Date(chat.pausedUntil) > new Date();
      return el('div', { class: 'item' },
        el('div', { class: 'item-head' },
          el('b', {}, `${chat.name}${chat.phone ? ` · ${chat.phone}` : ''}`),
          el('span', { class: 'row' },
            chat.handoffAt ? el('span', { class: 'badge hot' }, 'بحاجة متابعة') : null,
            paused ? el('span', { class: 'badge' }, 'البوت ساكت') : null,
            el('span', { class: 'badge' }, time(chat.lastMessageAt)))),
        chat.handoffSummary ? el('div', { class: 'msg' }, `📝 ${chat.handoffSummary}`) : null,
        ...chat.last.map(line => el('div', { class: 'msg' }, el('b', {}, line.role === 'customer' ? 'الزبون: ' : line.role === 'owner' ? 'إنت: ' : 'البوت: '), line.text)),
        paused ? el('button', { class: 'ghost', onclick: async () => { await api('chats/resume', { method: 'POST', body: { jid: chat.jid } }); loadChats(); } }, 'خلي البوت يرجع يرد') : null);
    }) : [el('p', { class: 'muted' }, 'ما في محادثات لسا.')]));
  }

  async function openTenant(tenant) {
    show('tenant-view');
    $('title').textContent = tenant.name;
    fillSettings(tenant.settings);
    renderStatus(tenant.status);
    loadChats().catch(() => {});
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(refreshStatus, 3000);
  }

  $('wa-connect').addEventListener('click', async event => {
    event.target.disabled = true;
    try { renderStatus(await api('connect', { method: 'POST' })); } catch (error) { alert(error.message); } finally { event.target.disabled = false; }
  });
  $('wa-disconnect').addEventListener('click', async () => {
    if (!confirm('فصل الرقم عن البوت؟ رح تحتاج تمسح QR من جديد.')) return;
    await api('disconnect', { method: 'POST' });
    refreshStatus();
  });

  $('settings-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.target;
    const body = {};
    for (const field of form.elements) {
      if (!field.name) continue;
      body[field.name] = field.type === 'checkbox' ? field.checked : field.name === 'pauseHours' ? Number(field.value) : field.value;
    }
    $('settings-note').textContent = '';
    try { const result = await api('settings', { method: 'PUT', body }); fillSettings(result.settings); $('settings-note').textContent = '✅ انحفظ'; } catch (error) { $('settings-note').textContent = `❌ ${error.message}`; }
  });

  boot();
})();
