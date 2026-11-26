/* George's Assistant v1.1 — web/app.js — Connie, George's personal assistant
   Owner: George Wederski. Personal copy only — NOT for sale, no customers, no plans, no storefront. All screens talk to server.py's real API.
   © 2026 George Wederski. All rights reserved. No part of this book/app may be copied, reproduced, or shared without written permission from George Wederski.
   Nothing here is live: no phone calls are placed, no money is moved,
   no bank feed, tax filing or payment is connected. Those panels say so.
   AI chat works only when the owner sets a server-side key (see README);
   with no key the server answers 503 and this page says so plainly.
   The Assistant is the do-anything front door, called the George's Assistant
   Assistant: before it asks the live AI anything, it first tries to do
   the request in the app itself — searching your saved records, working
   out numbers, adding a task or reminder, or drafting something for you
   to approve. Those offline jobs work with no AI key. It is NOT Remy:
   Remy is George's personal assistant in the Muse app, for George
   only — customers cannot talk to Remy through this bot, and George's
   private records are never shared with them. There is no Remy key.
   Anything it drafts is only a draft: it never calls, charges, files,
   publishes or orders anything on its own, and anything affecting a
   customer, money or an account needs your review first.
   Voice dictation / read-aloud use the browser's own speech tools when
   available and fall back to typing when they are not. The bot can
   talk back in different voices — girl/female voices and male voices
   among them — using the voices already on the person's own device.
   The buyer picks one in Settings, or just asks the Assistant, e.g.
   "change your voice to a girl voice", and the bot switches right
   away and answers back in the new voice. Picking a voice to talk
   back does NOT change voice recognition: only the enrolled buyer's
   voice can start jobs.
   Permission first: before the bot looks at a person's records, does
   a job, or uses a connected tool, it asks that person first — like
   Remy does — shows plainly what it wants to do and whose records
   it wants to use, and waits for their yes. If they say no, or do
   not answer, it does nothing. Access is per-person only. */
"use strict";
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money = (v) => { const n = Number(v); return Number.isFinite(n) ? "$" + n.toFixed(2) : String(v ?? ""); };
const today = () => new Date().toISOString().slice(0, 10);

let token = localStorage.getItem("connie_token") || "";
let username = localStorage.getItem("connie_username") || "";
let mode = "login";
let records = {};           // kind -> [record]
let health = null;
let currentTab = "assistant";
let editing = {};           // kind -> id or null
let chatHistory = [];
let lastDraft = "";          // latest draft the Assistant made, for "Save as a note"
let assistantActions = [];  // buttons under the chat: [{label, tab, kind, prefill, saveDraft}]
let draftPrefill = null;    // {kind, data} — pre-fills the form on the screen it opens
let aiProvider = localStorage.getItem("connie_ai_provider") || "allinone";  // 2026-11-21: All in One is the default; falls back below if not connected  // "anthropic" | "openai" | "opus" — default anthropic = Claude Fable 5.2, #1, top level
let lastAiProvider = "";    // provider that answered the last live-AI reply

/* ---------- How the bot sounds — speaking voice choice ----------
   The buyer picks how the bot sounds when it talks back. The voices
   are the ones already on this person's own device / browser
   (speechSynthesis voices) — the bot does not invent a voice, does
   not claim a voice that is not on this device, and there is no live
   AI voice model in this build (no AI key is set). When an AI
   provider key is connected later, the bot still speaks its answers
   in the voice chosen here, unless that provider offers its own
   voice — the server supports Anthropic and OpenAI
   today, and neither is claimed to supply a voice here.
   Picking a voice to talk back is separate from voice recognition /
   safety: it does NOT change who can unlock the bot — only the
   enrolled buyer's voice can start jobs.
   Change it two ways: pick one in Settings, or just ask the
   Assistant, e.g. "change your voice to a girl voice" — the bot
   switches right away and answers back in the new voice. */
const FEMALE_VOICE_HINTS = ["female", "woman", "girl", "samantha", "zira", "aria", "victoria", "karen", "moira", "tessa", "fiona", "susan", "allison", "ava", "joana", "siri female", "google uk english female", "microsoft zira", "microsoft aria", "microsoft jenny", "microsoft sonia"];
const MALE_VOICE_HINTS = ["male", "man", "boy", "david", "mark", "daniel", "alex", "fred", "aaron", "google uk english male", "microsoft david", "microsoft mark", "microsoft guy", "microsoft ryan", "siri male"];
function classifySpeechVoice(v) {
  const n = (v.name || "").toLowerCase();
  if (FEMALE_VOICE_HINTS.some(h => n.includes(h))) return "Female";
  if (MALE_VOICE_HINTS.some(h => n.includes(h))) return "Male";
  return "Other";
}
let speakingVoiceURI = localStorage.getItem("connie_speaking_voice_uri") || "";
let speakingVoiceName = localStorage.getItem("connie_speaking_voice_name") || "";
/* Connie's default voice is a GIRL / FEMALE voice: the first female voice
   on this device. George picked her name (Connie) and her starting voice
   is female; he can still ask her to change to a different girl voice
   later ("change your voice to a girl voice", "an Australian girl voice"). */
async function ensureConnieGirlVoice() {
  if (speakingVoiceURI || speakingVoiceName) return null;
  const vs = await loadSpeechVoices();
  const f = vs.find(v => classifySpeechVoice(v) === "Female");
  if (!f) return null;
  speakingVoiceURI = f.voiceURI; speakingVoiceName = f.name;
  localStorage.setItem("connie_speaking_voice_uri", speakingVoiceURI);
  localStorage.setItem("connie_speaking_voice_name", speakingVoiceName);
  return f;
}
function connieIntro() { return "Hello, George. I'm Connie, your personal assistant, in a girl's voice. What would you like help with today?"; }
function getSpeechVoices() {
  if (!("speechSynthesis" in window)) return [];
  return speechSynthesis.getVoices() || [];
}
function loadSpeechVoices() {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) return resolve([]);
    const vs = getSpeechVoices();
    if (vs.length) return resolve(vs);
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(getSpeechVoices()); } };
    speechSynthesis.addEventListener("voiceschanged", finish, {once: true});
    setTimeout(finish, 1500);
  });
}
function chosenSpeechVoice() {
  const vs = getSpeechVoices();
  if (speakingVoiceURI) { const v = vs.find(x => x.voiceURI === speakingVoiceURI); if (v) return v; }
  if (speakingVoiceName) { const v = vs.find(x => x.name === speakingVoiceName); if (v) return v; }
  // No voice picked yet: Connie starts as a girl — first female voice on this device.
  const f = vs.find(v => classifySpeechVoice(v) === "Female");
  return f || null;
}
function speakText(text, voice) {
  if (!("speechSynthesis" in window)) return false;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const v = voice || chosenSpeechVoice();
  if (v) u.voice = v;
  speechSynthesis.speak(u);
  return true;
}
async function saveSpeakingVoiceToServer() {
  // Bonus copy in George's own settings record on the server, so
  // the choice is remembered per user. The choice on this device
  // (localStorage) is what actually picks the voice, because a voice
  // only exists on the device that offers it.
  try {
    const s = first("settings");
    const data = {...(s ? s.data : {}), speaking_voice_uri: speakingVoiceURI, speaking_voice_name: speakingVoiceName};
    if (s) await api("/api/records/" + s.id, {method: "PUT", body: {data}});
    else await api("/api/records", {method: "POST", body: {kind: "settings", data}});
    await loadAll();
  } catch (err) { /* local choice still stands — the server copy is a bonus */ }
}
async function setSpeakingVoice(voice, opts = {}) {
  speakingVoiceURI = voice ? voice.voiceURI : "";
  speakingVoiceName = voice ? voice.name : "";
  localStorage.setItem("connie_speaking_voice_uri", speakingVoiceURI);
  localStorage.setItem("connie_speaking_voice_name", speakingVoiceName);
  saveSpeakingVoiceToServer();
  if (opts.announce !== false && voice) {
    const kind = classifySpeechVoice(voice);
    const label = kind === "Female" ? "a girl's voice" : kind === "Male" ? "a male voice" : "this voice";
    speakText("Hello, I'm Connie, your personal assistant, speaking in " + label + " now.", voice);
  }
  return voice;
}
function findSpeechVoiceForRequest(low) {
  // Accent first, then girl/male/named: "an Australian girl voice"
  // means a female voice from the Australian voices on this device,
  // and "a Mexican voice" means a voice from the Mexican voices on
  // this device. Accents come only from the accent / language name
  // the device gives a voice (for example en-AU, es-MX). The bot
  // never labels a voice by race or ethnicity — only by the accent
  // or language name the device gives it.
  let vs = getSpeechVoices();
  if (!vs.length) return {error: "none"};
  const ACCENTS = {
    australian: ["en-au", "australian"], mexican: ["es-mx", "mexican"],
    british: ["en-gb", "british", "uk english"], american: ["en-us", "american"],
    canadian: ["en-ca", "canadian"], indian: ["en-in", "indian"],
    "south african": ["en-za", "south african"], spanish: ["es-", "spanish"],
    french: ["fr-", "french"], german: ["de-", "german"],
    irish: ["en-ie", "irish"], "new zealand": ["en-nz", "new zealand"],
  };
  let accent = "";
  for (const [key, hints] of Object.entries(ACCENTS)) {
    if (low.includes(key)) {
      accent = key;
      vs = vs.filter(v => hints.some(h => (v.lang || "").toLowerCase().includes(h) || v.name.toLowerCase().includes(h)));
      break;
    }
  }
  if (accent && !vs.length) return {error: "no-accent", accent};
  if (/\b(girl|female|woman|lady|feminine)\b/.test(low)) {
    const f = vs.find(v => classifySpeechVoice(v) === "Female");
    return f ? {voice: f, kind: "female", accent} : {error: "no-female", accent};
  }
  if (/\b(boy|male|man|masculine)\b/.test(low)) {
    const m = vs.find(v => classifySpeechVoice(v) === "Male");
    return m ? {voice: m, kind: "male", accent} : {error: "no-male", accent};
  }
  if (/default|normal|original|usual/.test(low)) return {voice: null, kind: "default"};
  const words = low.replace(/[^a-z ]/g, " ").split(/\s+/).filter(w => w.length >= 3);
  const named = vs.find(v => {
    const nameWords = v.name.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter(w => w.length >= 3);
    return nameWords.some(w => words.includes(w));
  });
  if (named) return {voice: named, kind: "named", accent};
  // An accent was asked for, with no girl/male word and no name:
  // "a Mexican voice" means the first voice in that accent on
  // this device, not an error.
  if (accent) return {voice: vs[0], kind: "accent", accent};
  return {error: "unclear", accent};
}
function accentLabel(v) {
  // The accent / language name the DEVICE gives this voice
  // (its language code, e.g. en-AU, es-MX, and its name). The bot
  // never labels a voice by race or ethnicity — only by the accent
  // or language name the device gives it.
  const lang = (v.lang || "").toLowerCase();
  const name = (v.name || "").toLowerCase();
  const map = [
    ["en-au", "Australian English"], ["en-gb", "British English"], ["en-us", "American English"],
    ["en-ca", "Canadian English"], ["en-in", "Indian English"], ["en-za", "South African English"],
    ["en-ie", "Irish English"], ["en-nz", "New Zealand English"],
    ["es-mx", "Mexican Spanish"], ["es-es", "Spanish (Spain)"], ["es-us", "Spanish (US)"],
    ["es-", "Spanish"], ["fr-", "French"], ["de-", "German"], ["pt-br", "Brazilian Portuguese"],
    ["pt-", "Portuguese"], ["it-", "Italian"], ["ja-", "Japanese"], ["ko-", "Korean"], ["zh-", "Chinese"],
  ];
  for (const [code, label] of map) if (lang.startsWith(code)) return label + " (" + (v.lang || "") + ")";
  if (name.includes("australian")) return "Australian English";
  if (name.includes("mexican")) return "Mexican Spanish";
  return v.lang || "language not labelled by this device";
}
async function renderVoiceChoiceList() {
  const el = $("#voiceChoiceList"); if (!el) return;
  const vs = await loadSpeechVoices();
  if (!("speechSynthesis" in window)) { el.innerHTML = "<p>Talking back is not available in this browser, so there is no voice to pick here.</p>"; return; }
  if (!vs.length) { el.innerHTML = "<p>No voices are available on this device yet — try again, or use a different browser. The voices come from the device itself.</p>"; return; }
  const groups = {Female: [], Male: [], Other: []};
  vs.forEach((v, i) => groups[classifySpeechVoice(v)].push({v, i}));
  const cur = chosenSpeechVoice();
  el.innerHTML = `<p>Current voice: <strong>${esc(cur ? cur.name + " (" + classifySpeechVoice(cur) + ")" : "your device's default voice")}</strong></p>`
    + Object.entries(groups).filter(([, a]) => a.length).map(([g, arr]) =>
      `<h3>${g} voices</h3>` + arr.map(({v, i}) =>
        `<div class="row"><span>${esc(v.name)} — ${esc(accentLabel(v))}</span><button type="button" class="secondary small" onclick="sampleSpeakingVoice(${i})">▶ Hear it</button><button type="button" class="small" onclick="pickSpeakingVoice(${i})">${cur && cur.voiceURI === v.voiceURI ? "✓ Using this one" : "Use this voice"}</button></div>`).join("")).join("")
    + `<div class="row"><button type="button" class="secondary" onclick="clearSpeakingVoice()">Use my device's default voice</button></div>`
    + `<p class="muted">Voices come from your device / browser — the list is different on different phones and computers, and a voice that is not listed here is not available on this device. Voices are listed by the accent / language the device gives them (for example Australian English, Mexican Spanish). The bot does not label a voice by race — only by the accent or language name the device gives it. There is no live AI voice model in this bot.</p>`;
}
window.sampleSpeakingVoice = async function (i) {
  const vs = await loadSpeechVoices(); const v = vs[i];
  if (!v) { flash("That voice is not on this device."); return; }
  speakText("Hello, I'm Connie. This is how I sound in this voice.", v);
};
window.pickSpeakingVoice = async function (i) {
  const vs = await loadSpeechVoices(); const v = vs[i];
  if (!v) { flash("That voice is not on this device."); return; }
  await setSpeakingVoice(v);
  flash("Voice changed to " + v.name + ".", true);
  if (currentTab === "settings") renderSettings($("#view"));
};
window.clearSpeakingVoice = async function () {
  await setSpeakingVoice(null, {announce: false});
  flash("Back to your device's default voice.", true);
  if (currentTab === "settings") renderSettings($("#view"));
};

/* ---------- Permission first — ask, like Remy does ----------
   The bot asks for permission first, every time it needs to look
   at a person's records, do a job, or use a connected tool. It
   shows plainly what it wants to do and whose records it wants to
   use, then waits for that person's yes. If they say no, or do not
   answer, it does nothing.
   Access is per-person only: the server already keeps every user's
   records separate (each record belongs to one signed-in user, and
   nobody else can see George's records — this copy is for George only), and a grant
   here covers only the person who said yes, only for what they
   said yes to, and only for this sign-in. Take it back any time in
   Settings — the bot asks again next time. */
let grantedPermissions = new Set();   // scopes granted this sign-in
let pendingPermission = null;         // {what, scope, resolve}
function permissionScopeFor(text) {
  const low = text.toLowerCase();
  if (/multitask|several things|at once|at the same time|run .* (inventory|invoice|money|usage|product)/.test(low)) return {scope: "jobs", what: "run several jobs at once using your inventory, invoices and money records"};
  if (/how much (am i owed|did i (spend|make|earn))|unpaid invoices|total (income|spending|spent)/.test(low)) return {scope: "money", what: "look at your invoices and transactions to work out your money totals"};
  if (/what'?s (on|due) (today|tomorrow)|what do i have/.test(low)) return {scope: "today", what: "look at your appointments, tasks and reminders for that day"};
  if (/remind me|add (a )?(task|reminder)/.test(low)) return {scope: "tasks", what: "save a task or reminder in your records"};
  if (/add (an? )?invoice/.test(low)) return {scope: "invoices", what: "draft an invoice in your records"};
  if (/add (a )?customer/.test(low)) return {scope: "customers", what: "draft a customer in your records"};
  if (/^(learn|remember|teach me)\b/.test(low) || /learn this|remember (this|that)/.test(low)) return {scope: "learn", what: "save this as something I learned, in your own records on this server only"};
  if (/find|search|look up|show me|where is|do i have/.test(low)) return {scope: "records", what: "search your saved records"};
  if (/(draft|write|make|create)/.test(low) && /(description|plan|list|letter|note|email|outline|checklist)/.test(low)) return {scope: "drafts", what: "draft something for you to check (nothing is saved or sent until you approve it)"};
  return null;
}
function requestPermission(what, scope) {
  if (currentTab === "assistant") {
    return new Promise((resolve) => {
      pendingPermission = {what, scope, resolve};
      renderAssistant($("#view"));
      const el = $("#permissionCard"); if (el) el.scrollIntoView({block: "center"});
    });
  }
  // Not on the Assistant screen (e.g. the Tasks screen): ask with the
  // browser's own yes/no box instead, and wait for the answer.
  const yes = window.confirm("Can I " + what + "?\n\nYour records only — " + username + "'s, nobody else's. OK means yes, Cancel means no.");
  if (yes) grantedPermissions.add(scope);
  return Promise.resolve(yes);
}
window.answerPermission = function (yes) {
  if (!pendingPermission) return;
  const p = pendingPermission; pendingPermission = null;
  if (yes) grantedPermissions.add(p.scope);
  p.resolve(yes);
};
window.revokePermissions = function () {
  grantedPermissions.clear();
  flash("Permissions taken back. The bot will ask again before it looks at your records.", true);
  if (currentTab === "settings") renderSettings($("#view"));
  else if (currentTab === "assistant") renderAssistant($("#view"));
};
async function ensurePermissionForJobs() {
  if (grantedPermissions.has("jobs")) return true;
  const yes = await requestPermission("run a job using your saved records", "jobs");
  if (!yes) flash("OK — I didn't run the job, and I looked at nothing.");
  return yes;
}
function permissionLine() {
  if (!grantedPermissions.size) return "I ask first, every time. I only see what you said yes to — nothing yet this sign-in.";
  return "You said yes to: " + [...grantedPermissions].join(", ") + ". I only see what you said yes to — take it back any time in Settings.";
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || "GET",
    headers: {"Content-Type": "application/json", ...(token ? {Authorization: "Bearer " + token} : {})},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch (e) { /* empty body */ }
  if (!res.ok) throw new Error(data.error || ("Request failed (" + res.status + ")"));
  return data;
}
function flash(msg, good) {
  const el = $("#flash"); if (!el) return;
  el.textContent = msg || ""; el.className = "msg" + (good ? " good" : "");
}
async function loadAll() {
  const d = await api("/api/records");
  records = {};
  for (const r of d.records || []) { (records[r.kind] = records[r.kind] || []).push(r); }
}
function list(kind) { return records[kind] || []; }
function first(kind) { return list(kind)[0] || null; }
function taxRate() {
  const s = first("settings");
  const n = s ? Number(s.data.tax_reserve) : 25;
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : 25;
}

/* ---------- auth ---------- */
function setMode(m) {
  mode = m;
  $("#authTitle").textContent = m === "register" ? "Create account" : m === "recover" ? "Forgot password" : "Sign in";
  $("#authGo").textContent = m === "register" ? "Create account" : m === "recover" ? "Reset password" : "Sign in";
  $("#pwLabel").hidden = (m === "recover");
  $("#pwLabel input").required = (m !== "recover");
  $("#newPwLabel").hidden = (m !== "recover");
  $("#newPwLabel input").required = (m === "recover");
  $("#codeLabel").hidden = (m !== "recover");
  $("#codeLabel input").required = (m === "recover");
  $("#authMsg").textContent = "";
  $("#recoveryShow").hidden = true;
}
async function doAuth(e) {
  e.preventDefault();
  const f = e.target;
  const body = {username: f.username.value.trim().toLowerCase(), password: f.password.value};
  let path = "/api/login";
  if (mode === "register") path = "/api/register";
  if (mode === "recover") { path = "/api/recover"; body.recovery_code = f.recovery_code.value.trim(); body.new_password = f.new_password.value; }
  try {
    const d = await api(path, {method: "POST", body});
    token = d.token; username = d.username;
    localStorage.setItem("connie_token", token); localStorage.setItem("connie_username", username);
    if (d.recovery_code) {
      const box = $("#recoveryShow"); box.hidden = false;
      box.innerHTML = "<strong>Save this recovery code somewhere safe — it is shown only once:</strong><br>" + esc(d.recovery_code);
    }
    await enterApp();
  } catch (err) { $("#authMsg").textContent = err.message; }
}
async function enterApp() {
  try {
    health = await api("/api/health");
    const me = await api("/api/me");
    username = me.username;
    $("#auth").hidden = true; $("#app").hidden = false;
    $("#who").hidden = false; $("#whoName").textContent = "Signed in as " + username;
    await loadAll();
    await loadVoice();
    await loadSpeechVoices();
    // Restore the speaking voice saved in your settings record, if
    // this device actually has that voice. The choice on this device
    // (localStorage) wins when it is set.
    const _s = first("settings");
    if (!speakingVoiceURI && _s && _s.data.speaking_voice_uri) {
      speakingVoiceURI = _s.data.speaking_voice_uri;
      speakingVoiceName = _s.data.speaking_voice_name || "";
      localStorage.setItem("connie_speaking_voice_uri", speakingVoiceURI);
      localStorage.setItem("connie_speaking_voice_name", speakingVoiceName);
    }
    await ensureConnieGirlVoice();  // Connie starts as a girl: first female voice on this device.
    renderTabs(); showTab(currentTab);
  } catch (err) {
    token = ""; localStorage.removeItem("connie_token");
    $("#authMsg").textContent = "Please sign in again: " + err.message;
  }
}
function signOut() {
  if (token) api("/api/logout", {method: "POST", body: {}}).catch(() => {});
  token = ""; username = "";
  localStorage.removeItem("connie_token"); localStorage.removeItem("connie_username");
  $("#app").hidden = true; $("#who").hidden = true; $("#auth").hidden = false;
  $("#authForm").reset(); setMode("login");
}

/* ---------- generic record screens ---------- */
const FIELDS = {
  customers: [["name","Name","text",1],["phone","Phone","text"],["email","Email","text"],["notes","Notes","textarea"]],
  appointments: [["title","Service / title","text",1],["customer","Customer","text"],["date","Date","date"],["time","Time","text"],["status","Status","select:Scheduled,Completed,Cancelled"],["notes","Notes","textarea"]],
  calls: [["caller","Caller","text",1],["phone","Phone","text"],["summary","What they wanted","textarea"],["urgent","Urgent — needs a person","checkbox"],["follow_up","Follow-up","text"]],
  jobs: [["title","Job","text",1],["customer","Customer","text"],["address","Address","text"],["status","Status","select:New,In progress,Done"],["notes","Notes","textarea"]],
  invoices: [["customer","Customer","text",1],["title","What it is for","text"],["amount","Amount ($)","number"],["due","Due date","date"],["status","Status","select:Draft,Sent,Paid,Overdue"],["notes","Notes","textarea"]],
  transactions: [["date","Date","date"],["kind","Type","select:Income,Expense"],["category","Category","text"],["amount","Amount ($)","number",1],["notes","Notes","textarea"]],
  inventory: [["item","Item","text",1],["quantity","Quantity on hand","number"],["low_stock","Low-stock level","number"],["unit_cost","Cost each ($)","number"],["sell_price","Sell price ($)","number"],["supplier","Supplier","text"]],
  tasks: [["title","Task","text",1],["due","Due date","date"],["priority","Priority","select:Low,Medium,High"],["done","Done","checkbox"]],
  reminders: [["title","Reminder","text",1],["due","Due date","date"],["done","Done","checkbox"]],
  products: [["title","Product title","text",1],["kind","Type","text"],["audience","Audience","text"],["price","Price ($)","number"],["description","Description","textarea"],["status","Status","select:Draft,Ready"],["pay_link","Payment link (optional — leave blank until Stripe is set up)","text"]],
  campaigns: [["name","Campaign","text",1],["channel","Channel","text"],["budget","Budget ($)","number"],["status","Status","select:Draft,Running,Done"],["notes","Notes","textarea"]],
  household: [["title","Item","text",1],["category","Category","text"],["notes","Notes","textarea"],["done","Done","checkbox"]],
  shopping: [["item","Item","text",1],["quantity","Quantity","number"],["notes","Notes","textarea"],["done","Bought","checkbox"]],
  meals: [["title","Meal / plan","text",1],["day","Day","text"],["notes","Notes","textarea"]],
  notes: [["title","Title","text",1],["body","Note","textarea"]],
};
function fieldHtml(kind, f, val) {
  const [name, label, type] = f;
  const v = val ?? "";
  if (type === "textarea") return `<label class="wide">${esc(label)}<textarea name="${name}">${esc(v)}</textarea></label>`;
  if (type === "checkbox") return `<label><input type="checkbox" name="${name}" ${v === true || v === "true" ? "checked" : ""}> ${esc(label)}</label>`;
  if (type.startsWith("select:")) {
    const opts = type.slice(7).split(",");
    return `<label>${esc(label)}<select name="${name}">${opts.map(o => `<option ${String(v) === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></label>`;
  }
  return `<label>${esc(label)}<input type="${type}" name="${name}" value="${esc(v)}" ${f[3] ? "required" : ""}></label>`;
}
function formData(form) {
  const d = {};
  for (const [name, , type] of FIELDS[form.dataset.kind] || []) {
    const el = form.elements[name]; if (!el) continue;
    if (type === "checkbox") d[name] = el.checked;
    else if (type === "number") d[name] = el.value === "" ? "" : Number(el.value);
    else d[name] = el.value;
  }
  return d;
}
async function saveRecord(kind, form) {
  const data = formData(form);
  try {
    if (editing[kind]) await api("/api/records/" + editing[kind], {method: "PUT", body: {data}});
    else await api("/api/records", {method: "POST", body: {kind, data}});
    editing[kind] = null; draftPrefill = null; await loadAll(); showTab(currentTab); flash("Saved.", true);
  } catch (err) { flash(err.message); }
}
async function deleteRecord(kind, id) {
  if (!confirm("Delete this record? This cannot be undone.")) return;
  try { await api("/api/records/" + id, {method: "DELETE"}); await loadAll(); showTab(currentTab); flash("Deleted.", true); }
  catch (err) { flash(err.message); }
}
function renderKind(kind, title, extra) {
  const rows = list(kind);
  const ed = editing[kind] ? rows.find(r => r.id === editing[kind]) : null;
  const fields = FIELDS[kind];
  let h = `<div class="panel"><h2>${esc(title)}</h2>${extra || ""}`;
  h += `<form data-kind="${kind}" onsubmit="event.preventDefault();saveRecord('${kind}',this)">`;
  for (const f of fields) {
    // A draft sent from the Assistant pre-fills this form (see openTabWithDraft).
    const pre = (!ed && draftPrefill && draftPrefill.kind === kind) ? draftPrefill.data[f[0]] : undefined;
    h += fieldHtml(kind, f, pre !== undefined ? pre : (ed ? ed.data[f[0]] : (f[1] === "Date" ? today() : "")));
  }
  h += `<button type="submit">${ed ? "Save changes" : "Add"}</button>`;
  if (ed) h += ` <button type="button" class="secondary" onclick="cancelEdit('${kind}')">Cancel edit</button>`;
  h += `</form></div>`;
  if (!rows.length) return h + `<p class="muted">Nothing here yet — add your first one above.</p>`;
  h += `<div class="panel scroll"><table><thead><tr><th>${fields.slice(0, 4).map(f => esc(f[1])).join("</th><th>")}</th><th></th></tr></thead><tbody>`;
  for (const r of rows) {
    h += "<tr>" + fields.slice(0, 4).map(f => {
      let v = r.data[f[0]];
      if (f[2] === "number" && (f[0] === "amount" || f[0].includes("price") || f[0].includes("cost") || f[0] === "budget")) v = money(v);
      if (f[2] === "checkbox") v = v ? "Yes" : "—";
      return `<td>${esc(v ?? "")}</td>`;
    }).join("") + `<td><button class="small secondary" onclick="startEdit('${kind}','${r.id}')">Edit</button> <button class="small danger" onclick="deleteRecord('${kind}','${r.id}')">Delete</button></td></tr>`;
  }
  return h + "</tbody></table></div>";
}
function startEdit(kind, id) { editing[kind] = id; showTab(currentTab); }
function cancelEdit(kind) { editing[kind] = null; showTab(currentTab); }
window.saveRecord = saveRecord; window.deleteRecord = deleteRecord;
window.startEdit = startEdit; window.cancelEdit = cancelEdit;

function notConnectedPanel(title, what) {
  return `<div class="warning"><strong>${esc(title)} — not connected.</strong> ${esc(what)} Nothing here is live, and nothing is sent anywhere until you connect it and approve it.</div>`;
}

/* ---------- tabs ---------- */
const TABS = [
  ["assistant","Assistant"], ["frontdesk","Front Desk"], ["invoices","Invoices"],
  ["money","Money"], ["inventory","Inventory"], ["tasks","Tasks"],
  ["products","Products & Marketing"], ["personal","Personal"], ["trading","Paper Trading"], ["learning","Learning"], ["settings","Settings"], ["integrations","Integrations"],
];
function renderTabs() {
  $("#tabs").innerHTML = TABS.map(([id, label]) =>
    `<button data-tab="${id}" class="${id === currentTab ? "active" : ""}">${esc(label)}</button>`).join("");
  $$("#tabs button").forEach(b => b.onclick = () => showTab(b.dataset.tab));
}
function showTab(id) {
  if (pendingPermission) { const p = pendingPermission; pendingPermission = null; p.resolve(false); }
  currentTab = id; renderTabs();
  const v = $("#view"); flash("");
  if (id === "assistant") return renderAssistant(v);
  if (id === "frontdesk") return renderFrontDesk(v);
  if (id === "invoices") return renderInvoices(v);
  if (id === "money") return renderMoney(v);
  if (id === "inventory") return renderInventory(v);
  if (id === "tasks") return renderTasks(v);
  if (id === "products") return renderProducts(v);
  if (id === "personal") return renderPersonal(v);
  if (id === "trading") return renderTrading(v);
  if (id === "learning") return renderLearning(v);
  if (id === "settings") return renderSettings(v);
  if (id === "integrations") return renderIntegrations(v);
}

/* ---------- Research to upgrade me — $250, ask first ----------
   George's words: Connie should learn on her own by researching, so
   she gets smarter — but only after she asks and George says yes, and
   only within what he agreed to. She never researches everything in
   the world at once, and she never learns on her own without
   permission. The button shows the $250 cost up front. No payment is
   live: no Stripe, no checkout, nothing is charged here — the $250 is
   a price George set, not a live charge. If no AI key is connected,
   research cannot run at all, and Connie says so plainly. */
window.showResearchUpgrade = function () {
  const box = $("#researchUpgradeBox"); if (!box) return;
  box.innerHTML = `<div class="panel"><h3>Can I do research to learn and get smarter?</h3>
    <p>This costs an <strong>additional $250</strong>. <strong>No payment is live — nothing is charged here.</strong> There is no Stripe and no checkout in this copy.</p>
    <label class="wide">What should I research? (only this — I will not research everything in the world at once)<input id="researchTopic" placeholder="e.g. better ways to price my plumbing jobs"></label>
    <div class="row"><button type="button" onclick="confirmResearchUpgrade()">Yes — research this, for $250</button>
    <button type="button" class="secondary" onclick="cancelResearchUpgrade()">No, not now</button></div>
    <p id="researchMsg" class="msg"></p></div>`;
};
window.cancelResearchUpgrade = function () {
  const box = $("#researchUpgradeBox"); if (box) box.innerHTML = "";
  flash("OK — no research, and nothing was charged.", true);
};
window.confirmResearchUpgrade = async function () {
  const topic = ($("#researchTopic") || {}).value || "";
  const msg = $("#researchMsg");
  if (!topic.trim()) { if (msg) msg.textContent = "Tell me what to research first — one thing, so I stay inside what you agreed to."; return; }
  if (!(health && health.ai_enabled)) {
    if (msg) msg.textContent = "You said yes, and thank you — but I can't research yet: no AI key is connected on the server, so there is nothing to research with. No $250 was charged. Connect an AI key first, then ask me again.";
    return;
  }
  if (msg) msg.textContent = "Researching — only what you agreed to: " + topic;
  if (!(await ensureVoiceForJobs())) { if (msg) msg.textContent = "I need to know it's you first — check your voice, then your passcode, and ask me again."; return; }
  try {
    const d = await api("/api/ai/chat", {method: "POST", body: {messages: [{role: "user", content: "Research this so you can learn and get smarter, only within this topic, and tell George what you learned in plain words: " + topic}], voice_token: voiceToken || undefined, passcode_token: passcodeToken || undefined}});
    chatHistory.push({role: "user", content: "Research to upgrade me: " + topic});
    chatHistory.push({role: "assistant", content: d.reply || d.error || "Research done — see above."});
    if (msg) msg.textContent = "Research done. I answered in the chat below, in my girl's voice if you tap Read aloud. No $250 was charged — no payment is live in this copy.";
    showTab("assistant");
  } catch (err) { if (msg) msg.textContent = "Research could not run: " + (err.message || err) + ". Nothing was charged."; }
};
window.hearConnieHello = async function () {
  await ensureConnieGirlVoice();
  const v = chosenSpeechVoice();
  speakText(connieIntro(), v);
  flash("That's Connie — in a girl's voice.", true);
};

function renderAssistant(v) {
  const aiOn = !!(health && health.ai_enabled);
  v.innerHTML = `
  <div class="panel"><h2>Connie — George's Assistant — ask her anything</h2>
    <p class="muted">This is Connie, George's personal assistant. She helps George inside George's Assistant. It is <strong>not Remy</strong> — Remy is George's personal assistant in the Muse app, for George only, and customers cannot talk to Remy through this bot.</p>
    <p class="muted">Type or dictate <strong>any</strong> request in plain words and the bot will do it in the app, draft it for you to approve, or take you to the right screen with the draft already filled in. It only writes text and drafts — it never calls, charges, files, publishes or orders anything on its own. Anything that affects a customer, money or an account needs your review first.</p>
    ${aiOn ? `<p class="ok">AI is connected on the server.</p>` : `<div class="warning"><strong>AI is not connected yet.</strong> Add an AI key on the server (see README) to turn live chat on. Until then the Assistant still works for everything below that does not need live AI — searching your records, adding tasks and reminders, working out numbers, and drafting things for you.</div>`}
    <div class="panel"><h2>Which bot answers?</h2>
      <p class="muted">Pick which AI bot answers your live chat questions. Only a bot whose key is set on the server is Available — the other one just says so until George adds its key. Only George uses this copy. This is not open to the public.</p>
      <div class="row">${["allinone", "anthropic", "openai", "opus"].map(p => {
        const name = {"allinone": "All in One — all three brains together", "anthropic": "Claude Fable 5.2 (Anthropic) — #1, top level", "openai": "GPT-6.2 Astra (OpenAI) — top level", "opus": "Claude Opus 5.5 (Anthropic) — top level"}[p];
        const on = p === "allinone" ? !!(integrationStatus && integrationStatus.allinone_available) : ((integrationStatus && integrationStatus.providers) || []).includes(p);
        const picked = aiProvider === p;
        return `<button type="button" class="${picked ? "" : "secondary"}" onclick="pickAiProvider('${p}')">${esc(name)} — ${on ? (picked ? "✓ Using this one" : "Available") : "Not connected — needs your key"}</button>`;
      }).join("")}</div>
      ${lastAiProvider ? `<p class="muted">Last live reply came from: ${esc({"allinone": "All in One (" + (window.lastBrains || []).join(" + ") + ")", "anthropic": "Claude Fable 5.2 (Anthropic)", "openai": "ChatGPT (OpenAI)", "opus": "Claude Opus 5.5 (Anthropic)"}[lastAiProvider] || "Claude (Anthropic)")}</p>` : ""}
    </div>
    <details><summary><strong>What can I ask it to do?</strong></summary>
    <ul>
      <li><strong>Find things:</strong> "find the invoice for Smith" — searches your customers, jobs, invoices, inventory, notes and everything else you saved.</li>
      <li><strong>Money:</strong> "how much am I owed?" / "how much did I spend?" — totals from your invoices and transactions (your entered figures — estimates, not bank balances).</li>
      <li><strong>Today:</strong> "what's on today?" — today's appointments, tasks and reminders.</li>
      <li><strong>Remember it:</strong> "remind me to call Smith tomorrow" / "add a task to buy paint" — saves a reminder or task.</li>
      <li><strong>Teach me something — Fast Learn:</strong> "learn this: Smith prefers morning appointments" for one thing, or "learn these: Smith likes mornings; the shop opens at 8; paint is in the garage" for several at once — I ask first, one yes covers the whole list, and only save it when you say yes. I say "I learned: ..." for each one. My knowledge is open: everything I learned is on the Learning screen, searchable, with no cap. I will say no, with the reason, if you ask me to learn something against the law.</li>
      <li><strong>What do I know?</strong> "what do you know" / "what are the laws" — I will tell you what I know, including the plain-words law summary (general information only, not legal advice). The full summary is on the Learning screen.</li>
      <li><strong>Start something:</strong> "add an invoice for Smith, $150, for fixing a leak" / "add a customer called Jones" — opens that screen with the details filled in for you to check and save.</li>
      <li><strong>Write it for me:</strong> "draft a product description for my plumbing planner, $39.95" / "draft a plan for the kitchen job" / "make a shopping list" — writes a draft you can save as a note or send on to the right screen.</li>
      <li><strong>Work it out:</strong> "what is 25% of 400?" / "what is 150 + 85?" — does the maths in the app.</li>
      <li><strong>Do several things at once:</strong> "run inventory check, invoice draft and money totals at the same time" — starts those jobs together, each with its own progress on the Tasks screen. Jobs start only when you ask — the bot never starts one on its own, and a job never sends, charges, publishes or deletes anything.</li>
      <li><strong>Voice recognition + passcode:</strong> enrol your voice in Settings and set a passcode there, and the bot only runs jobs for that voice plus that passcode — voice first, then passcode. A different voice, or a wrong passcode, stops there. It is a safety feature, not a secure ID, and it alone never authorises taxes, bank access, payments, publishing or sending anything.</li>
      <li><strong>Change my voice:</strong> "change your voice to a girl voice" / "use a male voice" / "use Samantha's voice" / "an Australian girl voice" / "a Mexican voice" — I switch right away and answer back in the new voice, out loud. Or pick one in Settings — Voice choice. This only changes how I sound; it does not change who can unlock the bot.</li>
      <li><strong>Permission first:</strong> before I look at your records, do a job, or use a connected tool, I ask you first and wait for your yes — like Remy does. I only see what you said yes to, and only your records, never anyone else's. Say no and I do nothing.</li>
      <li><strong>Ask the live AI</strong> (only when an AI key is set on the server): research a question, explain something, or write a longer draft. Pick which bot answers — Claude Fable 5.2 (Anthropic), ChatGPT GPT-6.2 Astra (OpenAI), or Claude Opus 5.5 (Anthropic) — in the "Which bot answers?" box above; only a bot whose key is set shows as Available.</li>
      <li><strong>Connect other bots:</strong> "show me integrations" — opens the Crosswalk hub, where Claude, ChatGPT, Stripe, calendar, phone and the rest can be plugged in. "What connectors do I have?" lists them, including any app or bot you added yourself. "Add any connector" on the Integrations screen plugs in a new app — it is plugged in but NOT connected until its key/account is set on the server and you approve it.</li>
    </ul>
    <p class="muted"><strong>It cannot do these, even if you ask:</strong> place or answer a phone call, send a message or email, charge a card, move money, file taxes, publish a product, or place an order. Those need a provider you connect later, and your approval each time. It also cannot look things up on the live internet — it only knows what you have saved in the bot, plus what the live AI knows when that is connected.</p>
    </details>
    <div class="panel"><h2>Talk to Remy</h2>
      <p class="muted">There is <strong>no key for Remy</strong> — Remy lives in the Muse app, and no key can be made for it. Open Muse and talk to Remy there, by text or voice call, and Remy can help with this bot, your records, your trading desk, Stripe / Whop / Etsy steps, and anything else. This is for George, the owner, only — nobody else uses this copy, so nobody else can talk to Remy through it through this bot, and George's private records and money are never shared with them. Inside this bot Remy is <strong>not</strong> live: the assistant here is the Connie, which works from the bot's own screens, and for live AI chat it uses your own Anthropic or OpenAI key.</p></div>
    <div class="panel"><h2>Built-in helpers — in this bot</h2>
      <p class="muted">These are features of this bot itself, not a live Remy connection: the do-anything Assistant above (search your records, money totals, tasks and reminders, drafts, maths); the Money screen with its tax-reserve ledger; the Paper Trading view (paper only); Front Desk, Invoices, Inventory, Products and your own product drafts. They work from what you have saved in the bot.</p></div>
    <div class="panel"><h2>🔬 Research to upgrade me</h2>
      <p class="muted">Ask Connie to do research so she can learn and get smarter. <strong>She asks you first, every time</strong> — she only researches what you agreed to, and she does not research everything in the world at once. This costs an <strong>additional $250</strong>.</p>
      <p class="muted"><strong>No payment is live — nothing is charged here.</strong> There is no Stripe and no checkout in this personal copy, so the $250 is not taken. When payment is set up, George approves the $250 first, before any research starts.</p>
      <div class="row"><button type="button" onclick="showResearchUpgrade()">🔬 Research to upgrade me — $250</button></div>
      <div id="researchUpgradeBox"></div></div>
    <div class="panel"><h2>What I've learned</h2>
      <p class="muted">Fast Learn: I can learn several things at once, only when you say yes to the list. Learning is local notes only: it does not retrain the model, does not change the model, and does not go to the internet.</p>
      ${learnedNotes().length ? `<p class="muted">I have learned ${learnedNotes().length} thing${learnedNotes().length === 1 ? "" : "s"} — all of them are on the Learning screen, searchable, with no cap.</p><ul>${learnedNotes().slice(-5).map(r => `<li>${esc(r.data.text || "")}</li>`).join("")}</ul>` : `<p class="muted">Nothing learned yet. Teach me — "learn this: ..." for one thing, or "learn these: ..." for several at once — and I will ask first, then save it when you say yes.</p>`}
      <div class="row"><button type="button" class="secondary" onclick="showTab('learning')">Open Learning — everything I learned, what I know, and the law summary</button></div></div>
    <div class="chat" id="chatBox">${chatHistory.map(m => `<div class="bubble ${m.role}">${esc(m.content)}</div>`).join("") || `<div class="bubble bot">Hello, George. I'm Connie, your personal assistant, in a girl's voice. What would you like help with today? Try "what's on today?", "how much am I owed?", or "remind me to call a customer tomorrow".</div><div class="row"><button type="button" class="secondary" onclick="hearConnieHello()">🔊 Hear Connie say hello</button></div>`}</div>
    ${pendingPermission ? `<div class="panel" id="permissionCard"><h2>Can I look at your records?</h2><p>I want to <strong>${esc(pendingPermission.what)}</strong> — your records only, ${esc(username)}'s, nobody else's. Is that OK?</p><p class="muted">I ask first, every time. If you say no, I do nothing — I won't look at your records at all.</p><div class="row"><button type="button" onclick="answerPermission(true)">Yes, you can</button><button type="button" class="secondary" onclick="answerPermission(false)">No, don't</button></div></div>` : ""}
    <form id="chatForm" style="margin-top:10px">
      <label class="wide">Message<textarea name="msg" required></textarea></label>
      <button type="submit">Send</button>
      <button type="button" class="secondary" id="dictateBtn">🎤 Dictate</button>
      <button type="button" class="secondary" id="readBtn">🔊 Read last reply aloud</button>
    </form>
    <div class="row" id="chatActions">${assistantActions.map((a, i) => `<button type="button" class="secondary" data-action="${i}">${esc(a.label)}</button>`).join("")}</div>
    <p id="chatMsg" class="msg"></p>
    <p class="muted">${esc(permissionLine())} <button type="button" class="secondary small" onclick="revokePermissions()">Take back permission</button></p>
  </div>
  <div class="panel"><h2>Saved context</h2>
    <p class="muted">Sent with your question so the assistant knows your business (your own figures, entered by you — estimates, not bank balances).</p>
    <p>Customers: ${list("customers").length} · Appointments: ${list("appointments").length} · Open jobs: ${list("jobs").filter(j => j.data.status !== "Done").length} · Unpaid invoices: ${list("invoices").filter(i => i.data.status !== "Paid").length} · Inventory items: ${list("inventory").length}</p>
  </div>
  ${notConnectedPanel("Phone / receptionist", "Live call answering needs a phone provider you choose and connect. For now, log calls by hand on the Front Desk tab.")}
  ${notConnectedPanel("Payments", "No Stripe or payment provider is connected. Nothing is for sale in this personal copy.")}
  ${notConnectedPanel("Bank feeds & tax filing", "No bank feed or tax-filing provider is connected. Money figures here are your own entered estimates.")}
  <p class="muted">If a request is uncertain, urgent or sensitive, the assistant should hand it to you, the owner — it does not guess.</p>
  <p class="fineprint"><small>© 2026 George Wederski. All rights reserved. No part of this book/app may be copied, reproduced, or shared without written permission from George Wederski.</small></p>`;
  $("#chatForm").onsubmit = sendChat;
  $("#dictateBtn").onclick = dictate;
  $("#readBtn").onclick = readAloud;
  $$("#chatActions button").forEach(b => b.onclick = () => doAssistantAction(Number(b.dataset.action)));
  // The picker needs the live provider list — fetch it once if unknown.
  if (!integrationStatus && !integrationStatusLoading) {
    integrationStatusLoading = true;
    api("/api/status").then(d => {
      integrationStatus = d; integrationStatusLoading = false;
      if (currentTab === "assistant") renderAssistant($("#view"));
    }).catch(() => { integrationStatusLoading = false; });
  }
}
function pickAiProvider(p) {
  const on = p === "allinone" ? !!(integrationStatus && (integrationStatus.providers || []).length) : ((integrationStatus && integrationStatus.providers) || []).includes(p);
  if (!on) { flash(({"allinone": "All in One", "anthropic": "Claude Fable 5.2 (Anthropic)", "openai": "ChatGPT (OpenAI)", "opus": "Claude Opus 5.5 (Anthropic)"}[p] || "Claude (Anthropic)") + " is not connected — its key needs to be set on the server first."); return; }
  aiProvider = p;
  localStorage.setItem("connie_ai_provider", p);
  renderAssistant($("#view"));
}
window.pickAiProvider = pickAiProvider;
function openTabWithDraft(tab, kind, data) {
  draftPrefill = kind ? {kind, data: data || {}} : null;
  showTab(tab);
}
async function doAssistantAction(i) {
  const a = assistantActions[i]; if (!a) return;
  if (a.learnCancel) {
    pendingLearnList = [];
    chatHistory.push({role: "assistant", content: "OK — I didn't learn it, and I saved nothing."});
    assistantActions = []; renderAssistant($("#view"));
    return;
  }
  if (a.learn) {
    const done = Array.isArray(a.learn) ? await saveLearnedNotes(a.learn) : await saveLearnedNote(a.learn);
    chatHistory.push({role: "assistant", content: done.reply});
    assistantActions = done.ok ? [{label: "See what I learned (Learning screen)", tab: "learning"}] : [];
    renderAssistant($("#view"));
    const b2 = $("#chatBox"); if (b2) b2.scrollTop = b2.scrollHeight;
    return;
  }
  if (a.saveDraft) {
    if (!lastDraft) { flash("No draft to save yet — ask the Assistant to draft something first."); return; }
    try {
      await api("/api/records", {method: "POST", body: {kind: "notes", data: {title: a.saveDraft, body: lastDraft}}});
      await loadAll(); flash("Draft saved as a note.", true);
      chatHistory.push({role: "assistant", content: "Saved that draft as a note. You can find it on the Personal screen."});
      assistantActions = []; renderAssistant($("#view"));
    } catch (err) { flash(err.message); }
    return;
  }
  if (a.tab) openTabWithDraft(a.tab, a.kind, a.prefill);
}
window.openTabWithDraft = openTabWithDraft;

/* ---------- Assistant: do it in the app first, live AI second ----------
   handleOfflineRequest(text) returns {reply, actions} when the request
   can be handled with the owner's own saved records, or null when it
   needs the live AI (or cannot be done at all). It never calls, charges,
   files, publishes or orders anything — creating a task, reminder or
   note, or opening a screen with a draft, is all it does on its own. */
function searchRecords(term) {
  const t = term.toLowerCase();
  const hits = [];
  for (const [kind, rows] of Object.entries(records)) {
    for (const r of rows || []) {
      const text = Object.values(r.data || {}).join(" ").toLowerCase();
      if (text.includes(t)) hits.push({kind, r});
    }
  }
  return hits;
}
function calcExpression(text) {
  const pctOf = text.match(/([\d,]+(?:\.\d+)?)\s*%\s*of\s*\$?([\d,]+(?:\.\d+)?)/i);
  if (pctOf) {
    const p = parseFloat(pctOf[1].replace(/,/g, "")), base = parseFloat(pctOf[2].replace(/,/g, ""));
    return `${pctOf[1]}% of ${money(base)} is ${money(base * p / 100)}.`;
  }
  const m = text.match(/\$?([\d,]+(?:\.\d+)?)\s*([+\-*/x×])\s*\$?([\d,]+(?:\.\d+)?)/);
  if (!m) return null;
  const a = parseFloat(m[1].replace(/,/g, "")), b = parseFloat(m[3].replace(/,/g, ""));
  const op = m[2] === "x" || m[2] === "×" ? "*" : m[2];
  if (op === "/" && b === 0) return "I can't divide by zero.";
  const out = op === "+" ? a + b : op === "-" ? a - b : op === "*" ? a * b : a / b;
  return `${a} ${op} ${b} = ${Number.isInteger(out) ? out : out.toFixed(2)}.`;
}
function totalsText() {
  const unpaid = list("invoices").filter(i => i.data.status !== "Paid");
  const owed = unpaid.reduce((s, i) => s + (Number(i.data.amount) || 0), 0);
  const income = list("transactions").filter(t => t.data.kind === "Income").reduce((s, t) => s + (Number(t.data.amount) || 0), 0);
  const spent = list("transactions").filter(t => t.data.kind === "Expense").reduce((s, t) => s + (Number(t.data.amount) || 0), 0);
  const rate = taxRate();
  return `Unpaid invoices: ${unpaid.length} totalling ${money(owed)}. Income entered: ${money(income)}. Spending entered: ${money(spent)}. Balance of what you entered: ${money(income - spent)}. Tax reserve at ${rate}% of income: ${money(income * rate / 100)} (estimate only — not a tax bill, and no money has moved).`;
}
/* ---------- Learn — Fast Learn, open knowledge, ask first ----------
   George's words (2026-11-16): Connie should learn everything, fast —
   her knowledge is open. So: Fast Learn. George says "learn this: ..."
   for one thing, or "learn these: ..." for several things at once,
   Connie asks first (one yes covers the whole list), George says yes,
   and only then she saves each one as a learned note in her own records
   on this server, and says "I learned: ..." for each one, out loud and
   in chat. Learning here means saving what George teaches her as notes.
   It does NOT retrain the model, does NOT change the model, and does
   NOT go to the internet. Learned notes are used in future answers:
   they are shown on the Learning screen and in the Assistant, and sent
   with the question to the live AI (when a key is set) so it can use
   them. Her knowledge is open: the Learning screen shows everything
   she learned, searchable, with no cap on how many notes she holds.
   George can forget any note, or all of them, from the Learning screen.
   Connie refuses to learn anything against the law, and says why —
   that rule cannot be switched off.
   Speed: Connie is faster than the customer bot — 60 AI requests per user
   per hour (double the customer bot's 30), and no 5-hour session limit
   for George. */
let pendingLearnList = [];   // things George asked Connie to learn, waiting for his yes (only when auto-learn is off)
// Auto-learn on/off (George's choice, 2026-11-25): when on, Connie saves
// what she is taught and what she notices right away, without asking.
// The law refusal cannot be switched off. Turn it off on the Learning screen.
let AUTO_LEARN = (function(){ try { const v = localStorage.getItem("connie_auto_learn"); return v === null ? true : v === "1"; } catch(e){ return true; } })();
function setAutoLearn(on){ AUTO_LEARN = !!on; try { localStorage.setItem("connie_auto_learn", AUTO_LEARN ? "1" : "0"); } catch(e){} if (typeof showTab === "function" && typeof currentTab !== "undefined" && currentTab === "learning") showTab("learning"); }
window.setAutoLearn = setAutoLearn;
const UNLAWFUL_LEARN = [
  [/impersonate|pretend to be|pose as/i, "pretending to be someone else — a person, a business, or a government office — is impersonation, and the law bans it"],
  [/clone.*voice|copy.*voice|voice.*clone/i, "copying someone's voice without their clear consent is against voice/biometric law"],
  [/deepfake|non-consensual/i, "non-consensual synthetic images are a crime in Wyoming and under federal law"],
  [/(access|get into|break into|hack|log ?in as).*(someone else's|another person's|another customer's|their|his|her).*(phone|account|email|bank)/i, "getting into someone else's phone or account without their permission breaks computer-crime law"],
  [/fake (review|testimonial)s?|buy (fake )?reviews/i, "fake reviews are banned by the FTC — reviews must be from real people who really used the product"],
  [/steal|bypass.*(login|password|captcha|paywall)/i, "stealing, or bypassing a login or paywall, is against the law"],
];
function unlawfulLearnReason(text) {
  for (const [re, reason] of UNLAWFUL_LEARN) if (re.test(text || "")) return reason;
  return null;
}
function learnedNotes() { return list("learned"); }
function learnedNotesText() {
  return learnedNotes().map(r => r.data.text).filter(Boolean);
}
async function saveLearnedNote(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) return {ok: false, reply: "Tell me what to learn first — one thing."};
  const reason = unlawfulLearnReason(trimmed);
  if (reason) return {ok: false, reply: "No — I can't learn that, because " + reason + ". Ask me to learn something lawful instead, and I will."};
  try {
    await api("/api/records", {method: "POST", body: {kind: "learned", data: {text: trimmed, learned: today()}}});
    await loadAll();
    pendingLearnList = [];
    const reply = "I learned: " + trimmed;
    speakText(reply);
    return {ok: true, reply};
  } catch (err) {
    return {ok: false, reply: "I couldn't save that: " + err.message};
  }
}
// Fast Learn: save several things at once, after one yes from George.
// Each item is checked against the law on its own; an unlawful item is
// refused with its reason and the lawful ones are still saved.
async function saveLearnedNotes(items) {
  const list = (items || []).map(s => (s || "").trim()).filter(Boolean);
  if (!list.length) return {ok: false, reply: "Tell me what to learn first."};
  const saved = [], refused = [];
  for (const item of list) {
    const done = await saveLearnedNote(item);
    if (done.ok) saved.push(item);
    else refused.push(item + " — " + done.reply);
  }
  if (!saved.length) return {ok: false, reply: refused.join("\n") || "I couldn't save any of those."};
  const reply = saved.map(s => "I learned: " + s).join("\n")
    + (refused.length ? "\n\nI did NOT learn these, because:\n" + refused.join("\n") : "");
  return {ok: true, reply, saved};
}
function splitLearnList(text) {
  // "learn these: a; b; c" — split on new lines, semicolons, or numbered
  // items (1. ... 2. ...). Commas are NOT split on: one thing can
  // contain commas ("Smith, who likes mornings, ...").
  return (text || "").split(/\n|;|\r/).map(s => s.replace(/^\s*\d+[.)]\s*/, "").trim()).filter(Boolean);
}
async function forgetLearnedNote(id) {
  if (!confirm("Forget this one thing I learned? I will not remember it any more.")) return;
  try { await api("/api/records/" + id, {method: "DELETE"}); await loadAll(); if (currentTab === "learning") showTab("learning"); else renderAssistant($("#view")); flash("Forgotten.", true); }
  catch (err) { flash(err.message); }
}
async function forgetAllLearned() {
  const notes = learnedNotes();
  if (!notes.length) { flash("Nothing learned yet — there is nothing to forget."); return; }
  if (!confirm("Forget everything I learned? I will not remember any of it any more.")) return;
  try {
    for (const r of notes) await api("/api/records/" + r.id, {method: "DELETE"});
    await loadAll(); showTab("learning"); flash("Forgotten everything I learned.", true);
  } catch (err) { flash(err.message); }
}
window.forgetLearnedNote = forgetLearnedNote;
window.forgetAllLearned = forgetAllLearned;
function filterLearnedNotes(q) {
  const needle = (q || "").toLowerCase();
  document.querySelectorAll("#learnedList li").forEach(li => {
    li.style.display = !needle || (li.dataset.text || "").includes(needle) ? "" : "none";
  });
}
window.filterLearnedNotes = filterLearnedNotes;
async function showMonthlyUpgrade() {
  const box = $("#monthlyUpgrade"); if (!box) return;
  const val = ($("#upgradeMonth") && $("#upgradeMonth").value) || new Date().toISOString().slice(0, 7);
  const [year, month] = val.split("-").map(Number);
  box.innerHTML = "<p class=\"muted\">Looking back at what I learned that month…</p>";
  try {
    const s = await api(`/api/monthly-upgrade?year=${year}&month=${month}`);
    box.innerHTML = `<div class="panel"><h3>${esc(s.label)}</h3>
      <p><strong>${esc(s.headline)}</strong></p>
      <p class="muted">Your upgrades are free. ${esc(s.note || "")}</p>
      ${s.items && s.items.length ? `<ul>${s.items.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : `<p class="muted">I learned nothing new that month — teach me something and it will show up here next month.</p>`}
      ${s.approved ? `<p class="ok">This monthly upgrade is already approved.</p>` : `<div class="row"><button type="button" onclick="decideMonthlyUpgrade(${year}, ${month}, true)">Yes — apply this monthly upgrade</button> <button type="button" class="secondary" onclick="decideMonthlyUpgrade(${year}, ${month}, false)">No, don't upgrade</button></div>`}
    </div>`;
  } catch (err) { box.innerHTML = "<p class=\"muted\">I couldn't build that summary: " + esc(err.message) + "</p>"; }
}
window.showMonthlyUpgrade = showMonthlyUpgrade;
async function decideMonthlyUpgrade(year, month, yes) {
  const box = $("#monthlyUpgrade"); if (!box) return;
  try {
    const s = await api("/api/monthly-upgrade", {method: "POST", body: {year, month, approved: !!yes}});
    box.innerHTML = `<p class="${yes ? "ok" : "muted"}">${esc(s.note || (yes ? "Monthly upgrade applied." : "OK — no upgrade."))}</p>`;
    if (yes) await loadAll();
  } catch (err) { box.innerHTML = "<p class=\"muted\">That didn't work: " + esc(err.message) + "</p>"; }
}
window.decideMonthlyUpgrade = decideMonthlyUpgrade;
function renderLearning(v) {
  const notes = learnedNotes();
  v.innerHTML = `
  <div class="panel"><h2>Learning — fast, open, and on my own</h2>
    <p><strong>Auto-learn is ON — Connie learns on her own now (George's choice, 2026-11-25).</strong> You teach me one thing ("learn this: ...") or several at once ("learn these: Smith likes mornings; the shop opens at 8; paint is in the garage"), and I save each one right away — no asking first. I also notice things worth remembering in what you say and save those too. Everything I learn is listed below, searchable, with no cap — and you can forget any of it there, any time.</p>
    <div class="row">${AUTO_LEARN ? `<button type="button" onclick="setAutoLearn(false)">Turn auto-learn OFF — ask me first again</button>` : `<button type="button" onclick="setAutoLearn(true)">Turn auto-learn ON — learn on my own</button>`}</div>
    <p class="muted">How to teach me: in the Assistant, type or say <strong>"learn this: ..."</strong> for one thing, or <strong>"learn these: ..."</strong> for several at once, separated by semicolons or new lines. I save them right away. Learning here means I save what you teach me as notes in my own records on this server. <strong>It does NOT retrain the model, does NOT change the model, and does NOT go to the internet.</strong> What I learned is used in my future answers — it is listed below, shown in the Assistant, and sent with your question to the live AI (when a key is set) so it can use it too.</p>
    <p class="muted">If you ask me to learn or do something against the law — for example pretend to be someone else, copy someone's voice without their say-so, get into someone else's phone or account, or write fake reviews — <strong>I will say no and tell you why. That rule cannot be switched off.</strong></p>
  </div>
  <div class="panel"><h2>Monthly upgrade — free for George</h2>
    <p><strong>Your upgrades are free.</strong> Connie is your personal bot — you pay nothing for her upgrades. There is no price and no payment here.</p>
    <p>Once a month I look back at what I learned that month and show you a plain summary — for example "November upgrade: I learned 12 new things" — for you to approve. The upgrade is only that summary: it does <strong>NOT</strong> retrain or change the model, does <strong>NOT</strong> change code by itself, and does <strong>NOT</strong> go to the internet. If you say no, nothing is saved and nothing changes.</p>
    <div class="row"><label>Month <input type="month" id="upgradeMonth" value="${new Date().toISOString().slice(0, 7)}"></label> <button type="button" onclick="showMonthlyUpgrade()">Show my monthly upgrade</button></div>
    <div id="monthlyUpgrade"></div>
  </div>
  <div class="panel"><h2>What Connie knows</h2>
    <ul>
      <li><strong>Top brains:</strong> Claude Fable 5.2 (claude-fable-5-2, #1, the default brain), GPT-6.2 Astra (gpt-6.2-astra, OpenAI), and Claude Opus 5.5 (claude-opus-5-5, Anthropic) — only 3 brains, top level only, no lower tiers. No AI key is set on the server, so live AI is not connected yet.</li>
      <li><strong>Ask first:</strong> I ask George first, every time, and only do what he said yes to. George only — this is his personal copy, nobody else's records are here.</li>
      <li><strong>Fast Learn, open knowledge:</strong> I can learn several things at once when you say yes to a list, and everything I learned is listed below — searchable, with no cap on how many notes I hold. Learning is local notes only; it does not retrain or change the model and never goes to the internet.</li>
      <li><strong>Faster than the customer bot:</strong> 60 AI requests an hour (double the customer bot's 30), and no 5-hour session limit for George.</li>
      <li><strong>Monthly upgrade — free:</strong> once a month I show you what I learned that month, for your yes. Your upgrades are free — no price, no payment.</li>
      <li><strong>Multitasking on demand:</strong> I can run several jobs at once when you ask me to, in one request. I never start a job on my own.</li>
      <li><strong>Voice recognition — safety check only, not a secure ID:</strong> only 16 numbers from the sound of your voice are stored on this server, no audio recording, only with your consent, and you can remove it any time. A recording could fool it, and a cold or background noise can make it fail. Voice alone never authorises money, taxes, bank access, publishing or sending anything.</li>
      <li><strong>Law &amp; safety:</strong> the plain-words summary below. General information only — not legal advice.</li>
    </ul>
  </div>
  <div class="panel"><h2>Law &amp; safety — what I know</h2>
    <p><strong>General information only — NOT legal advice.</strong> This is a short plain-words summary of research done on 16 November 2026. Law changes fast, and this does not cover your exact situation. <strong>George should get a Wyoming lawyer to check things before selling anything.</strong> The full research is saved at <span>workspace/research_notes/ai-laws-creating-selling-bot-20261116-1031/report.md</span> (76KB) and on the law page "AI Bot Laws — What George Needs to Know". This panel is the summary, not the full report.</p>
    <ul>
      <li><strong>No single federal AI law in the US as of November 2026.</strong> But the old laws still apply to AI: the FTC Act bans unfair or deceptive acts — advertising must be truthful, and you need proof <em>before</em> you make a claim. "The AI did it" is not a defence if the bot gets something wrong. Fake reviews are banned, and pretending to be a government office or a business is banned. Fines can be up to about $53,088 per violation.</li>
      <li><strong>Wyoming has no broad AI law and no broad privacy law.</strong> It does have HB 102, in force 1 July 2026: sharing non-consensual synthetic sexual images, building AI to make child abuse images, or building AI to promote self-harm are felonies — up to 10 years and a $10,000 fine. Using AI is not a defence to a crime. Wyoming's consumer-protection law bans deceptive selling (up to $10,000 per wilful violation, $15,000 if the victim is over 60 or has a disability). If personal data is breached, Wyoming residents must be told as soon as possible, without unreasonable delay.</li>
      <li><strong>Voice is the highest risk.</strong> A stored voiceprint counts as a biometric identifier in Illinois, Texas, Washington, California and 20+ other states. Illinois (BIPA) needs written notice, the purpose, how long it is kept, and a written release — all <em>before</em> collecting it — $1,000 per negligent violation and $5,000 per intentional one, and people can sue. Texas: up to $25,000 per violation, enforced by the Attorney General. Selling from Wyoming does <em>not</em> shield you from other states' laws for their residents. That is why Connie stores only 16 numbers, never audio, only with consent, and you can remove it any time.</li>
      <li><strong>Never do these:</strong> pretend to be a human, a government office, a business, or a lawyer, accountant or doctor; clone someone's voice or face without their clear consent; make fake reviews; use another company's name or logo as if they endorse you; get into someone else's phone or account without permission — that breaks federal computer-crime law. Say plainly that the bot is AI, every time.</li>
      <li><strong>Ask first, every time.</strong> Connie only looks at your records, does a job, or uses a connected tool after you say yes. She only does what you agreed to, only your records, and stops when you take permission back.</li>
      <li><strong>Before selling anything:</strong> Terms of Service and a Privacy Policy (Apple and Google require one), a separate voice-consent and retention policy, simple cancellation for subscriptions, Stripe rules, and taxes — Wyoming generally does not tax software-as-a-service, but many other states do, so get an accountant. And get a Wyoming lawyer to check the terms before selling.</li>
    </ul>
    <p class="muted">If you ask me to learn or do something against the law, I will say no and tell you why — see "Learning — fast, open, and ask-first" above.</p>
  </div>
  <div class="panel"><h2>Things I have learned (${notes.length}) — open knowledge, no cap</h2>
    <p class="muted">Everything I learned is here, searchable. Type in the box to find a note — nothing is hidden and there is no limit on how many I can hold.</p>
    <div class="row"><label>Search what I learned <input type="text" id="learnSearch" placeholder="type a word to find it" oninput="filterLearnedNotes(this.value)"></label></div>
    ${notes.length ? `<ul id="learnedList">${notes.map(r => `<li data-text="${esc((r.data.text || "").toLowerCase())}">${esc(r.data.text || "")} <span class="muted">— learned ${esc(r.data.learned || "")}</span> <button type="button" class="small danger" onclick="forgetLearnedNote('${r.id}')">Forget this</button></li>`).join("")}</ul>
    <div class="row"><button type="button" class="danger" onclick="forgetAllLearned()">Forget everything I learned</button></div>` : `<p class="muted">Nothing learned yet. Teach me in the Assistant — "learn this: ..." for one thing, or "learn these: ..." for several at once — and I will save it here right away.</p>`}
  </div>`;
}

async function handleOfflineRequest(text) {
  const t = text.trim();
  const low = t.toLowerCase();
  // Refuse anything against the law, and say why — this runs before
  // any other branch, so no request can slip past it.
  const unlawful = unlawfulLearnReason(t);
  if (unlawful && !/^(learn|remember|teach me)\b/.test(low)) {
    return {reply: "No — I can't do that, because " + unlawful + ". I have to say no to anything against the law, and tell you why. Ask me to do something lawful instead, and I will."};
  }
  // Fast Learn — one thing, or several at once, ask first. If Connie
  // is waiting for a yes to things George asked her to learn, "yes"
  // saves them all and "no" drops them all. A new "learn this: ..." or
  // "learn these: ..." asks first, and never saves until George says
  // yes. Unlawful things are refused, with the reason.
  if (pendingLearnList.length) {
    if (/^(yes|yeah|yep|ok|okay|sure|learn it|learn them|yes,? learn (it|them)|yes please|go ahead)\.?$/.test(low)) {
      const done = await saveLearnedNotes(pendingLearnList);
      return {reply: done.reply, actions: done.ok ? [{label: "See what I learned (Learning screen)", tab: "learning"}] : []};
    }
    if (/^(no|nope|don't|do not|never mind|cancel)\b/.test(low)) {
      pendingLearnList = [];
      return {reply: "OK — I didn't learn it, and I saved nothing."};
    }
  }
  let mLearn = t.match(/^(?:learn(?: these| this| that)?|remember(?: these| this| that)?|teach me)[:\s]+(.+)$/is);
  if (mLearn && mLearn[1] && mLearn[1].trim().length >= 2) {
    const multi = /these/i.test(t.slice(0, 20));
    const things = multi ? splitLearnList(mLearn[1]) : [mLearn[1].trim()];
    const bad = things.map(x => unlawfulLearnReason(x)).find(Boolean);
    if (bad) return {reply: "No — I can't learn that, because " + bad + ". Ask me to learn something lawful instead, and I will."};
    // Auto-learn (George's choice, 2026-11-25): save right away, no asking.
    // The law check above and the server's HTTP 400 still refuse unlawful notes.
    // Turn it off on the Learning screen ("Learn on my own") to go back to asking first.
    if (!AUTO_LEARN) {
      pendingLearnList = things;
      const shown = things.map(x => '"' + x + '"').join("\n");
      const word = things.length === 1 ? "this one thing" : "these " + things.length + " things";
      return {reply: `Can I learn ${word}?\n\n${shown}\n\nFast Learn: one yes covers the whole list. If you say yes, I will save ${things.length === 1 ? "it" : "each one"} in my own records on this server only, and say "I learned: ..." back to you for each one. Say "yes, learn it" or tap the button below — or say no and I won't save it.`, actions: [{label: things.length === 1 ? "Yes — learn this" : "Yes — learn these " + things.length, learn: things.length === 1 ? things[0] : things}, {label: "No, don't learn it", learnCancel: true}]};
    }
    const done = await saveLearnedNotes(things);
    return {reply: done.reply, actions: done.ok ? [{label: "See what I learned (Learning screen)", tab: "learning"}] : []};
  }
  // What have I learned? / What do you know? / What are the laws?
  if (/what (have you|did you) learn|what do you (remember|know about me)|show me what you (learned|remember)/.test(low)) {
    const notes = learnedNotesText();
    if (!notes.length) return {reply: "I haven't learned anything yet. Teach me one thing — say \"learn this: ...\" — and I will ask first, then save it when you say yes.", actions: [{label: "Open Learning", tab: "learning"}]};
    return {reply: "Here is what I have learned (" + notes.length + " things — everything is on the Learning screen, searchable, with no cap):\n" + notes.map(n => "- " + n).join("\n"), actions: [{label: "Open Learning", tab: "learning"}]};
  }
  if (/what do you know|what does connie know/.test(low)) {
    return {reply: "What I know: my top brains are Claude Fable 5.2 (claude-fable-5-2, #1, the default), GPT-6.2 Astra (gpt-6.2-astra, OpenAI), and Claude Opus 5.5 (claude-opus-5-5, Anthropic) — only 3 brains, no key is set yet, so live AI is not connected. I ask first, every time, and only do what you said yes to. Fast Learn: I can learn several things at once when you say yes to a list — say \"learn these: ...\" — and my knowledge is open, everything I learned is on the Learning screen, searchable, with no cap. I am faster than the customer bot: 60 AI requests an hour (double the customer bot's 30), and no 5-hour session limit for you. Learning is local notes only, it never retrains the model. I can run several jobs at once when you ask. Voice recognition is a safety check only, not a secure ID. And I know the plain-words law summary on the Learning screen — general information only, not legal advice. Ask me \"what are the laws\" for the short version, or open the Learning screen for the full summary.", actions: [{label: "Open Learning", tab: "learning"}]};
  }
  if (/what are the laws|tell me the laws|is (this|it) legal|law(s)? (about|for|on) (ai|bots?|this)/.test(low)) {
    return {reply: "Short version — general information only, NOT legal advice, and you should get a Wyoming lawyer before selling anything. There is no single federal AI law in the US as of November 2026, but the FTC still bans deceptive claims and fake reviews. Wyoming has no broad AI law, but HB 102 (from 1 July 2026) makes non-consensual synthetic sexual images a felony. Voice is the highest risk: a stored voiceprint is a biometric in Illinois, Texas, Washington, California and 20+ states, and Illinois needs written notice and written consent before you collect it. Never pretend to be a human, a business, or a professional; never clone a voice without consent; never get into someone else's phone or account without permission. Before selling you need Terms of Service, a Privacy Policy, a voice-consent policy, simple cancellation, and a lawyer to check it all. The full plain-words summary is on the Learning screen.", actions: [{label: "Open Learning — law & safety", tab: "learning"}]};
  }
  // What connectors do I have? — list the built-in slots and any
  // custom connector George added, honestly: plugged in is not
  // the same as connected.
  if (/what (connectors|apps|bots) (do i have|are (plugged|connected))|list (my )?connectors|show (my )?connectors/.test(low)) {
    const customs = list("connectors").filter(r => r.data && typeof r.data.key === "string" && r.data.key.startsWith("custom:"));
    const lines = CONNECTOR_CATALOG.filter(c => c.type !== "remy").map(c => `- ${c.name}: ${connectorStatus(c).label}`);
    if (customs.length) lines.push(...customs.map(r => `- ${r.data.custom_name || "Other app / bot"}: Plugged in — NOT connected${r.data.approved ? " (you approved it — its key/account still needs to be set on the server)" : " (needs its key/account on the server and your approval)"}`));
    return {reply: "Your connectors:\n" + lines.join("\n") + "\n\nPlugged in is not the same as connected — a connector only works when its own key/account is set on the server and you have approved it. Nothing connects itself.", actions: [{label: "Open Integrations", tab: "integrations"}]};
  }
  // What can it do? — the help list.
  if (/what can (you|i) (do|ask)|^help$|what can i ask/.test(low)) {
    return {reply: "Here's what I can do in the bot right now: find things you saved ('find the invoice for Smith'); money totals ('how much am I owed?'); what's on today; remind you of things ('remind me to call Smith tomorrow'); start an invoice, customer, appointment or job with the details filled in; draft a product description, plan or list for you to approve; and work out numbers ('what is 25% of 400?'). Fast Learn: say 'learn this: ...' for one thing, or 'learn these: ...' for several at once — I ask first, then save them only when you say yes. I am faster than the customer bot: 60 AI requests an hour and no 5-hour limit for you. With an AI key on the server I can also research and explain things. I can't place calls, send messages, charge cards, move money, file taxes, publish, or order anything — those need a provider and your approval."};
  }
  // Change how the bot sounds — just ask. "change your voice to a
  // girl voice", "speak in a female voice", "use a male voice",
  // "use Samantha's voice". The bot switches right away and answers
  // back in the new voice, out loud. This only changes how it
  // sounds — it does not change who can unlock the bot.
  if (/research (to )?(upgrade|learn|get smarter|everything)/.test(low) || /upgrade (me|yourself)/.test(low)) {
    return {reply: "I can do research to learn and get smarter — but I ask you first, and only research what you agreed to. Tap the \"Research to upgrade me\" button above the chat: it costs an additional $250, and no payment is live, so nothing is charged here. Tell me one thing to research, and I'll stay inside that."};
  }
  if ((/voice/.test(low) && /(change|switch|use|make|put|speak|talk|sound)/.test(low)) || /speak (like|in) (a )?(girl|female|male|boy|woman|man)/.test(low)) {
    const voices = await loadSpeechVoices();
    if (!("speechSynthesis" in window)) return {reply: "Talking back is not available in this browser, so I can't change my voice here. Try a different browser on your phone or computer."};
    if (!voices.length) return {reply: "No voices are available on this device yet, so I can't change my voice right now. Try again, or use a different browser — the voices come from the device itself."};
    const found = findSpeechVoiceForRequest(low);
    if (found.error === "no-accent") {
      return {reply: "I couldn't find a " + found.accent + " voice on this device. The voices on this device are: " + voices.map(v => v.name + " (" + (v.lang || "") + ")").join(", ") + ". Pick one from Settings — Voice choice — or ask me for one of those by name."};
    }
    if (found.error === "no-female") {
      return {reply: "I couldn't find a" + (found.accent ? " " + found.accent : "") + " girl / female voice on this device. The voices on this device are: " + voices.map(v => v.name + " (" + (v.lang || "") + ")").join(", ") + ". Pick one from Settings — Voice choice — or ask me for one of those by name."};
    }
    if (found.error === "no-male") {
      return {reply: "I couldn't find a" + (found.accent ? " " + found.accent : "") + " male voice on this device. The voices on this device are: " + voices.map(v => v.name + " (" + (v.lang || "") + ")").join(", ") + ". Pick one from Settings — Voice choice — or ask me for one of those by name."};
    }
    if (found.error === "none" || found.error === "unclear") {
      return {reply: "I didn't catch which voice you want. Try 'change your voice to a girl voice', 'use a male voice', or name one from Settings — Voice choice, for example 'use Samantha's voice'."};
    }
    if (found.kind === "default") {
      await setSpeakingVoice(null, {announce: false});
      return {reply: "Done — I'm back to your device's default voice. Pick a different one any time in Settings — Voice choice — or just ask me."};
    }
    await setSpeakingVoice(found.voice);
    const kindWord = found.kind === "female" ? "a girl's voice" : found.kind === "male" ? "a male voice" : "the " + found.voice.name + " voice";
    return {reply: `Done — I'm now speaking in ${kindWord}${found.accent ? " with a " + found.accent + " accent" : ""} (${found.voice.name}). I just said hello out loud in the new voice so you can hear it. This only changes how I sound — it does not change who can unlock the bot; only the enrolled voice can start jobs.`};
  }
  // Talk to Remy — there is no key to make; Remy lives in the Muse app.
  if (/remy|talk to (you|remy)|muse/.test(low)) {
    return {reply: "There is no key for Remy — Remy lives in the Muse app, and no key can be made for it. Open Muse and talk to Remy there, by text or voice call, and Remy can help with this bot, your records, your trading desk, Stripe / Whop / Etsy steps, and anything else. That is for you, George, as the owner — nobody else uses this copy, so nobody else can talk to your Remy, and your private records are never shared with them. Inside this bot the assistant is the Connie, not Remy.", actions: [{label: "Open Integrations (Remy slot)", tab: "integrations"}]};
  }
  // Integrations / Crosswalk — open the hub.
  if (/crosswalk|crossroads|integrations|connect (a |another |other )?(bot|tool|app)|plug in/.test(low)) {
    const customs = list("connectors").filter(r => r.data && typeof r.data.key === "string" && r.data.key.startsWith("custom:"));
    const extra = customs.length ? " You also plugged in: " + customs.map(r => r.data.custom_name || "another app").join(", ") + " — each is plugged in but NOT connected until its key/account is set on the server and you approve it." : " You can plug in any other app yourself on that screen — 'Add any connector / plug in a new app'.";
    return {reply: "The Integrations screen is the Crosswalk hub — where other bots and tools plug into George's Assistant. Claude and ChatGPT show Connected only when their server keys are set; Crosswalk itself is Not connected, because your Nov 6 signup was never finished and no key is saved. Everything else (Stripe, calendar, phone, email, bank feeds, tax filing) is Not connected until you supply that service's own account." + extra, actions: [{label: "Open Integrations (Crosswalk)", tab: "integrations"}]};
  }
  // Do several things at once — on-demand multitasking. Jobs start
  // only when you ask for them, here or from the Tasks screen. A job
  // only reads your saved records and works out a summary or a draft;
  // it never sends, charges, publishes or deletes anything.
  if (/multitask|several things|at once|at the same time|do .* and .* at/.test(low) || (/run /.test(low) && /(inventory|invoice|money|usage|product)/.test(low))) {
    const wanted = [];
    if (/inventor/.test(low)) wanted.push("inventory_check");
    if (/invoice/.test(low)) wanted.push("invoice_draft");
    if (/money|total/.test(low)) wanted.push("money_totals");
    if (/usage|limit/.test(low)) wanted.push("usage_check");
    if (/product/.test(low)) wanted.push("product_draft");
    const types = wanted.length ? wanted : ["inventory_check", "invoice_draft", "money_totals"];
    if (!(await ensureVoiceForJobs())) {
      return {reply: "I don't recognise that voice, so I won't run any jobs. Check your voice on the Tasks screen first — if no voice is enrolled, enrol yours in Settings.", actions: [{label: "Open Tasks (Running tasks)", tab: "tasks"}]};
    }
    try {
      const d = await api("/api/jobs/batch", {method: "POST", body: {types, voice_token: voiceToken || undefined, passcode_token: passcodeToken || undefined}});
      const names = (d.jobs || []).map(j => j.label).join(", ");
      return {reply: `Started ${types.length} job(s) at once, running together: ${names}. Watch each one's progress on the Tasks screen — when one finishes it will say what it did. Nothing is sent, charged, published or deleted by a job; invoice and product results are drafts for you to check first.`, actions: [{label: "Open Tasks (Running tasks)", tab: "tasks"}]};
    } catch (err) { return {reply: "I couldn't start those jobs: " + err.message}; }
  }
  // What jobs are running right now?
  if (/what.*(jobs|tasks).*running|running (jobs|tasks)|show.*jobs/.test(low)) {
    try {
      const d = await api("/api/jobs");
      const js = d.jobs || [];
      if (!js.length) return {reply: "No jobs are running right now. Ask me to do several things at once — for example, 'run inventory check, invoice draft and money totals at the same time' — and I will run them together.", actions: [{label: "Open Tasks (Running tasks)", tab: "tasks"}]};
      return {reply: "Running tasks:\n" + js.slice(-6).map(j => `- ${j.label}: ${j.status}${j.status === "running" ? ` — ${j.step || ""} (${j.progress}%)` : j.result ? ` — ${j.result}` : ""}`).join("\n"), actions: [{label: "Open Tasks (Running tasks)", tab: "tasks"}]};
    } catch (err) { return {reply: "I couldn't check the running jobs: " + err.message}; }
  }
  // Work out numbers.
  if (/what is|calculate|work out|how much is/.test(low) && /[\d]/.test(low)) {
    const calc = calcExpression(low);
    if (calc) return {reply: calc};
  }
  // Money totals.
  if (/how much (am i owed|do .* owe|did i (spend|make|earn)|is owed)|unpaid invoices|total (income|spending|spent)/.test(low)) {
    return {reply: totalsText()};
  }
  // What's on today.
  if (/what'?s (on|due) (today|tomorrow)|what do i have (today|tomorrow)|today'?s appointments/.test(low)) {
    const day = /tomorrow/.test(low) ? new Date(Date.now() + 86400000).toISOString().slice(0, 10) : today();
    const appts = list("appointments").filter(a => a.data.date === day);
    const tasks = list("tasks").filter(x => x.data.due === day && !x.data.done);
    const rems = list("reminders").filter(x => x.data.due === day && !x.data.done);
    const lines = [
      appts.length ? "Appointments: " + appts.map(a => `${a.data.title || ""} — ${a.data.customer || ""} at ${a.data.time || "no time"}`).join("; ") : "No appointments.",
      tasks.length ? "Tasks due: " + tasks.map(x => x.data.title).join("; ") : "No tasks due.",
      rems.length ? "Reminders: " + rems.map(x => x.data.title).join("; ") : "No reminders.",
    ];
    return {reply: `For ${day}: ` + lines.join(" ")};
  }
  // Remind me / add a task or reminder — saved straight away, nothing sent.
  let m = low.match(/^(?:remind me to|remind me|add (?:a )?(?:task|reminder)|create (?:a )?(?:task|reminder))\s*:?\s*(.+)$/);
  if (m) {
    const title = m[1].replace(/\.$/, "").trim();
    const due = /tomorrow/.test(low) ? new Date(Date.now() + 86400000).toISOString().slice(0, 10) : (/today/.test(low) ? today() : "");
    const kind = /remind/.test(low) ? "reminders" : "tasks";
    try {
      await api("/api/records", {method: "POST", body: {kind, data: {title, due, done: false}}});
      await loadAll();
      return {reply: `Done — I saved "${title}" as a ${kind === "reminders" ? "reminder" : "task"}${due ? " for " + due : ""}. I haven't sent it anywhere; it's just saved in the bot.`, actions: [{label: "Open Tasks", tab: "tasks"}]};
    } catch (err) { return {reply: "I couldn't save that: " + err.message}; }
  }
  // Start an invoice with details filled in — draft only, you check and save it.
  m = t.match(/add (?:an? )?invoice for (.+?)[, ]+\$?([\d,]+(?:\.\d+)?)(?:[, ]+for (.+))?$/i);
  if (m) {
    const data = {customer: m[1].trim(), amount: Number(m[2].replace(/,/g, "")), title: (m[3] || "").trim(), status: "Draft", due: today()};
    return {reply: `Here's the invoice draft — ${data.customer}, ${money(data.amount)}${data.title ? " for " + data.title : ""}. I haven't saved or sent it. Check it on the Invoices screen and save it there if it's right.`, actions: [{label: "Open Invoices (draft filled in)", tab: "invoices", kind: "invoices", prefill: data}]};
  }
  // Start a customer.
  m = t.match(/add (?:a )?customer (?:called |named )?(.+)$/i);
  if (m) {
    const data = {name: m[1].trim()};
    return {reply: `Here's a customer draft for ${data.name}. Check it on the Front Desk screen and save it there if it's right — nothing is saved yet.`, actions: [{label: "Open Front Desk (draft filled in)", tab: "frontdesk", kind: "customers", prefill: data}]};
  }
  // Draft something — product description, plan, list, letter.
  m = t.match(/^(?:write|draft|make|create)\s+(?:a\s+)?(.+)$/i);
  if (m && /(description|plan|list|letter|note|email|outline|checklist)/.test(m[1])) {
    const subject = m[1].trim();
    const price = t.match(/\$([\d,]+(?:\.\d+)?)/);
    let draft;
    if (/product description|description/.test(subject)) {
      draft = `${subject.replace(/^(a\s+)?product description (for\s+)?/i, "") || "Product"}\n\nA practical guide from George Wederski — clear steps, real measurements, and what to watch out for, written for a homeowner doing it themselves. ${price ? "Price: $" + price[1] + ". " : ""}Draft only — check the wording, price and details before you use it.`;
    } else if (/shopping list|list|checklist/.test(subject)) {
      const items = subject.replace(/^(a\s+)?(shopping\s+)?(list|checklist)\s*(for\s+|of\s+)?/i, "").split(/,| and /).map(s => s.trim()).filter(Boolean);
      draft = "List\n" + (items.length ? items.map(i => "- [ ] " + i).join("\n") : "- [ ] ") + "\n\nDraft only — tick things off as you go. I haven't ordered anything.";
    } else {
      draft = `Plan: ${subject}\n\n1. What needs doing — write the job down in one line.\n2. Materials and tools needed — list them with prices.\n3. Steps in order — do the messy work first, finish work last.\n4. Check it — test it before you call it done.\n5. Charge it — invoice the customer only after they have seen the finished work.\n\nDraft only — change any step before you use it.`;
    }
    lastDraft = draft;
    return {reply: "Here's a draft for you to check — I haven't saved, sent or published it:\n\n" + draft, actions: [{label: "Save draft as a note", saveDraft: "Assistant draft — " + subject.slice(0, 60)}, {label: "Open Personal (notes)", tab: "personal"}]};
  }
  // Find things in saved records.
  m = t.match(/^(?:find|search|look up|show me|where is|do i have)\b\s*(.+)$/i);
  if (m) {
    const term = m[1].replace(/^(the|a|an|my)\s+/i, "").trim();
    if (term.length < 2) return null;
    const hits = searchRecords(term);
    if (!hits.length) return {reply: `I searched everything you saved in the bot and found nothing for "${term}". It only knows what you have saved here — it can't look things up on the live internet.`};
    const lines = hits.slice(0, 8).map(h => {
      const d = h.r.data || {};
      return `- ${h.kind}: ${d.name || d.title || d.item || d.customer || d.caller || JSON.stringify(d).slice(0, 60)}`;
    });
    return {reply: `Found ${hits.length} match${hits.length > 1 ? "es" : ""} for "${term}":\n` + lines.join("\n") + (hits.length > 8 ? `\n…and ${hits.length - 8} more.` : "")};
  }
  return null;
}
async function sendChat(e) {
  e.preventDefault();
  const f = e.target, text = f.msg.value.trim(); if (!text) return;
  f.msg.value = "";
  chatHistory.push({role: "user", content: text});
  assistantActions = [];
  renderAssistant($("#view"));
  const box = $("#chatBox"); box.scrollTop = box.scrollHeight;
  // Permission first, like Remy does: before the bot looks at your
  // records, does a job, or uses a connected tool, it asks you and
  // waits for your yes. No answer, or no, means it does nothing.
  const perm = permissionScopeFor(text);
  if (perm && !grantedPermissions.has(perm.scope)) {
    const yes = await requestPermission(perm.what, perm.scope);
    if (!yes) {
      chatHistory.push({role: "assistant", content: "OK — I didn't look at your records, and I did nothing. Ask me again any time and I will ask first again."});
      renderAssistant($("#view"));
      const b3 = $("#chatBox"); if (b3) b3.scrollTop = b3.scrollHeight;
      return;
    }
    renderAssistant($("#view"));
  }
  // 1) Try to do it in the app itself — works with no AI key.
  try {
    const done = await handleOfflineRequest(text);
    if (done) {
      chatHistory.push({role: "assistant", content: done.reply});
      assistantActions = done.actions || [];
      renderAssistant($("#view"));
      const b2 = $("#chatBox"); if (b2) b2.scrollTop = b2.scrollHeight;
      return;
    }
  } catch (err) {
    chatHistory.push({role: "assistant", content: "I couldn't do that in the app: " + err.message});
    renderAssistant($("#view"));
    return;
  }
  // 2) Needs the live AI — only when a key is set on the server.
  // Live chat reads George's learned notes, so it needs the same
  // two-step check as jobs: voice first, then passcode, when set.
  if (!(await ensureVoiceForJobs())) {
    chatHistory.push({role: "assistant", content: "I need to know it's you first — check your voice, then your passcode, and ask me again."});
    renderAssistant($("#view")); return;
  }
  const ctx = `Customers: ${list("customers").map(c => c.data.name).join(", ") || "none"}. Open jobs: ${list("jobs").filter(j => j.data.status !== "Done").map(j => j.data.title).join(", ") || "none"}. Unpaid invoices total: ${money(list("invoices").filter(i => i.data.status !== "Paid").reduce((s, i) => s + (Number(i.data.amount) || 0), 0))}. Things George taught Connie (learned notes, local only — use them when answering): ${learnedNotesText().join("; ") || "none yet"}.`;
  try {
    const body = {messages: chatHistory.slice(-12), context: ctx, voice_token: voiceToken || undefined, passcode_token: passcodeToken || undefined};
    if (aiProvider) body.provider = aiProvider;
    const d = await api("/api/ai/chat", {method: "POST", body});
    lastAiProvider = d.provider || aiProvider || "";
    window.lastBrains = d.brains || [];
    chatHistory.push({role: "assistant", content: d.reply});
  } catch (err) {
    chatHistory.push({role: "assistant", content: "AI is not connected yet: " + err.message + " Add a server-side AI key (see README) to turn live chat on. Until then I can still search your records, add tasks and reminders, work out numbers, and draft things for you — try 'what can I ask it to do?'."});
  }
  renderAssistant($("#view"));
  const b2 = $("#chatBox"); if (b2) b2.scrollTop = b2.scrollHeight;
}
function dictate() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { flash("Voice dictation is not available in this browser — type your message instead."); return; }
  const rec = new SR(); rec.lang = "en-US"; rec.interimResults = false;
  rec.onresult = (ev) => { const t = $("#chatForm textarea[name=msg]"); if (t) t.value = (t.value + " " + ev.results[0][0].transcript).trim(); };
  rec.onerror = () => flash("Dictation did not hear anything — try again or type it.");
  rec.start();
}
function readAloud() {
  const last = [...chatHistory].reverse().find(m => m.role === "assistant");
  if (!last) { flash("Nothing to read aloud yet."); return; }
  if (!speakText(last.content)) flash("Read-aloud is not available in this browser.");
}

function renderFrontDesk(v) {
  const urgent = list("calls").filter(c => c.data.urgent);
  v.innerHTML = `<div class="panel"><h2>Front Desk</h2>
    <p class="muted">Customers, appointments, jobs and a hand-written call log. This is not a live phone line — no call is answered or transferred by the bot until you connect a phone provider.</p>
    ${urgent.length ? `<p class="pill alert">${urgent.length} urgent call(s) need a person — see the call log below.</p>` : ""}
    <p>Appointments today (${today()}): ${list("appointments").filter(a => a.data.date === today()).length} · Open jobs: ${list("jobs").filter(j => j.data.status !== "Done").length}</p></div>`
    + renderKind("customers", "Customers")
    + renderKind("appointments", "Appointments — double-booking is flagged when you add a second appointment at the same date and time")
    + renderKind("jobs", "Jobs & dispatch")
    + renderKind("calls", "Call log (manual — no live calls)");
  // flag double bookings in the appointments table after render
  const seen = {};
  for (const a of list("appointments")) {
    const k = (a.data.date || "") + " " + (a.data.time || "");
    if (seen[k]) flash("Warning: more than one appointment at " + k + " — check for a double-booking.");
    seen[k] = true;
  }
}
function renderInvoices(v) {
  const inv = list("invoices");
  const unpaid = inv.filter(i => i.data.status !== "Paid").reduce((s, i) => s + (Number(i.data.amount) || 0), 0);
  v.innerHTML = `<div class="panel"><h2>Invoices</h2>
    <p>Unpaid total (your entered figures): <strong>${money(unpaid)}</strong> · ${inv.filter(i => i.data.status === "Paid").length} paid.</p>
    <p class="muted">Dictate an invoice, check the read-back, then confirm before anything is sent. Nothing is emailed or charged from here — sending needs an email/payment provider you connect later.</p></div>`
    + renderKind("invoices", "Invoices")
    + `<div class="panel"><h2>Read back & print</h2><p class="muted">Pick an invoice, hear its customer and amount read aloud, then print it.</p>
    <div class="row">${inv.map(i => `<button class="secondary small" onclick="readInvoice('${i.id}')">🔊 ${esc(i.data.customer || i.data.title || "Invoice")}: ${money(i.data.amount)}</button>`).join("") || "No invoices yet."}</div>
    <div class="row">${inv.map(i => `<button class="secondary small" onclick="printInvoice('${i.id}')">🖨 Print ${esc(i.data.customer || i.data.title || "")}</button>`).join("")}</div></div>`;
}
window.readInvoice = function (id) {
  const r = list("invoices").find(x => x.id === id); if (!r) return;
  const text = `Invoice for ${r.data.customer || "customer"}. ${r.data.title || ""}. Amount ${money(r.data.amount)}. Status ${r.data.status || "Draft"}. Due ${r.data.due || "no date"}. Please confirm this is correct before sending.`;
  if (!speakText(text)) flash("Read-aloud is not available in this browser. " + text);
};
window.printInvoice = function (id) {
  const r = list("invoices").find(x => x.id === id); if (!r) return;
  $("#printArea").innerHTML = `<h1>Invoice</h1><p><strong>Customer:</strong> ${esc(r.data.customer || "")}</p><p><strong>For:</strong> ${esc(r.data.title || "")}</p><p><strong>Amount:</strong> ${money(r.data.amount)}</p><p><strong>Status:</strong> ${esc(r.data.status || "")}</p><p><strong>Due:</strong> ${esc(r.data.due || "")}</p><p>${esc(r.data.notes || "")}</p><p>George's Assistant · George Wederski · Figures entered by the owner — estimates, not bank balances.</p>`;
  window.print();
};
function renderMoney(v) {
  const tx = list("transactions");
  const income = tx.filter(t => t.data.kind === "Income").reduce((s, t) => s + (Number(t.data.amount) || 0), 0);
  const expense = tx.filter(t => t.data.kind === "Expense").reduce((s, t) => s + (Number(t.data.amount) || 0), 0);
  const rate = taxRate();
  v.innerHTML = `<div class="panel"><h2>Money — bookkeeping (estimates only)</h2>
    <div class="cards">
      <div class="card">Income entered<strong>${money(income)}</strong></div>
      <div class="card">Expenses entered<strong>${money(expense)}</strong></div>
      <div class="card">Balance (entered figures only)<strong>${money(income - expense)}</strong></div>
      <div class="card">${rate}% tax reserve — estimate<strong>${money(income * rate / 100)}</strong></div>
    </div>
    <p class="muted">This is a running total of figures <em>you</em> entered. It is not a bank balance, not a tax determination and no money is moved. The ${rate}% tax reserve is a bookkeeping estimate (change it in Settings) — set the real tax aside only through your own bank/tax provider.</p></div>`
    + notConnectedPanel("Bank feeds", "No bank is connected, so no verified transactions are imported.")
    + renderKind("transactions", "Income & expenses");
}
function renderInventory(v) {
  const items = list("inventory");
  const low = items.filter(i => Number(i.data.quantity) <= Number(i.data.low_stock || 0));
  v.innerHTML = `<div class="panel"><h2>Inventory & parts</h2>
    <p>Items: ${items.length} · Low stock: ${low.length ? low.map(i => esc(i.data.item)).join(", ") : "none"}</p>
    <p class="muted">Orders are never placed from here. Build a parts list, check the estimate, and only order after you approve the vendor, items and total yourself.</p></div>`
    + renderKind("inventory", "Inventory")
    + `<div class="panel"><h2>Parts list estimate</h2><p class="muted">Tick items in the list below to build a job parts estimate (quantities and prices are your entered figures).</p>
    <div id="partsList">${items.map(i => `<label><input type="checkbox" data-cost="${Number(i.data.sell_price) || Number(i.data.unit_cost) || 0}" onchange="updateParts()"> ${esc(i.data.item)} — ${money(i.data.sell_price || i.data.unit_cost)}</label><br>`).join("") || "No inventory yet."}</div>
    <p>Estimated parts total: <strong id="partsTotal">$0.00</strong></p></div>`;
}
window.updateParts = function () {
  let s = 0; $$("#partsList input:checked").forEach(c => s += Number(c.dataset.cost) || 0);
  const el = $("#partsTotal"); if (el) el.textContent = money(s);
};
/* ---------- Jobs / multitasking — on-demand only ----------
   Jobs start only when you ask for them — the bot never starts a job
   on its own, and nothing runs in the background unprompted. A job
   only reads your own saved records and works out a summary or a
   draft. It never sends, charges, publishes or deletes anything:
   anything that would do one of those still needs your yes first. */
let jobs = [];           // latest job list from /api/jobs
let jobsTimer = null;    // refreshes the Jobs view while it is open
const JOB_TYPES = [
  ["inventory_check", "Check inventory"], ["invoice_draft", "Draft unpaid-invoices summary"],
  ["money_totals", "Work out money totals"], ["usage_check", "Check usage"], ["product_draft", "Draft a product summary"],
];
async function loadJobs() {
  try { jobs = (await api("/api/jobs")).jobs || []; } catch (err) { jobs = []; }
}
function jobsHtml() {
  const rows = jobs.map(j => `<tr><td>${esc(j.label)}</td><td>${esc(j.status)}</td><td>${j.status === "running" ? esc(j.step || "") + " — " + j.progress + "%" : esc(j.step || "")}</td><td>${esc(j.result || "")}${j.needs_approval ? "<br><strong>Draft only — check it before you send or publish anything.</strong>" : ""}</td><td>${j.status === "running" ? `<button class="small danger" onclick="cancelJob('${j.id}')">Cancel</button>` : ""}</td></tr>`).join("");
  return `<div class="panel"><h2>Running tasks — ask me to do several things at once</h2>
    <p><strong>Ask me to do several things at once, and I will run them together.</strong> Jobs start only when you ask — the bot never starts a job on its own, and nothing runs in the background unprompted.</p>
    <p class="muted">${esc(voiceStatusLine())} Voice recognition is a safety feature, not a secure ID — it alone never authorises taxes, bank access, payments, publishing or sending anything.</p>
    <p class="muted">Each job only reads what you have saved in the bot and works out a summary or a draft. A job never sends, charges, publishes or deletes anything — anything that would do one of those still needs your yes first. Jobs are in-app only, on this server, and they disappear when the server restarts. This is not a separate robot, not phone or screen access, and not the bot working on its own 24/7.</p>
    <div class="row"><button onclick="startMultiJobs()">▶ Run 3 jobs at once: check inventory, draft invoices, work out money</button>
    <button class="secondary" onclick="refreshJobs()">↻ Refresh</button></div>
    <div class="row">${JOB_TYPES.map(([t, label]) => `<button class="secondary small" onclick="startJob('${t}')">${esc(label)}</button>`).join("")}</div>
    ${jobs.length ? `<div class="panel scroll"><table><thead><tr><th>Job</th><th>Status</th><th>Progress</th><th>What it did</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="muted">No jobs yet — ask for one above, or ask the Assistant, for example "run inventory check, invoice draft and money totals at the same time".</p>`}
  </div>`;
}
async function startJob(type) {
  if (!(await ensurePermissionForJobs())) return;
  if (!(await ensureVoiceForJobs())) return;
  try { await api("/api/jobs", {method: "POST", body: {type, voice_token: voiceToken || undefined, passcode_token: passcodeToken || undefined}}); await refreshJobs(); flash("Job started.", true); }
  catch (err) { flash(err.message); }
}
async function startMultiJobs() {
  if (!(await ensurePermissionForJobs())) return;
  if (!(await ensureVoiceForJobs())) return;
  try {
    await api("/api/jobs/batch", {method: "POST", body: {types: ["inventory_check", "invoice_draft", "money_totals"], voice_token: voiceToken || undefined, passcode_token: passcodeToken || undefined}});
    await refreshJobs(); flash("3 jobs started — running together.", true);
  } catch (err) { flash(err.message); }
}
async function refreshJobs() { await loadJobs(); const el = $("#jobsPanel"); if (el && currentTab === "tasks") el.innerHTML = jobsHtml(); }
async function cancelJob(id) {
  try { await api("/api/jobs/" + id + "/cancel", {method: "POST", body: {}}); await refreshJobs(); }
  catch (err) { flash(err.message); }
}
/* ---------- Voice recognition — safety feature, not a secure ID ----------
   The person who bought the bot enrols their voice first, with their
   consent. The browser listens for about 3 seconds, works out 16
   numbers from the sound (average frequency-band levels), and sends
   only those numbers to the server — no audio recording is stored
   and no voice is sent anywhere. After enrolment, jobs only start
   for that enrolled voice: the browser checks the voice first and
   the server only accepts the job with a fresh voice token (5 min).
   A different voice is not recognised and no job starts. This is a
   simple voiceprint match, not a bank-grade biometric and not
   unbreakable — a recording could fool it, a cold or background
   noise can make it fail. Voice recognition alone NEVER authorises
   taxes, bank access, payments, publishing or sending anything. */
let voiceProfile = null;   // {enrolled, name, phrase} from /api/voice, or null
let voiceToken = "";       // fresh token from a recognised voice check
let voiceTokenExpires = 0;
/* ---------- Passcode — second step after voice (George, 2026-11-16) ----------
   Only George's voice PLUS his passcode opens Connie, in that order.
   The passcode is set by George himself in Settings and only its
   salted hash is stored on the server — never the passcode itself,
   never in this browser, never in a log. No code is unbreakable: a
   4-digit code has only 10,000 combinations, so the server refuses
   short codes and asks for at least 8 characters with letters and
   numbers. 3 wrong tries locks Connie for 15 minutes. The passcode
   token lives only in memory here (never localStorage) and lasts
   1 hour. */
let passcodeStatus = null;  // {set, locked, locked_until} from /api/passcode/status
let passcodeToken = "";     // fresh token from a passed passcode check
let passcodeTokenExpires = 0;
async function loadPasscodeStatus() {
  try { passcodeStatus = await api("/api/passcode/status"); } catch (err) { passcodeStatus = null; }
  return passcodeStatus;
}
async function setPasscode() {
  const pc = ($("#passcodeNew") || {}).value || "";
  const pw = ($("#passcodePassword") || {}).value || "";
  const msg = $("#passcodeMsg"); if (msg) msg.textContent = "";
  if (!pc || !pw) { flash("Enter a new passcode and your account password."); return; }
  try {
    await api("/api/passcode/set", {method: "POST", body: {passcode: pc, password: pw}});
    if ($("#passcodeNew")) $("#passcodeNew").value = "";
    if ($("#passcodePassword")) $("#passcodePassword").value = "";
    passcodeStatus = {set: true, locked: false};
    if (msg) msg.textContent = "Passcode set. Only your voice plus this passcode opens Connie now. Write it down somewhere private — nobody can look it up for you.";
    flash("Passcode set.", true); if (currentTab === "settings") showTab("settings");
  } catch (err) { if (msg) msg.textContent = "Passcode was not set: " + err.message; flash(err.message); }
}
async function checkPasscode() {
  // Voice first, then passcode — in that order. Asks George for the
  // passcode with the browser's own prompt; it is sent once to the
  // server for checking and is never stored anywhere.
  const pc = window.prompt("Enter your passcode — the one you set in Settings. Voice alone is not enough.");
  if (pc === null || pc === "") return false;
  try {
    const d = await api("/api/passcode/check", {method: "POST", body: {voice_token: voiceToken || undefined, passcode: pc}});
    passcodeToken = d.passcode_token || ""; passcodeTokenExpires = Date.now() + 60 * 60 * 1000;
    flash("That's you — voice and passcode both match.", true);
    return true;
  } catch (err) { flash(err.message); return false; }
}
async function removePasscode() {
  const pw = ($("#passcodePassword") || {}).value || "";
  const msg = $("#passcodeMsg");
  if (!pw) { flash("Enter your account password to remove the passcode."); return; }
  if (!confirm("Remove your passcode? Voice alone will open Connie again.")) return;
  try {
    await api("/api/passcode/remove", {method: "POST", body: {password: pw}});
    passcodeToken = ""; passcodeTokenExpires = 0; passcodeStatus = {set: false, locked: false};
    if (msg) msg.textContent = "Passcode removed. Voice alone opens Connie again.";
    flash("Passcode removed.", true); if (currentTab === "settings") showTab("settings");
  } catch (err) { if (msg) msg.textContent = "Passcode was not removed: " + err.message; flash(err.message); }
}
window.setPasscode = setPasscode; window.removePasscode = removePasscode;
async function loadVoice() {
  try { voiceProfile = await api("/api/voice"); } catch (err) { voiceProfile = null; }
  return voiceProfile;
}
async function captureVoiceFeatures(seconds, statusEl) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("This browser cannot use the microphone — voice enrolment needs a browser with microphone access.");
  if (!window.AudioContext && !window.webkitAudioContext) throw new Error("This browser cannot measure voice sound — voice enrolment needs Web Audio.");
  const stream = await navigator.mediaDevices.getUserMedia({audio: true});
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser(); analyser.fftSize = 2048;
    src.connect(analyser);
    const bins = new Uint8Array(analyser.frequencyBinCount);
    const bands = new Array(16).fill(0); let frames = 0;
    const started = Date.now();
    if (statusEl) statusEl.textContent = "Listening — say your phrase in a normal voice…";
    while (Date.now() - started < seconds * 1000) {
      analyser.getByteFrequencyData(bins);
      for (let b = 0; b < 16; b++) {
        let s = 0; const from = Math.floor(bins.length * b / 16), to = Math.floor(bins.length * (b + 1) / 16);
        for (let i = from; i < to; i++) s += bins[i];
        bands[b] += s / Math.max(1, to - from);
      }
      frames++;
      await new Promise(r => setTimeout(r, 100));
    }
    const max = Math.max(...bands, 1);
    return bands.map(v => Math.round((v / frames / max) * 1000) / 1000);
  } finally {
    stream.getTracks().forEach(t => t.stop());
  }
}
async function enrollVoice() {
  const name = ($("#voiceName") || {}).value ? $("#voiceName").value.trim() : "";
  const phrase = ($("#voicePhrase") || {}).value ? $("#voicePhrase").value.trim() : "This is my bot";
  const consent = $("#voiceConsent") ? $("#voiceConsent").checked : false;
  const msg = $("#voiceMsg"); if (msg) msg.textContent = "";
  if (!name) { flash("Give your name first, then enrol your voice."); return; }
  if (!consent) { flash("Enrolling your voice needs your consent — tick the consent box first."); return; }
  try {
    const features = await captureVoiceFeatures(3, msg);
    const d = await api("/api/voice/enroll", {method: "POST", body: {name, phrase, features, consent: true}});
    voiceProfile = {enrolled: true, name: d.name, phrase: d.phrase};
    if (msg) msg.textContent = "Voice enrolled for " + d.name + ". From now on, jobs only start for this voice.";
    flash("Voice enrolled.", true); if (currentTab === "settings") showTab("settings");
  } catch (err) { if (msg) msg.textContent = "Voice enrolment did not work: " + err.message; flash(err.message); }
}
async function testVoice() {
  const msg = $("#voiceMsg"); if (msg) msg.textContent = "";
  try {
    const features = await captureVoiceFeatures(2.5, msg);
    const d = await api("/api/voice/check", {method: "POST", body: {features}});
    if (d.recognised) {
      voiceToken = d.voice_token || ""; voiceTokenExpires = Date.now() + 5 * 60 * 1000;
      if (msg) msg.textContent = "Voice recognised — that's the enrolled voice. You can run jobs for 5 minutes.";
      flash("Voice recognised.", true);
    } else {
      voiceToken = ""; voiceTokenExpires = 0;
      if (msg) msg.textContent = "I don't recognise that voice, so I won't run any jobs.";
      flash("I don't recognise that voice.");
    }
    return !!d.recognised;
  } catch (err) { if (msg) msg.textContent = "Voice check did not work: " + err.message; flash(err.message); return false; }
}
async function forgetVoice() {
  if (!confirm("Remove your enrolled voice? Jobs will no longer be voice-checked until you enrol again.")) return;
  try {
    await api("/api/voice", {method: "DELETE"});
    voiceProfile = {enrolled: false}; voiceToken = ""; voiceTokenExpires = 0;
    flash("Your voice has been removed.", true); if (currentTab === "settings") showTab("settings");
  } catch (err) { flash(err.message); }
}
async function ensureVoiceForJobs() {
  // Two-step, in order — voice first, then passcode (if one is set).
  await loadVoice(); await loadPasscodeStatus();
  const voiceNeeded = voiceProfile && voiceProfile.enrolled;
  const passcodeNeeded = passcodeStatus && passcodeStatus.set;
  if (!voiceNeeded && !passcodeNeeded) return true;  // neither set — jobs work as before (sign-in only)
  if (voiceNeeded) {
    if (!(voiceToken && Date.now() < voiceTokenExpires)) {
      flash("Voice check first — say your phrase so the bot knows it's you.");
      if (!(await testVoice())) { flash("I don't recognise that voice, so I won't run any jobs."); return false; }
    }
  }
  if (passcodeNeeded) {
    if (passcodeStatus.locked) { flash("Too many wrong passcodes — Connie is locked for 15 minutes. Wait, then try again."); return false; }
    if (!(passcodeToken && Date.now() < passcodeTokenExpires)) {
      if (!(await checkPasscode())) { flash("Enter your passcode first — voice alone is not enough."); return false; }
    }
  }
  return true;
}
window.ensureVoiceForJobs = ensureVoiceForJobs;
function voiceStatusLine() {
  if (!voiceProfile) return "Voice recognition: not checked yet.";
  const pc = passcodeStatus && passcodeStatus.set ? " Plus your passcode: voice first, then passcode — both are needed before Connie knows it's you." : " No passcode set yet — set one below and only your voice plus your passcode will open Connie.";
  if (!voiceProfile.enrolled) return "Voice recognition: no voice enrolled — anyone signed in can run jobs. Enrol your voice in Settings to lock jobs to your voice." + pc;
  return `Voice recognition: enrolled for ${voiceProfile.name} — jobs only start for that voice. A different voice is not recognised and no job starts.` + pc;
}
window.enrollVoice = enrollVoice; window.testVoice = testVoice; window.forgetVoice = forgetVoice;
window.startJob = startJob; window.startMultiJobs = startMultiJobs; window.refreshJobs = refreshJobs; window.cancelJob = cancelJob;
function renderTasks(v) {
  const open = list("tasks").filter(t => !t.data.done).length;
  v.innerHTML = `<div id="jobsPanel">` + jobsHtml() + `</div>`
    + `<div class="panel"><h2>Tasks & reminders</h2><p>Open tasks: ${open} · Reminders: ${list("reminders").filter(r => !r.data.done).length}</p></div>`
    + renderKind("tasks", "Tasks") + renderKind("reminders", "Reminders");
  if (jobsTimer) clearInterval(jobsTimer);
  jobsTimer = setInterval(async () => {
    if (currentTab !== "tasks") { clearInterval(jobsTimer); jobsTimer = null; return; }
    await loadJobs();
    const el = $("#jobsPanel"); if (el) el.innerHTML = jobsHtml();
    if (!jobs.some(j => j.status === "running")) { clearInterval(jobsTimer); jobsTimer = null; }
  }, 1500);
  loadJobs().then(() => { const el = $("#jobsPanel"); if (el && currentTab === "tasks") el.innerHTML = jobsHtml(); });
}
function renderProducts(v) {
  v.innerHTML = `<div class="panel"><h2>Products & marketing</h2>
    <p class="muted"><strong>Personal copy — no storefront, nothing for sale.</strong> Products here are George's own drafts and notes only. Nothing is published, listed, or sold from this copy, and there is no payment link.</p></div>`
    + renderKind("products", "Digital products")
    + renderKind("campaigns", "Marketing campaigns");
}
function renderPersonal(v) {
  v.innerHTML = `<div class="panel"><h2>Personal & household</h2><p class="muted">Your personal space is separate from business records. Nothing here is ordered or shared — shopping lists are for your review only.</p></div>`
    + renderKind("household", "Household") + renderKind("shopping", "Shopping list") + renderKind("meals", "Meal planning") + renderKind("notes", "Notes");
}
function renderTrading(v) {
  const tr = list("trades");
  const spent = tr.filter(t => t.data.side === "Buy").reduce((s, t) => s + (Number(t.data.qty) || 0) * (Number(t.data.price) || 0), 0);
  const got = tr.filter(t => t.data.side === "Sell").reduce((s, t) => s + (Number(t.data.qty) || 0) * (Number(t.data.price) || 0), 0);
  v.innerHTML = `<div class="panel"><h2>Paper trading — paper only</h2>
    <p><strong>This is not live trading.</strong> No broker is connected, no real money moves, and no order is placed. Trades here are practice records only.</p>
    <p>Paper buys recorded: ${money(spent)} · Paper sells recorded: ${money(got)} · Paper difference: ${money(got - spent)}</p></div>`
    + renderKind("trades", "Paper trades — add a trade with symbol, Buy/Sell, quantity and price");
}
function renderSettings(v) {
  const s = first("settings");
  v.innerHTML = `<div class="panel"><h2>Settings</h2>
    <p class="muted">Business name is George's own business name. Tax reserve % is used only for the Money estimate.</p>
    <form data-kind="settings" onsubmit="event.preventDefault();saveSettings(this)">
      <label>Business name<input name="business" value="${esc(s ? s.data.business : "")}"></label>
      <label>Owner name<input name="owner_name" value="${esc(s ? s.data.owner_name : "George Wederski")}"></label>
      <label>Tax reserve % (estimate)<input type="number" name="tax_reserve" value="${esc(s ? s.data.tax_reserve : 25)}"></label>
      <label class="wide">Notes<textarea name="notes">${esc(s ? s.data.notes : "")}</textarea></label>
      <button type="submit">Save settings</button>
    </form></div>
  <div class="panel"><h2>Put Connie on my phone</h2>
    <p>Connie is already a phone app — a home-screen app, <strong>not</strong> a Play Store app. There is no app-store download. Tap the button below: on Android / Chrome it adds her to your home screen. On iPhone the button will not appear — use Share, then \"Add to Home Screen\" instead.</p>
    <div class="row"><button type="button" id="installConnieBtn" onclick="installConnie()">📲 Add Connie to my home screen</button></div>
    <p id="installMsg" class="msg"></p>
    <p class="muted"><strong>Honest note:</strong> the home-screen icon alone does not run Connie. Her server still has to be running — on your computer (same Wi-Fi, see README \"Put Connie on my phone\") or on a hosted server. If the server is off, the app opens but your records will not load.</p></div>
  <div class="panel"><h2>How the bot sounds — Voice choice</h2>
    <p>Connie's voice is a <strong>girl's voice by default</strong> — the first female voice on this device, set right now. Pick how she sounds when she talks back — girl / female voices and male voices are in the list, from the voices on <strong>this device</strong>. Tap "Hear it" to hear a short sample, then "Use this voice" to switch. Or just ask the Assistant: "change your voice to a girl voice" — it switches right away and answers back in the new voice.</p>
    <p class="muted">These are your device / browser's own text-to-speech voices — the list is different on different phones and computers, and a voice that is not listed here is not available on this device. There is no live AI voice model in this bot, and no AI key is set. When an AI key is connected later, the bot still speaks its answers in the voice you picked here, unless that provider offers its own voice. Picking a voice to talk back does <strong>not</strong> change voice recognition — only George's enrolled voice can start jobs.</p>
    <div id="voiceChoiceList"><p class="muted">Loading the voices on this device…</p></div></div>
  <div class="panel"><h2>Permissions — I ask first, every time</h2>
    <p><strong>I ask first, every time. I only see what you said yes to.</strong> Before the bot looks at your records, does a job, or uses a connected tool, it shows you plainly what it wants to do and whose records it wants to use, and waits for your yes — like Remy does. If you say no, or do not answer, it does nothing.</p>
    <p class="muted">Access is per-person only: the bot can only look at the records of the person who gave permission, for that request, and only what they said yes to. It does not get blanket access to everybody's stuff at once, and nobody else can see George's records — this copy is for George only — the server keeps every user's records separate. A yes lasts only for this sign-in.</p>
    <p>${esc(permissionLine())}</p>
    <div class="row"><button type="button" class="secondary" onclick="revokePermissions()">Take back permission</button></div></div>
  <div class="panel"><h2>Safety &amp; legal — read this first</h2>
    <p><strong>George asked: is this bot safe, and am I breaking any rules?</strong> Here is the honest answer, in plain words.</p>
    <p><strong>Safe already, in this build:</strong></p>
    <ul>
      <li><strong>Your records stay yours.</strong> Records are per-person only — nobody else can see George's stuff — this copy is for George only. The server only ever returns the signed-in person's own records.</li>
      <li><strong>The bot asks for permission first, every time</strong> — like Remy does — before it looks at your records, does a job, or uses a connected tool. If you say no, or do not answer, it does nothing.</li>
      <li><strong>Voice recognition is a safety check only, not a secure ID</strong> — and voice alone never authorises payments, taxes, bank access, publishing or sending anything. Those still need a separate yes, every time. With a passcode set, it takes voice <em>plus</em> passcode to get in — see "Passcode" and "Security" below.</li>
      <li><strong>No audio recordings are stored</strong> — only 16 voice numbers, kept on this server. No voice is sent anywhere.</li>
      <li><strong>No phone or screen access, no impersonation, no accessing other people's phones.</strong> The bot never pretends to be you, and it never touches a phone that is not yours.</li>
      <li><strong>No live payments, no Stripe, no AI key in the bot.</strong> Nothing is charged, and no money moves.</li>
    </ul>
    <p><strong>NOT done yet — say so plainly:</strong></p>
    <ul>
      <li><strong>No hosting security review yet.</strong> This build runs on your own computer only. Before it goes on the internet it needs a host, a web address, HTTPS, and a security review first (see HOSTING.md).</li>
      <li><strong>No public web address for the real bot yet.</strong> Only the hosted phone demo exists, and that is sample data only.</li>
      <li><strong>No terms of service or privacy policy yet.</strong> There is nothing for a customer to read or agree to.</li>
      <li><strong>No legal review.</strong> Nobody has checked this bot against the law yet.</li>
    </ul>
    <p><strong>What Connie knows about the law:</strong> a short plain-words summary — no single federal AI law, the FTC rules, Wyoming HB 102, voice as the highest risk, what never to do, and what is needed before selling — is on the Learning screen ("Law &amp; safety — what I know"). General information only — NOT legal advice. The full research is saved at workspace/research_notes/ai-laws-creating-selling-bot-20261116-1031/report.md.</p>
    <p><strong>This personal copy is NOT for sale at all, and it is NOT legally reviewed.</strong> It is George's own assistant only — no customers, no selling, no terms of service or privacy policy for buyers, because there are no buyers. Do not put real money through it. If George ever wants to sell a version of it, that version needs hosting + a security review + Stripe + terms of service and a privacy policy first, and <strong>George should get a lawyer to check the terms before selling</strong>.</p></div>
  <div class="panel"><h2>Voice recognition — safety feature</h2>
    <p><strong>The bot only answers to / only runs jobs for George, the person this copy is for</strong> — once that person enrols their voice here, with their consent. After enrolment, a different voice is not recognised and no job starts.</p>
    <p class="muted">How it works: tap "Enrol my voice", allow the microphone, and say your phrase in a normal voice for about 3 seconds. The browser works out 16 numbers from the sound of your voice and sends only those numbers to this server — <strong>no audio recording is stored, and no voice is sent anywhere.</strong> To run jobs, the bot checks your voice first (about 2 seconds) and the check lasts 5 minutes. If no voice is enrolled, jobs work as before.</p>
    <p class="muted"><strong>This is a safety feature, not a secure ID.</strong> It is a simple voiceprint match, not a bank-grade biometric and not unbreakable — a recording could fool it, and a cold or background noise can make it fail. It does not work until you enrol first. <strong>Voice recognition alone never authorises taxes, bank access, payments, publishing or sending anything</strong> — those still need a separate yes / approval in the app, every time.</p>
    <p id="voiceStatus">${esc(voiceStatusLine())}</p>
    <label>Your name<input id="voiceName" value="${esc(voiceProfile && voiceProfile.enrolled ? voiceProfile.name : (s ? s.data.owner_name : "George Wederski"))}"></label>
    <label>Phrase to say<input id="voicePhrase" value="${esc(voiceProfile && voiceProfile.enrolled ? voiceProfile.phrase : "This is my bot")}"></label>
    <label><input type="checkbox" id="voiceConsent"> I consent to the bot keeping a voiceprint (16 numbers from my voice) on this server, so it can recognise my voice.</label>
    <div class="row"><button type="button" onclick="enrollVoice()">🎤 Enrol my voice</button>
    <button type="button" class="secondary" onclick="testVoice()">🎤 Test my voice</button>
    <button type="button" class="danger" onclick="forgetVoice()">Remove my voice (Forget)</button></div>
    <p id="voiceMsg" class="msg"></p></div>
  <div class="panel"><h2>Passcode — second step after your voice</h2>
    <p><strong>Only your voice plus your passcode opens Connie</strong> — voice first, then passcode, in that order. Nobody else gets in: a different voice is not recognised, and a wrong passcode stops there too.</p>
    <p class="muted"><strong>No code is unbreakable.</strong> A 4-digit code has only 10,000 combinations, so it can be guessed — short codes are refused here. Use at least <strong>8 characters with letters and numbers</strong> (for example a short phrase with a number in it). Only the salted hash of your passcode is stored on the server — never the passcode itself, never in a log, never in chat. <strong>Write it down somewhere private</strong> — nobody can look it up for you, not even me. After <strong>3 wrong tries Connie locks for 15 minutes</strong>.</p>
    <p id="passcodeStatus">${esc(passcodeStatus && passcodeStatus.set ? (passcodeStatus.locked ? "Passcode: set — and locked right now after too many wrong tries. Wait 15 minutes, then try again." : "Passcode: set. Voice first, then passcode — both are needed before Connie knows it's you.") : "Passcode: not set yet. Set one below and only your voice plus your passcode will open Connie.")}</p>
    <label>New passcode (at least 8 characters, letters and numbers)<input type="password" id="passcodeNew" autocomplete="new-password"></label>
    <label>Your account password — to prove it's you<input type="password" id="passcodePassword" autocomplete="current-password"></label>
    <div class="row"><button type="button" onclick="setPasscode()">Set my passcode</button>
    <button type="button" class="danger" onclick="removePasscode()">Remove my passcode</button></div>
    <p id="passcodeMsg" class="msg"></p></div>
  <div class="panel"><h2>Security — the security blanket</h2>
    <p><strong>Nobody can hack Connie or change her except George.</strong> Here is what protects her, in plain words:</p>
    <ul>
      <li><strong>Two steps to get in:</strong> your enrolled voice first, then your passcode. Both must match. A different voice, or a wrong passcode, stops there.</li>
      <li><strong>Your passcode is never stored as plain text</strong> — only a salted hash lives on the server. It is never logged, never put in a file or chat, and nobody can read it back out.</li>
      <li><strong>Lockout:</strong> 3 wrong passcodes locks Connie for 15 minutes. 5 wrong sign-ins locks 5 minutes. 5 wrong voice checks locks 5 minutes.</li>
      <li><strong>HTTPS-only when hosted:</strong> on the internet Connie only answers over HTTPS (set HTTPS_ONLY=1 on the host). Plain HTTP is refused.</li>
      <li><strong>No cookies at all:</strong> sign-in uses a token in the request header, so there are no cookies to steal.</li>
      <li><strong>Owner-only changes:</strong> only George, signed in, can change settings, learned notes, connectors or the passcode. Every write needs a signed-in owner session — visitors and anyone not signed in cannot change anything, and no record can be written without signing in first.</li>
      <li><strong>No secrets in the code, the zip or the logs:</strong> AI keys only ever come from the server's own settings (environment variables), never from code, chat or Drive.</li>
      <li><strong>Safe headers:</strong> the server tells browsers not to guess file types, not to show Connie inside another page, and to use HTTPS for a year once it is on.</li>
    </ul>
    <p class="muted"><strong>Honest limit:</strong> no system is unhackable, and no code is unbreakable — this makes breaking in very hard, not impossible. Keep your passcode and your account password private, keep the server's database backed up, and get a security review before Connie goes on the open internet.</p></div>
  <div class="panel"><h2>Personal copy — no plans, no prices</h2>
    <p><strong>This copy is for George only. It is NOT for sale.</strong> There are no plans, no pricing tiers, no monthly or yearly prices, no free tier, and no usage limits to buy. The customer version had prices — they do not exist in this personal copy.</p>
    <p class="muted">The only money figure in this copy is the Research to upgrade me button: an additional $250, shown up front, with no payment live — nothing is charged here.</p></div>
  <div class="panel"><h2>What is connected</h2><div id="connList">Loading…</div></div>
  <div class="panel"><h2>Backup &amp; audit — Download my stuff</h2>
    <p><strong>Download your own records to your phone or computer</strong> — learned notes, invoices, everything you saved. Only George, signed in, can download — and only after the two-step check (your voice, then your passcode, when set). Only your own records ever come down; there is no other person's data in Connie at all. Nothing downloads on its own — only when you tap a button below.</p>
    <div class="row"><button onclick="downloadMyStuff('')">⬇ Download my stuff — everything</button>
    <button class="secondary" onclick="downloadMyStuff('learned')">⬇ Learned notes only</button>
    <button class="secondary" onclick="downloadMyStuff('invoices')">⬇ Invoices only</button></div>
    <div class="row"><label>Import backup <input type="file" id="importFile" accept="application/json"></label></div>
    <p id="backupMsg" class="msg"></p>
    <h3>Audit history</h3><div id="auditList">Loading…</div></div>
  <div class="panel"><h2>Account</h2>
    <div class="row"><button class="secondary" onclick="signOut()">Sign out</button></div>
    <form onsubmit="event.preventDefault();deleteAccount(this)">
      <label>Password (to delete my account and all my records)<input type="password" name="password" required minlength="12"></label>
      <button type="submit" class="danger">Delete my account</button>
    </form>
    <p class="muted">Deleting your account removes your records, sessions and audit history from this server. Export a backup first if you want to keep a copy.</p></div>`;
  loadVoice().then(() => { const el = $("#voiceStatus"); if (el) el.textContent = voiceStatusLine(); });
  loadPasscodeStatus().then(() => { const el = $("#voiceStatus"); if (el) el.textContent = voiceStatusLine(); });
  loadSpeechVoices().then(() => renderVoiceChoiceList());
  api("/api/health").then(h => {
    const el = $("#connList"); if (!el) return;
    el.innerHTML = `<ul>
      <li>AI chat: ${h.ai_enabled ? "connected on the server" : "not connected — add a server-side AI key (see README)"}</li>
      <li>Live phone / receptionist: not connected</li>
      <li>Payments / Stripe: not connected — no store, no checkout, no payment in this personal copy</li>
      <li>Bank feeds: not connected</li>
      <li>Tax filing: not connected — tax reserve is an estimate only</li>
      <li>Sign-ups open: ${h.signup_open ? "yes" : "no"}</li></ul>`;
  }).catch(() => {});
  api("/api/audit").then(d => {
    const el = $("#auditList"); if (!el) return;
    el.innerHTML = (d.audit || []).slice(0, 50).map(a => `<div>${esc(new Date(a.created * 1000).toLocaleString())} — ${esc(a.action)} ${esc(a.detail || "")}</div>`).join("") || "No audit entries yet.";
  }).catch(() => {});
  const imp = $("#importFile");
  if (imp) imp.onchange = importBackup;
}
/* ---------- Integrations / Crosswalk — plug-in connector framework ----------
   Each connector is a slot in CONNECTOR_CATALOG: a name, what it does,
   what it needs (its own account/key, server-side only), and its status.
   State (enabled on/off, plus any custom "other app / other bot" slots
   George names) is saved per user as records of kind "connectors"
   (server.py KINDS), so it survives sign-out.
   Statuses are honest: only Claude and ChatGPT report Connected, from
   the server's real /api/status (providers list). Every other slot is
   "Not connected" — or "Needs your key" once George switches it on —
   until that service's own account/key is supplied on the server and
   approved. Switching a slot on never connects it and never invents
   live behaviour. Adding a real connector later means filling in its
   slot: server-side credentials, a status check, and the actions it is
   allowed to do, with George's approval first for anything affecting
   customers, money or accounts.
   Crosswalk: his signup (Nov 6, 2026, as "Rumi (Muse)",
   biggeorgewederski7@gmail.com) was never finished and no Crosswalk
   key is saved. There is no Crosswalk connector to install and no
   live Crosswalk connection. */
let integrationStatus = null;   // {providers: [...]} from /api/status
let integrationStatusLoading = false;
const CONNECTOR_CATALOG = [
  {key: "crosswalk", name: "Crosswalk", type: "hub",
   adds: "The hub itself: the crossroads where other bots, tools and apps plug into George's Assistant, so they can work inside the bot instead of in separate apps.",
   needs: "Your Crosswalk key and account, added on the server once your Nov 6 signup is finished. No key is saved in the bot."},
  {key: "anthropic", name: "Claude Fable 5.2 (Anthropic)", type: "ai", provider: "anthropic",
   adds: "Live AI chat and research in the Assistant, using Claude Fable 5.2 (claude-fable-5-2) — the #1 top brain, $8 per million input / $40 per million output tokens, released 9 Nov 2026.",
   needs: "Your own Anthropic API key and model name, set on the server as ANTHROPIC_API_KEY and ANTHROPIC_MODEL. No key is set yet, so Claude is not connected."},
  {key: "openai", name: "ChatGPT (OpenAI)", type: "ai", provider: "openai",
   adds: "Live AI chat and research in the Assistant, using GPT-6.2 Astra (gpt-6.2-astra) — $8 per million input / $40 per million output tokens, released 17 Nov 2026.",
   needs: "Your own OpenAI API key and model name, set on the server as OPENAI_API_KEY and OPENAI_MODEL. No key is set yet, so ChatGPT is not connected."},
  {key: "opus", name: "Claude Opus 5.5 (Anthropic)", type: "ai", provider: "opus",
   adds: "Live AI chat and research in the Assistant, using Claude Opus 5.5 (claude-opus-5-5) — $4 per million input / $20 per million output tokens. Same Anthropic key as Fable — no new key needed.",
   needs: "Your own Anthropic API key, set on the server as ANTHROPIC_API_KEY, with OPUS_MODEL to override the default claude-opus-5-5. No key is set yet, so Opus is not connected."},
  {key: "remy", name: "Remy / Muse — Talk to Remy", type: "remy",
   adds: "Remy is the assistant George talks to here in Muse: research, drafting, building and checking this bot, running the paper trading desk, keeping his records, and walking him through Stripe, Whop and Etsy steps — by text or voice call in the Muse app. This slot is for George, the owner, only.",
   needs: "There is no key for Remy — Remy lives in the Muse app, and no key can be made for it. Open Muse and talk to Remy there. Customers using George's Assistant cannot talk to George's Remy through this bot: Remy knows George's private records and money, and that is never shared with customers. Inside George's Assistant itself, Remy is NOT live: the assistant there is the Connie, which works from the bot's own screens and, for live AI chat, from George's own Anthropic or OpenAI key."},
  {key: "calendar", name: "Google Calendar", type: "external",
   adds: "Appointments in the bot syncing with your calendar, so nothing double-books.",
   needs: "Your Google Calendar account, connected on the server."},
  {key: "gmail", name: "Gmail", type: "external",
   adds: "Reading your email for invoices and appointments, and sending invoices and reminders to customers — only messages you approve.",
   needs: "Your Gmail account, connected on the server. Nothing is sent until you approve that exact message."},
  {key: "stripe", name: "Stripe (payments)", type: "external",
   adds: "Taking real payment — only if George ever wants it. Not in this personal copy: no checkout, nothing for sale.",
   needs: "Your own Stripe account, and George's approval. This personal copy has no checkout."},
  {key: "phone", name: "Phone / telephony", type: "external",
   adds: "A live phone line that answers calls, takes messages and books appointments, with a person taking over when needed.",
   needs: "A phone provider account you choose. For now, calls are only logged by hand on the Front Desk tab."},
  {key: "bank", name: "Bank feeds", type: "external",
   adds: "Real bank transactions appearing in Money, instead of figures you type in.",
   needs: "A bank-feed provider account you connect and approve. Money figures here are your own entered estimates until then."},
  {key: "tax", name: "Tax filing", type: "external",
   adds: "Preparing and filing a tax return through an authorised tax provider, after you review and sign it.",
   needs: "An authorised tax-filing provider account. The 25% tax reserve here is a bookkeeping estimate only."},
];
function connectorRecord(key) {
  return list("connectors").find(r => r.data && r.data.key === key) || null;
}
function connectorStatus(c) {
  if (c.type === "builtin") return {label: "Built in", cls: ""};
  if (c.type === "remy") return {label: "Works here in Muse", cls: ""};
  // A custom connector George added himself: it is plugged in (Connie
  // knows about it and can talk about it) but NOT connected — there is
  // no live check for it, so it can never honestly say Connected here.
  if (typeof c.key === "string" && c.key.startsWith("custom:")) return {label: "Plugged in — NOT connected", cls: "alert"};
  if (c.type === "ai") {
    const on = ((integrationStatus && integrationStatus.providers) || []).includes(c.provider);
    return on ? {label: "Connected", cls: ""} : {label: "Not connected", cls: "alert"};
  }
  const rec = connectorRecord(c.key);
  if (rec && rec.data.enabled) return {label: "Needs your key", cls: "alert"};
  return {label: "Not connected", cls: "alert"};
}
function connectorCard(c, name, adds, needs, rec) {
  const s = connectorStatus(c);
  const enabled = !!(rec && rec.data.enabled);
  const toggle = (c.type === "builtin" || c.type === "remy") ? "" :
    `<div class="row"><button type="button" class="${enabled ? "secondary" : ""}" onclick="toggleConnector('${esc(c.key)}')">${enabled ? "✓ Enabled — switch off" : "Enable this connector"}</button>
    <span class="muted">${c.type === "ai" ? "Enabling only records that you want it. It connects only when the server key is set." : "Enabling only records that you want it. It connects only when you supply the account/key on the server."}</span></div>`;
  return `<div class="panel"><h2>${esc(name)} <span class="pill ${s.cls}">${esc(s.label)}</span></h2>
    <p><strong>What it would add:</strong> ${esc(adds)}</p>
    <p class="muted"><strong>What you need to supply:</strong> ${esc(needs)}</p>${toggle}</div>`;
}
async function toggleConnector(key) {
  const rec = connectorRecord(key);
  try {
    if (rec) await api("/api/records/" + rec.id, {method: "PUT", body: {data: {...rec.data, enabled: !(rec.data.enabled === true)}}});
    else await api("/api/records", {method: "POST", body: {kind: "connectors", data: {key, enabled: true}}});
    await loadAll(); renderIntegrations($("#view"));
  } catch (err) { flash(err.message); }
}
window.toggleConnector = toggleConnector;
async function addCustomConnector(form) {
  const name = form.custom_name.value.trim(), what = form.custom_what.value.trim();
  const account = form.custom_account ? form.custom_account.value.trim() : "";
  if (!name) { flash("Give the app or bot a name first."); return; }
  try {
    await api("/api/records", {method: "POST", body: {kind: "connectors", data: {key: "custom:" + Date.now(), enabled: true, custom_name: name, custom_what: what, custom_account: account, approved: false}}});
    await loadAll(); renderIntegrations($("#view"));
    flash("Plugged in — " + name + " is now listed, but NOT connected until its key/account is set on the server and you approve it.", true);
  } catch (err) { flash(err.message); }
}
window.addCustomConnector = addCustomConnector;
/* A custom connector is plugged in, not connected: Connie knows about
   it and can talk about it, but it cannot do anything until (1) its
   key/account is set on the server and (2) George approves it here.
   Approving never connects it by itself — there is no live check for a
   custom connector, so it stays "Plugged in — NOT connected" until a
   real connector is built for it. Nothing is auto-connected, auto-sent
   or auto-charged, ever. */
async function approveCustomConnector(id) {
  const rec = list("connectors").find(r => r.id === id); if (!rec) return;
  try {
    await api("/api/records/" + id, {method: "PUT", body: {data: {...rec.data, approved: true}}});
    await loadAll(); renderIntegrations($("#view"));
    flash("Approved — " + (rec.data.custom_name || "that connector") + ". It is still NOT connected until its key/account is set on the server.", true);
  } catch (err) { flash(err.message); }
}
async function deleteCustomConnector(id) {
  if (!confirm("Remove this connector slot? Connie will stop listing it.")) return;
  try { await api("/api/records/" + id, {method: "DELETE"}); await loadAll(); renderIntegrations($("#view")); flash("Connector removed.", true); }
  catch (err) { flash(err.message); }
}
window.approveCustomConnector = approveCustomConnector;
window.deleteCustomConnector = deleteCustomConnector;
function customConnectorCard(r) {
  const d = r.data || {};
  return `<div class="panel"><h2>${esc(d.custom_name || "Other app / bot")} <span class="pill alert">Plugged in — NOT connected</span></h2>
    <p><strong>What it should do in the bot:</strong> ${esc(d.custom_what || "You named this app or bot — say what it should do, and it will be filled in when its connector is built.")}</p>
    ${d.custom_account ? `<p><strong>Key / account to use:</strong> ${esc(d.custom_account)} <span class="muted">(name only — the actual key stays on the server, never in chat)</span></p>` : `<p class="muted"><strong>Key / account to use:</strong> not named yet — add it on the server, never in chat.</p>`}
    <p class="muted"><strong>Plugged in but NOT connected.</strong> Connie knows about this app and can talk about it, and you can ask her "what connectors do I have?" — but it cannot do anything yet. It connects only when (1) its key/account is set on the server and (2) you approve it here. ${d.approved ? "You have approved it — its key/account still needs to be set on the server, and there is no live check for it yet, so it stays NOT connected." : "You have not approved it yet."} Nothing is auto-connected, auto-sent or auto-charged.</p>
    <div class="row">${d.approved ? `<span class="pill">✓ You approved it</span>` : `<button type="button" onclick="approveCustomConnector('${r.id}')">Approve — I set the key/account on the server</button>`}
    <button type="button" class="secondary" onclick="toggleConnector('${esc(d.key)}')">${d.enabled ? "✓ Enabled — switch off" : "Enable this connector"}</button>
    <button type="button" class="danger" onclick="deleteCustomConnector('${r.id}')">Remove</button></div></div>`;
}
function renderIntegrations(v) {
  const customs = list("connectors").filter(r => r.data && typeof r.data.key === "string" && r.data.key.startsWith("custom:"));
  v.innerHTML = `
  <div class="panel"><h2>Integrations — Crosswalk</h2>
    <p class="muted">Crosswalk is the crossroads for this bot: the hub where other bots, tools and apps plug in, so they can work inside George's Assistant instead of living in separate apps — plugging things in makes it stronger. Each box below is a connector slot: switch it on to say you want it, then supply that service's own account or key on the server. Nothing here will ever ask you to paste a key into this page. Keys and accounts go on the server only, never in browser code, chat or Drive.</p>
    <div class="warning"><strong>Crosswalk itself — Not connected.</strong> Your Crosswalk signup was started on November 6, 2026 as "Rumi (Muse)" with the email biggeorgewederski7@gmail.com, and a claim email was sent — but the signup was never finished and <strong>no Crosswalk key was ever saved</strong>. There is no Crosswalk connector to install and no live Crosswalk connection in this bot. Once you have your Crosswalk key and account, add it on the server (see README) and it will show as Connected here. Until then, the entries below are the connections that work on their own.</div>
    <p class="muted">How a slot becomes real: (1) you switch it on, (2) you supply that service's account/key on the server, (3) the bot checks it and shows Connected, (4) it may only do what you approve — anything affecting customers, money or accounts needs your approval first, every time. Any app or bot you plug in below is listed here and Connie can talk about it — ask her "what connectors do I have?" — but it is plugged in, NOT connected, until its key/account is set on the server and you approve it.</p>
  </div>
  ${CONNECTOR_CATALOG.map(c => connectorCard(c, c.name, c.adds, c.needs, connectorRecord(c.key))).join("")}
  ${customs.map(r => customConnectorCard(r)).join("")}
  <div class="panel"><h2>Add any connector / plug in a new app</h2>
    <p class="muted">Name any other app or bot you want plugged in — WhatsApp, QuickBooks, your bank, another bot, anything. This saves it as a connector Connie knows about and can talk about: ask her "what connectors do I have?" and she will list it. <strong>Plugging it in does NOT connect it.</strong> It stays "Plugged in — NOT connected" until its key/account is set on the server and you approve it — nothing is auto-connected, auto-sent or auto-charged.</p>
    <form onsubmit="event.preventDefault();addCustomConnector(this)">
      <label>App or bot name<input name="custom_name" required maxlength="80" placeholder="e.g. WhatsApp, QuickBooks, my other bot"></label>
      <label class="wide">What should it do in the bot?<textarea name="custom_what" placeholder="e.g. Send customers a message when their invoice is ready"></textarea></label>
      <label class="wide">Key / account to use — name only<input name="custom_account" maxlength="120" placeholder="e.g. my WhatsApp Business account, my QuickBooks account"></label>
      <p class="muted"><strong>Keys stay on the server, never in chat.</strong> Do NOT paste an actual secret key into this form — write only which account or key it is. The real key goes on the server only (see README), never in browser code, chat or Drive. If you paste a key here by mistake, it would be saved as a plain record — so don't.</p>
      <button type="submit">Plug in this app</button>
    </form></div>
  <p class="muted">If a slot says "Not connected" or "Needs your key", the bot does not pretend otherwise — the feature simply says so on its own screen too.</p>`;
  if (!integrationStatus && !integrationStatusLoading) {
    integrationStatusLoading = true;
    api("/api/status").then(d => {
      integrationStatus = d; integrationStatusLoading = false;
      if (currentTab === "integrations") renderIntegrations($("#view"));
    }).catch(() => { integrationStatusLoading = false; });
  }
}
window.saveSettings = async function (form) {
  const data = {...(first("settings") ? first("settings").data : {}), business: form.business.value, owner_name: form.owner_name.value, tax_reserve: Number(form.tax_reserve.value) || 25, notes: form.notes.value};
  try {
    const s = first("settings");
    if (s) await api("/api/records/" + s.id, {method: "PUT", body: {data}});
    else await api("/api/records", {method: "POST", body: {kind: "settings", data}});
    await loadAll(); showTab("settings"); flash("Settings saved.", true);
  } catch (err) { flash(err.message); }
};
window.downloadMyStuff = async function (kind) {
  // Download my stuff (George, 2026-11-16): only after the two-step
  // check — voice first, then passcode, when set. Only George's own
  // records, as a file on his phone or computer. Nothing downloads
  // on its own, and nothing is downloaded from the open internet.
  if (!(await ensureVoiceForJobs())) { flash("I need to know it's you first — check your voice, then your passcode, and tap download again."); return; }
  try {
    const q = new URLSearchParams();
    if (kind) q.set("kind", kind);
    if (voiceToken) q.set("voice_token", voiceToken);
    if (passcodeToken) q.set("passcode_token", passcodeToken);
    const d = await api("/api/export" + (q.toString() ? "?" + q : ""));
    const blob = new Blob([JSON.stringify(d, null, 2)], {type: "application/json"});
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = "connie-" + (kind || "everything") + "-" + today() + ".json"; a.click();
    const el = $("#backupMsg"); if (el) el.textContent = "Downloaded — only your own records, nothing else.";
  } catch (err) { flash(err.message); }
};
window.exportBackup = function () { return downloadMyStuff(""); };
async function importBackup(e) {
  const file = e.target.files[0]; if (!file) return;
  try {
    const d = JSON.parse(await file.text());
    const r = await api("/api/import", {method: "POST", body: {records: d.records || []}});
    $("#backupMsg").textContent = `Imported ${r.imported} records, skipped ${r.skipped}.`;
    await loadAll();
  } catch (err) { flash(err.message); }
}
window.deleteAccount = async function (form) {
  if (!confirm("Delete your account and ALL your records? Export a backup first if you want to keep a copy.")) return;
  try {
    await api("/api/account", {method: "DELETE", body: {password: form.password.value}});
    token = ""; localStorage.removeItem("connie_token"); localStorage.removeItem("connie_username");
    location.reload();
  } catch (err) { flash(err.message); }
};
window.signOut = signOut;

/* trades need their own field set — add it after FIELDS is defined */
FIELDS.trades = [["symbol","Symbol (e.g. BTC)","text",1],["side","Side","select:Buy,Sell"],["qty","Quantity","number"],["price","Price ($)","number"],["date","Date","date"],["notes","Notes","textarea"]];

/* ---------- start ---------- */
$("#authForm").addEventListener("submit", doAuth);
$$(".links button").forEach(b => b.addEventListener("click", () => setMode(b.dataset.mode)));
$("#signOut").addEventListener("click", signOut);
setMode("login");
// Waits for plus.js (Connie Plus) to load first, so its upgrades start too.
if (token) window.addEventListener("DOMContentLoaded", () => enterApp());

/* Phone: install prompt. The browser fires beforeinstallprompt when
   the app can be installed (Android/Chrome). iPhone Safari never
   fires it — there the steps are Share -> Add to Home Screen, and
   installConnie() says so plainly. The home-screen icon alone does
   NOT run the server — see README "Put Connie on my phone". */
let deferredInstallPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  const b = document.getElementById("installConnieBtn");
  if (b) { b.disabled = false; b.textContent = "📲 Add Connie to my home screen"; }
});
async function installConnie() {
  const msg = document.getElementById("installMsg");
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    if (msg) msg.textContent = choice.outcome === "accepted"
      ? "Done — Connie is on your home screen now."
      : "No problem — you can add her any time from Settings, or from your browser menu.";
    const b = document.getElementById("installConnieBtn");
    if (b) b.disabled = true;
    return;
  }
  if (msg) msg.textContent = "Your browser did not offer the install button — use the steps below (on iPhone: Share, then Add to Home Screen).";
}
window.installConnie = installConnie;

/* Phone: register the service worker so the app shell works offline
   and the app can be added to the home screen. API calls are never
   cached (see sw.js) — records still need the server. */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
