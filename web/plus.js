/* George's Assistant — Connie Plus (v1.2, 2026-11-21) — web/plus.js
   Owner and creator: George Wederski.
   © 2026 George Wederski. All rights reserved. No part of this book/app may be copied, reproduced, or shared without written permission from George Wederski.
   Loaded after app.js. Adds: the Today screen (morning briefing, reminders,
   business watch, bills, separate business books, receipt reading, make
   products & marketing), "Hey Connie" wake word, reminders that speak and
   notify, offline mode, live connectors (Stripe, Google Calendar, Google
   Drive, email, nightly Drive backup) and memory upgrades (pin, topics,
   smart search, Connie offering to remember things — she always asks first).
   Rules kept from v1.1: Connie asks first, every time. She never pays,
   sends, buys, sells or publishes on her own. */
"use strict";

const ACCOUNTS = ["George's Little Handy Books", "ALI — All-in-One Superbot", "People's Bot", "GDP — George's Digital Products", "Next Gen Production & Studios", "G.W. Clothing Co", "George's Ad Agency — Gillette", "Personal"];
const P = {briefing: null, watch: null, books: null, bills: null, conn: null, due: [], upcoming: [], alerted: new Set(), receipt: null, backup: null};
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage full */ } };
function gateBody(extra) { return Object.assign({voice_token: voiceToken || undefined, passcode_token: passcodeToken || undefined}, extra || {}); }
function gateQuery() { const q = []; if (voiceToken) q.push("voice_token=" + encodeURIComponent(voiceToken)); if (passcodeToken) q.push("passcode_token=" + encodeURIComponent(passcodeToken)); return q.join("&"); }

/* ---------- new fields: separate accounts + bills ---------- */
FIELDS.transactions.splice(2, 0, ["account", "Business / account", "account"]);
FIELDS.invoices.splice(1, 0, ["account", "Business / account", "account"]);
FIELDS.bills = [["payee", "Who the bill is from", "text", 1], ["amount", "Amount ($)", "number"], ["due", "Due date", "date"], ["account", "Business / account", "account"], ["category", "Category", "text"], ["status", "Status", "select:Waiting for George,Approved by George,George said not yet,Paid"], ["notes", "Notes", "textarea"]];
FIELDS.reminders = [["title", "Reminder", "text", 1], ["due", "Due date", "date"], ["at", "Exact time (optional)", "datetime-local"], ["repeat", "Repeat", "select:,daily,weekly,monthly"], ["done", "Done", "checkbox"]];
const _fieldHtml = fieldHtml;
fieldHtml = function (kind, f, val) {
  if (f[2] === "account") {
    return `<label>${esc(f[1])}<input name="${f[0]}" list="acctList" value="${esc(val ?? "")}" placeholder="Which business?"></label>
      <datalist id="acctList">${ACCOUNTS.map(a => `<option value="${esc(a)}">`).join("")}</datalist>`;
  }
  return _fieldHtml(kind, f, val);
};

/* ---------- offline mode ---------- */
const _api = api;
api = async function (path, opts = {}) {
  const method = opts.method || "GET";
  try {
    const d = await _api(path, opts);
    if (method === "GET" && path === "/api/records") lsSet("connie_offline_records", {saved: Date.now(), data: d});
    return d;
  } catch (err) {
    const offline = !navigator.onLine || err instanceof TypeError;
    if (!offline) throw err;
    if (method === "GET" && path === "/api/records") {
      const c = lsGet("connie_offline_records", null);
      if (c) { flash("You're offline — showing what I had saved on this phone. Changes will be sent when you're back online."); return c.data; }
    }
    if (path.startsWith("/api/records") && method !== "GET") {
      const box = lsGet("connie_outbox", []); box.push({path, opts, at: Date.now()}); lsSet("connie_outbox", box);
      const c = lsGet("connie_offline_records", {data: {records: []}});
      if (method === "POST" && opts.body) c.data.records.unshift({id: "offline-" + Date.now(), kind: opts.body.kind, data: opts.body.data, created: Math.floor(Date.now() / 1000)});
      lsSet("connie_offline_records", c);
      return {id: "offline", queued: true, offline: true};
    }
    throw new Error("You're offline — this needs a connection. Try again when you're back online.");
  }
};
async function flushOutbox() {
  const box = lsGet("connie_outbox", []); if (!box.length || !token) return;
  const left = [];
  for (const item of box) {
    if (String(item.path).includes("/offline-")) continue;   // edits to an offline-only record: the POST carries it
    try { await _api(item.path, item.opts); } catch (e) { if (e instanceof TypeError) left.push(item); }
  }
  lsSet("connie_outbox", left);
  if (box.length > left.length) { await loadAll(); flash(`Back online — I sent ${box.length - left.length} change(s) you made offline.`, true); if (currentTab) showTab(currentTab); }
}
window.addEventListener("online", flushOutbox);

/* ---------- Today tab ---------- */
TABS.splice(1, 0, ["today", "Today"]);
const _showTab = showTab;
showTab = function (id) {
  if (id === "today") { if (pendingPermission) { const p = pendingPermission; pendingPermission = null; p.resolve(false); } currentTab = id; renderTabs(); flash(""); return renderToday($("#view")); }
  const out = _showTab(id);
  if (id === "integrations") addLiveConnectorsPanel();
  if (id === "learning") addMemoryPanel();
  if (id === "money") addBooksToMoney();
  if (id === "assistant") addWakePanel();
  return out;
};

function alertHtml(a) {
  const icon = {high: "🔴", medium: "🟠", info: "🔵"}[a.level] || "•";
  return `<li>${icon} <strong>${esc(a.area)}:</strong> ${esc(a.text)} <button class="small secondary" onclick="showTab('${esc(a.tab)}')">Open</button></li>`;
}
function renderToday(v) {
  const b = P.briefing;
  v.innerHTML = `
  <div class="panel"><h2>☀️ Today with Connie</h2>
    <div class="row">
      <button type="button" onclick="playBriefing()">☀️ Give me my briefing</button>
      <button type="button" class="secondary" onclick="refreshToday()">Refresh</button>
      <label class="chk"><input type="checkbox" ${lsGet("connie_auto_briefing", true) ? "checked" : ""} onchange="lsSetPub('connie_auto_briefing', this.checked)"> Read my briefing out loud the first time I open Connie each morning</label>
    </div>
    <div id="briefingBox">${b ? b.sections.map(s => `<h3>${esc(s.title)}</h3><ul>${s.items.map(i => `<li>${esc(i)}</li>`).join("")}</ul>${s.note ? `<p class="muted">${esc(s.note)}</p>` : ""}`).join("") : `<p class="muted">Tap "Give me my briefing" — I'll read your day out loud.</p>`}</div>
  </div>

  <div class="panel"><h2>⏰ Reminders</h2>
    <form onsubmit="event.preventDefault();quickReminder(this)" class="row">
      <input name="text" placeholder='e.g. "call Smith tomorrow at 3pm", "pay rent every month on the 1st", "in 20 minutes check the oven"' style="flex:1">
      <button>Remind me</button>
    </form>
    <p class="muted">I speak up and pop a notice when a reminder is due — while Connie is open on your phone or computer. <button class="small secondary" onclick="askNotify()">Allow pop-up notices</button></p>
    <div id="dueBox">${remindersHtml()}</div>
  </div>

  <div class="panel"><h2>👀 Business watch</h2>
    <p class="muted">I keep an eye on things and point them out. I only look — I don't change, send or pay anything.</p>
    <ul id="watchBox">${P.watch ? (P.watch.length ? P.watch.map(alertHtml).join("") : "<li>✅ Nothing needs your attention. Everything looks good.</li>") : "<li class='muted'>Checking…</li>"}</ul>
  </div>

  <div class="panel"><h2>🧾 Bills — I ask first, always</h2>
    <p class="muted">When a bill comes in under your name, add it here (or snap it with Read a receipt). I'll warn you before it's due and ask <strong>"Can I pay this?"</strong> I never pay a bill on my own. No bank is connected yet, so after you say yes you pay it from your bank, then tap Mark paid and I book it to the right business.</p>
    <div id="billsBox">${billsHtml()}</div>
    <details><summary>Add a bill</summary>${renderKind("bills", "New bill")}</details>
  </div>

  <div class="panel"><h2>📒 Each business, separate</h2><div id="booksBox">${booksHtml()}</div></div>

  <div class="panel"><h2>📸 Read a receipt</h2>
    <p class="muted">Take a photo of a receipt. I read the store, date, total, tax and category and make a draft expense — you check it, pick the business, then save. The photo itself is not kept. Needs a brain (AI key) on the server.</p>
    <input type="file" accept="image/*" capture="environment" onchange="readReceipt(this.files[0])">
    <div id="receiptBox">${receiptHtml()}</div>
  </div>

  <div class="panel"><h2>🚀 Make products & marketing</h2>
    <p class="muted">Pick a business and I'll write it for you with the live brain. Everything is a <strong>draft</strong> — you check it and decide; I never publish, post, advertise or spend on my own.</p>
    <div class="row"><select id="makeAcct">${ACCOUNTS.filter(a => a !== "Personal").map(a => `<option>${esc(a)}</option>`).join("")}</select></div>
    <div class="row">
      <button type="button" class="secondary" onclick="makeIt('research')">🔎 What do customers want?</button>
      <button type="button" class="secondary" onclick="makeIt('product')">📦 New digital product idea + draft</button>
      <button type="button" class="secondary" onclick="makeIt('ad')">📣 Write 3 ads</button>
      <button type="button" class="secondary" onclick="makeIt('posts')">📱 A week of posts</button>
      <button type="button" class="secondary" onclick="makeIt('plan')">🗺️ 30-day marketing plan</button>
      <button type="button" class="secondary" onclick="makeIt('money')">💵 How is this business doing?</button>
    </div>
  </div>`;
  refreshToday(true);
}
window.lsSetPub = lsSet;

function remindersHtml() {
  const due = P.due.map(r => `<li>🔔 <strong>${esc(r.title)}</strong> — due ${esc(fmtTs(r.due_ts))} <button class="small" onclick="reminderDone('${r.id}')">Done</button> <button class="small secondary" onclick="reminderSnooze('${r.id}',10)">Snooze 10 min</button> <button class="small secondary" onclick="reminderSnooze('${r.id}',60)">1 hour</button></li>`);
  const up = P.upcoming.map(r => `<li>⏰ ${esc(r.title)} — ${esc(fmtTs(r.due_ts))}${r.repeat ? " · " + esc(r.repeat) : ""}</li>`);
  if (!due.length && !up.length) return `<p class="muted">No reminders due in the next day.</p>`;
  return (due.length ? `<h3>Due now</h3><ul>${due.join("")}</ul>` : "") + (up.length ? `<h3>Coming up (next 24 hours)</h3><ul>${up.join("")}</ul>` : "");
}
function fmtTs(ts) { const d = new Date(ts * 1000); return d.toLocaleString([], {weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit"}); }
function billsHtml() {
  const bills = (P.bills || []);
  if (!bills.length) return `<p class="muted">No unpaid bills. 👍</p>`;
  return `<div class="tablewrap"><table><thead><tr><th>From</th><th>Amount</th><th>Due</th><th>Business</th><th>Status</th><th></th></tr></thead><tbody>${bills.map(b => `<tr class="${b.late ? "late" : ""}">
    <td>${esc(b.payee)}</td><td>${money(b.amount)}</td><td>${esc(b.due || "")}${b.late ? " ⚠️ late" : b.days_left !== null && b.days_left <= 3 ? " ⏳" : ""}</td><td>${esc(b.account)}</td><td>${esc(b.status)}</td>
    <td>${b.status === "Approved by George" ? "" : `<button class="small" onclick="billAction('${b.id}','approve')">Yes, pay it</button> <button class="small secondary" onclick="billAction('${b.id}','decline')">Not yet</button>`}
    <button class="small secondary" onclick="billAction('${b.id}','paid')">Mark paid</button></td></tr>`).join("")}</tbody></table></div>`;
}
function booksHtml() {
  const b = P.books; if (!b) return `<p class="muted">Adding up…</p>`;
  const rows = b.accounts.filter(a => a.count || a.bills_due || ACCOUNTS.includes(a.account));
  return `<div class="tablewrap"><table><thead><tr><th>Business</th><th>Money in</th><th>Money out</th><th>Profit / loss</th><th>Tax set-aside (${b.tax_rate}%)</th><th>Bills due</th></tr></thead><tbody>
    ${rows.map(a => `<tr><td>${esc(a.account)}</td><td>${money(a.income)}</td><td>${money(a.expenses)}</td><td class="${a.profit < 0 ? "bad" : a.profit > 0 ? "ok" : ""}">${money(a.profit)} ${a.profit > 0 ? "📈" : a.profit < 0 ? "📉" : ""}</td><td>${money(a.tax_reserve)}</td><td>${money(a.bills_due)}</td></tr>`).join("")}
    <tr><th>All businesses</th><th>${money(b.total.income)}</th><th>${money(b.total.expenses)}</th><th>${money(b.total.profit)}</th><th>${money(b.total.tax_reserve)}</th><th>${money(b.total.bills_due)}</th></tr></tbody></table></div>
    <p class="muted">${esc(b.note)} Tag each income/expense with its business on the Money screen. Where the money goes is broken down by category on the Money screen.</p>`;
}
function receiptHtml() {
  const r = P.receipt; if (!r) return "";
  if (r.reading) return `<p>Reading your receipt…</p>`;
  if (r.error) return `<p class="msg">${esc(r.error)}</p>`;
  return `<form onsubmit="event.preventDefault();saveReceipt(this)" class="panel">
    <h3>Draft expense — check it</h3>
    <label>Store<input name="vendor" value="${esc(r.vendor || "")}"></label>
    <label>Date<input name="date" type="date" value="${esc(r.date || today())}"></label>
    <label>Total ($)<input name="amount" type="number" step="0.01" value="${esc(r.total ?? "")}" required></label>
    <label>Tax ($)<input name="tax" type="number" step="0.01" value="${esc(r.tax ?? "")}"></label>
    <label>Category<input name="category" value="${esc(r.category || "Other")}"></label>
    <label>Business / account<input name="account" list="acctList2" placeholder="Which business?"><datalist id="acctList2">${ACCOUNTS.map(a => `<option value="${esc(a)}">`).join("")}</datalist></label>
    <label class="chk"><input type="checkbox" name="is_bill"> This is a bill I still have to pay (save it under Bills instead)</label>
    ${(r.items || []).length ? `<details><summary>${r.items.length} item(s) on it</summary><ul>${r.items.map(i => `<li>${esc(i.name)} — ${money(i.price)}</li>`).join("")}</ul></details>` : ""}
    <p class="muted">Confidence: ${esc(r.confidence || "?")}. ${esc(r.note || "")}</p>
    <button>Save</button> <button type="button" class="secondary" onclick="P_clearReceipt()">Throw away</button></form>`;
}
window.P_clearReceipt = () => { P.receipt = null; const b = $("#receiptBox"); if (b) b.innerHTML = ""; };

async function refreshToday(quiet) {
  const tasks = [
    api("/api/watch").then(d => P.watch = d.alerts).catch(e => P.watch = [{level: "info", area: "Watch", text: e.message, tab: "today"}]),
    api("/api/books").then(d => P.books = d).catch(() => {}),
    api("/api/bills").then(d => P.bills = d.bills).catch(() => {}),
    checkReminders(true),
  ];
  await Promise.all(tasks);
  if (!quiet) flash("Up to date.", true);
  if (currentTab === "today") {
    const set = (id, html) => { const el = $(id); if (el) el.innerHTML = html; };
    set("#watchBox", P.watch.length ? P.watch.map(alertHtml).join("") : "<li>✅ Nothing needs your attention. Everything looks good.</li>");
    set("#booksBox", booksHtml()); set("#billsBox", billsHtml()); set("#dueBox", remindersHtml());
  }
}
window.refreshToday = refreshToday;

async function playBriefing(auto) {
  try {
    P.briefing = await api("/api/briefing");
    if (currentTab === "today") renderToday($("#view"));
    await ensureConnieGirlVoice();
    speakText(P.briefing.spoken);
    lsSet("connie_briefed_on", today());
  } catch (err) { if (!auto) flash("I couldn't make your briefing: " + err.message); }
}
window.playBriefing = playBriefing;

/* ---------- reminders that speak ---------- */
async function quickReminder(form) {
  const text = form.text.value.trim(); if (!text) return;
  try {
    const r = await api("/api/reminders/parse", {method: "POST", body: {text}});
    await api("/api/records", {method: "POST", body: {kind: "reminders", data: {title: r.title, due: r.due, at: r.at, repeat: r.repeat, done: false}}});
    form.text.value = ""; await loadAll(); await checkReminders(true);
    const msg = `OK — I'll remind you ${r.when_text}: ${r.title}.` + (r.guessed ? " (You didn't say when, so I picked tomorrow at 9 — edit it on the Tasks screen if that's wrong.)" : "");
    flash(msg, true); speakText(msg);
    if (currentTab === "today") { const el = $("#dueBox"); if (el) el.innerHTML = remindersHtml(); }
  } catch (err) { flash(err.message); }
}
window.quickReminder = quickReminder;
async function checkReminders(quiet) {
  if (!token) return;
  try {
    const d = await api("/api/reminders/due");
    P.due = d.due || []; P.upcoming = d.upcoming || [];
    for (const r of P.due) {
      if (P.alerted.has(r.id + r.due_ts)) continue;
      P.alerted.add(r.id + r.due_ts);
      const say = "George, reminder: " + r.title;
      speakText(say);
      try { if (window.Notification && Notification.permission === "granted") new Notification("Connie — reminder", {body: r.title, icon: "/icon-192.png", tag: r.id}); } catch (e) { /* not allowed here */ }
      if (!quiet || currentTab !== "today") flash("🔔 " + say + " — open Today to mark it done or snooze it.", true);
    }
    if (currentTab === "today") { const el = $("#dueBox"); if (el) el.innerHTML = remindersHtml(); }
  } catch (e) { /* offline or signed out — try next time */ }
}
window.reminderDone = async (id) => { try { const d = await api(`/api/reminders/${id}/done`, {method: "POST", body: {}}); flash(d.next_text ? "Done — next time: " + d.next_text + "." : "Done.", true); await loadAll(); await checkReminders(true); } catch (e) { flash(e.message); } };
window.reminderSnooze = async (id, m) => { try { await api(`/api/reminders/${id}/snooze`, {method: "POST", body: {minutes: m}}); flash(`Snoozed ${m} minutes.`, true); await checkReminders(true); } catch (e) { flash(e.message); } };
window.askNotify = async () => {
  if (!window.Notification) { flash("This browser can't show pop-up notices — I'll still speak up while Connie is open."); return; }
  const p = await Notification.requestPermission();
  flash(p === "granted" ? "Pop-up notices are on." : "Pop-up notices are off — I'll still speak up while Connie is open.", p === "granted");
};
setInterval(() => checkReminders(true), 30000);

/* ---------- bills ---------- */
window.billAction = async (id, action) => {
  if (action !== "decline") {
    const bill = (P.bills || []).find(b => b.id === id) || {};
    const q = action === "approve" ? `Can I mark "${bill.payee}" for ${money(bill.amount)} as OK to pay? No money moves — no bank is connected.` : `Mark "${bill.payee}" for ${money(bill.amount)} as paid and book it as an expense?`;
    if (!confirm(q)) { flash("OK — nothing changed."); return; }
    if (!(await ensureVoiceForJobs())) { flash("I need to know it's you first — voice, then passcode."); return; }
  }
  try {
    const d = await api(`/api/bills/${id}/${action}`, {method: "POST", body: gateBody({approved: true})});
    flash(d.note || d.status, true); await loadAll(); await refreshToday(true);
  } catch (e) { flash(e.message); }
};

/* ---------- receipts ---------- */
async function shrinkImage(file, max = 1600) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement("canvas"); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.82).split(",")[1];
  } finally { URL.revokeObjectURL(url); }
}
window.readReceipt = async (file) => {
  if (!file) return;
  P.receipt = {reading: true}; $("#receiptBox").innerHTML = receiptHtml();
  if (!(await ensureVoiceForJobs())) { P.receipt = {error: "I need to know it's you first — voice, then passcode."}; $("#receiptBox").innerHTML = receiptHtml(); return; }
  try {
    const image = await shrinkImage(file);
    P.receipt = await api("/api/receipt/read", {method: "POST", body: gateBody({image, media_type: "image/jpeg"})});
  } catch (e) { P.receipt = {error: e.message + " You can still type it in on the Money screen."}; }
  $("#receiptBox").innerHTML = receiptHtml();
};
window.saveReceipt = async (form) => {
  const f = form.elements;
  try {
    if (f.is_bill.checked) {
      await api("/api/records", {method: "POST", body: {kind: "bills", data: {payee: f.vendor.value, amount: Number(f.amount.value), due: f.date.value, account: f.account.value, category: f.category.value, status: "Waiting for George", notes: "From a photo"}}});
    } else {
      await api("/api/records", {method: "POST", body: {kind: "transactions", data: {date: f.date.value, kind: "Expense", account: f.account.value, category: f.category.value, amount: Number(f.amount.value), notes: (f.vendor.value || "Receipt") + (f.tax.value ? ` (tax ${money(f.tax.value)})` : "")}}});
    }
    P.receipt = null; await loadAll(); await refreshToday(true); flash("Saved.", true); renderToday($("#view"));
  } catch (e) { flash(e.message); }
};

/* ---------- make products & marketing (drafts only) ---------- */
const MAKE_PROMPTS = {
  research: (a) => `Research what customers of "${a}" want and need most right now to make their lives easier and more affordable. Give the top 7 needs, who has them, and one digital product idea for each with a price range. Use my learned notes about this business.`,
  product: (a) => `Create one new digital product for "${a}" that real customers would pay for: name, who it's for, the problem it solves, a full outline/table of contents, a price, a short sales description, and the first section written out. It's a draft for me to check.`,
  ad: (a) => `Write 3 short ads for "${a}" (Facebook / community marketplace style): a headline, 2-3 sentences, and a call to action each. Truthful claims only — no fake reviews, no promises of results. End each with: Created by George, made with the influence of Claude and Muse.`,
  posts: (a) => `Write 7 social media posts for "${a}", one per day for a week, each with a hook, the post, and 3 hashtags. Truthful only.`,
  plan: (a) => `Make a simple 30-day marketing plan for "${a}" for a one-person business with a small budget: weekly goals, daily 15-minute tasks, free channels first, and what to measure.`,
  money: (a) => `Look at the money for "${a}" in my figures (context below) and tell me plainly: am I making or losing money, where the money goes, and 3 things to do next. Not tax or financial advice.`,
};
window.makeIt = async (what) => {
  const acct = ($("#makeAcct") || {}).value || ACCOUNTS[0];
  let prompt = MAKE_PROMPTS[what](acct);
  if (what === "money" && P.books) {
    const a = P.books.accounts.find(x => x.account === acct);
    if (a) prompt += `\nFigures: in ${money(a.income)}, out ${money(a.expenses)}, profit ${money(a.profit)}, by category ${JSON.stringify(a.by_category)}.`;
  }
  showTab("assistant");
  const box = $("#chatForm textarea[name=msg]");
  if (box) { box.value = prompt; $("#chatForm").requestSubmit(); }
};

/* ---------- Assistant: reminders, briefing and "never stop learning" ---------- */
const _offline = handleOfflineRequest;
handleOfflineRequest = async function (text) {
  const low = text.trim().toLowerCase();
  if (/^(hey connie,?\s*)?(remind me|set a reminder)\b/.test(low)) {
    const r = await api("/api/reminders/parse", {method: "POST", body: {text}});
    await api("/api/records", {method: "POST", body: {kind: "reminders", data: {title: r.title, due: r.due, at: r.at, repeat: r.repeat, done: false}}});
    await loadAll(); checkReminders(true);
    return {reply: `OK — I'll remind you ${r.when_text}: ${r.title}.` + (r.guessed ? " You didn't say when, so I picked tomorrow at 9 — tell me if that's wrong." : " I'll speak up when it's time, while I'm open."), actions: [{label: "Open Today", tab: "today"}]};
  }
  if (/^(good morning|morning briefing|(give me )?my briefing|brief me|what'?s (my day|on today)( like)?)\b/.test(low)) {
    const b = await api("/api/briefing"); P.briefing = b;
    return {reply: b.spoken, actions: [{label: "See it all on Today", tab: "today"}]};
  }
  if (/^(how'?s (the )?business|business watch|anything wrong|what needs my attention)/.test(low)) {
    const d = await api("/api/watch"); P.watch = d.alerts;
    return {reply: d.alerts.length ? "Here's what I'm watching:\n" + d.alerts.map(a => "• " + a.area + ": " + a.text).join("\n") : "Everything looks good — nothing needs your attention.", actions: [{label: "Open Today", tab: "today"}]};
  }
  if (/^(what bills|any bills|bills due)/.test(low)) {
    const d = await api("/api/bills");
    return {reply: d.bills.length ? d.bills.map(b => `• ${b.payee} — ${money(b.amount)}, due ${b.due} (${b.status})`).join("\n") + "\nI won't pay any of them unless you say yes." : "No unpaid bills.", actions: [{label: "Open Today", tab: "today"}]};
  }
  if (/^(how much (am i|are we) making|profit|am i making money|money by business)/.test(low)) {
    const b = await api("/api/books"); P.books = b;
    return {reply: b.accounts.filter(a => a.count).map(a => `• ${a.account}: ${money(a.profit)} (${a.status})`).join("\n") + `\nAll together: ${money(b.total.profit)}. ${b.note}`, actions: [{label: "Open Today", tab: "today"}]};
  }
  const done = await _offline(text);
  if (done) return done;
  // Never stop learning — auto-learn (George's choice, 2026-11-25): if
  // George said something worth remembering, save it right away and tell
  // him what was saved. Skip when the message itself was a learn command
  // (already saved above). The law check in saveLearnedNote still refuses
  // unlawful notes, and everything saved shows on the Learning screen
  // where he can forget any of it.
  if (AUTO_LEARN && !/^(learn|remember|teach me)\b/.test(low) && !pendingLearnList.length) {
    try {
      const s = await api("/api/memory/suggest", {method: "POST", body: {text}});
      if (s.suggestions && s.suggestions.length) {
        const done2 = await saveLearnedNotes(s.suggestions);
        if (done2.ok) window._memoryOffer = "\n\nI learned: " + done2.saved.join(" · ") + " — see the Learning screen any time, and forget anything there.";
      }
    } catch (e) { /* fine */ }
  }
  return null;
};
// Attach the memory offer to the next reply.
const _sendChat = sendChat;
sendChat = async function (e) {
  window._memoryOffer = "";
  await _sendChat(e);
  if (window._memoryOffer) {
    const last = chatHistory[chatHistory.length - 1];
    if (last && last.role === "assistant") last.content += window._memoryOffer;
    window._memoryOffer = "";
    if (currentTab === "assistant") { renderAssistant($("#view")); const b = $("#chatBox"); if (b) b.scrollTop = b.scrollHeight; }
  }
  if (wake.on) speakLastReply();
};
function speakLastReply() { const last = [...chatHistory].reverse().find(m => m.role === "assistant"); if (last) speakText(last.content.replace(/[💡“”•]/g, "")); }

/* ---------- "Hey Connie" wake word ---------- */
const wake = {on: lsGet("connie_wake", false), rec: null, waitingCommand: false, busy: false};
function wakeSupported() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); }
function startWake() {
  if (!wakeSupported()) { flash("This browser can't listen for 'Hey Connie' — use Chrome on Android or a computer, or Safari on iPhone."); wake.on = false; lsSet("connie_wake", false); return; }
  if (wake.rec) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new SR(); rec.lang = "en-US"; rec.continuous = true; rec.interimResults = false;
  rec.onresult = (ev) => {
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      if (!ev.results[i].isFinal) continue;
      const heard = ev.results[i][0].transcript.trim();
      const m = heard.match(/\b(?:hey|hi|okay|ok)?\s*conn(?:ie|y|ee|i)\b[,.!]?\s*(.*)$/i);
      if (wake.waitingCommand) { wake.waitingCommand = false; runWakeCommand(heard); }
      else if (m) {
        if (m[1] && m[1].length > 2) runWakeCommand(m[1]);
        else { wake.waitingCommand = true; speakText("Yes, George?"); setTimeout(() => wake.waitingCommand = false, 8000); }
      }
    }
  };
  rec.onend = () => { wake.rec = null; if (wake.on && !document.hidden) setTimeout(startWake, 400); };
  rec.onerror = (e) => { if (e.error === "not-allowed" || e.error === "service-not-allowed") { wake.on = false; lsSet("connie_wake", false); flash("I need the microphone to hear 'Hey Connie' — allow it in the browser, then turn it on again."); } };
  try { rec.start(); wake.rec = rec; } catch (e) { wake.rec = null; }
  updateWakeBadge();
}
function stopWake() { wake.on = false; lsSet("connie_wake", false); if (wake.rec) { try { wake.rec.stop(); } catch (e) { /* */ } } wake.rec = null; updateWakeBadge(); }
async function runWakeCommand(cmd) {
  if (wake.busy) return; wake.busy = true;
  try {
    if (currentTab !== "assistant") showTab("assistant");
    const box = $("#chatForm textarea[name=msg]");
    if (box) { box.value = cmd; $("#chatForm").requestSubmit(); }
  } finally { setTimeout(() => wake.busy = false, 1500); }
}
window.toggleWake = (on) => { wake.on = on; lsSet("connie_wake", on); if (on) { startWake(); speakText("I'm listening. Say 'Hey Connie' any time."); } else stopWake(); };
document.addEventListener("visibilitychange", () => { if (!document.hidden && wake.on && token) startWake(); });
function updateWakeBadge() {
  let b = $("#wakeBadge");
  if (!b) { b = document.createElement("div"); b.id = "wakeBadge"; b.className = "wake-badge"; b.onclick = () => toggleWake(!wake.on); document.body.appendChild(b); }
  b.hidden = !token;
  b.textContent = wake.on ? "🎙️ Listening for “Hey Connie”" : "🎙️ Hey Connie: off";
  b.classList.toggle("on", wake.on);
}
function addWakePanel() {
  const v = $("#view"); if (!v || $("#wakePanel")) return;
  const d = document.createElement("div"); d.className = "panel"; d.id = "wakePanel";
  d.innerHTML = `<h2>🎙️ Hands-free — "Hey Connie"</h2>
    <label class="chk"><input type="checkbox" ${wake.on ? "checked" : ""} onchange="toggleWake(this.checked)"> Listen for "Hey Connie"</label>
    <p class="muted">Say "Hey Connie, what's on today?" or "Hey Connie" and wait for "Yes, George?". I answer out loud. Works while Connie is open on screen (phones stop the microphone when the screen locks). It listens on your device only. Voice ID and passcode rules still apply for jobs and anything private.</p>`;
  v.insertBefore(d, v.children[1] || null);
}

/* ---------- Integrations: live connectors ---------- */
async function addLiveConnectorsPanel() {
  const v = $("#view"); if (!v) return;
  const d = document.createElement("div"); d.className = "panel"; d.id = "livePanel";
  d.innerHTML = `<h2>🔌 Live connectors (new)</h2><p class="muted">Checking…</p>`;
  v.insertBefore(d, v.firstChild);
  try { P.conn = await api("/api/plus/connectors"); P.backup = await api("/api/backup/status"); } catch (e) { d.innerHTML = `<h2>🔌 Live connectors</h2><p class="msg">${esc(e.message)}</p>`; return; }
  const c = P.conn.connectors;
  const row = (on, name, what, how, btn) => `<div class="card"><strong>${on ? "✅" : "⚪"} ${esc(name)}</strong><span>${esc(what)}</span>${on ? (btn || "") : `<span class="muted">To connect: ${esc(how)}</span>`}</div>`;
  const last = P.backup.last;
  d.innerHTML = `<h2>🔌 Live connectors</h2>
    <p class="muted">These really connect when their keys are set on the server (never in the app, never in chat). Connie only reads, unless you say yes for that one thing.</p>
    <div class="cards">
      ${row(P.conn.allinone_available, "All in One brain", "Answers with " + (P.conn.allinone_brains.join(" + ") || "every connected brain") + " together", "set ANTHROPIC_API_KEY (runs Fable + Opus); add OPENAI_API_KEY for GPT-6.2 Astra")}
      ${row(c.stripe, "Stripe", "Sales, balance, failed payments, disputes — read-only", "set STRIPE_SECRET_KEY (a read-only restricted key, rk_…)", `<button class="small" onclick="liveStripe()">Show Stripe</button>`)}
      ${row(c.calendar, "Google Calendar", c.calendar_source === "ics" ? "Reads your calendar (secret address — read only)" : "Reads your calendar; adds events after your yes", "run connect_google.py once, or set GOOGLE_CALENDAR_ICS_URL", `<button class="small" onclick="liveCalendar()">Next 7 days</button>`)}
      ${row(c.drive, "Google Drive", "Find your files by name; nightly backups", "run connect_google.py once on the server", `<button class="small" onclick="liveDrive()">Find a file</button>`)}
      ${row(c.email, "Email", "Unread mail in your briefing; sends only after your yes", "set EMAIL_ADDRESS + EMAIL_APP_PASSWORD (a Gmail app password)", `<button class="small" onclick="liveEmail()">Show inbox</button> <button class="small secondary" onclick="liveCompose()">Write an email</button>`)}
      <div class="card"><strong>${c.daily_backup ? "✅" : "⚪"} Nightly backup</strong><span>Every night after ${c.backup_hour}:00 — to "Connie Backups" in your Drive${c.drive ? "" : " (once Drive is connected)"} + 14 copies on Connie's own disk.</span>
        <span class="muted">Last: ${last ? esc(last.date) + " · " + last.records + " records · Drive " + (last.drive ? "✅" : "— " + esc(last.drive_error || "")) : "not yet"}</span>
        <button class="small" onclick="backupNow()">Back up now</button></div>
    </div><div id="liveOut"></div>`;
}
const liveOut = (html) => { const el = $("#liveOut"); if (el) el.innerHTML = `<div class="panel">${html}</div>`; };
window.liveStripe = async () => { try { const s = await api("/api/connect/stripe"); liveOut(s.error ? esc(s.error) : `<h3>Stripe (${esc(s.mode)})</h3><p>Available ${money(s.available)} · pending ${money(s.pending)}</p><p>Last 24h: ${money(s.sales_24h)} (${s.count_24h}) · Last 7 days: ${money(s.sales_7d)} (${s.count_7d}) · Failed: ${s.failed_7d} · Open disputes: ${s.disputes_open}</p><ul>${s.recent.map(r => `<li>${money(r.amount)} — ${esc(r.status)} ${esc(r.description)}</li>`).join("")}</ul>`); } catch (e) { liveOut(esc(e.message)); } };
window.liveCalendar = async () => { try { const s = await api("/api/connect/calendar?days=7"); liveOut(`<h3>Next 7 days</h3><ul>${s.events.map(e => `<li>${esc(e.all_day ? e.start : new Date(e.start).toLocaleString([], {weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit"}))} — ${esc(e.title)}${e.where ? " · " + esc(e.where) : ""}</li>`).join("") || "<li>Nothing.</li>"}</ul>
  ${P.conn.connectors.calendar_source === "google" ? `<form onsubmit="event.preventDefault();liveAddEvent(this)"><h3>Add an event</h3><label>What<input name="title" required></label><label>When<input name="start" type="datetime-local" required></label><label>Where<input name="where"></label><button>Add it — I said yes</button></form>` : ""}`); } catch (e) { liveOut(esc(e.message)); } };
window.liveAddEvent = async (f) => { if (!(await ensureVoiceForJobs())) return flash("Voice, then passcode first."); try { const r = await api("/api/connect/calendar/add", {method: "POST", body: gateBody({approved: true, title: f.title.value, start: f.start.value, where: f.where.value})}); flash("Added to your calendar: " + r.title, true); liveCalendar(); } catch (e) { flash(e.message); } };
window.liveDrive = async (q) => { q = q ?? prompt("Find which file? (leave empty for your latest files)") ?? null; if (q === null) return; try { const s = await api("/api/connect/drive?q=" + encodeURIComponent(q)); liveOut(`<h3>Drive${q ? ": " + esc(q) : ""}</h3><ul>${s.files.map(f => `<li><a href="${esc(f.webViewLink)}" target="_blank" rel="noopener">${esc(f.name)}</a> · ${esc((f.modifiedTime || "").slice(0, 10))}</li>`).join("") || "<li>No files found.</li>"}</ul>`); } catch (e) { liveOut(esc(e.message)); } };
window.liveEmail = async () => { if (!(await ensureVoiceForJobs())) return flash("Voice, then passcode first."); try { const s = await api("/api/connect/email?" + gateQuery()); liveOut(s.error ? esc(s.error) : `<h3>Inbox — ${s.unread} unread</h3><ul>${s.latest.map(m => `<li><strong>${esc(m.from)}</strong>: ${esc(m.subject)}</li>`).join("") || "<li>Nothing new.</li>"}</ul>`); } catch (e) { liveOut(esc(e.message)); } };
window.liveCompose = () => liveOut(`<form onsubmit="event.preventDefault();liveSend(this)"><h3>Write an email</h3><label>To<input name="to" type="email" required></label><label>Subject<input name="subject" required></label><label class="wide">Message<textarea name="body" required></textarea></label><button>Send — I checked it</button></form>`);
window.liveSend = async (f) => { if (!confirm(`Send this email to ${f.to.value} now?`)) return; if (!(await ensureVoiceForJobs())) return flash("Voice, then passcode first."); try { await api("/api/connect/email/send", {method: "POST", body: gateBody({approved: true, to: f.to.value, subject: f.subject.value, body: f.body.value})}); flash("Sent.", true); liveOut("Sent ✅"); } catch (e) { flash(e.message); } };
window.backupNow = async () => { if (!(await ensureVoiceForJobs())) return flash("Voice, then passcode first."); try { const r = await api("/api/backup/now", {method: "POST", body: gateBody()}); flash(`Backed up ${r.records} records — ${r.drive ? "to your Drive ✅" : "on Connie's disk (" + (r.drive_error || "Drive not connected") + ")"}.`, true); showTab("integrations"); } catch (e) { flash(e.message); } };

/* ---------- Learning: memory upgrades ---------- */
function addMemoryPanel() {
  const v = $("#view"); if (!v) return;
  const notes = list("learned");
  const topics = {};
  notes.forEach(n => { const t = n.data.topic || "Other"; topics[t] = (topics[t] || 0) + 1; });
  const d = document.createElement("div"); d.className = "panel";
  d.innerHTML = `<h2>🧠 Connie's memory — unlimited</h2>
    <p class="muted">No limit on what I learn. I sort everything by topic, you can pin the most important things (I always use pinned notes), and with every question I send the brain the notes that matter most — so my memory can grow forever and stay sharp. I also notice things you tell me in chat and ask, "Want me to remember this?" — I only save it when you say yes. Nobody but you can see it.</p>
    <p>${notes.length} things learned · ${Object.entries(topics).map(([t, n]) => `${esc(t)}: ${n}`).join(" · ") || "no topics yet"}</p>
    <form class="row" onsubmit="event.preventDefault();memSearch(this.q.value)"><input name="q" placeholder="Search my memory — words or topic" style="flex:1"><button>Search</button></form>
    <div id="memOut">${memListHtml(notes.slice(0, 30))}</div>`;
  v.insertBefore(d, v.firstChild);
}
function memListHtml(notes) {
  if (!notes.length) return `<p class="muted">Nothing found.</p>`;
  return `<ul>${notes.map(n => `<li>${n.data.pinned ? "📌 " : ""}${esc(n.data.text)} <span class="muted">· ${esc(n.data.topic || "Other")}</span>
    <button class="small secondary" onclick="memPin('${n.id}', ${!n.data.pinned})">${n.data.pinned ? "Unpin" : "Pin"}</button></li>`).join("")}</ul>`;
}
window.memSearch = async (q) => { try { const d = await api("/api/memory/search?q=" + encodeURIComponent(q)); $("#memOut").innerHTML = `<p class="muted">${d.notes.length} of ${d.total}</p>` + memListHtml(d.notes); } catch (e) { flash(e.message); } };
window.memPin = async (id, pinned) => { try { await api("/api/memory/pin", {method: "POST", body: {id, pinned}}); await loadAll(); showTab("learning"); flash(pinned ? "Pinned — I'll always keep that in mind." : "Unpinned.", true); } catch (e) { flash(e.message); } };

/* ---------- Money: the business books, separate ---------- */
async function addBooksToMoney() {
  const v = $("#view"); if (!v) return;
  const d = document.createElement("div"); d.className = "panel"; d.innerHTML = `<h2>📒 Each business, separate</h2><div id="booksBox2">Adding up…</div>`;
  v.insertBefore(d, v.children[1] || null);
  try { P.books = await api("/api/books"); $("#booksBox2").innerHTML = booksHtml(); } catch (e) { $("#booksBox2").textContent = e.message; }
}

/* ---------- start-up ---------- */
const _enterApp = enterApp;
enterApp = async function () {
  await _enterApp();
  if (!token) return;
  updateWakeBadge();
  flushOutbox();
  checkReminders(true);
  if (wake.on) startWake();
  const h = new Date().getHours();
  if (lsGet("connie_auto_briefing", true) && h >= 5 && h < 12 && lsGet("connie_briefed_on", "") !== today()) {
    showTab("today");
    // Phones only allow speech after a tap — the first tap anywhere starts the briefing.
    const go = () => { document.removeEventListener("click", go, true); playBriefing(true); };
    flash("☀️ Good morning, George — tap anywhere and I'll read your briefing.", true);
    document.addEventListener("click", go, true);
  }
};
const _signOut = signOut;
signOut = function () { stopWake(); lsSet("connie_wake", wake.on); _signOut(); updateWakeBadge(); };
