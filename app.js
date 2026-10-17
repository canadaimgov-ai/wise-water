(() => {
'use strict';

/* ------------------------------------------------------------------ *
 * Setup
 * ------------------------------------------------------------------ */
// Built-in defaults (these two values are public by design). config.js can override
// them, but a missing, wrong or placeholder config.js is ignored.
const DEFAULTS = {
  SUPABASE_URL: 'https://albjeupsacojdiqxwlzz.supabase.co',
  SUPABASE_KEY: 'sb_publishable_Fe5c8mRR37fqb44GrNxZzw_4be8smyY'
};
const userCfg = window.APP_CONFIG || {};
const cfg = {
  SUPABASE_URL: /^https:\/\/[a-z0-9]+\.supabase\.co\/?$/i.test(userCfg.SUPABASE_URL || '')
    ? userCfg.SUPABASE_URL : DEFAULTS.SUPABASE_URL,
  SUPABASE_KEY: /^(sb_publishable_|eyJ)/.test(userCfg.SUPABASE_KEY || '')
    ? userCfg.SUPABASE_KEY : DEFAULTS.SUPABASE_KEY
};
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const money = n => 'KSh ' + Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 });
const todayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
const fmtDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB',
  { day: '2-digit', month: 'short', year: 'numeric' }) : '';
const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'k' + Date.now() + Math.random().toString(16).slice(2));

const state = { profile: null, email: '', biz: { business_name: 'Wise Water', receipt_footer: '' } };
const ROLE_LABEL = { super_admin: 'Super admin', owner: 'Owner', staff: 'Staff' };
const ROLE_HELP = {
  staff: 'Can record sales, receive payments, add customers and expenses, record purchases and production.',
  owner: 'Staff rights, plus prices and costs, voiding, stock counts, cashbook, reports, daily report, settings and backup.',
  super_admin: 'Everything an owner can do, plus approving and managing users and viewing the audit log.'
};
const isOwner = () => !!state.profile && (state.profile.role === 'owner' || state.profile.role === 'super_admin');
const isSuper = () => !!state.profile && state.profile.role === 'super_admin';
const ic = n => `<svg class="ic" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const fmtLong = d => new Date(d + 'T00:00:00').toLocaleDateString('en-GB',
  { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const bizLines = () => [state.biz.address, state.biz.phone, state.biz.email].filter(Boolean)
  .map(x => `<div class="c">${esc(x)}</div>`).join('');
let sb = null;

function toast(msg, kind = 'ok') {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast ' + (kind === 'err' ? 'err' : '');
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, kind === 'err' ? 7000 : 2500);
}
const must = res => { if (res.error) throw res.error; return res.data; };
async function guard(btn, fn) {
  if (btn.disabled) return;
  btn.disabled = true;
  try { await fn(); } catch (e) { toast(e.message || String(e), 'err'); }
  finally { btn.disabled = false; }
}
function openModal(html, wide) {
  const m = $('#modal');
  m.innerHTML = `<div class="sheet ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
  m.hidden = false;
  m.onclick = e => { if (e.target === m || e.target.closest('[data-close]')) closeModal(); };
}
function closeModal() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; }
const view = () => $('#view');
const set = html => { view().innerHTML = html; };
const monthStart = d => d.slice(0, 8) + '01';

/* data loaders */
const loadProducts = async (all) => must(await (all
  ? sb.from('products').select('*').order('category').order('name')
  : sb.from('products').select('*').eq('is_active', true).order('category').order('name')));
const loadCustomers = async () => must(await sb.from('customer_balances').select('*')
  .eq('is_active', true).order('name'));
const loadAccounts = async () => must(await sb.from('cash_accounts').select('*').eq('is_active', true));

/* ------------------------------------------------------------------ *
 * Boot & auth
 * ------------------------------------------------------------------ */
function showOnly(id) {
  ['setup', 'login', 'pending', 'shell'].forEach(x => { $('#' + x).hidden = x !== id; });
}
const setMsg = (err, ok) => { $('#loginErr').textContent = err || ''; $('#loginOk').textContent = ok || ''; };
function authTab(signup) {
  $('#tabIn').classList.toggle('on', !signup); $('#tabUp').classList.toggle('on', signup);
  $('#loginForm').hidden = signup; $('#signupForm').hidden = !signup; setMsg('', '');
}
const netErr = e => /fetch/i.test((e && e.message) || '')
  ? e.message + ' (the site could not reach ' + cfg.SUPABASE_URL + ')' : ((e && e.message) || String(e));
const openDrawer = () => { $('#nav').classList.add('open'); $('#scrim').hidden = false; };
const closeDrawer = () => { $('#nav').classList.remove('open'); $('#scrim').hidden = true; };

let idleTimer = null;
const IDLE_MS = 30 * 60 * 1000;
function resetIdle() {
  clearTimeout(idleTimer);
  if (state.profile) idleTimer = setTimeout(() => signOutNow('You were signed out after 30 minutes without activity.'), IDLE_MS);
}
async function signOutNow(msg) {
  try { await sb.auth.signOut(); } catch (e) { /* ignore */ }
  state.profile = null; clearTimeout(idleTimer); closeModal(); showOnly('login'); setMsg(msg || '', ''); checkConnection();
}

function openPasswordModal(recovery) {
  openModal(`<h2>${recovery ? 'Set a new password' : 'Change password'}</h2>
    <label>New password (at least 8 characters)<input id="np1" type="password" minlength="8" autocomplete="new-password"></label>
    <label>Confirm new password<input id="np2" type="password" minlength="8" autocomplete="new-password"></label>
    <div class="actions"><button class="btn primary" id="npGo">Save password</button><button class="btn" data-close>Cancel</button></div>`);
  $('#npGo').onclick = e => guard(e.currentTarget, async () => {
    const p1 = $('#np1').value, p2 = $('#np2').value;
    if (p1.length < 8) throw new Error('Use at least 8 characters');
    if (p1 !== p2) throw new Error('The two passwords do not match');
    const { error } = await sb.auth.updateUser({ password: p1 });
    if (error) throw error;
    closeModal(); toast('Password updated');
  });
}

async function boot() {
  sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY);

  $('#tabIn').onclick = () => authTab(false);
  $('#tabUp').onclick = () => authTab(true);

  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.submitter; setMsg('', ''); btn.disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email: $('#email').value.trim(), password: $('#password').value });
    btn.disabled = false;
    if (error) { setMsg('Could not sign in: ' + netErr(error)); checkConnection(); return; }
    await enter();
  });

  $('#signupForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.submitter, name = $('#sname').value.trim(), email = $('#semail').value.trim(),
      p1 = $('#spass').value, p2 = $('#spass2').value;
    setMsg('', '');
    if (!name) return setMsg('Please enter your full name.');
    if (p1.length < 8) return setMsg('Use at least 8 characters for the password.');
    if (p1 !== p2) return setMsg('The two passwords do not match.');
    btn.disabled = true;
    const { data, error } = await sb.auth.signUp({ email, password: p1,
      options: { data: { full_name: name }, emailRedirectTo: location.origin + location.pathname } });
    btn.disabled = false;
    if (error) { setMsg('Could not create the account: ' + netErr(error)); return; }
    if (data && data.session) { await enter(); return; }
    authTab(false);
    setMsg('', 'Account created. If you receive a confirmation email, open it first. Then sign in. The administrator must approve your account before you can use the system.');
  });

  $('#forgotBtn').onclick = async () => {
    const email = $('#email').value.trim();
    if (!email) return setMsg('Type your email address above first.');
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    if (error) setMsg('Could not send the reset email: ' + netErr(error));
    else setMsg('', 'If that email has an account, a password reset link has been sent.');
  };

  $('#logoutBtn').addEventListener('click', () => signOutNow(''));
  $('#pendOut').addEventListener('click', () => signOutNow(''));
  $('#pendRetry').addEventListener('click', () => enter());
  $('#menuBtn').addEventListener('click', openDrawer);
  $('#moreBtn').addEventListener('click', openDrawer);
  $('#scrim').addEventListener('click', closeDrawer);
  window.addEventListener('hashchange', route);
  ['click', 'keydown', 'touchstart', 'mousemove'].forEach(ev => window.addEventListener(ev, resetIdle, { passive: true }));
  const net = () => { $('#offline').hidden = navigator.onLine; };
  window.addEventListener('online', net); window.addEventListener('offline', net); net();

  sb.auth.onAuthStateChange(evt => { if (evt === 'PASSWORD_RECOVERY') setTimeout(() => openPasswordModal(true), 400); });

  const { data } = await sb.auth.getSession();
  if (data.session) await enter(); else { showOnly('login'); checkConnection(); }
}

async function checkConnection() {
  const el = $('#conn'); if (!el) return;
  el.textContent = 'Checking connection...';
  try {
    const r = await fetch(cfg.SUPABASE_URL.replace(/\/+$/, '') + '/auth/v1/health', { headers: { apikey: cfg.SUPABASE_KEY } });
    el.textContent = r.ok ? 'Secure connection OK' : 'Server reached but replied with code ' + r.status + '. Check the key in config.js.';
  } catch (e) {
    el.textContent = 'Cannot reach ' + cfg.SUPABASE_URL + '. Check your internet and that the Supabase project is not paused.';
  }
}

async function refreshPendingBadge() {
  if (!isSuper()) return;
  const r = await sb.from('profiles').select('id', { count: 'exact', head: true }).eq('is_active', false);
  const b = $('#pendingBadge'); b.hidden = !r.count; b.textContent = r.count || '';
}

async function enter() {
  const { data: u } = await sb.auth.getUser();
  if (!u || !u.user) { showOnly('login'); return; }
  const { data: p, error } = await sb.from('profiles').select('*').eq('id', u.user.id).maybeSingle();
  if (error) { await sb.auth.signOut(); showOnly('login'); setMsg('Could not load your account: ' + error.message); return; }
  if (!p || !p.is_active) { $('#pendEmail').textContent = u.user.email || ''; showOnly('pending'); return; }
  state.profile = p; state.email = u.user.email || p.email || '';
  const { data: b } = await sb.from('business_settings').select('*').eq('id', 1).maybeSingle();
  if (b) state.biz = b;
  $('#bizName').textContent = $('#brand').textContent = state.biz.business_name;
  const nm = p.full_name || state.email || 'User';
  $('#who').textContent = nm; $('#avatar').textContent = nm.trim().charAt(0).toUpperCase();
  $('#roleLabel').textContent = ROLE_LABEL[p.role] || p.role;
  document.querySelectorAll('[data-owner]').forEach(a => { a.hidden = !isOwner(); });
  document.querySelectorAll('[data-super]').forEach(a => { a.hidden = !isSuper(); });
  showOnly('shell'); resetIdle();
  refreshPendingBadge().catch(() => {});
  if (!location.hash) location.hash = '#dashboard'; else route();
}

/* ------------------------------------------------------------------ *
 * Router
 * ------------------------------------------------------------------ */
const routes = {
  dashboard: viewDashboard, sell: viewSell, sales: viewSales, customers: viewCustomers,
  payment: viewPayment, expenses: viewExpenses, products: viewProducts,
  inventory: viewInventory, purchases: viewPurchases, production: viewProduction,
  cashbook: viewCashbook, reports: viewReports, settings: viewSettings, mpesa: viewMpesa,
  daily: viewDaily, users: viewUsers, audit: viewAudit, account: viewAccount
};
const OWNER_ONLY = ['reports', 'cashbook', 'settings', 'daily'], SUPER_ONLY = ['users', 'audit'];
async function route() {
  if (!state.profile) return;
  const key = (location.hash || '#dashboard').slice(1), k2 = routes[key] ? key : 'dashboard';
  document.querySelectorAll('#nav a, .tabbar a').forEach(a => a.classList.toggle('active', a.dataset.r === k2));
  closeDrawer(); view().onclick = null;
  if (OWNER_ONLY.includes(key) && !isOwner()) { set('<div class="card err">This page is for the owner only.</div>'); return; }
  if (SUPER_ONLY.includes(key) && !isSuper()) { set('<div class="card err">This page is for the super admin only.</div>'); return; }
  set('<p class="muted">Loading...</p>');
  try { await routes[k2](); } catch (e) {
    set(`<div class="card err"><b>Something went wrong.</b><br>${esc(e.message || e)}</div>`);
  }
  window.scrollTo(0, 0);
}

/* ------------------------------------------------------------------ *
 * Dashboard
 * ------------------------------------------------------------------ */
function prevMonthRange(t) {
  const [y, m, d] = t.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 2, 1));
  const lastDay = new Date(Date.UTC(y, m - 1, 0)).getUTCDate();
  const from = first.toISOString().slice(0, 10);
  const to = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, lastDay)))
    .toISOString().slice(0, 10);
  return [from, to];
}
function greeting() {
  const h = Number(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Africa/Nairobi' }).slice(0, 2));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}
const curSplit = v => String(v).startsWith('KSh ') ? `<span class="cur">KSh</span>${v.slice(4)}` : v;
const statCard = (cls, icon, k, v, sub) => `<div class="stat ${cls}"><span class="chip">${ic(icon)}</span>
  <div class="k">${k}</div><div class="v">${curSplit(v)}</div>${sub ? `<div class="muted small-text">${sub}</div>` : ''}</div>`;

function salesChart(rows) {
  const W = 640, H = 200, pl = 10, pr = 10, pt = 16, pb = 28, n = rows.length;
  const max = Math.max(1, ...rows.map(r => Number(r.sales)));
  const bw = (W - pl - pr) / n, ch = H - pt - pb;
  const grid = [0, .5, 1].map(f => `<line class="grid-line" x1="${pl}" x2="${W - pr}" y1="${(H - pb - ch * f).toFixed(1)}" y2="${(H - pb - ch * f).toFixed(1)}"/>`).join('');
  const bars = rows.map((r, i) => {
    const h = Math.max(2, (Number(r.sales) / max) * ch), x = pl + i * bw + bw * .17, w = bw * .66, y = H - pb - h;
    const day = new Date(r.day + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric' });
    return `<rect class="bar ${i === n - 1 ? 'today' : ''}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="4">
      <title>${esc(fmtDate(r.day))}: ${money(r.sales)}</title></rect>
      <text x="${(x + w / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${day}</text>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Sales for the last ${n} days">
    <defs><linearGradient id="barg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#1a8fb8"/><stop offset="1" stop-color="#0a5c8a"/></linearGradient></defs>
    ${grid}${bars}</svg>`;
}

async function viewDashboard() {
  const t = todayStr(), ms = monthStart(t), [pf, pt] = prevMonthRange(t), owner = isOwner();
  const none = Promise.resolve({ data: null });
  const [day, mon, prev, accts, debtors, stock, trend] = await Promise.all([
    sb.rpc('period_summary', { p_from: t, p_to: t }),
    owner ? sb.rpc('period_summary', { p_from: ms, p_to: t }) : none,
    owner ? sb.rpc('period_summary', { p_from: pf, p_to: pt }) : none,
    sb.from('cash_balances').select('*'),
    sb.from('customer_balances').select('*').gt('balance', 0).order('balance', { ascending: false }),
    sb.from('inventory_stock').select('*').gt('reorder_level', 0).eq('is_low', true),
    owner ? sb.rpc('daily_sales', { p_days: 14 }) : none
  ]);
  const zero = { sales: 0, paid_at_sale: 0, cash_received: 0, cogs: 0, operating_expenses: 0, personal_expenses: 0 };
  const D = must(day), M = must(mon) || zero, P = must(prev) || zero;
  const A = must(accts), C = must(debtors), S = must(stock), T = must(trend) || [];
  const owed = C.reduce((s, c) => s + Number(c.balance), 0);
  const cashTotal = A.reduce((s, a) => s + Number(a.balance), 0);
  const credToday = Math.max(0, D.sales - D.paid_at_sale);
  const gross = M.sales - M.cogs, net = gross - M.operating_expenses;
  const growth = P.sales > 0 ? ((M.sales - P.sales) / P.sales) * 100 : null;
  const first = ((state.profile.full_name || '').trim().split(/\s+/)[0]) || '';

  set(`
    <div class="card hero"><div><h1>${greeting()}${first ? ', ' + esc(first) : ''}</h1>
      <p>${esc(fmtLong(t))}</p></div>
      <div class="hero-actions"><a class="btn light" href="#sell">${ic('cart')}New sale</a><a class="btn light" href="#payment">${ic('wallet')}Receive payment</a></div></div>

    <div class="grid g3">
      ${statCard('', 'cart', 'Sales today', money(D.sales))}
      ${statCard('good', 'wallet', 'Cash received today', money(D.cash_received))}
      ${statCard('', 'receipt', 'Sold on credit today', money(credToday))}
      ${statCard('', 'coins', 'Expenses today', money(D.operating_expenses + D.personal_expenses))}
      ${statCard('owe', 'users', 'Customers owe you', money(owed), C.length ? C.length + ' customer' + (C.length > 1 ? 's' : '') : 'All settled')}
      ${statCard('', 'book', 'Money in hand', money(cashTotal), A.map(a => esc(a.name) + ' ' + money(a.balance)).join(' | '))}
    </div>

    ${owner ? `<div class="card"><h2>Sales, last 14 days</h2>${T.length ? salesChart(T) : '<div class="empty">No data yet.</div>'}</div>
    <div class="card"><h2>This month</h2>
      <div class="grid" style="margin:0">
        ${statCard('', 'chart', 'Sales', money(M.sales))}
        ${statCard('', 'trend', 'Gross profit', money(gross))}
        ${statCard('', 'tag', 'Business expenses', money(M.operating_expenses))}
        ${statCard('good', 'trend', 'Net profit (estimate)', money(net))}
        ${statCard('', 'chart', 'Growth vs same days last month', growth === null ? 'Not available' : (growth >= 0 ? '+' : '') + growth.toFixed(1) + '%')}
      </div>
      ${M.sales > 0 && M.cogs === 0 ? `<p class="muted small-text" style="margin-top:.75rem">Profit looks too high because product <b>cost prices are 0</b>. Enter them in Products and prices.</p>` : ''}
      ${M.personal_expenses > 0 ? `<p class="muted small-text">${money(M.personal_expenses)} of personal expenses (such as house rent) is left out of business profit.</p>` : ''}
    </div>` : ''}

    <div class="card"><h2>Who owes you</h2>
      ${C.length ? `<div class="tablewrap"><table><thead><tr><th>Customer</th><th>Phone</th>
        <th class="num">Balance</th><th></th></tr></thead><tbody>
        ${C.slice(0, 10).map(c => `<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.phone || '')}</td>
          <td class="num">${money(c.balance)}</td>
          <td>${Number(c.overdue_amount) > 0 ? '<span class="pill bad">Overdue</span> ' : ''}${remindBtn(c)}</td></tr>`).join('')}
        </tbody></table></div>`
        : '<div class="empty">No one owes you money.</div>'}
    </div>
    ${S.length ? `<div class="card"><h2>${ic('alert')} Low stock</h2>${S.map(s =>
      `<div class="balance-line"><span>${esc(s.name)}</span><span class="pill bad">${s.on_hand} ${esc(s.unit)}</span></div>`).join('')}</div>` : ''}
  `);
}

/* ------------------------------------------------------------------ *
 * New sale
 * ------------------------------------------------------------------ */
async function viewSell() {
  const [products, customers, accounts] = await Promise.all([loadProducts(), loadCustomers(), loadAccounts()]);
  const byId = Object.fromEntries(products.map(p => [p.id, p]));
  let cart = [], type = 'retail', paidTouched = false, paid = 0, key = uuid();
  const catPrice = p => type === 'wholesale' ? Number(p.wholesale_price ?? p.retail_price) : Number(p.retail_price);
  const total = () => cart.reduce((s, l) => s + Math.round(l.qty * l.price * 100) / 100, 0) - num($('#disc').value);
  const canEdit = () => isOwner() || type === 'wholesale';

  set(`
    <div class="pagehead"><h1>New sale</h1></div>
    <div class="card">
      <div class="seg" role="radiogroup" aria-label="Price type">
        <label><input type="radio" name="ptype" value="retail" checked>Retail</label>
        <label><input type="radio" name="ptype" value="wholesale">Wholesale</label>
      </div>
      <label>Customer
        <select id="cust"><option value="">Walk-in customer (pays in full)</option>
        ${customers.map(c => `<option value="${c.customer_id}">${esc(c.name)}${c.phone ? ' - ' + esc(c.phone) : ''}${Number(c.balance) > 0 ? ' (owes ' + money(c.balance) + ')' : ''}</option>`).join('')}
        </select></label>
      <div class="row">
        <label>Product <select id="prod">${products.map(p =>
          `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
        <label class="fixed" style="width:90px">Qty <input id="qty" type="number" min="1" step="1" value="1" inputmode="decimal"></label>
        <div class="fixed"><button id="addBtn" class="btn primary" type="button">Add</button></div>
      </div>
    </div>

    <div class="card"><div class="tablewrap"><table class="cart-table">
      <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th class="num">Total</th><th></th></tr></thead>
      <tbody id="cart"></tbody></table></div>
      <p id="cartEmpty" class="empty">Add a product to start the sale.</p>
      <label>Discount (KSh) <input id="disc" type="number" min="0" step="1" value="0" inputmode="decimal"></label>
    </div>

    <div class="total-box"><span>Total</span><span class="amt" id="total">KSh 0</span></div>

    <div class="card">
      <div class="row">
        <label>Amount paid now <input id="paid" type="number" min="0" step="1" inputmode="decimal"></label>
        <label>Paid by <select id="method">
          <option value="cash">Cash</option><option value="mpesa">M-Pesa</option>
          ${accounts.some(a => a.account_type === 'bank') ? '<option value="bank">Bank</option>' : ''}</select></label>
      </div>
      <div class="actions" style="margin-top:0">
        <button id="fullBtn" class="btn small" type="button">Paid in full</button>
        <button id="creditBtn" class="btn small" type="button">All on credit</button>
      </div>
      <div class="balance-line" style="margin-top:.75rem"><span>Left to pay (goes on customer account)</span><span id="left">KSh 0</span></div>
      <button id="saveBtn" class="btn primary wide" type="button">Record sale</button>
    </div>`);

  const drawRows = () => {
    $('#cart').innerHTML = cart.map((l, i) => `<tr>
      <td>${esc(byId[l.id].name)}</td>
      <td data-l="Qty"><input data-i="${i}" data-f="qty" type="number" min="1" step="1" value="${l.qty}" inputmode="decimal"></td>
      <td data-l="Price"><input data-i="${i}" data-f="price" type="number" min="0" step="1" value="${l.price}" inputmode="decimal" ${canEdit() ? '' : 'disabled'}></td>
      <td class="num" data-l="Total" id="lt${i}">${money(l.qty * l.price)}</td>
      <td><button class="btn small danger" data-rm="${i}" type="button" aria-label="Remove">Remove</button></td></tr>`).join('');
    $('#cartEmpty').hidden = cart.length > 0;
    totals();
  };
  const totals = () => {
    const t = total();
    $('#total').textContent = money(t);
    if (!paidTouched) { paid = Math.max(0, t); $('#paid').value = paid || ''; }
    $('#left').textContent = money(Math.max(0, t - num($('#paid').value)));
  };

  document.querySelectorAll('input[name=ptype]').forEach(r => r.addEventListener('change', () => {
    type = r.value;
    cart.forEach(l => { l.price = catPrice(byId[l.id]); l.edited = false; });
    drawRows();
  }));
  $('#cust').addEventListener('change', () => {
    const c = customers.find(x => x.customer_id === $('#cust').value);
    if (c && c.category === 'wholesale' && type !== 'wholesale') {
      document.querySelector('input[name=ptype][value=wholesale]').click();
    }
  });
  $('#addBtn').addEventListener('click', () => {
    const id = $('#prod').value, q = num($('#qty').value);
    if (!id || q <= 0) { toast('Enter a quantity above zero', 'err'); return; }
    const ex = cart.find(l => l.id === id);
    if (ex) ex.qty += q; else cart.push({ id, qty: q, price: catPrice(byId[id]), edited: false });
    $('#qty').value = 1; drawRows();
  });
  $('#cart').addEventListener('input', e => {
    const i = e.target.dataset.i; if (i === undefined) return;
    const l = cart[i], v = num(e.target.value);
    if (e.target.dataset.f === 'qty') l.qty = v; else { l.price = v; l.edited = true; }
    $('#lt' + i).textContent = money(l.qty * l.price); totals();
  });
  $('#cart').addEventListener('click', e => {
    const b = e.target.closest('[data-rm]'); if (!b) return;
    cart.splice(Number(b.dataset.rm), 1); drawRows();
  });
  $('#disc').addEventListener('input', totals);
  $('#paid').addEventListener('input', () => { paidTouched = true; totals(); });
  $('#fullBtn').addEventListener('click', () => { paidTouched = false; totals(); });
  $('#creditBtn').addEventListener('click', () => { paidTouched = true; $('#paid').value = 0; totals(); });

  $('#saveBtn').addEventListener('click', e => guard(e.currentTarget, async () => {
    const t = total(), pd = num($('#paid').value), custId = $('#cust').value || null;
    if (!cart.length) throw new Error('Add at least one product');
    if (cart.some(l => l.qty <= 0)) throw new Error('Every quantity must be above zero');
    if (t < 0) throw new Error('Discount is larger than the sale');
    if (pd > t) throw new Error('Amount paid is more than the total');
    if (!custId && pd < t) throw new Error('Walk-in customers must pay in full. Choose a customer to sell on credit.');
    const items = cart.map(l => {
      const it = { product_id: l.id, quantity: l.qty };
      if (l.price !== catPrice(byId[l.id])) it.unit_price = l.price;
      return it;
    });
    const id = must(await sb.rpc('create_sale', {
      p_customer_id: custId, p_price_type: type, p_items: items, p_amount_paid: pd,
      p_method: $('#method').value, p_discount: num($('#disc').value), p_idempotency_key: key }));
    toast('Sale recorded');
    await showReceipt(id);
    viewSell();
  }));
  drawRows();
}

/* receipts */
async function showReceipt(saleId) {
  const s = must(await sb.from('sales').select(
    '*, customers(name, phone), sale_items(quantity, unit_price, line_total, products(name))')
    .eq('id', saleId).single());
  const bal = must(await sb.from('sale_balances').select('paid,balance').eq('sale_id', saleId).maybeSingle());
  const paid = bal ? Number(bal.paid) : 0, left = bal ? Number(bal.balance) : 0;
  openModal(`<div id="printArea" class="receipt">
    <h3>${esc(state.biz.business_name)}</h3>
    ${bizLines()}
    <hr>
    <div class="l"><span>Receipt</span><span>${esc(s.sale_no)}</span></div>
    <div class="l"><span>Date</span><span>${fmtDate(s.sale_date)}</span></div>
    <div class="l"><span>Customer</span><span>${esc(s.customers ? s.customers.name : 'Walk-in')}</span></div>
    <div class="l"><span>Price</span><span>${esc(s.price_type)}</span></div>
    <hr>
    ${s.sale_items.map(i => `<div class="l"><span>${esc(i.products.name)}<br>${i.quantity} x ${Number(i.unit_price).toLocaleString('en-KE')}</span>
      <span>${Number(i.line_total).toLocaleString('en-KE')}</span></div>`).join('')}
    <hr>
    ${Number(s.discount) > 0 ? `<div class="l"><span>Discount</span><span>-${Number(s.discount).toLocaleString('en-KE')}</span></div>` : ''}
    <div class="l"><b>Total</b><b>${money(s.total)}</b></div>
    <div class="l"><span>Paid</span><span>${money(paid)}</span></div>
    <div class="l"><span>Balance on this sale</span><span>${money(left)}</span></div>
    ${s.status === 'voided' ? '<div class="c"><b>VOIDED</b></div>' : ''}
    <hr><div class="c">${esc(state.biz.receipt_footer || '')}</div></div>
    <div class="actions"><button class="btn primary" id="prBtn">Print / save PDF</button>
    <button class="btn" data-close>Close</button></div>`);
  $('#prBtn').onclick = () => window.print();
}

/* ------------------------------------------------------------------ *
 * Sales history
 * ------------------------------------------------------------------ */
async function viewSales() {
  const t = todayStr();
  set(`<div class="pagehead"><h1>Sales history</h1></div>
    <div class="card"><div class="row">
      <label>From <input id="from" type="date" value="${t}"></label>
      <label>To <input id="to" type="date" value="${t}"></label>
      <label>Search <input id="q" placeholder="Receipt no. or customer"></label>
    </div></div><div id="list" class="card"></div>`);
  let rows = [];
  const draw = () => {
    const q = $('#q').value.trim().toLowerCase();
    const r = rows.filter(s => !q || s.sale_no.toLowerCase().includes(q) ||
      (s.customers ? s.customers.name.toLowerCase().includes(q) : 'walk-in'.includes(q)));
    $('#list').innerHTML = r.length ? `<div class="tablewrap"><table><thead><tr><th>Receipt</th><th>Date</th>
      <th>Customer</th><th class="num">Total</th><th class="num">Unpaid</th><th>Status</th><th></th></tr></thead><tbody>
      ${r.map(s => `<tr><td>${esc(s.sale_no)}</td><td>${fmtDate(s.sale_date)}</td>
        <td>${esc(s.customers ? s.customers.name : 'Walk-in')}</td><td class="num">${money(s.total)}</td>
        <td class="num">${s.status === 'voided' ? '-' : money(s.unpaid)}</td>
        <td>${s.status === 'voided' ? '<span class="pill bad">Voided</span>' : s.unpaid > 0 ? '<span class="pill owe">Credit</span>' : '<span class="pill good">Paid</span>'}</td>
        <td><button class="btn small" data-rc="${s.id}">Receipt</button>
        ${isOwner() && s.status === 'completed' ? `<button class="btn small danger" data-vd="${s.id}">Void</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">No sales in this period.</div>';
  };
  const load = async () => {
    rows = must(await sb.from('sales').select('*, customers(name)')
      .gte('sale_date', $('#from').value).lte('sale_date', $('#to').value)
      .order('created_at', { ascending: false }).limit(300));
    const ids = rows.filter(s => s.status === 'completed').map(s => s.id);
    const bal = ids.length ? must(await sb.from('sale_balances').select('sale_id,balance').in('sale_id', ids)) : [];
    const bm = Object.fromEntries(bal.map(b => [b.sale_id, Number(b.balance)]));
    rows.forEach(s => { s.unpaid = bm[s.id] || 0; });
    draw();
  };
  ['from', 'to'].forEach(id => $('#' + id).addEventListener('change', () => load().catch(e => toast(e.message, 'err'))));
  $('#q').addEventListener('input', draw);
  $('#list').addEventListener('click', async e => {
    const rc = e.target.closest('[data-rc]'), vd = e.target.closest('[data-vd]');
    try {
      if (rc) await showReceipt(rc.dataset.rc);
      if (vd) {
        const reason = prompt('Why are you voiding this sale? (required)');
        if (!reason || !reason.trim()) return;
        must(await sb.rpc('void_sale', { p_sale_id: vd.dataset.vd, p_reason: reason.trim() }));
        toast('Sale voided'); await load();
      }
    } catch (err) { toast(err.message, 'err'); }
  });
  await load();
}

/* ------------------------------------------------------------------ *
 * Customers
 * ------------------------------------------------------------------ */
async function viewCustomers() {
  const list = must(await sb.from('customer_balances').select('*').order('name'));
  set(`<div class="pagehead"><h1>Customers</h1></div>
    <div class="card"><h2>Add customer</h2>
      <div class="row">
        <label>Name <input id="cn" required></label>
        <label>Phone <input id="cp" type="tel" inputmode="tel"></label>
        <label>Type <select id="cc"><option value="retail">Retail</option><option value="wholesale">Wholesale</option></select></label>
      </div>
      ${isOwner() ? `<div class="row">
        <label>Debt they already owe (opening balance) <input id="co" type="number" min="0" step="1" value="0"></label>
        <label>Credit limit (optional) <input id="cl" type="number" min="0" step="1"></label>
        <label>Days to pay (optional) <input id="cd" type="number" min="0" step="1"></label></div>` : ''}
      <button id="addC" class="btn primary">Save customer</button></div>
    <div class="card"><label>Search <input id="q" placeholder="Name or phone"></label><div id="cl2"></div></div>`);
  const draw = () => {
    const q = $('#q').value.trim().toLowerCase();
    const r = list.filter(c => !q || c.name.toLowerCase().includes(q) || (c.phone || '').includes(q));
    $('#cl2').innerHTML = r.length ? `<div class="tablewrap"><table><thead><tr><th>Name</th><th>Phone</th><th>Type</th>
      <th class="num">Owes</th><th></th></tr></thead><tbody>${r.map(c => `<tr>
      <td>${esc(c.name)}${c.is_active ? '' : ' <span class="pill">Inactive</span>'}</td><td>${esc(c.phone || '')}</td><td>${esc(c.category)}</td>
      <td class="num">${Number(c.balance) > 0 ? '<b>' + money(c.balance) + '</b>' : money(0)}
        ${Number(c.overdue_amount) > 0 ? '<span class="pill bad">Overdue</span>' : ''}</td>
      <td><button class="btn small" data-st="${c.customer_id}">Statement</button> ${remindBtn(c)}${isOwner() ? ` <button class="btn small" data-ed="${c.customer_id}">Edit</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">No customers yet. Add your first one above.</div>';
  };
  draw();
  $('#q').addEventListener('input', draw);
  $('#cl2').addEventListener('click', e => {
    const b = e.target.closest('[data-st]'), ed = e.target.closest('[data-ed]');
    if (b) showStatement(b.dataset.st).catch(err => toast(err.message, 'err'));
    if (ed) editCustomer(ed.dataset.ed).catch(err => toast(err.message, 'err'));
  });
  $('#addC').addEventListener('click', e => guard(e.currentTarget, async () => {
    const name = $('#cn').value.trim();
    if (!name) throw new Error('Enter the customer name');
    const row = { name, phone: $('#cp').value.trim() || null, category: $('#cc').value };
    if (isOwner()) {
      row.opening_balance = num($('#co').value);
      if ($('#cl').value !== '') row.credit_limit = num($('#cl').value);
      if ($('#cd').value !== '') row.default_due_days = Math.round(num($('#cd').value));
    }
    const { error } = await sb.from('customers').insert(row);
    if (error) throw new Error(error.code === '23505' ? 'A customer with that phone number already exists' : error.message);
    toast('Customer saved'); viewCustomers();
  }));
}

async function showStatement(id) {
  const [c, s, p, a] = await Promise.all([
    sb.from('customer_balances').select('*').eq('customer_id', id).single(),
    sb.from('sales').select('sale_no,sale_date,total').eq('customer_id', id).eq('status', 'completed'),
    sb.from('payments').select('payment_no,payment_date,amount,method,reference').eq('customer_id', id).eq('status', 'posted'),
    sb.from('customer_adjustments').select('adjustment_date,amount,reason').eq('customer_id', id)
  ]);
  const cu = must(c), S = must(s), P = must(p), A = must(a);
  const ev = [];
  S.forEach(x => ev.push({ d: x.sale_date, o: 1, t: 'Sale ' + x.sale_no, debit: Number(x.total), credit: 0 }));
  P.forEach(x => ev.push({ d: x.payment_date, o: 2, t: `Payment ${x.payment_no} (${x.method}${x.reference ? ' ' + x.reference : ''})`, debit: 0, credit: Number(x.amount) }));
  A.forEach(x => ev.push({ d: x.adjustment_date, o: 3, t: 'Adjustment: ' + x.reason,
    debit: x.amount < 0 ? -Number(x.amount) : 0, credit: x.amount > 0 ? Number(x.amount) : 0 }));
  ev.sort((x, y) => x.d < y.d ? -1 : x.d > y.d ? 1 : x.o - y.o);
  let run = Number(cu.opening_balance);
  const body = ev.map(x => { run += x.debit - x.credit; return `<tr><td>${fmtDate(x.d)}</td><td>${esc(x.t)}</td>
    <td class="num">${x.debit ? x.debit.toLocaleString('en-KE') : ''}</td>
    <td class="num">${x.credit ? x.credit.toLocaleString('en-KE') : ''}</td>
    <td class="num">${run.toLocaleString('en-KE')}</td></tr>`; }).join('');
  openModal(`<div id="printArea"><h2>${esc(cu.name)}</h2>
    <p class="muted">${esc(state.biz.business_name)}${state.biz.phone ? ' | ' + esc(state.biz.phone) : ''} - statement as at ${fmtDate(todayStr())}</p>
    <div class="tablewrap"><table><thead><tr><th>Date</th><th>Details</th><th class="num">Bought</th><th class="num">Paid</th><th class="num">Balance</th></tr></thead>
    <tbody><tr><td></td><td>Opening balance</td><td></td><td></td><td class="num">${Number(cu.opening_balance).toLocaleString('en-KE')}</td></tr>${body}</tbody></table></div>
    <div class="balance-line"><span>Amount owed now</span><span>${money(cu.balance)}</span></div></div>
    <div class="actions"><button class="btn primary" id="prBtn">Print / save PDF</button>${remindBtn(cu)}<button class="btn" data-close>Close</button></div>`, true);
  $('#prBtn').onclick = () => window.print();
}

/* ------------------------------------------------------------------ *
 * Receive payment
 * ------------------------------------------------------------------ */
async function viewPayment() {
  const [all, accounts] = await Promise.all([loadCustomers(), loadAccounts()]);
  const customers = all.filter(c => Number(c.balance) > 0);
  const key = uuid();
  set(`<div class="pagehead"><h1>Receive payment</h1></div>
    <div class="card">${customers.length ? `
      <label>Customer <select id="pc">${customers.map(c =>
        `<option value="${c.customer_id}" data-b="${c.balance}">${esc(c.name)} - owes ${money(c.balance)}</option>`).join('')}</select></label>
      <div class="balance-line"><span>Outstanding</span><span id="ob"></span></div>
      <div class="row">
        <label>Amount received <input id="pa" type="number" min="1" step="1" inputmode="decimal"></label>
        <label>Paid by <select id="pm"><option value="cash">Cash</option><option value="mpesa">M-Pesa</option>
          ${accounts.some(a => a.account_type === 'bank') ? '<option value="bank">Bank</option>' : ''}</select></label>
        <label>Reference (M-Pesa code) <input id="pr"></label>
      </div>
      <div class="actions" style="margin-top:0"><button id="payAll" class="btn small" type="button">Pay full balance</button></div>
      <button id="payBtn" class="btn primary wide" style="margin-top:.75rem">Record payment</button>`
      : '<div class="empty">No customer owes you money right now.</div>'}</div>
    ${customers.length ? `<div class="card"><h2>Paste M-Pesa messages</h2>
      <p class="muted small-text">Copy the "Confirmed. You have received..." messages from your phone and paste them here
      (one or many). The system reads the amount, code and sender and suggests the customer. You check it, then press Record.</p>
      <label>Messages <textarea id="sms" rows="5" placeholder="Paste here..." style="min-height:110px"></textarea></label>
      <button id="smsRead" class="btn primary" type="button">Read messages</button>
      <div id="smsOut"></div></div>` : ''}`);
  if (!customers.length) return;
  const sel = $('#pc'), bal = () => num(sel.selectedOptions[0].dataset.b);
  const upd = () => { $('#ob').textContent = money(bal()); };
  sel.addEventListener('change', upd); upd();
  $('#payAll').addEventListener('click', () => { $('#pa').value = bal(); });
  $('#payBtn').addEventListener('click', e => guard(e.currentTarget, async () => {
    const amt = num($('#pa').value);
    if (amt <= 0) throw new Error('Enter the amount received');
    if (amt > bal()) throw new Error('That is more than the customer owes (' + money(bal()) + ')');
    must(await sb.rpc('receive_payment', { p_customer_id: sel.value, p_amount: amt, p_method: $('#pm').value,
      p_reference: $('#pr').value.trim() || null, p_idempotency_key: key }));
    toast('Payment recorded'); viewPayment();
  }));

  $('#smsRead').addEventListener('click', e => guard(e.currentTarget, async () => {
    const M = parseMpesaSms($('#sms').value);
    if (!M.length) throw new Error('No M-Pesa "received" messages found. Paste the full message text.');
    const done = must(await sb.from('payments').select('reference').in('reference', M.map(m => m.code)));
    const have = new Set(done.map(x => (x.reference || '').toUpperCase()));
    $('#smsOut').innerHTML = `<div class="tablewrap"><table><thead><tr><th>Date</th><th>Code</th><th>From</th><th class="num">Amount</th><th>Customer</th><th></th></tr></thead><tbody>
      ${M.map((m, i) => have.has(m.code) ? `<tr><td>${fmtDate(m.date)}</td><td>${esc(m.code)}</td><td>${esc(m.name)}</td><td class="num">${money(m.amount)}</td>
        <td colspan="2"><span class="pill good">Already recorded</span></td></tr>` : `<tr><td>${fmtDate(m.date)}</td><td>${esc(m.code)}</td>
        <td>${esc(m.name)}<br><span class="muted small-text">${esc(m.phone)}</span></td><td class="num">${money(m.amount)}</td>
        <td><select data-sc="${i}"><option value="">Choose customer</option>${opts(customers, 'customer_id', c => c.name, matchCustomer(m, customers))}</select></td>
        <td><button class="btn small primary" data-sr="${i}">Record</button></td></tr>`).join('')}</tbody></table></div>`;
    $('#smsOut').onclick = async ev => {
      const b = ev.target.closest('[data-sr]'); if (!b) return;
      const m = M[+b.dataset.sr], cust = $(`[data-sc="${b.dataset.sr}"]`).value;
      await guard(b, async () => {
        if (!cust) throw new Error('Choose the customer who paid');
        must(await sb.rpc('receive_payment', { p_customer_id: cust, p_amount: m.amount, p_method: 'mpesa',
          p_reference: m.code, p_payment_date: m.date, p_idempotency_key: 'mpesa-' + m.code }));
        toast('Recorded ' + money(m.amount)); b.closest('tr').innerHTML = `<td colspan="6"><span class="pill good">Recorded: ${esc(m.code)}</span></td>`;
      });
    };
  }));
}

/* ------------------------------------------------------------------ *
 * Expenses
 * ------------------------------------------------------------------ */
async function viewExpenses() {
  const owner = isOwner();
  const [cats, accounts, list, rec] = await Promise.all([
    sb.from('expense_categories').select('*').order('name'), loadAccounts(),
    sb.from('expenses').select('*, expense_categories(name,kind)').order('expense_date', { ascending: false })
      .order('created_at', { ascending: false }).limit(60),
    owner ? sb.from('recurring_expenses').select('*, expense_categories(name)').order('description') : Promise.resolve({ data: [] })]);
  const C = must(cats), L = must(list), RE = must(rec);
  set(`<div class="pagehead"><div><h1>Expenses</h1><div class="sub">Record what the business spends.</div></div>
      <button id="gen" class="btn">${ic('clock')}Add today's daily and monthly expenses</button></div>
    <div class="card"><h2>Record an expense</h2>
      <div class="row">
        <label>Date <input id="ed" type="date" value="${todayStr()}"></label>
        <label>Category <select id="ec">${C.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
        <label>Amount (KSh) <input id="ea" type="number" min="1" step="1" inputmode="decimal"></label>
      </div>
      <div class="row">
        <label>Description <input id="et"></label>
        <label>Paid by <select id="em"><option value="cash">Cash</option><option value="mpesa">M-Pesa</option></select></label>
      </div>
      <button id="addE" class="btn primary">Save expense</button></div>
    <div class="card"><h2>Recent expenses</h2>${L.length ? `<div class="tablewrap"><table><thead><tr><th>Date</th><th>Category</th>
      <th>Description</th><th class="num">Amount</th><th></th></tr></thead><tbody>
      ${L.map(x => `<tr><td>${fmtDate(x.expense_date)}</td><td>${esc(x.expense_categories.name)}${x.expense_categories.kind === 'owner_personal' ? ' <span class="pill">Personal</span>' : ''}</td>
      <td>${esc(x.description)}</td><td class="num">${x.status === 'voided' ? '<s>' + money(x.amount) + '</s>' : money(x.amount)}</td>
      <td>${x.status === 'voided' ? '<span class="pill bad">Voided</span>' : owner ? `<button class="btn small danger" data-vd="${x.id}">Void</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">No expenses recorded yet.</div>'}</div>
    ${owner ? `<div class="card"><h2>Regular expenses</h2>
      <p class="muted small-text">These are added for you when you press "Add today's daily and monthly expenses". They never duplicate.</p>
      ${RE.length ? `<div class="tablewrap"><table><thead><tr><th>Expense</th><th>How often</th><th>Amount</th><th>On</th><th></th></tr></thead><tbody>
        ${RE.map(r => `<tr><td>${esc(r.description)}<br><span class="muted small-text">${esc(r.expense_categories.name)}</span></td>
        <td>${r.frequency === 'daily' ? 'Every day' : 'Monthly, day ' + r.day_of_month}</td>
        <td><input type="number" min="1" step="any" data-ra="${r.id}" value="${r.amount}"></td>
        <td><input type="checkbox" data-rc="${r.id}" ${r.is_active ? 'checked' : ''}></td>
        <td><button class="btn small" data-rsave="${r.id}">Save</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">None yet.</div>'}
      <h3 style="margin-top:1rem">Add a regular expense</h3>
      <div class="row"><label>Category <select id="rcat">${C.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
        <label>Description <input id="rdes"></label>
        <label>Amount <input id="ramt" type="number" min="1" step="any"></label>
        <label>How often <select id="rfreq"><option value="daily">Every day</option><option value="monthly">Monthly</option></select></label>
        <label>Day of month (monthly) <input id="rdom" type="number" min="1" max="31" value="1"></label></div>
      <button id="rAdd" class="btn">Add regular expense</button>
      <h3 style="margin-top:1.25rem">Add a category</h3>
      <div class="row"><label>Name <input id="cname"></label>
        <label>Counts as <select id="ckind"><option value="operating">Business expense</option><option value="owner_personal">Personal (left out of business profit)</option></select></label></div>
      <button id="cAdd" class="btn">Add category</button></div>` : ''}`);

  $('#gen').addEventListener('click', e => guard(e.currentTarget, async () => {
    const n = must(await sb.rpc('generate_recurring_expenses', { p_date: todayStr() }));
    toast(n ? `${n} expense(s) added` : 'Nothing new to add. Today is already up to date.'); viewExpenses();
  }));
  $('#addE').addEventListener('click', e => guard(e.currentTarget, async () => {
    const amount = num($('#ea').value), desc = $('#et').value.trim(), method = $('#em').value;
    const acct = accounts.find(a => a.account_type === method);
    if (amount <= 0) throw new Error('Enter the amount');
    if (!acct) throw new Error('No ' + method + ' account found');
    const cat = C.find(c => c.id === $('#ec').value);
    const { error } = await sb.from('expenses').insert({ expense_date: $('#ed').value, category_id: cat.id,
      description: desc || cat.name, amount, payment_method: method, cash_account_id: acct.id });
    if (error) throw error;
    toast('Expense saved'); viewExpenses();
  }));
  view().onclick = async e => {
    const b = e.target.closest('button'); if (!b) return;
    await guard(b, async () => {
      if (b.dataset.vd) {
        const reason = prompt('Why are you voiding this expense? (required)');
        if (!reason || !reason.trim()) return;
        must(await sb.rpc('void_expense', { p_expense_id: b.dataset.vd, p_reason: reason.trim() }));
        toast('Expense voided'); viewExpenses();
      } else if (b.dataset.rsave) {
        const id = b.dataset.rsave;
        const { error } = await sb.from('recurring_expenses').update({
          amount: num(document.querySelector(`[data-ra="${id}"]`).value), is_active: document.querySelector(`[data-rc="${id}"]`).checked }).eq('id', id);
        if (error) throw error; toast('Saved');
      } else if (b.id === 'rAdd') {
        const amt = num($('#ramt').value), des = $('#rdes').value.trim(), freq = $('#rfreq').value;
        const cash = accounts.find(a => a.account_type === 'cash');
        if (!des || amt <= 0) throw new Error('Enter a description and an amount');
        if (!cash) throw new Error('No cash account found');
        const { error } = await sb.from('recurring_expenses').insert({ category_id: $('#rcat').value, description: des, amount: amt,
          frequency: freq, day_of_month: freq === 'monthly' ? Math.min(31, Math.max(1, Math.round(num($('#rdom').value) || 1))) : null,
          method: 'cash', cash_account_id: cash.id });
        if (error) throw error; toast('Added'); viewExpenses();
      } else if (b.id === 'cAdd') {
        const name = $('#cname').value.trim(); if (!name) throw new Error('Enter the category name');
        const { error } = await sb.from('expense_categories').insert({ name, kind: $('#ckind').value });
        if (error) throw new Error(error.code === '23505' ? 'That category already exists' : error.message);
        toast('Category added'); viewExpenses();
      }
    });
  };
}

/* ------------------------------------------------------------------ *
 * Products and prices
 * ------------------------------------------------------------------ */
async function viewProducts() {
  const P = await loadProducts(true), owner = isOwner();
  const cell = (p, f, v) => owner
    ? `<input data-id="${p.id}" data-f="${f}" type="number" min="0" step="1" value="${v ?? ''}" inputmode="decimal">`
    : (v === null || v === undefined ? '-' : Number(v).toLocaleString('en-KE'));
  set(`<div class="pagehead"><h1>Products and prices</h1></div>
    ${owner ? '<p class="muted">Changing a price only affects new sales. Old sales keep the price they were sold at. Leave wholesale empty to use the retail price.</p>' : ''}
    <div class="card"><div class="tablewrap"><table><thead><tr><th>Product</th><th>Retail</th><th>Wholesale</th>
      ${owner ? '<th>Cost</th><th>Active</th><th></th>' : ''}</tr></thead><tbody>
      ${P.map(p => `<tr><td>${esc(p.name)}</td><td>${cell(p, 'retail_price', p.retail_price)}</td>
        <td>${cell(p, 'wholesale_price', p.wholesale_price)}</td>${owner ? `<td>${cell(p, 'cost_price', p.cost_price)}</td><td><input type="checkbox" style="min-height:0;width:auto" data-id="${p.id}" data-f="is_active" ${p.is_active ? 'checked' : ''}></td>
        <td><button class="btn small primary" data-save="${p.id}">Save</button></td>` : ''}</tr>`).join('')}
      </tbody></table></div></div>
    ${owner ? `<div class="card"><h2>Add a product</h2><div class="row">
      <label>Name <input id="np"></label>
      <label>Type <select id="nc"><option value="refill">Refill</option><option value="bottle">Bottle</option>
        <option value="pack">Pack</option><option value="equipment">Equipment</option><option value="other">Other</option></select></label>
      <label>Retail <input id="nr" type="number" min="0" step="1"></label>
      <label>Wholesale <input id="nw" type="number" min="0" step="1"></label>
      <label>Cost <input id="nk" type="number" min="0" step="1"></label></div>
      <button id="addP" class="btn primary">Add product</button></div>` : ''}`);
  if (!owner) return;
  view().onclick = e => {
    const b = e.target.closest('[data-save]'); if (!b) return;
    guard(b, async () => {
      const id = b.dataset.save, g = f => document.querySelector(`[data-id="${id}"][data-f="${f}"]`);
      const w = g('wholesale_price').value;
      const { error } = await sb.from('products').update({ retail_price: num(g('retail_price').value),
        wholesale_price: w === '' ? null : num(w), cost_price: num(g('cost_price').value),
        is_active: g('is_active').checked }).eq('id', id);
      if (error) throw error;
      toast('Saved');
    });
  };
  $('#addP').addEventListener('click', e => guard(e.currentTarget, async () => {
    const name = $('#np').value.trim();
    if (!name) throw new Error('Enter the product name');
    const { error } = await sb.from('products').insert({ name, category: $('#nc').value,
      retail_price: num($('#nr').value), wholesale_price: $('#nw').value === '' ? null : num($('#nw').value),
      cost_price: num($('#nk').value) });
    if (error) throw new Error(error.code === '23505' ? 'A product with that name already exists' : error.message);
    toast('Product added'); viewProducts();
  }));
}

/* ------------------------------------------------------------------ *
 * Shared small helpers for the later screens
 * ------------------------------------------------------------------ */
const opts = (arr, val, label, sel) => arr.map(x =>
  `<option value="${esc(x[val])}" ${x[val] === sel ? 'selected' : ''}>${esc(label(x))}</option>`).join('');
const ask = msg => { const r = prompt(msg); return r && r.trim() ? r.trim() : null; };

/* ------------------------------------------------------------------ *
 * Inventory (stock, counts, losses, recipes)
 * ------------------------------------------------------------------ */
async function viewInventory() {
  const owner = isOwner();
  const [stock, items, products, rules] = await Promise.all([
    sb.from('inventory_stock').select('*').order('name'),
    sb.from('inventory_items').select('*').eq('is_active', true).order('name'),
    loadProducts(true),
    sb.from('product_stock_rules').select('product_id,item_id,qty_per_unit,products(name),inventory_items(name,unit)')
  ]);
  const S = must(stock), I = must(items), R = must(rules);
  const cost = Object.fromEntries(I.map(i => [i.id, Number(i.unit_cost)]));
  const value = S.reduce((t, s) => t + Number(s.on_hand) * (cost[s.item_id] || 0), 0);

  set(`<div class="pagehead"><h1>Inventory</h1><span class="pill">Stock value ${money(value)}</span></div>
    <div class="card"><div class="tablewrap"><table><thead><tr><th>Item</th><th class="num">In stock</th>
      <th>Unit</th><th>Warn me below</th>${owner ? '<th>Count today</th>' : ''}<th></th></tr></thead><tbody>
      ${S.map(s => `<tr><td>${esc(s.name)}</td><td class="num"><b>${Number(s.on_hand).toLocaleString('en-KE')}</b></td>
        <td>${esc(s.unit)}</td>
        <td>${owner ? `<input type="number" min="0" step="1" data-ro="${s.item_id}" value="${s.reorder_level}"><button class="btn small" data-rosave="${s.item_id}">Save</button>` : s.reorder_level}</td>
        ${owner ? `<td><input type="number" min="0" step="1" data-cnt="${s.item_id}" placeholder="counted"></td>` : ''}
        <td>${s.reorder_level > 0 && s.is_low ? '<span class="pill bad">Low</span>' : ''}</td></tr>`).join('')}
      </tbody></table></div>
      ${owner ? `<p class="muted small-text">To check your stock: count what is on the shelf, type it in the "Count today" boxes
        (leave blank for items you did not count) and press the button. The system records the difference.</p>
        <button id="applyCount" class="btn primary">Apply stock count</button>` : ''}</div>

    ${owner ? `<div class="card"><h2>Record a loss or damage</h2><div class="row">
        <label>Item <select id="dmI">${opts(I, 'id', i => i.name)}</select></label>
        <label>How many lost <input id="dmQ" type="number" min="1" step="1"></label>
        <label>Reason <input id="dmN" placeholder="e.g. broken bottles"></label></div>
        <button id="dmBtn" class="btn">Record loss</button></div>
      <div class="card"><h2>Add a stock item</h2><div class="row">
        <label>Name <input id="niN"></label>
        <label>Type <select id="niT"><option value="raw_water">Raw water</option><option value="empty_bottle">Empty bottle</option>
          <option value="new_bottle">New bottle</option><option value="filled_bottle">Filled bottle</option>
          <option value="finished_pack">Finished pack</option><option value="cup">Cups</option><option value="seal">Seals</option>
          <option value="packaging">Packaging</option><option value="pump">Pump</option><option value="other">Other</option></select></label>
        <label>Unit <input id="niU" value="pc"></label></div>
        <button id="niBtn" class="btn primary">Add item</button></div>` : ''}

    <div class="card"><h2>What each product uses</h2>
      <p class="muted small-text">Each time you sell one unit of a product, these stock items go down automatically.
      Example: "20L refill" uses 20 litres of Raw water.</p>
      ${R.length ? `<div class="tablewrap"><table><thead><tr><th>Product</th><th>Uses</th><th class="num">Per unit sold</th><th></th></tr></thead><tbody>
        ${R.map(r => `<tr><td>${esc(r.products.name)}</td><td>${esc(r.inventory_items.name)}</td>
          <td class="num">${r.qty_per_unit} ${esc(r.inventory_items.unit)}</td>
          <td>${owner ? `<button class="btn small danger" data-delrule="${r.product_id}|${r.item_id}">Remove</button>` : ''}</td></tr>`).join('')}
        </tbody></table></div>` : '<div class="empty">No rules yet.</div>'}
      ${owner ? `<div class="row" style="margin-top:.75rem">
        <label>Product <select id="rP">${opts(products, 'id', p => p.name)}</select></label>
        <label>Uses <select id="rI">${opts(I, 'id', i => i.name)}</select></label>
        <label>Amount per unit sold <input id="rQ" type="number" min="0.0001" step="any"></label></div>
        <button id="rBtn" class="btn primary">Save rule</button>` : ''}</div>`);
  if (!owner) return;

  view().onclick = async e => {
    const b = e.target.closest('button'); if (!b) return;
    try {
      if (b.dataset.rosave) {
        const v = num(document.querySelector(`[data-ro="${b.dataset.rosave}"]`).value);
        const { error } = await sb.from('inventory_items').update({ reorder_level: v }).eq('id', b.dataset.rosave);
        if (error) throw error; toast('Saved');
      } else if (b.dataset.delrule) {
        const [p, i] = b.dataset.delrule.split('|');
        const { error } = await sb.from('product_stock_rules').delete().eq('product_id', p).eq('item_id', i);
        if (error) throw error; toast('Rule removed'); viewInventory();
      } else if (b.id === 'applyCount') {
        const counts = [...document.querySelectorAll('[data-cnt]')].filter(x => x.value !== '')
          .map(x => ({ item_id: x.dataset.cnt, counted: num(x.value) }));
        if (!counts.length) throw new Error('Type at least one counted quantity');
        if (!confirm(`Apply the count for ${counts.length} item(s)? The system stock will be changed to match.`)) return;
        const n = must(await sb.rpc('stock_count', { p_counts: counts }));
        toast(n ? `${n} item(s) corrected` : 'Everything already matched'); viewInventory();
      } else if (b.id === 'dmBtn') {
        const q = num($('#dmQ').value), why = $('#dmN').value.trim();
        if (q <= 0) throw new Error('Enter how many were lost');
        must(await sb.rpc('adjust_stock', { p_item_id: $('#dmI').value, p_quantity: -q, p_type: 'damage', p_notes: why || '' }));
        toast('Loss recorded'); viewInventory();
      } else if (b.id === 'niBtn') {
        const name = $('#niN').value.trim(); if (!name) throw new Error('Enter the item name');
        const { error } = await sb.from('inventory_items').insert({ name, item_type: $('#niT').value, unit: $('#niU').value.trim() || 'pc' });
        if (error) throw new Error(error.code === '23505' ? 'That item already exists' : error.message);
        toast('Item added'); viewInventory();
      } else if (b.id === 'rBtn') {
        const q = num($('#rQ').value); if (q <= 0) throw new Error('Enter the amount used per unit sold');
        const { error } = await sb.from('product_stock_rules').upsert({ product_id: $('#rP').value, item_id: $('#rI').value, qty_per_unit: q });
        if (error) throw error; toast('Rule saved'); viewInventory();
      }
    } catch (err) { toast(err.message || String(err), 'err'); }
  };
}

/* ------------------------------------------------------------------ *
 * Purchases and suppliers
 * ------------------------------------------------------------------ */
async function viewPurchases() {
  const [sup, items, accounts, recent] = await Promise.all([
    sb.from('supplier_balances').select('*').eq('is_active', true).order('name'),
    sb.from('inventory_items').select('*').eq('is_active', true).order('name'), loadAccounts(),
    sb.from('purchases').select('*, suppliers(name)').order('purchase_date', { ascending: false })
      .order('created_at', { ascending: false }).limit(30)]);
  const S = must(sup), I = must(items), R = must(recent);
  const hasBank = accounts.some(a => a.account_type === 'bank');
  let lines = [], paidTouched = false;
  const itemName = id => (I.find(i => i.id === id) || {}).name;
  const total = () => lines.reduce((t, l) => t + Math.round(l.qty * l.cost * 100) / 100, 0);

  set(`<div class="pagehead"><h1>Purchases and suppliers</h1></div>
    <div class="card"><h2>Record a purchase</h2>
      <div class="row">
        <label>Supplier <select id="ps">${opts(S, 'supplier_id', s => s.name)}</select></label>
        <label>Type <select id="pk"><option value="production_material">Production material</option>
          <option value="inventory">Goods for resale</option><option value="equipment">Equipment</option>
          <option value="other">Other</option></select></label>
      </div>
      <div class="row">
        <label>Stock item <select id="pi"><option value="">Not a stock item (type a description)</option>${opts(I, 'id', i => i.name)}</select></label>
        <label>Description <input id="pd" placeholder="Only if not a stock item"></label>
        <label class="fixed" style="width:100px">Quantity <input id="pq" type="number" min="1" step="any"></label>
        <label class="fixed" style="width:120px">Cost each <input id="pc" type="number" min="0" step="any"></label>
        <div class="fixed"><button id="pAdd" class="btn primary" type="button">Add</button></div>
      </div>
      <div class="tablewrap"><table><tbody id="pl"></tbody></table></div>
      <div class="total-box"><span>Purchase total</span><span class="amt" id="pt">KSh 0</span></div>
      <div class="row">
        <label>Paid now <input id="pp" type="number" min="0" step="any"></label>
        <label>Paid by <select id="pm"><option value="cash">Cash</option><option value="mpesa">M-Pesa</option>${hasBank ? '<option value="bank">Bank</option>' : ''}</select></label>
      </div>
      <p class="muted small-text">Anything not paid now is recorded as money you owe the supplier.</p>
      <button id="pSave" class="btn primary wide">Save purchase</button></div>

    <div class="card"><h2>Suppliers</h2>
      <div class="row"><label>Name <input id="sn"></label><label>Phone <input id="sp" type="tel"></label>
        <div class="fixed"><button id="sAdd" class="btn">Add supplier</button></div></div>
      <div class="tablewrap"><table><thead><tr><th>Supplier</th><th>Phone</th><th class="num">You owe</th><th></th></tr></thead><tbody>
        ${S.map(s => `<tr><td>${esc(s.name)}</td><td>${esc(s.phone || '')}</td>
          <td class="num">${Number(s.balance) > 0 ? '<b>' + money(s.balance) + '</b>' : money(0)}</td>
          <td>${Number(s.balance) > 0 ? `<button class="btn small" data-pay="${s.supplier_id}" data-b="${s.balance}" data-n="${esc(s.name)}">Pay</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div></div>

    <div class="card"><h2>Recent purchases</h2>${R.length ? `<div class="tablewrap"><table><thead><tr><th>Date</th><th>Supplier</th><th>Type</th>
      <th class="num">Total</th></tr></thead><tbody>${R.map(p => `<tr><td>${fmtDate(p.purchase_date)}</td>
      <td>${esc(p.suppliers ? p.suppliers.name : '')}</td><td>${esc(p.kind)}</td><td class="num">${money(p.total)}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">No purchases yet.</div>'}</div>`);

  const draw = () => {
    $('#pl').innerHTML = lines.map((l, i) => `<tr><td>${esc(l.id ? itemName(l.id) : l.desc)}</td>
      <td>${l.qty} x ${l.cost.toLocaleString('en-KE')}</td><td class="num">${money(l.qty * l.cost)}</td>
      <td><button class="btn small danger" data-rm="${i}">Remove</button></td></tr>`).join('');
    $('#pt').textContent = money(total());
    if (!paidTouched) $('#pp').value = total() || '';
  };
  $('#pAdd').addEventListener('click', () => {
    const id = $('#pi').value, desc = $('#pd').value.trim(), qty = num($('#pq').value), cost = num($('#pc').value);
    if (!id && !desc) return toast('Choose a stock item or type a description', 'err');
    if (qty <= 0) return toast('Enter the quantity', 'err');
    lines.push({ id, desc, qty, cost }); $('#pq').value = ''; $('#pc').value = ''; $('#pd').value = ''; draw();
  });
  $('#pp').addEventListener('input', () => { paidTouched = true; });
  $('#pl').addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (b) { lines.splice(+b.dataset.rm, 1); draw(); } });
  $('#pSave').addEventListener('click', e => guard(e.currentTarget, async () => {
    if (!lines.length) throw new Error('Add at least one item');
    const paid = num($('#pp').value);
    if (paid > total()) throw new Error('Paid is more than the total');
    must(await sb.rpc('create_purchase', { p_supplier_id: $('#ps').value, p_kind: $('#pk').value,
      p_items: lines.map(l => ({ inventory_item_id: l.id || null, description: l.desc || null, quantity: l.qty, unit_cost: l.cost })),
      p_amount_paid: paid, p_method: $('#pm').value }));
    toast('Purchase saved'); viewPurchases();
  }));
  $('#sAdd').addEventListener('click', e => guard(e.currentTarget, async () => {
    const name = $('#sn').value.trim(); if (!name) throw new Error('Enter the supplier name');
    const { error } = await sb.from('suppliers').insert({ name, phone: $('#sp').value.trim() || null });
    if (error) throw error; toast('Supplier added'); viewPurchases();
  }));
  view().onclick = e => {
    const b = e.target.closest('[data-pay]'); if (!b) return;
    openModal(`<h2>Pay ${esc(b.dataset.n)}</h2><p class="muted">You owe ${money(b.dataset.b)}</p>
      <label>Amount <input id="spA" type="number" min="1" step="any" value="${b.dataset.b}"></label>
      <label>Paid by <select id="spM"><option value="cash">Cash</option><option value="mpesa">M-Pesa</option></select></label>
      <div class="actions"><button class="btn primary" id="spGo">Record payment</button><button class="btn" data-close>Cancel</button></div>`);
    $('#spGo').onclick = ev => guard(ev.currentTarget, async () => {
      must(await sb.rpc('pay_supplier', { p_supplier_id: b.dataset.pay, p_amount: num($('#spA').value), p_method: $('#spM').value }));
      closeModal(); toast('Payment recorded'); viewPurchases();
    });
  };
}

/* ------------------------------------------------------------------ *
 * Production
 * ------------------------------------------------------------------ */
async function viewProduction() {
  const [items, recent] = await Promise.all([
    sb.from('inventory_items').select('*').eq('is_active', true).order('name'),
    sb.from('production_batches').select('*, inventory_items(name)').order('batch_date', { ascending: false })
      .order('created_at', { ascending: false }).limit(30)]);
  const I = must(items), R = must(recent); let mats = [];
  set(`<div class="pagehead"><h1>Production</h1></div>
    <div class="card"><p class="muted">Use this when you fill bottles or make packs. It adds the finished items to stock
      and takes the materials (cups, seals, bottles, water) out of stock.</p>
      <div class="row"><label>Date <input id="bd" type="date" value="${todayStr()}"></label>
        <label>What was made <select id="bo"><option value="">Nothing to add to stock</option>${opts(I, 'id', i => i.name)}</select></label>
        <label>How many made <input id="bq" type="number" min="0" step="any"></label>
        <label>How many damaged <input id="bx" type="number" min="0" step="any" value="0"></label></div>
      <h3>Materials used</h3>
      <div class="row"><label>Material <select id="bm">${opts(I, 'id', i => i.name)}</select></label>
        <label class="fixed" style="width:120px">Quantity <input id="bmq" type="number" min="0" step="any"></label>
        <div class="fixed"><button id="bAdd" class="btn" type="button">Add material</button></div></div>
      <div class="tablewrap"><table><tbody id="bl"></tbody></table></div>
      <label>Notes <input id="bn"></label>
      <button id="bSave" class="btn primary wide">Save production</button></div>
    <div class="card"><h2>Recent batches</h2>${R.length ? `<div class="tablewrap"><table><thead><tr><th>Date</th><th>Made</th>
      <th class="num">Quantity</th><th class="num">Damaged</th></tr></thead><tbody>${R.map(b => `<tr><td>${fmtDate(b.batch_date)}</td>
      <td>${esc(b.inventory_items ? b.inventory_items.name : '-')}</td><td class="num">${b.qty_produced}</td><td class="num">${b.qty_damaged}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">No production recorded yet.</div>'}</div>`);
  const draw = () => { $('#bl').innerHTML = mats.map((m, i) => `<tr><td>${esc((I.find(x => x.id === m.id) || {}).name)}</td>
    <td>${m.q}</td><td><button class="btn small danger" data-rm="${i}">Remove</button></td></tr>`).join(''); };
  $('#bAdd').addEventListener('click', () => {
    const q = num($('#bmq').value); if (q <= 0) return toast('Enter the quantity used', 'err');
    mats.push({ id: $('#bm').value, q }); $('#bmq').value = ''; draw();
  });
  $('#bl').addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (b) { mats.splice(+b.dataset.rm, 1); draw(); } });
  $('#bSave').addEventListener('click', e => guard(e.currentTarget, async () => {
    must(await sb.rpc('record_production', { p_date: $('#bd').value, p_output_item: $('#bo').value || null,
      p_qty_produced: num($('#bq').value), p_qty_damaged: num($('#bx').value),
      p_materials: mats.map(m => ({ item_id: m.id, quantity: m.q })), p_notes: $('#bn').value.trim() || null }));
    toast('Production saved'); viewProduction();
  }));
}

/* ------------------------------------------------------------------ *
 * Cashbook
 * ------------------------------------------------------------------ */
async function viewCashbook() {
  const t = todayStr(), accts = must(await sb.from('cash_accounts').select('*').eq('is_active', true));
  const bals = must(await sb.from('cash_balances').select('*'));
  set(`<div class="pagehead"><h1>Cashbook</h1></div>
    <div class="grid">${bals.map(b => `<div class="stat good"><div class="k">${esc(b.name)}</div><div class="v">${money(b.balance)}</div></div>`).join('')}
      <div class="stat"><div class="k">Total</div><div class="v">${money(bals.reduce((s, b) => s + Number(b.balance), 0))}</div></div></div>
    <div class="card"><div class="row"><label>From <input id="cf" type="date" value="${monthStart(t)}"></label>
      <label>To <input id="ct" type="date" value="${t}"></label>
      <label>Account <select id="ca"><option value="">All</option>${opts(accts, 'id', a => a.name)}</select></label></div>
      <div id="cs" class="grid" style="margin:0"></div></div>
    <div class="card" id="cl"></div>
    ${isOwner() ? `<div class="card"><h2>Move money between accounts</h2>
      <p class="muted small-text">For example, M-Pesa to cash. This is not income or an expense.</p>
      <div class="row"><label>From <select id="tf">${opts(accts, 'id', a => a.name)}</select></label>
        <label>To <select id="tt">${opts([...accts].reverse(), 'id', a => a.name)}</select></label>
        <label>Amount <input id="ta" type="number" min="1" step="any"></label></div>
      <button id="tBtn" class="btn primary">Move money</button></div>` : ''}`);
  const load = async () => {
    let q = sb.from('cash_transactions').select('*, cash_accounts(name)').gte('txn_date', $('#cf').value)
      .lte('txn_date', $('#ct').value).order('txn_date', { ascending: false }).order('created_at', { ascending: false }).limit(500);
    if ($('#ca').value) q = q.eq('account_id', $('#ca').value);
    const L = must(await q), live = L.filter(x => !x.is_void);
    const tr = x => x.txn_type === 'transfer_in' || x.txn_type === 'transfer_out';
    const inn = live.filter(x => x.direction === 'in' && !tr(x)).reduce((s, x) => s + Number(x.amount), 0);
    const out = live.filter(x => x.direction === 'out' && !tr(x)).reduce((s, x) => s + Number(x.amount), 0);
    $('#cs').innerHTML = `<div class="stat good"><div class="k">Money in</div><div class="v">${money(inn)}</div></div>
      <div class="stat"><div class="k">Money out</div><div class="v">${money(out)}</div></div>
      <div class="stat"><div class="k">Net movement</div><div class="v">${money(inn - out)}</div></div>`;
    $('#cl').innerHTML = L.length ? `<div class="tablewrap"><table><thead><tr><th>Date</th><th>Account</th><th>Details</th>
      <th class="num">In</th><th class="num">Out</th></tr></thead><tbody>${L.map(x => `<tr ${x.is_void ? 'style="opacity:.5;text-decoration:line-through"' : ''}>
      <td>${fmtDate(x.txn_date)}</td><td>${esc(x.cash_accounts.name)}</td><td>${esc(x.description || x.txn_type)}</td>
      <td class="num">${x.direction === 'in' ? Number(x.amount).toLocaleString('en-KE') : ''}</td>
      <td class="num">${x.direction === 'out' ? Number(x.amount).toLocaleString('en-KE') : ''}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">No entries in this period.</div>';
  };
  ['cf', 'ct', 'ca'].forEach(id => $('#' + id).addEventListener('change', () => load().catch(e => toast(e.message, 'err'))));
  if (isOwner()) $('#tBtn').addEventListener('click', e => guard(e.currentTarget, async () => {
    must(await sb.rpc('transfer_cash', { p_from: $('#tf').value, p_to: $('#tt').value, p_amount: num($('#ta').value) }));
    toast('Money moved'); viewCashbook();
  }));
  await load();
}

/* ------------------------------------------------------------------ *
 * Reports
 * ------------------------------------------------------------------ */
async function viewReports() {
  const t = todayStr();
  const [mr, cust, sup, items, stock] = await Promise.all([
    sb.rpc('monthly_report', { p_months: 12 }), sb.from('customer_balances').select('balance'),
    sb.from('supplier_balances').select('balance'), sb.from('inventory_items').select('id,unit_cost'),
    sb.from('inventory_stock').select('item_id,on_hand')]);
  const M = must(mr), owed = must(cust).reduce((s, c) => s + Number(c.balance), 0);
  const weOwe = must(sup).reduce((s, c) => s + Number(c.balance), 0);
  const cost = Object.fromEntries(must(items).map(i => [i.id, Number(i.unit_cost)]));
  const invValue = must(stock).reduce((s, x) => s + Number(x.on_hand) * (cost[x.item_id] || 0), 0);
  const rows = M.map((m, i) => {
    const prev = M[i + 1], gross = m.sales - m.cogs, net = gross - m.operating_expenses;
    const g = prev && prev.sales > 0 ? ((m.sales - prev.sales) / prev.sales) * 100 : null;
    return `<tr><td>${new Date(m.month + 'T00:00:00').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}</td>
      <td class="num">${money(m.sales)}</td><td class="num">${g === null ? 'n/a' : (g >= 0 ? '+' : '') + g.toFixed(1) + '%'}</td>
      <td class="num">${money(m.retail_sales)}</td><td class="num">${money(m.wholesale_sales)}</td>
      <td class="num">${money(gross)}</td><td class="num">${money(m.operating_expenses)}</td>
      <td class="num"><b>${money(net)}</b></td></tr>`;
  }).join('');
  const D = must(await sb.rpc('debt_trend', { p_months: 6 }));
  set(`<div class="pagehead"><h1>Reports</h1></div>
    <div class="grid">
      <div class="stat owe"><div class="k">Customers owe you</div><div class="v">${money(owed)}</div></div>
      <div class="stat"><div class="k">You owe suppliers</div><div class="v">${money(weOwe)}</div></div>
      <div class="stat"><div class="k">Stock value (at cost)</div><div class="v">${money(invValue)}</div></div></div>
    <div class="card"><h2>Month by month</h2><div class="tablewrap"><table><thead><tr><th>Month</th><th class="num">Sales</th>
      <th class="num">Growth</th><th class="num">Retail</th><th class="num">Wholesale</th><th class="num">Gross profit</th>
      <th class="num">Expenses</th><th class="num">Net profit</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="muted small-text">Net profit = sales - cost of goods - business expenses. Personal expenses (such as house rent)
      and unpaid credit are handled separately. Profit is only accurate once product costs are entered.</p></div>
    <div class="card"><h2>Customer debt trend</h2>
      <div class="tablewrap"><table><thead><tr><th>At the end of</th><th class="num">Customers owed you</th><th class="num">Change</th></tr></thead><tbody>
      ${D.map((d, i) => { const p = D[i + 1], ch = p ? d.receivables - p.receivables : null;
        return `<tr><td>${fmtDate(d.month_end)}</td><td class="num">${money(d.receivables)}</td>
        <td class="num">${ch === null ? '' : (ch > 0 ? '<span class="pill owe">+' + money(ch) + '</span>' : ch < 0 ? '<span class="pill good">' + money(ch) + '</span>' : '-')}</td></tr>`; }).join('')}
      </tbody></table></div></div>
    <div class="card"><h2>Pick a period</h2><div class="row">
      <label>From <input id="rf" type="date" value="${monthStart(t)}"></label><label>To <input id="rt" type="date" value="${t}"></label></div></div>
    <div class="card"><h2>Products sold</h2><div id="rp"></div></div>
    <div class="card"><h2>Best customers</h2><div id="rc"></div></div>
    <div class="card"><h2>Where the money went (expenses)</h2><div id="re"></div></div>
    <div class="card"><h2>Stock use and how long it will last</h2><div id="rs"></div></div>`);
  const tbl = (head, rows) => rows.length ? `<div class="tablewrap"><table><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`
    : '<div class="empty">Nothing in this period.</div>';
  const load = async () => {
    const f = $('#rf').value, t2 = $('#rt').value;
    const [P, C, E, U] = (await Promise.all([
      sb.rpc('product_sales', { p_from: f, p_to: t2 }), sb.rpc('customer_sales', { p_from: f, p_to: t2 }),
      sb.rpc('expense_breakdown', { p_from: f, p_to: t2 }), sb.rpc('stock_usage', { p_from: f, p_to: t2 })])).map(must);
    $('#rp').innerHTML = tbl('<th>Product</th><th class="num">Quantity</th><th class="num">Sales</th><th class="num">Profit</th>',
      P.map(p => `<tr><td>${esc(p.name)}</td><td class="num">${Number(p.qty).toLocaleString('en-KE')}</td><td class="num">${money(p.revenue)}</td><td class="num">${money(p.revenue - p.cost)}</td></tr>`));
    $('#rc').innerHTML = tbl('<th>Customer</th><th class="num">Bought</th><th class="num">Owes now</th>',
      C.map(c => `<tr><td>${esc(c.name)}</td><td class="num">${money(c.sales)}</td><td class="num">${Number(c.balance) > 0 ? '<b>' + money(c.balance) + '</b>' : money(0)}</td></tr>`));
    const eTot = E.reduce((s, x) => s + Number(x.total), 0);
    $('#re').innerHTML = tbl('<th>Category</th><th class="num">Amount</th><th class="num">Share</th>',
      E.map(x => `<tr><td>${esc(x.category)}${x.kind === 'owner_personal' ? ' <span class="pill">Personal</span>' : ''}</td><td class="num">${money(x.total)}</td><td class="num">${eTot ? (Number(x.total) / eTot * 100).toFixed(0) + '%' : ''}</td></tr>`));
    $('#rs').innerHTML = tbl('<th>Item</th><th class="num">Used</th><th class="num">In stock</th><th class="num">Times turned</th><th class="num">Will last (days)</th>',
      U.filter(u => Number(u.used) > 0 || Number(u.on_hand) > 0).map(u => `<tr><td>${esc(u.name)}</td><td class="num">${Number(u.used).toLocaleString('en-KE')} ${esc(u.unit)}</td>
        <td class="num">${Number(u.on_hand).toLocaleString('en-KE')}</td><td class="num">${u.turnover === null ? '-' : u.turnover}</td>
        <td class="num">${u.days_cover === null ? '-' : (u.days_cover < 7 ? '<span class="pill bad">' + u.days_cover + '</span>' : u.days_cover)}</td></tr>`));
  };
  ['rf', 'rt'].forEach(id => $('#' + id).addEventListener('change', () => load().catch(e => toast(e.message, 'err'))));
  await load();
}

/* ------------------------------------------------------------------ *
 * Settings, users and backup (owner only)
 * ------------------------------------------------------------------ */
const BACKUP_TABLES = ['business_settings', 'profiles', 'products', 'product_price_history', 'customers', 'cash_accounts',
  'sales', 'sale_items', 'payments', 'payment_allocations', 'customer_adjustments', 'cash_transactions',
  'expense_categories', 'recurring_expenses', 'expenses', 'suppliers', 'inventory_items', 'product_stock_rules',
  'inventory_movements', 'purchases', 'purchase_items', 'supplier_payments', 'production_batches',
  'production_materials', 'audit_logs'];

async function fetchAll(t) {
  let out = [], from = 0;
  for (;;) {
    let q = sb.from(t).select('*');
    q = t === 'product_stock_rules' ? q.order('product_id').order('item_id') : q.order('id');
    const { data, error } = await q.range(from, from + 999);
    if (error) throw error;
    out = out.concat(data);
    if (data.length < 1000) return out;
    from += 1000;
  }
}

async function viewSettings() {
  const [biz, accts] = await Promise.all([
    sb.from('business_settings').select('*').eq('id', 1).maybeSingle(),
    sb.from('cash_accounts').select('*').order('name')]);
  const B = must(biz) || {}, A = must(accts);
  set(`<div class="pagehead"><div><h1>Settings and backup</h1><div class="sub">Business details, money accounts and your weekly backup.</div></div></div>
    <div class="card"><h2>Business details</h2>
      <p class="muted small-text">These appear on receipts, statements and the daily report PDF.</p>
      <div class="row">
        <label>Business name <input id="sn" value="${esc(B.business_name || '')}"></label>
        <label>Phone <input id="sp" value="${esc(B.phone || '')}"></label>
        <label>Email <input id="se" type="email" value="${esc(B.email || '')}"></label></div>
      <div class="row">
        <label>Address <input id="sa" value="${esc(B.address || '')}" placeholder="Town, area"></label>
        <label>Receipt message <input id="sf" value="${esc(B.receipt_footer || '')}"></label></div>
      <button id="bSave" class="btn primary">Save details</button></div>

    <div class="card"><h2>Money accounts</h2>
      <p class="muted small-text">Opening balance is how much was in the account before you started using this system.</p>
      ${A.map(a => `<div class="row"><label>${esc(a.name)} <span class="pill">${esc(a.account_type)}</span>
        <input type="number" step="any" data-ob="${a.id}" value="${a.opening_balance}"></label>
        <div class="fixed"><button class="btn small" data-obs="${a.id}">Save</button></div></div>`).join('')}
      <h3 style="margin-top:1rem">Add an account</h3>
      <div class="row"><label>Name <input id="anN" placeholder="e.g. Equity Bank"></label>
        <label>Type <select id="anT"><option value="bank">Bank</option><option value="mpesa">M-Pesa</option><option value="cash">Cash</option></select></label>
        <label>Opening balance <input id="anB" type="number" step="any" value="0"></label></div>
      <button id="anAdd" class="btn">Add account</button></div>

    <div class="card"><h2>Backup</h2>
      <p class="muted small-text">Downloads all your business records as one file. Do this every week and keep copies on your computer
      and in your email or Google Drive.</p>
      <button id="bk" class="btn primary">${ic('download')}Download backup</button></div>`);
  view().onclick = async e => {
    const b = e.target.closest('button'); if (!b) return;
    await guard(b, async () => {
      if (b.id === 'bSave') {
        const row = { id: 1, business_name: $('#sn').value.trim() || 'Wise Water', phone: $('#sp').value.trim() || null,
          email: $('#se').value.trim() || null, address: $('#sa').value.trim() || null, receipt_footer: $('#sf').value.trim() || null };
        const { error } = await sb.from('business_settings').upsert(row);
        if (error) throw error;
        state.biz = { ...state.biz, ...row };
        $('#bizName').textContent = $('#brand').textContent = state.biz.business_name; toast('Saved');
      } else if (b.dataset.obs) {
        const v = num(document.querySelector(`[data-ob="${b.dataset.obs}"]`).value);
        const { error } = await sb.from('cash_accounts').update({ opening_balance: v }).eq('id', b.dataset.obs);
        if (error) throw error; toast('Saved');
      } else if (b.id === 'anAdd') {
        const name = $('#anN').value.trim(); if (!name) throw new Error('Enter the account name');
        const { error } = await sb.from('cash_accounts').insert({ name, account_type: $('#anT').value, opening_balance: num($('#anB').value) });
        if (error) throw new Error(error.code === '23505' ? 'An account with that name already exists' : error.message);
        toast('Account added'); viewSettings();
      } else if (b.id === 'bk') {
        const out = { app: 'wise-water', exported_at: new Date().toISOString(), tables: {} };
        for (const t of BACKUP_TABLES) out.tables[t] = await fetchAll(t);
        const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = `wise-water-backup-${todayStr()}.json`;
        document.body.appendChild(a); a.click(); a.remove(); toast('Backup downloaded');
      }
    });
  };
}

/* ------------------------------------------------------------------ *
 * WhatsApp / SMS reminders (free: opens the app with the message ready)
 * ------------------------------------------------------------------ */
const normPhone = p => {
  const d = String(p || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('254')) return d;
  if (d.startsWith('0')) return '254' + d.slice(1);
  if (d.length === 9) return '254' + d;
  return d;
};
const remindMsg = c => `Hello ${c.name}, this is ${state.biz.business_name}. Your balance with us is ${money(c.balance)}` +
  `${Number(c.overdue_amount) > 0 ? ', which is now overdue' : ''}. Please pay when you can. Thank you.`;
const remindBtn = c => {
  const n = normPhone(c.phone); if (!n || !(Number(c.balance) > 0)) return '';
  const text = encodeURIComponent(remindMsg(c));
  return `<a class="btn small" target="_blank" rel="noopener" href="https://wa.me/${n}?text=${text}">WhatsApp</a>
    <a class="btn small" href="sms:+${n}?body=${text}">SMS</a>`;
};

/* ------------------------------------------------------------------ *
 * Paste M-Pesa confirmation messages (works with a personal number)
 * ------------------------------------------------------------------ */
function parseMpesaSms(text) {
  return String(text || '').split(/(?=\b[A-Z0-9]{10}\s+Confirmed)/i).map(p => p.trim()).filter(Boolean).map(p => {
    const code = (p.match(/^([A-Z0-9]{10})\s+Confirmed/i) || [])[1];
    const amt = (p.match(/received\s+Ksh\.?\s?([\d,]+(?:\.\d+)?)/i) || [])[1];
    if (!code || !amt) return null;
    const fm = p.match(/from\s+(.+?)\s+on\s+\d/i);
    const sender = fm ? fm[1].trim() : '';
    const pm = sender.match(/((?:\+?254|0)[\d\s]{8,11}\d)\s*$/);
    const d = p.match(/\bon\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i);
    let date = todayStr();
    if (d) { const y = d[3].length === 2 ? '20' + d[3] : d[3]; date = `${y}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}`; }
    return { code: code.toUpperCase(), amount: parseFloat(amt.replace(/,/g, '')), date,
      name: (pm ? sender.replace(pm[0], '') : sender).trim(), phone: pm ? normPhone(pm[1].replace(/\s/g, '')) : '' };
  }).filter(Boolean);
}
const matchCustomer = (m, list) => {
  const byPhone = m.phone && list.find(c => normPhone(c.phone) === m.phone);
  if (byPhone) return byPhone.customer_id;
  const n = m.name.toLowerCase();
  const byName = n && list.find(c => c.name.toLowerCase() === n);
  return byName ? byName.customer_id : '';
};

/* ------------------------------------------------------------------ *
 * M-Pesa statement matching
 * ------------------------------------------------------------------ */
function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false; else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = ''; if (row.some(x => x.trim() !== '')) rows.push(row); row = [];
    } else cur += ch;
  }
  row.push(cur); if (row.some(x => x.trim() !== '')) rows.push(row);
  return rows;
}
const normDate = s => {
  s = String(s || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return todayStr();
};
const ignoredKey = 'ws_ignored_mpesa';
const getIgnored = () => { try { return new Set(JSON.parse(localStorage.getItem(ignoredKey) || '[]')); } catch (e) { return new Set(); } };
const saveIgnored = set => { try { localStorage.setItem(ignoredKey, JSON.stringify([...set])); } catch (e) { /* ignore */ } };

async function viewMpesa() {
  const customers = (await loadCustomers()).filter(c => Number(c.balance) > 0);
  set(`<div class="pagehead"><h1>M-Pesa matching</h1></div>
    <div class="card"><p class="muted">Download your M-Pesa statement as a CSV file (from the M-Pesa app or Safaricom statement)
      and choose it here. The system checks every payment you <b>received</b> against your records and shows what is missing.
      The file is read on your device only and is not uploaded anywhere.</p>
      <label>M-Pesa statement (.csv) <input id="mf" type="file" accept=".csv,text/csv"></label></div>
    <div id="mr"></div>`);
  $('#mf').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const rows = parseCsv(await file.text());
      const hi = rows.findIndex(r => r.some(c => /receipt/i.test(c)) && r.some(c => /paid.?in|credit/i.test(c)));
      if (hi < 0) throw new Error('Could not find the columns "Receipt No" and "Paid In". Is this the M-Pesa statement CSV?');
      const H = rows[hi].map(x => x.trim());
      const col = re => H.findIndex(x => re.test(x));
      const cR = col(/receipt/i), cT = col(/completion|time|date/i), cD = col(/details|description/i),
        cI = col(/paid.?in|credit/i), cS = col(/status/i);
      const inc = rows.slice(hi + 1).map(r => ({
        code: (r[cR] || '').trim().toUpperCase(), date: normDate(r[cT]), details: (r[cD] || '').trim(),
        amount: parseFloat(String(r[cI] || '').replace(/,/g, '')) || 0, status: cS >= 0 ? (r[cS] || '') : 'Completed'
      })).filter(x => x.code && x.amount > 0 && /complet/i.test(x.status || 'Completed'));
      if (!inc.length) throw new Error('No received payments found in this file.');
      const pays = must(await sb.from('payments').select('reference,amount,payment_date,payment_no,customers(name)')
        .eq('status', 'posted').eq('method', 'mpesa'));
      const used = new Set(), ign = getIgnored();
      const matched = [], possible = [], missing = [];
      inc.forEach(x => {
        const byRef = pays.find(p => p.reference && p.reference.trim().toUpperCase() === x.code);
        if (byRef) { matched.push(x); return; }
        const byAmt = pays.find(p => !used.has(p) && !p.reference && Number(p.amount) === x.amount && p.payment_date === x.date);
        if (byAmt) { used.add(byAmt); possible.push({ ...x, p: byAmt }); return; }
        if (!ign.has(x.code)) missing.push(x);
      });
      const sum = a => a.reduce((s, x) => s + x.amount, 0);
      $('#mr').innerHTML = `<div class="grid">
        <div class="stat good"><div class="k">Matched by M-Pesa code</div><div class="v">${matched.length}</div><div class="muted small-text">${money(sum(matched))}</div></div>
        <div class="stat"><div class="k">Probably recorded (same date and amount)</div><div class="v">${possible.length}</div><div class="muted small-text">${money(sum(possible))}</div></div>
        <div class="stat owe"><div class="k">Not in your records</div><div class="v">${missing.length}</div><div class="muted small-text">${money(sum(missing))}</div></div></div>
        <div class="card"><h2>Money received but not recorded</h2>
        ${missing.length ? `<p class="muted small-text">Record it against the customer who paid. If it was already recorded as part of a sale, choose Ignore.</p>
        <div class="tablewrap"><table><thead><tr><th>Date</th><th>Code</th><th>Details</th><th class="num">Amount</th><th>Customer</th><th></th></tr></thead><tbody>
        ${missing.map((x, i) => `<tr><td>${fmtDate(x.date)}</td><td>${esc(x.code)}</td><td>${esc(x.details)}</td><td class="num">${money(x.amount)}</td>
          <td><select data-c="${i}">${customers.length ? opts(customers, 'customer_id', c => c.name) : '<option value="">No customer owes money</option>'}</select></td>
          <td><button class="btn small primary" data-rec="${i}">Record</button> <button class="btn small" data-ign="${i}">Ignore</button></td></tr>`).join('')}
        </tbody></table></div>` : '<div class="empty">Everything in this statement is already in your records.</div>'}</div>
        ${possible.length ? `<div class="card"><h2>Probably recorded</h2><p class="muted small-text">These match a payment you recorded without an M-Pesa code.</p>
          <div class="tablewrap"><table><tbody>${possible.map(x => `<tr><td>${fmtDate(x.date)}</td><td>${esc(x.code)}</td>
          <td class="num">${money(x.amount)}</td><td>${esc(x.p.customers ? x.p.customers.name : 'Walk-in')} (${esc(x.p.payment_no)})</td></tr>`).join('')}</tbody></table></div></div>` : ''}`;
      $('#mr').onclick = async ev => {
        const b = ev.target.closest('button'); if (!b) return;
        if (b.dataset.ign !== undefined) {
          const s = getIgnored(); s.add(missing[+b.dataset.ign].code); saveIgnored(s);
          b.closest('tr').remove(); return;
        }
        if (b.dataset.rec === undefined) return;
        const x = missing[+b.dataset.rec], cust = $(`[data-c="${b.dataset.rec}"]`).value;
        await guard(b, async () => {
          if (!cust) throw new Error('Choose the customer who paid');
          must(await sb.rpc('receive_payment', { p_customer_id: cust, p_amount: x.amount, p_method: 'mpesa',
            p_reference: x.code, p_payment_date: x.date, p_idempotency_key: 'mpesa-' + x.code }));
          toast('Recorded'); b.closest('tr').remove();
        });
      };
    } catch (err) { $('#mr').innerHTML = `<div class="card err">${esc(err.message || err)}</div>`; }
  });
}


async function editCustomer(id) {
  const c = must(await sb.from('customers').select('*').eq('id', id).single());
  openModal(`<h2>Edit customer</h2>
    <label>Name <input id="ecN" value="${esc(c.name)}"></label>
    <div class="row"><label>Phone <input id="ecP" type="tel" value="${esc(c.phone || '')}"></label>
      <label>Type <select id="ecC"><option value="retail" ${c.category === 'retail' ? 'selected' : ''}>Retail</option>
        <option value="wholesale" ${c.category === 'wholesale' ? 'selected' : ''}>Wholesale</option></select></label></div>
    <div class="row"><label>Credit limit (empty = none) <input id="ecL" type="number" min="0" step="any" value="${c.credit_limit ?? ''}"></label>
      <label>Days to pay (optional) <input id="ecD" type="number" min="0" step="1" value="${c.default_due_days ?? ''}"></label></div>
    <label><input id="ecA" type="checkbox" ${c.is_active ? 'checked' : ''}> Active customer</label>
    <p class="muted small-text">The amount they owe cannot be edited here. It always follows their sales and payments.</p>
    <div class="actions"><button class="btn primary" id="ecGo">Save</button><button class="btn" data-close>Cancel</button></div>`);
  $('#ecGo').onclick = e => guard(e.currentTarget, async () => {
    const name = $('#ecN').value.trim(); if (!name) throw new Error('Enter the customer name');
    const { error } = await sb.from('customers').update({ name, phone: $('#ecP').value.trim() || null, category: $('#ecC').value,
      credit_limit: $('#ecL').value === '' ? null : num($('#ecL').value),
      default_due_days: $('#ecD').value === '' ? null : Math.round(num($('#ecD').value)), is_active: $('#ecA').checked }).eq('id', id);
    if (error) throw new Error(error.code === '23505' ? 'Another customer already has that phone number' : error.message);
    closeModal(); toast('Customer updated'); viewCustomers();
  });
}

/* ------------------------------------------------------------------ *
 * Daily report (on screen + PDF)
 * ------------------------------------------------------------------ */
const nice = v => ({ mpesa: 'M-Pesa', cash: 'Cash', bank: 'Bank' }[v] || String(v || '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()));
const mkTable = (head, rows, foot) => rows.length
  ? `<div class="tablewrap"><table><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody>${foot ? `<tfoot>${foot}</tfoot>` : ''}</table></div>`
  : '<div class="empty">Nothing recorded.</div>';

function dailyFigures(R) {
  const sales = Number(R.sales_total), cogs = Number(R.cogs), opex = Number(R.operating_expenses);
  const paid = Number(R.paid_at_sale), debt = Number(R.debt_payments);
  return { sales, cogs, opex, pers: Number(R.personal_expenses), paid, debt, received: paid + debt,
    credit: Math.max(0, sales - paid), gross: sales - cogs, net: sales - cogs - opex,
    closing: R.accounts.reduce((s, a) => s + Number(a.closing), 0),
    owedEnd: Number(R.receivables_end), owedStart: Number(R.receivables_start) };
}

function buildDailyPdf(R, biz, who) {
  if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('The PDF tool did not load. Check your internet connection and reload the page.');
  const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 40;
  const DARK = [7, 63, 95], BRAND = [10, 92, 138], AQUA = [27, 179, 199], INK = [13, 34, 48], MUTED = [100, 121, 138], SOFT = [243, 247, 250];
  const F = dailyFigures(R);
  const fm = n => 'KSh ' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const longDate = new Date(R.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  // header band
  doc.setFillColor(...DARK); doc.rect(0, 0, W, 94, 'F');
  doc.setFillColor(...AQUA); doc.rect(0, 94, W, 4, 'F');
  doc.setFillColor(255, 255, 255); doc.circle(M + 16, 58, 14, 'F');
  doc.triangle(M + 16 - 12.4, 50, M + 16 + 12.4, 50, M + 16, 24, 'F');
  doc.setFillColor(...AQUA); doc.circle(M + 11, 60, 4, 'F');
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(21);
  doc.text(biz.business_name || 'Wise Water', M + 42, 48);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(200, 225, 238);
  const contact = [biz.address, biz.phone, biz.email].filter(Boolean).join('   |   ');
  if (contact) doc.text(contact, M + 42, 64, { maxWidth: W - 2 * M - 220 });
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text('DAILY REPORT', W - M, 44, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
  doc.text(longDate, W - M, 60, { align: 'right' });
  doc.setFontSize(8); doc.setTextColor(200, 225, 238);
  doc.text('Prepared ' + new Date().toLocaleString('en-GB', { timeZone: 'Africa/Nairobi' }) + (who ? ' by ' + who : ''), W - M, 76, { align: 'right' });

  // KPI tiles
  let y = 116;
  const tiles = [
    ['Total sales', fm(F.sales), BRAND], ['Money received', fm(F.received), [20, 128, 90]],
    ['Sold on credit', fm(F.credit), [169, 106, 8]], ['Business expenses', fm(F.opex), INK],
    ['Gross profit', fm(F.gross), BRAND], ['Net profit (est.)', fm(F.net), F.net >= 0 ? [20, 128, 90] : [192, 57, 43]],
    ['Customers owe (end of day)', fm(F.owedEnd), [169, 106, 8]], ['Cash + M-Pesa (closing)', fm(F.closing), INK]];
  const tw = (W - 2 * M - 3 * 10) / 4, th = 50;
  tiles.forEach((t, i) => {
    const x = M + (i % 4) * (tw + 10), yy = y + Math.floor(i / 4) * (th + 10);
    doc.setFillColor(...SOFT); doc.roundedRect(x, yy, tw, th, 6, 6, 'F');
    doc.setFillColor(...t[2]); doc.rect(x, yy + 8, 3, th - 16, 'F');
    doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.text(t[0], x + 11, yy + 18, { maxWidth: tw - 14 });
    doc.setTextColor(...t[2]); doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text(t[1], x + 11, yy + 38, { maxWidth: tw - 14 });
  });
  y += 2 * (th + 10) + 6;
  doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
  doc.text(`${R.sales_count} sale(s) recorded` + (Number(R.voided_count) ? `, ${R.voided_count} voided` : '') +
    `.  Customer debt moved from ${fm(F.owedStart)} to ${fm(F.owedEnd)}.`, M, y);
  y += 16;

  const heading = (txt) => {
    if (y > H - 110) { doc.addPage(); y = 48; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...DARK); doc.text(txt, M, y);
    doc.setDrawColor(...AQUA); doc.setLineWidth(1.5); doc.line(M, y + 4, M + 28, y + 4);
    y += 12;
  };
  const note = txt => {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.setTextColor(...MUTED); doc.text(txt, M, y + 8); y += 22;
  };
  const table = (head, body, opt = {}) => {
    const cols = opt.cols || {};
    const al = (arr) => arr.map((h, i) => (cols[i] && cols[i].halign) ? { content: h, styles: { halign: cols[i].halign } } : h);
    doc.autoTable({
      startY: y + 2, head: [al(head)], body, foot: opt.foot ? [al(opt.foot)] : undefined, theme: 'plain',
      margin: { left: M, right: M, bottom: 50 },
      styles: { font: 'helvetica', fontSize: 8.5, cellPadding: { top: 4, bottom: 4, left: 5, right: 5 }, textColor: INK, lineColor: [221, 231, 238], lineWidth: { bottom: 0.5 } },
      headStyles: { fillColor: DARK, textColor: 255, fontStyle: 'bold', fontSize: 8 },
      footStyles: { fillColor: SOFT, textColor: DARK, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [249, 252, 253] },
      columnStyles: opt.cols || {}
    });
    y = doc.lastAutoTable.finalY + 16;
  };
  const R2 = { halign: 'right' };

  heading('Cash and M-Pesa for the day');
  table(['Account', 'Opening', 'Money in', 'Money out', 'Transfers', 'Closing'],
    R.accounts.map(a => [a.name, fm(a.opening), fm(a.money_in), fm(a.money_out), fm(a.transfers), fm(a.closing)]),
    { cols: { 1: R2, 2: R2, 3: R2, 4: R2, 5: R2 },
      foot: ['Total', fm(R.accounts.reduce((s, a) => s + Number(a.opening), 0)), fm(R.accounts.reduce((s, a) => s + Number(a.money_in), 0)),
        fm(R.accounts.reduce((s, a) => s + Number(a.money_out), 0)), fm(R.accounts.reduce((s, a) => s + Number(a.transfers), 0)), fm(F.closing)] });

  heading('Sales');
  if (R.sales.length) {
    table(['Receipt', 'Customer', 'Type', 'Served by', 'Total', 'Paid', 'On credit'],
      R.sales.map(s => [s.sale_no, s.customer, nice(s.price_type), s.staff || '-', fm(s.total), fm(s.paid), fm(Math.max(0, Number(s.total) - Number(s.paid)))]),
      { cols: { 4: R2, 5: R2, 6: R2 }, foot: ['', '', '', 'Total', fm(F.sales), fm(R.sales.reduce((s, x) => s + Number(x.paid), 0)), fm(F.credit)] });
  } else note('No sales were recorded on this date.');

  heading('Products sold');
  if (R.products.length) table(['Product', 'Quantity', 'Sales'], R.products.map(p => [p.name, Number(p.qty).toLocaleString('en-US'), fm(p.revenue)]), { cols: { 1: R2, 2: R2 } });
  else note('No products were sold.');

  heading('Payments received on customer debts');
  if (R.debt_payment_list.length) {
    table(['Payment', 'Customer', 'Method', 'M-Pesa code', 'Amount'],
      R.debt_payment_list.map(p => [p.payment_no, p.customer, nice(p.method), p.reference || '-', fm(p.amount)]),
      { cols: { 4: R2 }, foot: ['', '', '', 'Total', fm(F.debt)] });
  } else note('No debt payments were received.');

  if (R.by_method.length) {
    heading('All money received, by method');
    table(['Method', 'Amount'], R.by_method.map(m => [nice(m.method), fm(m.amount)]), { cols: { 1: R2 }, foot: ['Total', fm(F.received)] });
  }

  heading('Expenses');
  if (R.expense_list.length) {
    table(['Category', 'Description', 'Paid by', 'Amount'],
      R.expense_list.map(e => [e.category + (e.personal ? ' (personal)' : ''), e.description, nice(e.method), fm(e.amount)]),
      { cols: { 3: R2 }, foot: ['', '', 'Total', fm(F.opex + F.pers)] });
  } else note('No expenses were recorded.');

  if (R.purchases.length || R.production.length) {
    heading('Purchases and production');
    if (R.purchases.length) table(['Supplier', 'Type', 'Total'], R.purchases.map(p => [p.supplier || '-', nice(p.kind), fm(p.total)]), { cols: { 2: R2 } });
    if (R.production.length) table(['Made', 'Quantity', 'Damaged'], R.production.map(p => [p.item, p.produced, p.damaged]), { cols: { 1: R2, 2: R2 } });
  }
  if (R.low_stock.length) {
    heading('Low stock alerts');
    table(['Item', 'In stock'], R.low_stock.map(s => [s.name, s.on_hand + ' ' + s.unit]), { cols: { 1: R2 } });
  }

  // notes + signatures
  if (F.sales > 0 && F.cogs === 0) { doc.setFontSize(8); doc.setFont('helvetica', 'italic'); doc.setTextColor(169, 106, 8);
    doc.text('Note: product cost prices are not entered, so gross and net profit are overstated.', M, y); y += 14; }
  if (y > H - 120) { doc.addPage(); y = 60; }
  y += 18;
  doc.setDrawColor(...MUTED); doc.setLineWidth(0.6);
  doc.line(M, y + 24, M + 190, y + 24); doc.line(W - M - 190, y + 24, W - M, y + 24);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...MUTED);
  doc.text('Prepared by', M, y + 37); doc.text('Checked by', W - M - 190, y + 37);

  // footer on every page
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setDrawColor(221, 231, 238); doc.setLineWidth(0.6); doc.line(M, H - 34, W - M, H - 34);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED);
    doc.text((biz.business_name || 'Wise Water') + '  |  Daily report ' + R.date, M, H - 20);
    doc.text('Page ' + i + ' of ' + n, W - M, H - 20, { align: 'right' });
  }
  return doc;
}

async function viewDaily() {
  const t = todayStr();
  set(`<div class="pagehead"><div><h1>Daily report</h1><div class="sub">Your end-of-day summary. Download it as a PDF or share it.</div></div></div>
    <div class="card"><div class="row"><label>Date <input id="dd" type="date" value="${t}" max="${t}"></label>
      <div class="fixed"><button id="dGo" class="btn primary">${ic('file')}Generate report</button></div></div></div>
    <div id="dOut"></div>`);
  let R = null;
  const slug = (state.biz.business_name || 'Wise-Water').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const fname = () => `${slug}-Daily-Report-${R.date}.pdf`;
  const draw = () => {
    const F = dailyFigures(R);
    $('#dOut').innerHTML = `
      <div class="card"><div class="pagehead" style="margin:0"><div><h2 style="margin:0">${esc(fmtLong(R.date))}</h2>
        <span class="muted small-text">${R.sales_count} sale(s)${Number(R.voided_count) ? ', ' + R.voided_count + ' voided' : ''}</span></div>
        <div class="btn-row"><button class="btn primary" data-act="pdf">${ic('download')}Download PDF</button>
        <button class="btn" data-act="share">${ic('share')}Share</button></div></div></div>
      <div class="grid g4">
        ${statCard('', 'cart', 'Total sales', money(F.sales))}
        ${statCard('good', 'wallet', 'Money received', money(F.received), 'Paid at sale ' + money(F.paid) + ' | Debts ' + money(F.debt))}
        ${statCard('owe', 'receipt', 'Sold on credit', money(F.credit))}
        ${statCard('', 'coins', 'Business expenses', money(F.opex))}
        ${statCard('', 'trend', 'Gross profit', money(F.gross))}
        ${statCard('good', 'trend', 'Net profit (estimate)', money(F.net))}
        ${statCard('owe', 'users', 'Customers owe (end of day)', money(F.owedEnd), 'Start of day ' + money(F.owedStart))}
        ${statCard('', 'book', 'Cash + M-Pesa (closing)', money(F.closing))}
      </div>
      <div class="card"><h2>Cash and M-Pesa</h2>${mkTable('<th>Account</th><th class="num">Opening</th><th class="num">In</th><th class="num">Out</th><th class="num">Transfers</th><th class="num">Closing</th>',
        R.accounts.map(a => `<tr><td>${esc(a.name)}</td><td class="num">${money(a.opening)}</td><td class="num">${money(a.money_in)}</td><td class="num">${money(a.money_out)}</td><td class="num">${money(a.transfers)}</td><td class="num"><b>${money(a.closing)}</b></td></tr>`))}</div>
      <div class="card"><h2>Sales</h2>${mkTable('<th>Receipt</th><th>Customer</th><th>Type</th><th>Served by</th><th class="num">Total</th><th class="num">Paid</th><th class="num">On credit</th>',
        R.sales.map(s => `<tr><td>${esc(s.sale_no)}</td><td>${esc(s.customer)}</td><td>${esc(nice(s.price_type))}</td><td>${esc(s.staff || '-')}</td><td class="num">${money(s.total)}</td><td class="num">${money(s.paid)}</td><td class="num">${money(Math.max(0, s.total - s.paid))}</td></tr>`))}</div>
      <div class="card"><h2>Products sold</h2>${mkTable('<th>Product</th><th class="num">Quantity</th><th class="num">Sales</th>',
        R.products.map(p => `<tr><td>${esc(p.name)}</td><td class="num">${Number(p.qty).toLocaleString('en-KE')}</td><td class="num">${money(p.revenue)}</td></tr>`))}</div>
      <div class="card"><h2>Debt payments received</h2>${mkTable('<th>Payment</th><th>Customer</th><th>Method</th><th>Code</th><th class="num">Amount</th>',
        R.debt_payment_list.map(p => `<tr><td>${esc(p.payment_no)}</td><td>${esc(p.customer)}</td><td>${esc(nice(p.method))}</td><td>${esc(p.reference || '-')}</td><td class="num">${money(p.amount)}</td></tr>`))}</div>
      <div class="card"><h2>Expenses</h2>${mkTable('<th>Category</th><th>Description</th><th>Paid by</th><th class="num">Amount</th>',
        R.expense_list.map(e => `<tr><td>${esc(e.category)}${e.personal ? ' <span class="pill">Personal</span>' : ''}</td><td>${esc(e.description)}</td><td>${esc(nice(e.method))}</td><td class="num">${money(e.amount)}</td></tr>`))}</div>`;
  };
  const build = async () => { R = must(await sb.rpc('daily_report', { p_date: $('#dd').value })); draw(); };
  $('#dGo').addEventListener('click', e => guard(e.currentTarget, build));
  $('#dd').addEventListener('change', () => build().catch(err => toast(err.message, 'err')));
  $('#dOut').onclick = e => {
    const b = e.target.closest('[data-act]'); if (!b || !R) return;
    guard(b, async () => {
      const doc = buildDailyPdf(R, state.biz, state.profile.full_name);
      if (b.dataset.act === 'pdf') { doc.save(fname()); toast('PDF downloaded'); return; }
      const file = new File([doc.output('blob')], fname(), { type: 'application/pdf' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: 'Daily report ' + R.date, text: (state.biz.business_name || 'Wise Water') + ' daily report ' + R.date }); }
        catch (err) { if (err && err.name !== 'AbortError') throw err; }
      } else { doc.save(fname()); toast('Sharing is not available here, so the PDF was downloaded. Send it from your files.'); }
    });
  };
  await build();
}

/* ------------------------------------------------------------------ *
 * Users and access (super admin)
 * ------------------------------------------------------------------ */
async function viewUsers() {
  const U = must(await sb.from('profiles').select('*').order('created_at')), me = state.profile.id;
  const pend = U.filter(u => !u.is_active), act = U.filter(u => u.is_active);
  const row = u => `<tr ${u.is_active ? '' : 'style="background:var(--warn-bg)"'}>
    <td><b>${esc(u.full_name || '(no name)')}</b>${u.id === me ? ' <span class="pill">You</span>' : ''}<br><span class="muted small-text">${esc(u.email || '')}</span></td>
    <td><select data-ur="${u.id}" ${u.id === me ? 'disabled' : ''}>
      <option value="staff" ${u.role === 'staff' ? 'selected' : ''}>Staff</option>
      <option value="owner" ${u.role === 'owner' ? 'selected' : ''}>Owner</option>
      <option value="super_admin" ${u.role === 'super_admin' ? 'selected' : ''}>Super admin</option></select></td>
    <td>${u.is_active ? '<span class="pill good">Active</span>' : '<span class="pill owe">Waiting</span>'}</td>
    <td class="muted small-text">${fmtDate((u.created_at || '').slice(0, 10))}</td>
    <td>${u.id === me ? '' : u.is_active
      ? `<button class="btn small" data-us="${u.id}">Save role</button> <button class="btn small danger" data-off="${u.id}">Disable</button>`
      : `<button class="btn small primary" data-on="${u.id}">Approve</button>`}</td></tr>`;
  set(`<div class="pagehead"><div><h1>Users and access</h1><div class="sub">Approve new staff and choose what each person can do.</div></div></div>
    ${pend.length ? `<div class="card" style="border-color:#f1d9a8"><h2>${ic('alert')} Waiting for approval (${pend.length})</h2>
      <div class="tablewrap"><table><thead><tr><th>Person</th><th>Role</th><th>Status</th><th>Requested</th><th></th></tr></thead><tbody>${pend.map(row).join('')}</tbody></table></div></div>` : ''}
    <div class="card"><h2>Team (${act.length})</h2>
      <div class="tablewrap"><table><thead><tr><th>Person</th><th>Role</th><th>Status</th><th>Joined</th><th></th></tr></thead><tbody>${act.map(row).join('')}</tbody></table></div></div>
    <div class="card"><h2>What each role can do</h2><dl class="kv">
      <dt>Staff</dt><dd style="text-align:left;font-weight:500">${esc(ROLE_HELP.staff)}</dd>
      <dt>Owner</dt><dd style="text-align:left;font-weight:500">${esc(ROLE_HELP.owner)}</dd>
      <dt>Super admin</dt><dd style="text-align:left;font-weight:500">${esc(ROLE_HELP.super_admin)}</dd></dl>
      <p class="muted small-text" style="margin-top:.75rem">New people create their own account with <b>Request access</b> on the sign-in page. They cannot see anything until you approve them here. You cannot change your own role.</p></div>`);
  view().onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    guard(b, async () => {
      const id = b.dataset.us || b.dataset.on || b.dataset.off, sel = document.querySelector(`[data-ur="${id}"]`);
      const patch = { role: sel.value };
      if (b.dataset.on) patch.is_active = true;
      if (b.dataset.off) { if (!confirm('Disable this person? They will no longer be able to use the system.')) return; patch.is_active = false; }
      const { error } = await sb.from('profiles').update(patch).eq('id', id);
      if (error) throw error;
      toast(b.dataset.on ? 'Approved' : b.dataset.off ? 'Disabled' : 'Saved');
      await viewUsers(); refreshPendingBadge().catch(() => {});
    });
  };
}

/* ------------------------------------------------------------------ *
 * Audit log (super admin)
 * ------------------------------------------------------------------ */
async function viewAudit() {
  const [logs, users] = await Promise.all([
    sb.from('audit_logs').select('*').order('id', { ascending: false }).limit(300),
    sb.from('profiles').select('id,full_name,email')]);
  const L = must(logs), name = Object.fromEntries(must(users).map(u => [u.id, u.full_name || u.email || 'User']));
  const tables = [...new Set(L.map(x => x.table_name))].sort();
  set(`<div class="pagehead"><div><h1>Audit log</h1><div class="sub">A permanent record of important changes. Nothing here can be edited.</div></div></div>
    <div class="card"><label>Show <select id="af"><option value="">All records</option>${tables.map(t => `<option>${esc(t)}</option>`).join('')}</select></label>
    <div id="al"></div></div>`);
  const draw = () => {
    const f = $('#af').value, r = L.filter(x => !f || x.table_name === f);
    $('#al').innerHTML = mkTable('<th>When</th><th>Who</th><th>Action</th><th>Record</th><th></th>', r.map(x => `<tr>
      <td>${esc(new Date(x.created_at).toLocaleString('en-GB', { timeZone: 'Africa/Nairobi', dateStyle: 'medium', timeStyle: 'short' }))}</td>
      <td>${esc(name[x.user_id] || (x.user_id ? 'User' : 'System'))}</td>
      <td><span class="pill ${x.action === 'DELETE' ? 'bad' : x.action === 'INSERT' ? 'good' : ''}">${esc(x.action)}</span></td>
      <td>${esc(x.table_name)}</td><td><button class="btn small" data-id="${x.id}">Details</button></td></tr>`));
  };
  draw();
  $('#af').addEventListener('change', draw);
  view().onclick = e => {
    const b = e.target.closest('[data-id]'); if (!b) return;
    const x = L.find(r => String(r.id) === b.dataset.id);
    const js = o => esc(JSON.stringify(o, null, 2));
    openModal(`<h2>${esc(x.action)} on ${esc(x.table_name)}</h2>
      ${x.old_data ? `<h3>Before</h3><pre class="json">${js(x.old_data)}</pre>` : ''}
      ${x.new_data ? `<h3>After</h3><pre class="json">${js(x.new_data)}</pre>` : ''}
      <div class="actions"><button class="btn" data-close>Close</button></div>`, true);
  };
}

/* ------------------------------------------------------------------ *
 * My account
 * ------------------------------------------------------------------ */
async function viewAccount() {
  const p = state.profile;
  set(`<div class="pagehead"><h1>My account</h1></div>
    <div class="card"><div class="row" style="align-items:center"><span class="avatar" style="width:56px;height:56px;font-size:1.4rem;flex:none;background:linear-gradient(135deg,var(--aqua),#2e8fd0);color:#fff">${esc((p.full_name || '?').charAt(0).toUpperCase())}</span>
      <div><h2 style="margin:0">${esc(p.full_name || '')}</h2><div class="muted">${esc(state.email)}</div>
      <span class="pill dark">${esc(ROLE_LABEL[p.role] || p.role)}</span></div></div>
      <p class="muted" style="margin-top:.9rem">${esc(ROLE_HELP[p.role] || '')}</p></div>
    <div class="card"><h2>Security</h2><p class="muted small-text">You are signed out automatically after 30 minutes without activity.</p>
      <button id="chPw" class="btn primary">Change password</button> <button id="outBtn" class="btn">${ic('logout')}Sign out</button></div>`);
  $('#chPw').addEventListener('click', () => openPasswordModal(false));
  $('#outBtn').addEventListener('click', () => signOutNow(''));
}

boot().catch(e => {
  $('#setup').innerHTML = `<div class="login-card"><h1>Could not start</h1><p>${esc(e.message || e)}</p></div>`;
  showOnly('setup');
});
})();
