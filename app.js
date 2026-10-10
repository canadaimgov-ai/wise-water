(() => {
'use strict';

/* ------------------------------------------------------------------ *
 * Setup
 * ------------------------------------------------------------------ */
const cfg = window.APP_CONFIG || {};
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

const state = { profile: null, biz: { business_name: 'Water Station', receipt_footer: '' } };
const isOwner = () => state.profile && state.profile.role === 'owner';
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
  ['setup', 'login', 'shell'].forEach(x => { $('#' + x).hidden = x !== id; });
}

async function boot() {
  if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes('PASTE')) {
    $('#setup').innerHTML = `<div class="login-card"><h1>One step left</h1>
      <p>Open <b>config.js</b> and paste your Supabase <b>Project URL</b>
      (it looks like https://abcdxyz.supabase.co), then reload this page.</p></div>`;
    showOnly('setup'); return;
  }
  sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY);

  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.submitter; $('#loginErr').textContent = '';
    btn.disabled = true;
    const { error } = await sb.auth.signInWithPassword({
      email: $('#email').value.trim(), password: $('#password').value });
    btn.disabled = false;
    if (error) { $('#loginErr').textContent = 'Could not sign in: ' + error.message; return; }
    await enter();
  });
  $('#logoutBtn').addEventListener('click', async () => {
    await sb.auth.signOut(); state.profile = null; showOnly('login');
  });
  $('#menuBtn').addEventListener('click', () => $('#nav').classList.toggle('open'));
  $('#nav').addEventListener('click', e => { if (e.target.closest('a')) $('#nav').classList.remove('open'); });
  window.addEventListener('hashchange', route);

  const { data } = await sb.auth.getSession();
  if (data.session) await enter(); else showOnly('login');
}

async function enter() {
  const { data: u } = await sb.auth.getUser();
  if (!u || !u.user) { showOnly('login'); return; }
  const { data: p, error } = await sb.from('profiles').select('*').eq('id', u.user.id).maybeSingle();
  if (error || !p || !p.is_active) {
    await sb.auth.signOut(); showOnly('login');
    $('#loginErr').textContent = 'This account is not active. Ask the owner to activate it.';
    return;
  }
  state.profile = p;
  const { data: b } = await sb.from('business_settings').select('*').eq('id', 1).maybeSingle();
  if (b) state.biz = b;
  $('#bizName').textContent = $('#brand').textContent = state.biz.business_name;
  $('#who').textContent = `${p.full_name || ''} (${p.role})`;
  showOnly('shell');
  if (!location.hash) location.hash = '#dashboard'; else route();
}

/* ------------------------------------------------------------------ *
 * Router
 * ------------------------------------------------------------------ */
const routes = {
  dashboard: viewDashboard, sell: viewSell, sales: viewSales, customers: viewCustomers,
  payment: viewPayment, expenses: viewExpenses, products: viewProducts
};
async function route() {
  if (!state.profile) return;
  const key = (location.hash || '#dashboard').slice(1);
  const fn = routes[key] || viewDashboard;
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.r === key));
  view().onclick = null;
  set('<p class="muted">Loading...</p>');
  try { await fn(); } catch (e) {
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

async function viewDashboard() {
  const t = todayStr(), ms = monthStart(t), [pf, pt] = prevMonthRange(t);
  const [day, mon, prev, accts, debtors, stock] = await Promise.all([
    sb.rpc('period_summary', { p_from: t, p_to: t }),
    sb.rpc('period_summary', { p_from: ms, p_to: t }),
    sb.rpc('period_summary', { p_from: pf, p_to: pt }),
    sb.from('cash_balances').select('*'),
    sb.from('customer_balances').select('*').gt('balance', 0).order('balance', { ascending: false }),
    sb.from('inventory_stock').select('*').gt('reorder_level', 0).eq('is_low', true)
  ]);
  const D = must(day), M = must(mon), P = must(prev);
  const A = must(accts), C = must(debtors), S = must(stock);
  const owed = C.reduce((s, c) => s + Number(c.balance), 0);
  const cashTotal = A.reduce((s, a) => s + Number(a.balance), 0);
  const credToday = Math.max(0, D.sales - D.paid_at_sale);
  const gross = M.sales - M.cogs, net = gross - M.operating_expenses;
  const growth = P.sales > 0 ? ((M.sales - P.sales) / P.sales) * 100 : null;
  const overdue = C.filter(c => Number(c.overdue_amount) > 0);

  set(`
    <div class="pagehead"><h1>Today</h1>
      <span><a class="btn primary" href="#sell">New sale</a>
      <a class="btn" href="#payment">Receive payment</a></span></div>
    <div class="grid">
      <div class="stat"><div class="k">Sales today</div><div class="v">${money(D.sales)}</div></div>
      <div class="stat good"><div class="k">Cash received today</div><div class="v">${money(D.cash_received)}</div></div>
      <div class="stat"><div class="k">Sold on credit today</div><div class="v">${money(credToday)}</div></div>
      <div class="stat"><div class="k">Expenses today</div><div class="v">${money(D.operating_expenses + D.personal_expenses)}</div></div>
      <div class="stat owe"><div class="k">Customers owe you</div><div class="v">${money(owed)}</div></div>
      <div class="stat"><div class="k">Money in hand</div><div class="v">${money(cashTotal)}</div>
        <div class="muted small-text">${A.map(a => esc(a.name) + ' ' + money(a.balance)).join(' | ')}</div></div>
    </div>

    <div class="card"><h2>This month</h2>
      <div class="grid" style="margin:0">
        <div class="stat"><div class="k">Sales</div><div class="v">${money(M.sales)}</div></div>
        <div class="stat"><div class="k">Gross profit</div><div class="v">${money(gross)}</div></div>
        <div class="stat"><div class="k">Business expenses</div><div class="v">${money(M.operating_expenses)}</div></div>
        <div class="stat good"><div class="k">Net profit (estimate)</div><div class="v">${money(net)}</div></div>
        <div class="stat"><div class="k">Growth vs same days last month</div>
          <div class="v">${growth === null ? 'Not available' : (growth >= 0 ? '+' : '') + growth.toFixed(1) + '%'}</div></div>
      </div>
      ${M.sales > 0 && M.cogs === 0 ? `<p class="muted small-text">Profit looks too high because product
        <b>cost prices are 0</b>. Enter them in Products and prices.</p>` : ''}
      ${M.personal_expenses > 0 ? `<p class="muted small-text">${money(M.personal_expenses)} of personal
        expenses (such as house rent) is left out of business profit.</p>` : ''}
    </div>

    <div class="card"><h2>Who owes you</h2>
      ${C.length ? `<div class="tablewrap"><table><thead><tr><th>Customer</th><th>Phone</th>
        <th class="num">Balance</th><th></th></tr></thead><tbody>
        ${C.slice(0, 10).map(c => `<tr><td>${esc(c.name)}</td><td>${esc(c.phone || '')}</td>
          <td class="num">${money(c.balance)}</td>
          <td>${Number(c.overdue_amount) > 0 ? '<span class="pill bad">Overdue</span>' : ''}</td></tr>`).join('')}
        </tbody></table></div>
        ${overdue.length ? `<p class="small-text"><b>${overdue.length}</b> customer(s) are past their due date.</p>` : ''}`
        : '<div class="empty">No one owes you money.</div>'}
    </div>
    ${S.length ? `<div class="card"><h2>Low stock</h2>${S.map(s =>
      `<div class="balance-line"><span>${esc(s.name)}</span><span>${s.on_hand} ${esc(s.unit)}</span></div>`).join('')}</div>` : ''}
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

    <div class="card"><div class="tablewrap"><table>
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
      <td><input data-i="${i}" data-f="qty" type="number" min="1" step="1" value="${l.qty}" inputmode="decimal"></td>
      <td><input data-i="${i}" data-f="price" type="number" min="0" step="1" value="${l.price}" inputmode="decimal" ${canEdit() ? '' : 'disabled'}></td>
      <td class="num" id="lt${i}">${money(l.qty * l.price)}</td>
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
    ${state.biz.phone ? `<div class="c">${esc(state.biz.phone)}</div>` : ''}
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
      <td><button class="btn small" data-st="${c.customer_id}">Statement</button></td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">No customers yet. Add your first one above.</div>';
  };
  draw();
  $('#q').addEventListener('input', draw);
  $('#cl2').addEventListener('click', e => {
    const b = e.target.closest('[data-st]');
    if (b) showStatement(b.dataset.st).catch(err => toast(err.message, 'err'));
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
    <p class="muted">${esc(state.biz.business_name)} - statement as at ${fmtDate(todayStr())}</p>
    <div class="tablewrap"><table><thead><tr><th>Date</th><th>Details</th><th class="num">Bought</th><th class="num">Paid</th><th class="num">Balance</th></tr></thead>
    <tbody><tr><td></td><td>Opening balance</td><td></td><td></td><td class="num">${Number(cu.opening_balance).toLocaleString('en-KE')}</td></tr>${body}</tbody></table></div>
    <div class="balance-line"><span>Amount owed now</span><span>${money(cu.balance)}</span></div></div>
    <div class="actions"><button class="btn primary" id="prBtn">Print / save PDF</button><button class="btn" data-close>Close</button></div>`, true);
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
      : '<div class="empty">No customer owes you money right now.</div>'}</div>`);
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
}

/* ------------------------------------------------------------------ *
 * Expenses
 * ------------------------------------------------------------------ */
async function viewExpenses() {
  const [cats, accounts, list] = await Promise.all([
    sb.from('expense_categories').select('*').order('name'), loadAccounts(),
    sb.from('expenses').select('*, expense_categories(name,kind)').order('expense_date', { ascending: false })
      .order('created_at', { ascending: false }).limit(60)]);
  const C = must(cats), L = must(list);
  set(`<div class="pagehead"><h1>Expenses</h1>
      <button id="gen" class="btn">Add today's daily and monthly expenses</button></div>
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
      <td>${x.status === 'voided' ? '<span class="pill bad">Voided</span>' : isOwner() ? `<button class="btn small danger" data-vd="${x.id}">Void</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">No expenses recorded yet.</div>'}</div>`);

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
    const b = e.target.closest('[data-vd]'); if (!b) return;
    const reason = prompt('Why are you voiding this expense? (required)');
    if (!reason || !reason.trim()) return;
    try { must(await sb.rpc('void_expense', { p_expense_id: b.dataset.vd, p_reason: reason.trim() }));
      toast('Expense voided'); viewExpenses(); } catch (err) { toast(err.message, 'err'); }
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
      <th>Cost</th>${owner ? '<th>Active</th><th></th>' : ''}</tr></thead><tbody>
      ${P.map(p => `<tr><td>${esc(p.name)}</td><td>${cell(p, 'retail_price', p.retail_price)}</td>
        <td>${cell(p, 'wholesale_price', p.wholesale_price)}</td><td>${cell(p, 'cost_price', p.cost_price)}</td>
        ${owner ? `<td><input type="checkbox" style="min-height:0;width:auto" data-id="${p.id}" data-f="is_active" ${p.is_active ? 'checked' : ''}></td>
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

boot().catch(e => {
  $('#setup').innerHTML = `<div class="login-card"><h1>Could not start</h1><p>${esc(e.message || e)}</p></div>`;
  showOnly('setup');
});
})();
