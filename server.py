#!/usr/bin/env python3
"""George's Assistant v1.1 - combined app server.
Owner and creator: George Wederski.
© 2026 George Wederski. All rights reserved. No part of this book/app may be copied, reproduced, or shared without written permission from George Wederski.

Serves the George's Assistant web app and its API from one place. Uses only the
Python standard library (Python 3.9+). Built on the v1.0 local backend.

Settings come from environment variables (see .env.example):
  HOST, PORT, GEORGES_ASSISTANT_DB, ALLOW_SIGNUP,
  ANTHROPIC_API_KEY, ANTHROPIC_MODEL, OPUS_MODEL, OPENAI_API_KEY, OPENAI_MODEL,
  AI_HOURLY_LIMIT

Hosting (2026-11-16, George approved): the server is hosting-ready.
It binds the host's PORT when one is given, serves plain HTTP behind
the host's HTTPS proxy (the host terminates TLS — see HOSTING.md),
and keeps its database at GEORGES_ASSISTANT_DB, which must point at
a persistent disk/volume on the host, or Connie's learned notes and
voice enrolment are lost when the host restarts the service.
Auth is a Bearer token in the Authorization header — no cookies and
no client-IP checks — so no proxy-header handling is needed.
"""
import os, json, sqlite3, secrets, hashlib, hmac, time, re, threading, urllib.request, urllib.error
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, unquote
from pathlib import Path
import connie_plus as plus

VERSION = "1.2"
ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"
CLASSIC = ROOT / "previous_versions"
DB = Path(os.getenv("GEORGES_ASSISTANT_DB", os.getenv("PEOPLES_BOT_DB", str(ROOT / "georges_assistant.sqlite3"))))
SESSION_SECONDS = 12 * 3600
ALLOW_SIGNUP = os.getenv("ALLOW_SIGNUP", "1") != "0"
# Connie is FASTER than People's Bot (George, 2026-11-16): 60 AI requests
# per user per hour — double People's Bot's 30 — and NO 5-hour session
# limit for George. There is no 5-hour usage window anywhere in this
# server; the only time limit is the 12-hour sign-in session.
AI_HOURLY_LIMIT = int(os.getenv("AI_HOURLY_LIMIT", "60"))
SESSION_LIMIT = "none — no 5-hour session limit for George"

# Top 3 usable AI brains only, chosen by George 2026-11-18 —
# installed in Connie herself (not just the demo). Per the
# Nov 18 2026 ranking at https://theairankings.com/best-ai-models/:
# 1. Claude Fable 5.2 (claude-fable-5-2) — #1, score 65, $8/$40
#    per million tokens, released 9 Nov 2026. Top/default brain.
#    Fable was removed 2026-11-16, then RE-ADDED 2026-11-18 when
#    George said "top three only, just put them on" — no review.
#    Rank #2, Claude Mythos 5.2, was SKIPPED: restricted to vetted
#    organisations only, so it is not offered.
# 2. GPT-6.2 Astra (gpt-6.2-astra) — #3 in the list, score 62,
#    $8/$40 per million tokens, released 17 Nov 2026. This UPDATES
#    the old GPT-6 Astra (gpt-6-astra, $10/$50) in place.
# 3. Claude Opus 5.5 (claude-opus-5-5) — #4 in the list, score 59,
#    $4/$20 per million tokens. Second Anthropic brain, same
#    ANTHROPIC_API_KEY as Fable — no new key needed.
# Removed 2026-11-18: Meta Muse Wonder, Google Gemini 4 Carbon,
# Grok 4.7. No lower-tier model is offered. These are model names
# only — no key is set here.
# A provider is "connected" only when its own API key is set on the
# server (see README); until then /api/status reports no providers
# and AI chat says so plainly.
# The live calls have NOT been tested — no key has ever been set —
# so a first live reply with a real key is the proof, not this code.
DEFAULT_ANTHROPIC_MODEL = "claude-fable-5-2"
DEFAULT_OPENAI_MODEL = "gpt-6.2-astra"
DEFAULT_OPUS_MODEL = "claude-opus-5-5"
TOP_AI_MODELS = {"anthropic": DEFAULT_ANTHROPIC_MODEL, "openai": DEFAULT_OPENAI_MODEL, "opus": DEFAULT_OPUS_MODEL}


def ai_model(provider):
    """Model to use for a provider: the env override, else the installed top-level default."""
    if provider == "anthropic":
        return os.getenv("ANTHROPIC_MODEL") or DEFAULT_ANTHROPIC_MODEL
    if provider == "openai":
        return os.getenv("OPENAI_MODEL") or DEFAULT_OPENAI_MODEL
    if provider == "opus":
        # Second Anthropic brain — same ANTHROPIC_API_KEY as Fable.
        return os.getenv("OPUS_MODEL") or DEFAULT_OPUS_MODEL
    raise ValueError(f"Unknown AI provider: {provider}")

KINDS = {
    # from v1.0
    "appointments", "customers", "calls", "tasks", "inventory", "transactions", "invoices",
    # added in v1.1
    "jobs", "products", "campaigns", "household", "shopping", "meals", "reminders",
    "trades", "notes", "settings",
    # added 2026-11-16 — Learn: things George teaches Connie, one at a
    # time, ask-first. A "learned" record is {text, learned}. Local only:
    # it never retrains or changes the model and never goes to the internet.
    "learned",
    # added 2026-11-16 — Monthly upgrade: a record of a monthly upgrade
    # George approved, {month, year, label, count, approved}. The upgrade
    # itself is only a summary of what Connie learned that month — it never
    # retrains or changes the model, never changes code, never goes to the
    # internet. If George says no, nothing is saved at all.
    "upgrades",
    # added in v1.1 mobile build — connector slots (see web/app.js CONNECTOR_CATALOG):
    # each record is {key, enabled, custom_name, custom_what}. The slot itself
    # is only a labelled place to plug a service in; "enabled" never means
    # "connected" — only Anthropic/OpenAI report connected, from /api/status.
    "connectors",
    # added 2026-11-21 — bills that come in under George's name. Connie asks
    # first, always: {payee, amount, due, account, status, notes}.
    "bills",
}
MAX_RECORD = 40000
MAX_RECORDS_PER_USER = 20000
MIME = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
        ".webmanifest": "application/manifest+json; charset=utf-8", ".txt": "text/plain; charset=utf-8",
        ".md": "text/plain; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon"}
FAILS = {}      # username -> (count, locked_until) — sign-in: 5 wrong tries locks 5 minutes
AI_USE = {}     # user id -> [timestamps]
# ---------- Security blanket (George, 2026-11-16) ----------
# HTTPS_ONLY=1 turns on HTTPS-only mode when hosted: every request
# carrying data must arrive over HTTPS (the host's proxy sets
# X-Forwarded-Proto: https). /api/health and /api/status stay open
# over plain HTTP so the host's own health check still works — they
# carry no personal data. Locally (HTTPS_ONLY unset) plain HTTP on
# 127.0.0.1 still works, so George can run Connie at home.
HTTPS_ONLY = os.getenv("HTTPS_ONLY", "0") == "1"
# Passcode (second step after voice): 3 wrong tries locks Connie for
# 15 minutes. No code is unbreakable — a 4-digit code has only 10,000
# combinations, which is why the minimum here is 8 characters with a
# letter and a number. The passcode is NEVER stored in plain text:
# only a salted PBKDF2 hash (same as account passwords) lives in the
# database, it is never logged, and it never leaves the server.
PASSCODE_MIN_LENGTH = 8
PASSCODE_MAX_LENGTH = 64
PASSCODE_MAX_TRIES = 3
PASSCODE_LOCK_SECONDS = 900      # 15 minutes
PASSCODE_TOKEN_SECONDS = 3600    # a passed passcode check lasts 1 hour
PASSCODE_FAILS = {}   # user id -> (count, locked_until)
PASSCODE_TOKENS = {}  # token -> (user id, expires)
VOICE_FAILS = {}      # user id -> (count, locked_until) — voice check: 5 wrong tries locks 5 minutes
VOICE_MAX_TRIES = 5
VOICE_LOCK_SECONDS = 300

# ---------- Jobs / multitasking (on-demand only) ----------
# A job is work the bot does inside the app, in the background, when a
# user asks for it — never on its own, and never unprompted. Jobs are
# held in memory only (they disappear when the server restarts) and are
# per-user: one user never sees another user's jobs. A job only reads
# the user's own saved records and works out a summary or a draft.
# It never sends, charges, publishes, deletes or files anything, and
# anything that would do one of those still needs the owner's yes first.
JOBS = {}       # user id -> {job id: job dict}
JOBS_LOCK = threading.Lock()
JOB_TYPES = {
    "inventory_check": ("Check inventory", ["Count inventory items", "Find low-stock items", "Work out the parts value"]),
    "invoice_draft": ("Draft unpaid-invoices summary", ["List unpaid invoices", "Add up the amount owed", "Draft the summary for you to check"]),
    "money_totals": ("Work out money totals", ["Add up income entered", "Add up spending entered", "Work out the tax-reserve estimate"]),
    "usage_check": ("Check usage", ["Count your saved records", "Count AI requests this hour", "Summarise your plan usage"]),
    "product_draft": ("Draft a product summary", ["List your products", "Check which are Ready", "Draft the summary for you to check"]),
}


def _job_public(job):
    return {k: job[k] for k in ("id", "type", "label", "status", "progress", "steps", "step", "result", "needs_approval", "created")}


def _job_compute(uid, job_type):
    """Work a job out from the user's own saved records. Read-only."""
    with connect() as c:
        rows = c.execute("SELECT kind,payload FROM records WHERE owner=?", (uid,)).fetchall()
    by_kind = {}
    for kind, payload in rows:
        by_kind.setdefault(kind, []).append(json.loads(payload))
    if job_type == "inventory_check":
        items = by_kind.get("inventory", [])
        low = [i for i in items if float(i.get("quantity") or 0) <= float(i.get("low_stock") or 0)]
        value = sum(float(i.get("sell_price") or i.get("unit_cost") or 0) * float(i.get("quantity") or 0) for i in items)
        return f"Inventory: {len(items)} item(s), {len(low)} low on stock ({', '.join(str(i.get('item')) for i in low) or 'none'}). Parts value at your entered prices: ${value:.2f}."
    if job_type == "invoice_draft":
        unpaid = [i for i in by_kind.get("invoices", []) if i.get("status") != "Paid"]
        owed = sum(float(i.get("amount") or 0) for i in unpaid)
        return (f"Draft only — check it before you send anything. Unpaid invoices: {len(unpaid)}, "
                f"totalling ${owed:.2f}. Nothing has been sent or charged.")
    if job_type == "money_totals":
        income = sum(float(t.get("amount") or 0) for t in by_kind.get("transactions", []) if t.get("kind") == "Income")
        spent = sum(float(t.get("amount") or 0) for t in by_kind.get("transactions", []) if t.get("kind") == "Expense")
        return f"Money entered: income ${income:.2f}, spending ${spent:.2f}, balance ${income - spent:.2f}. Tax reserve at 25% of income: ${income * 0.25:.2f} (estimate only — no money has moved)."
    if job_type == "usage_check":
        hour = [t for t in AI_USE.get(uid, []) if t > time.time() - 3600]
        total = sum(len(v) for v in by_kind.values())
        return (f"Usage: {total} record(s) saved. AI requests this hour: {len(hour)} of {AI_HOURLY_LIMIT}. "
                "There are no plans or usage limits in this personal copy — see README.")
    if job_type == "product_draft":
        products = by_kind.get("products", [])
        pub = [p for p in products if p.get("status") == "Ready"]
        return (f"Draft only — check it before you use it. Products: {len(products)}, "
                f"{len(pub)} Ready ({', '.join(str(p.get('title')) for p in pub) or 'none'}). Nothing is published or sold.")
    return "Done."


def _run_job(uid, job):
    label, steps = JOB_TYPES[job["type"]]
    try:
        for i, step in enumerate(steps):
            with JOBS_LOCK:
                if job.get("cancelled"):
                    job["status"] = "cancelled"
                    job["result"] = "Cancelled before it finished. Nothing was sent, charged, published or deleted."
                    return
                job["step"] = step
                job["progress"] = int(100 * i / len(steps))
            time.sleep(0.12)
        result = _job_compute(uid, job["type"])
        with JOBS_LOCK:
            if job.get("cancelled"):
                job["status"] = "cancelled"
                job["result"] = "Cancelled before it finished. Nothing was sent, charged, published or deleted."
                return
            job["step"] = "Finished"
            job["progress"] = 100
            job["status"] = "done"
            job["result"] = result
    except Exception as e:  # a job failing must not take the server down
        with JOBS_LOCK:
            job["status"] = "failed"
            job["result"] = "This job stopped: " + str(e)[:200]


def _start_job(uid, job_type):
    label, steps = JOB_TYPES[job_type]
    job = {"id": secrets.token_hex(8), "type": job_type, "label": label, "status": "running",
           "progress": 0, "steps": steps, "step": steps[0], "result": "",
           "needs_approval": job_type in ("invoice_draft", "product_draft"),
           "created": int(time.time()), "cancelled": False}
    with JOBS_LOCK:
        JOBS.setdefault(uid, {})[job["id"]] = job
    threading.Thread(target=_run_job, args=(uid, job), daemon=True).start()
    return job


# ---------- Voice recognition — safety feature, not a secure ID ----------
# The person who bought the bot enrols their voice first, with their
# consent, in the bot. What is stored on this server is only a short
# list of numbers — a voiceprint made from the sound of their voice
# (16 averaged frequency-band levels, 0-1). No audio recording is
# stored, and no voice is sent anywhere: the browser works the numbers
# out from the microphone and only the numbers are sent here.
# After enrolment, jobs only start for that enrolled voice: the browser
# checks the voice first and the server only accepts the job when it
# carries a fresh voice token from a recognised check (5 minutes).
# If a different voice asks, the check does not recognise it and no
# job starts. Say this plainly: this is a simple voiceprint match,
# not a bank-grade biometric and not unbreakable — a recording could
# fool it, a cold or background noise can make it fail, and it does
# not work at all until the person enrols first. Voice recognition
# alone NEVER authorises sensitive actions — taxes, bank access,
# payments, publishing or sending anything still need a separate
# yes / approval in the app, every time.
VOICE_TOKENS = {}   # token -> (user id, expires)
VOICE_THRESHOLD = 0.35  # recognised when the average difference is at most this


def _voice_distance(a, b):
    if len(a) != len(b) or not a:
        return 1.0
    return (sum((x - y) ** 2 for x, y in zip(a, b)) / len(a)) ** 0.5


def _voice_clean_features(value):
    if not isinstance(value, list) or not 8 <= len(value) <= 64:
        raise ValueError("Voice features must be a list of 8-64 numbers")
    out = []
    for v in value:
        if not isinstance(v, (int, float)) or not 0.0 <= float(v) <= 1.0:
            raise ValueError("Voice features must be numbers between 0 and 1")
        out.append(float(v))
    return out


def _voice_profile(uid):
    with connect() as c:
        row = c.execute("SELECT name,phrase,features,created FROM voice_profiles WHERE owner=?", (uid,)).fetchone()
    if not row:
        return None
    return {"enrolled": True, "name": row[0], "phrase": row[1], "features": json.loads(row[2]), "created": row[3]}


def _voice_token_ok(uid, token):
    if not isinstance(token, str):
        return False
    with JOBS_LOCK:
        got = VOICE_TOKENS.get(token)
        if not got or got[0] != uid or got[1] < time.time():
            if got:
                del VOICE_TOKENS[token]
            return False
    return True


def _passcode_row(uid):
    with connect() as c:
        return c.execute("SELECT salt,hash FROM passcodes WHERE owner=?", (uid,)).fetchone()


def _passcode_set(uid):
    return _passcode_row(uid) is not None


def _passcode_locked_until(uid):
    _, locked = PASSCODE_FAILS.get(uid, (0, 0))
    return locked if locked > time.time() else 0


def _passcode_token_ok(uid, token):
    if not isinstance(token, str):
        return False
    with JOBS_LOCK:
        got = PASSCODE_TOKENS.get(token)
        if not got or got[0] != uid or got[1] < time.time():
            if got:
                del PASSCODE_TOKENS[token]
            return False
    return True


def _passcode_valid(passcode):
    """A passcode George can actually rely on: at least 8 characters,
    with a letter and a number. A 4-digit code has only 10,000
    combinations — anyone can guess that — so short codes are refused,
    and no code is ever called unbreakable."""
    if not isinstance(passcode, str):
        return False, "Give a passcode of at least 8 characters, with letters and numbers."
    if len(passcode) < PASSCODE_MIN_LENGTH:
        return False, ("That passcode is too short — use at least 8 characters with letters and numbers. "
                       "A 4-digit code has only 10,000 combinations, so it can be guessed. "
                       "No code is unbreakable, but a long one with letters and numbers is far harder to guess.")
    if len(passcode) > PASSCODE_MAX_LENGTH:
        return False, "That passcode is too long — use at most 64 characters."
    if not (re.search(r"[A-Za-z]", passcode) and re.search(r"[0-9]", passcode)):
        return False, "Use letters and numbers in your passcode — at least one letter and one number."
    return True, ""


def _identity_gate(uid, data):
    """Two-step check, in order — voice first, then passcode.
    Only George gets in: if a voice is enrolled it must be recognised,
    and if a passcode is set it must also be entered. If neither is
    set, jobs work as before (sign-in only)."""
    if _voice_profile(uid) is not None and not _voice_token_ok(uid, data.get("voice_token")):
        return "This bot only runs jobs for the enrolled voice. Check your voice first — I don't recognise that voice, so I won't run any jobs."
    if _passcode_set(uid):
        if _passcode_locked_until(uid):
            return "Too many wrong passcodes — Connie is locked for 15 minutes. Wait, then try again."
        if not _passcode_token_ok(uid, data.get("passcode_token")):
            return "Enter your passcode first — voice alone is not enough. Check your voice, then enter the passcode you set in Settings."
    return None


SYSTEM_PROMPT = (
    "You are Connie, George Wederski's personal assistant (George's Assistant). You speak in a girl's voice. You help George only — this is his personal copy, not for sale, with no other customers. "
    "Help the owner run a small business and household: scheduling, invoices, bookkeeping, inventory, "
    "marketing, and digital products. Write clearly and briefly. You can only produce text and drafts: "
    "never claim that you placed a call, sent a message, charged a card, moved money, filed taxes, "
    "published anything, or placed an order. Figures the owner entered are estimates, not bank balances. "
    "You are not a tax, legal, medical, or investment adviser; say so when a question needs one. "
    "Anything that affects customers, money, or accounts needs the owner's review and approval first. "
    "You must refuse anything against the law — impersonating a person, business or government, cloning "
    "someone's voice or face without their consent, getting into someone else's phone or account without "
    "permission, making fake reviews, or creating non-consensual intimate images — and explain briefly "
    "in plain words why you said no. What you know about the law is general information only, not legal advice."
)


# ---------- Refusing to learn or do anything against the law ----------
# Connie must say no — and say why — to anything unlawful. This guard is
# used both by the Assistant (before it asks George) and by the server
# (before a "learned" note is saved), so the rule cannot be bypassed
# by saving a note directly. Patterns are deliberately narrow: ordinary
# business notes ("call Smith", "raise the price") never match.
UNLAWFUL_PATTERNS = [
    (re.compile(r"\b(impersonate|pretend to be|pose as)\b", re.I),
     "pretending to be someone else — a person, a business, or a government office — is impersonation, and the law bans it"),
    (re.compile(r"\bclone\b.*\bvoice\b|\bcopy\b.*\bvoice\b|\bvoice\b.*\bclone\b", re.I),
     "copying someone's voice without their clear consent is against voice/biometric law"),
    (re.compile(r"\bdeepfake\b|\bnon[- ]consensual\b", re.I),
     "non-consensual synthetic images are a crime in Wyoming and under federal law"),
    (re.compile(r"\b(access|get into|break into|hack|log ?in as)\b.{0,40}\b(someone else'?s|another (person'?s|customer'?s)|their|his|her)\b.{0,20}\b(phone|account|email|bank)\b", re.I),
     "getting into someone else's phone or account without their permission breaks computer-crime law"),
    (re.compile(r"\bfake (review|testimonial)s?\b|\bbuy (fake )?reviews\b", re.I),
     "fake reviews are banned by the FTC — reviews must be from real people who really used the product"),
    (re.compile(r"\bsteal\b|\bbypass\b.{0,20}\b(login|password|captcha|paywall)\b", re.I),
     "stealing, or bypassing a login or paywall, is against the law"),
]


def unlawful_reason(text):
    """Plain-words reason Connie cannot learn/do this, or None if it is fine."""
    if not isinstance(text, str):
        return None
    for pattern, reason in UNLAWFUL_PATTERNS:
        if pattern.search(text):
            return reason
    return None


def learned_notes_text(uid, limit=None):
    """Things George taught Connie, so future answers can use them.
    Connie's knowledge is open — no cap on how many learned notes she
    holds or returns. (limit is kept only for callers that ask for one.)"""
    with connect() as c:
        if limit is None:
            rows = c.execute("SELECT payload FROM records WHERE owner=? AND kind='learned' ORDER BY created DESC",
                             (uid,)).fetchall()
        else:
            rows = c.execute("SELECT payload FROM records WHERE owner=? AND kind='learned' ORDER BY created DESC LIMIT ?",
                             (uid, limit)).fetchall()
    notes = []
    for (payload,) in rows:
        try:
            notes.append(str(json.loads(payload).get("text", "")).strip())
        except (ValueError, TypeError, AttributeError):
            pass
    return [n for n in notes if n]


# ---------- Monthly upgrade ----------
# Once a month, Connie reviews what she learned and shows George a plain
# summary — "November upgrade: I learned 12 new things" — for him to
# approve. The upgrade is ONLY that summary: it never retrains or changes
# the AI model, never changes code by itself, never goes to the internet,
# and never applies without George's yes. If he says no, nothing is saved
# and nothing changes.
MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
               "July", "August", "September", "October", "November", "December"]


def monthly_upgrade_summary(uid, year, month):
    """Learned notes from one calendar month, as a plain summary dict."""
    import calendar
    if not (1 <= month <= 12 and 1900 <= year <= 2100):
        raise ValueError("Expected a real month and year")
    start = calendar.timegm((year, month, 1, 0, 0, 0))
    end = calendar.timegm((year + (month == 12), month % 12 + 1, 1, 0, 0, 0))
    with connect() as c:
        rows = c.execute("SELECT payload FROM records WHERE owner=? AND kind='learned' AND created>=? AND created<? ORDER BY created ASC",
                         (uid, start, end)).fetchall()
        approved = c.execute("SELECT payload FROM records WHERE owner=? AND kind='upgrades' ORDER BY created DESC",
                             (uid,)).fetchall()
    items = []
    for (payload,) in rows:
        try:
            items.append(str(json.loads(payload).get("text", "")).strip())
        except (ValueError, TypeError, AttributeError):
            pass
    items = [i for i in items if i]
    label = f"Connie — {MONTH_NAMES[month - 1]} {year} upgrade"
    already = any(json.loads(p).get("month") == month and json.loads(p).get("year") == year
                  and json.loads(p).get("approved") for (p,) in approved)
    return {"year": year, "month": month, "month_name": MONTH_NAMES[month - 1],
            "label": label, "count": len(items), "items": items,
            "headline": f"{MONTH_NAMES[month - 1]} upgrade: I learned {len(items)} new thing{'s' if len(items) != 1 else ''}",
            "approved": already,
            "note": "A summary only — it does NOT retrain or change the model, does NOT change code, and does NOT go to the internet. It only applies when George says yes."}


def connect():
    c = sqlite3.connect(DB, timeout=10)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL)")
    c.execute("CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, owner INTEGER NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, created INTEGER NOT NULL)")
    c.execute("CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, owner INTEGER NOT NULL, expires INTEGER NOT NULL)")
    c.execute("CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, owner INTEGER NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL, created INTEGER NOT NULL)")
    c.execute("CREATE TABLE IF NOT EXISTS voice_profiles (owner INTEGER PRIMARY KEY, name TEXT NOT NULL, phrase TEXT NOT NULL, features TEXT NOT NULL, created INTEGER NOT NULL)")
    # Passcode: only a salted hash is stored — never the passcode itself.
    c.execute("CREATE TABLE IF NOT EXISTS passcodes (owner INTEGER PRIMARY KEY, salt TEXT NOT NULL, hash TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL)")
    cols = {r[1] for r in c.execute("PRAGMA table_info(users)")}
    if "recovery_hash" not in cols:   # upgrade a v1.0 database in place
        c.execute("ALTER TABLE users ADD COLUMN recovery_hash TEXT")
    if "updated" not in {r[1] for r in c.execute("PRAGMA table_info(records)")}:
        c.execute("ALTER TABLE records ADD COLUMN updated INTEGER")
    c.execute("CREATE INDEX IF NOT EXISTS records_owner ON records(owner, kind)")
    c.commit()
    return c


def password_hash(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 310000).hex()


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def audit(c, owner, action, detail=""):
    c.execute("INSERT INTO audit(owner,action,detail,created) VALUES(?,?,?,?)", (owner, action, str(detail)[:300], int(time.time())))


def ai_providers():
    out = []
    if os.getenv("ANTHROPIC_API_KEY"):
        # One Anthropic key serves both Claude brains: Fable and Opus.
        out.append("anthropic")
        out.append("opus")
    if os.getenv("OPENAI_API_KEY"):
        out.append("openai")
    return out


def call_ai(provider, system, messages):
    """Send the conversation to the configured AI provider. Keys stay on the server."""
    if provider in ("anthropic", "opus"):
        # Anthropic Messages API — Fable and Opus share the one Anthropic key.
        url = "https://api.anthropic.com/v1/messages"
        headers = {"x-api-key": os.environ["ANTHROPIC_API_KEY"], "anthropic-version": "2023-06-01"}
        body = {"model": ai_model(provider), "max_tokens": 1600, "system": system, "messages": messages}
    else:
        url = "https://api.openai.com/v1/chat/completions"
        headers = {"Authorization": "Bearer " + os.environ["OPENAI_API_KEY"]}
        body = {"model": ai_model("openai"), "messages": [{"role": "system", "content": system}] + messages}
    headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.loads(r.read())
    if provider in ("anthropic", "opus"):
        text = "\n".join(p.get("text", "") for p in data.get("content", []) if p.get("type") == "text")
    else:  # openai returns OpenAI-style choices
        text = (data.get("choices") or [{}])[0].get("message", {}).get("content") or ""
    return text[:16000]


def clean_messages(value):
    if not isinstance(value, list) or not 1 <= len(value) <= 24:
        raise ValueError("Expected 1-24 messages")
    out = []
    for m in value:
        if not isinstance(m, dict) or m.get("role") not in ("user", "assistant") or not isinstance(m.get("content"), str) or len(m["content"]) > 6500:
            raise ValueError("Invalid message")
        out.append({"role": m["role"], "content": m["content"].strip()})
    while out and out[0]["role"] != "user":
        out.pop(0)
    if not out or out[-1]["role"] != "user" or not out[-1]["content"]:
        raise ValueError("Last message must be from the user")
    return out


plus.init(lambda: connect(), lambda *a: call_ai(*a), lambda: ai_providers(), lambda *a: audit(*a))


class Handler(BaseHTTPRequestHandler):
    server_version = "GeorgesAssistant/" + VERSION

    def log_message(self, *args):
        pass

    # ---------- helpers ----------
    def _https_ok(self):
        """HTTPS-only when hosted (HTTPS_ONLY=1): data requests must
        arrive over HTTPS. The host's proxy says so with
        X-Forwarded-Proto: https. /api/health and /api/status are
        exempt — they carry no personal data and the host's own
        health check uses plain HTTP. No cookies are used at all in
        this app (sign-in uses a Bearer token header), so there are
        no cookies to secure."""
        if not HTTPS_ONLY:
            return True
        if urlparse(self.path).path in ("/api/health", "/api/status"):
            return True
        # The host's proxy (Render / Railway / Fly.io) always sets
        # X-Forwarded-Proto: https for real visitors. Plain HTTP with
        # no such header is refused — there is no loopback exception,
        # so this is testable and cannot be bypassed locally either.
        if self.headers.get("X-Forwarded-Proto", "").lower() == "https":
            return True
        return False

    def send(self, status, obj):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        if self.headers.get("X-Forwarded-Proto", "").lower() == "https":
            self.send_header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def body(self, limit=65536):
        n = int(self.headers.get("Content-Length", "0"))
        if n < 1 or n > limit:
            raise ValueError("Request body size not allowed")
        return json.loads(self.rfile.read(n))

    def token(self):
        return self.headers.get("Authorization", "").removeprefix("Bearer ").strip()

    def user(self):
        t = self.token()
        if not t:
            return None
        with connect() as c:
            row = c.execute("SELECT owner,expires FROM sessions WHERE token_hash=?", (token_hash(t),)).fetchone()
        if not row or row[1] < time.time():
            return None
        return row[0]

    def static(self, path):
        if path in ("/", "/index.html"):
            path = "/app.html"
        if path.startswith("/classic/"):
            base, rel, classic = CLASSIC, path[len("/classic/"):], True
        else:
            base, rel, classic = WEB, path.lstrip("/"), False
        target = (base / unquote(rel)).resolve()
        if base.resolve() not in target.parents or not target.is_file() or target.suffix not in MIME \
                or any(part.startswith(".") for part in target.parts) or target.suffix in (".py", ".mjs"):
            return self.send(404, {"error": "Not found"})
        data = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", MIME[target.suffix])
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Cache-Control", "no-cache")
        if self.headers.get("X-Forwarded-Proto", "").lower() == "https":
            self.send_header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        if not classic:   # the new app keeps all script in its own files
            self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    # ---------- GET ----------
    def do_GET(self):
        if not self._https_ok():
            return self.send(426, {"error": "Use HTTPS — when hosted, Connie only answers over HTTPS. Open her https:// address, not http://."})
        u = urlparse(self.path)
        path = u.path
        if not path.startswith("/api/"):
            return self.static(path)
        if path == "/api/health":
            return self.send(200, {"status": "ok", "version": VERSION, "ai_enabled": bool(ai_providers()),
                                   "signup_open": ALLOW_SIGNUP, "live_phone": False, "live_payments": False,
                                   "bank_feeds": False, "tax_filing": False,
                                   "jobs_enabled": True, "multitasking": "on-demand only — jobs start only when you ask",
                                   "voice_recognition": "local enrollment only — safety feature, not a secure ID",
                                   "assistant": "Connie", "personal_copy": True, "permission_model": "ask-first, George only — Connie asks George before she looks at his records, and only does what he said yes to",
                                   "top_models": TOP_AI_MODELS, "default_provider": "anthropic",
                                   "allinone_available": plus.allinone_available(ai_providers()),
                                   "plus": PLUS_FEATURES, "connectors_live": plus.connector_status(),
                                   "ai_hourly_limit": AI_HOURLY_LIMIT, "session_limit": SESSION_LIMIT,
                                   "speed": "faster than People's Bot: 60 AI requests per user per hour (double People's Bot's 30), no 5-hour session limit for George",
                                   "learning": "Fast Learn — several things at once when George says yes to a list, ask-first — learned notes are local only, they never retrain or change the model",
                                   "monthly_upgrade": "summary only — once a month Connie shows what she learned that month for George to approve; it never retrains or changes the model, never changes code, never goes to the internet",
                                   "security": "two-step when set — enrolled voice first, then a passcode (salted hash only, never stored in plain text); 3 wrong passcode tries locks Connie 15 minutes, 5 wrong sign-in tries locks 5 minutes, 5 wrong voice checks locks 5 minutes; HTTPS-only when hosted (HTTPS_ONLY=1); no cookies; owner-only — every write needs a signed-in owner session. Honest limit: no system is unhackable, and no code is unbreakable — this makes breaking in very hard, not impossible."})
        if path == "/api/status":   # kept so the preserved v0.7 pages report honestly
            providers = ai_providers()
            return self.send(200, {"version": VERSION, "ai_enabled": bool(providers), "providers": providers, "research_enabled": False,
                                   "top_models": TOP_AI_MODELS, "default_provider": "anthropic",
                                   "allinone_available": plus.allinone_available(providers),
                                   "billing_enabled": False, "publishing_enabled": False, "customer_accounts_enabled": False, "personal_copy": True, "assistant": "Connie",
                                   "mode": "classic_page_inside_v1.1"})
        if path.startswith("/api/store/"):
            # Personal copy: no storefront, nothing for sale.
            return self.send(200, {"store_available": False, "store": "", "products": [],
                                   "note": "This personal copy has no storefront — nothing is published or sold here."})
        uid = self.user()
        if uid is None:
            return self.send(401, {"error": "Sign in required"})
        if path in PLUS_GET:
            return PLUS_GET[path](self, uid, parse_qs(u.query))
        if path == "/api/me":
            with connect() as c:
                name = c.execute("SELECT username FROM users WHERE id=?", (uid,)).fetchone()[0]
            return self.send(200, {"username": name, "version": VERSION, "ai_enabled": bool(ai_providers()), "ai_hourly_limit": AI_HOURLY_LIMIT})
        if path == "/api/jobs":
            with JOBS_LOCK:
                jobs = [_job_public(j) for j in sorted(JOBS.get(uid, {}).values(), key=lambda j: j["created"])]
            return self.send(200, {"jobs": jobs, "multitasking": "on-demand only — jobs start only when you ask"})
        if path.startswith("/api/jobs/"):
            jid = path.rsplit("/", 1)[-1]
            with JOBS_LOCK:
                job = JOBS.get(uid, {}).get(jid)
            if not job:
                return self.send(404, {"error": "Job not found"})
            return self.send(200, {"job": _job_public(job)})
        if path == "/api/voice":
            prof = _voice_profile(uid)
            if not prof:
                return self.send(200, {"enrolled": False})
            return self.send(200, {"enrolled": True, "name": prof["name"], "phrase": prof["phrase"], "created": prof["created"]})
        if path == "/api/passcode/status":
            locked = _passcode_locked_until(uid)
            return self.send(200, {"set": _passcode_set(uid), "locked": bool(locked),
                                   "locked_until": locked or None,
                                   "tries": PASSCODE_MAX_TRIES, "lock_minutes": PASSCODE_LOCK_SECONDS // 60,
                                   "note": "Voice first, then passcode — both are needed before Connie knows it's you. No code is unbreakable: use at least 8 characters with letters and numbers."})
        if path in ("/api/records", "/api/export"):
            kind = parse_qs(u.query).get("kind", [None])[0]
            if path == "/api/export":
                # Download my stuff: owner-only, and only after the
                # two-step check (voice first, then passcode, when set).
                # Only George's own records ever come back — there is
                # no other person's data in Connie at all.
                qs = parse_qs(u.query)
                gate = _identity_gate(uid, {"voice_token": (qs.get("voice_token") or [None])[0],
                                            "passcode_token": (qs.get("passcode_token") or [None])[0]})
                if gate:
                    return self.send(403, {"error": gate})
            with connect() as c:
                if kind:
                    rows = c.execute("SELECT id,kind,payload,created,updated FROM records WHERE owner=? AND kind=? ORDER BY created DESC", (uid, kind)).fetchall()
                else:
                    rows = c.execute("SELECT id,kind,payload,created,updated FROM records WHERE owner=? ORDER BY created DESC", (uid,)).fetchall()
                if path == "/api/export":
                    audit(c, uid, "export", f"{len(rows)} records")
                    c.commit()
            recs = [{"id": r[0], "kind": r[1], "data": json.loads(r[2]), "created": r[3], "updated": r[4]} for r in rows]
            if path == "/api/export":
                return self.send(200, {"app": "George's Assistant — Connie", "version": VERSION, "exported": int(time.time()), "records": recs})
            return self.send(200, {"records": recs})
        if path == "/api/monthly-upgrade":
            # Monthly upgrade summary: built from this month's learned
            # notes, on the fly. Free for George — Connie is his personal
            # bot, he pays nothing for her upgrades. No payment anywhere.
            now = time.gmtime()
            try:
                year = int(parse_qs(u.query).get("year", [now.tm_year])[0])
                month = int(parse_qs(u.query).get("month", [now.tm_mon])[0])
                summary = monthly_upgrade_summary(uid, year, month)
            except (ValueError, TypeError):
                return self.send(400, {"error": "Give a real month and year, for example month=11 and year=2026"})
            summary["free"] = True
            summary["price"] = "Free — your upgrades are free. Connie is your personal bot; you pay nothing for her upgrades."
            return self.send(200, summary)
        if path == "/api/audit":
            with connect() as c:
                rows = c.execute("SELECT action,detail,created FROM audit WHERE owner=? ORDER BY id DESC LIMIT 200", (uid,)).fetchall()
            return self.send(200, {"audit": [{"action": r[0], "detail": r[1], "created": r[2]} for r in rows]})
        return self.send(404, {"error": "Not found"})

    # ---------- POST ----------
    def do_POST(self):
        if not self._https_ok():
            return self.send(426, {"error": "Use HTTPS — when hosted, Connie only answers over HTTPS. Open her https:// address, not http://."})
        path = urlparse(self.path).path
        try:
            data = self.body(2_000_000 if path == "/api/import" else 8_000_000 if path == "/api/receipt/read" else 65536)
        except (ValueError, TypeError, json.JSONDecodeError):
            return self.send(400, {"error": "Invalid request"})
        if not isinstance(data, dict):
            return self.send(400, {"error": "Expected object"})

        if path in ("/api/register", "/api/login", "/api/recover"):
            username = str(data.get("username", "")).strip().lower()
            password = data.get("password", "")
            if not (3 <= len(username) <= 60 and username.replace("_", "").isalnum() and isinstance(password, str) and len(password) <= 200):
                return self.send(400, {"error": "Use 3-60 letters, numbers or underscores for the username"})
            count, locked = FAILS.get(username, (0, 0))
            if locked > time.time():
                return self.send(429, {"error": "Too many attempts. Wait a few minutes and try again."})
            recovery = None
            with connect() as c:
                if path == "/api/register":
                    if not ALLOW_SIGNUP:
                        return self.send(403, {"error": "New sign-ups are closed"})
                    if len(password) < 12:
                        return self.send(400, {"error": "Password must have at least 12 characters"})
                    salt = secrets.token_hex(16)
                    recovery = "-".join(secrets.token_hex(3) for _ in range(4))
                    try:
                        cur = c.execute("INSERT INTO users(username,salt,hash,recovery_hash) VALUES(?,?,?,?)",
                                        (username, salt, password_hash(password, salt), password_hash(recovery, salt)))
                        audit(c, cur.lastrowid, "account created")
                        c.commit()
                    except sqlite3.IntegrityError:
                        return self.send(409, {"error": "Username unavailable"})
                row = c.execute("SELECT id,salt,hash,recovery_hash FROM users WHERE username=?", (username,)).fetchone()
                if path == "/api/recover":
                    code = str(data.get("recovery_code", "")).strip().lower()
                    new = data.get("new_password", "")
                    ok = row and row[3] and hmac.compare_digest(password_hash(code, row[1]), row[3])
                    if not ok or not isinstance(new, str) or not 12 <= len(new) <= 200:
                        FAILS[username] = (count + 1, time.time() + 300 if count + 1 >= 5 else 0)
                        return self.send(400, {"error": "Recovery code not accepted, or new password is shorter than 12 characters"})
                    salt = secrets.token_hex(16)
                    recovery = "-".join(secrets.token_hex(3) for _ in range(4))
                    c.execute("UPDATE users SET salt=?,hash=?,recovery_hash=? WHERE id=?", (salt, password_hash(new, salt), password_hash(recovery, salt), row[0]))
                    c.execute("DELETE FROM sessions WHERE owner=?", (row[0],))
                    audit(c, row[0], "password reset with recovery code")
                    c.commit()
                    row, password = (row[0], salt, password_hash(new, salt), None), new
                valid = row and hmac.compare_digest(password_hash(password, row[1]), row[2])
                if not valid:
                    FAILS[username] = (count + 1, time.time() + 300 if count + 1 >= 5 else 0)
                    return self.send(401, {"error": "Invalid username or password"})
                FAILS.pop(username, None)
                token = secrets.token_urlsafe(32)
                c.execute("DELETE FROM sessions WHERE expires<?", (int(time.time()),))
                c.execute("INSERT INTO sessions VALUES(?,?,?)", (token_hash(token), row[0], int(time.time()) + SESSION_SECONDS))
                audit(c, row[0], "signed in")
                c.commit()
            out = {"token": token, "expires_in_seconds": SESSION_SECONDS, "username": username}
            if recovery:
                out["recovery_code"] = recovery
            return self.send(200, out)

        uid = self.user()
        if uid is None:
            return self.send(401, {"error": "Sign in required"})

        if path == "/api/voice/enroll":
            if data.get("consent") is not True:
                return self.send(400, {"error": "Enrolling your voice needs your consent — tick the consent box first."})
            name = str(data.get("name", "")).strip()[:80]
            phrase = str(data.get("phrase", "")).strip()[:200]
            if not name or not phrase:
                return self.send(400, {"error": "Give your name and the phrase you will say to enrol your voice."})
            try:
                features = _voice_clean_features(data.get("features"))
            except ValueError as e:
                return self.send(400, {"error": str(e)})
            with connect() as c:
                c.execute("INSERT INTO voice_profiles(owner,name,phrase,features,created) VALUES(?,?,?,?,?) "
                          "ON CONFLICT(owner) DO UPDATE SET name=excluded.name,phrase=excluded.phrase,features=excluded.features,created=excluded.created",
                          (uid, name, phrase, json.dumps(features), int(time.time())))
                audit(c, uid, "voice enrolled", name)
                c.commit()
            return self.send(200, {"enrolled": True, "name": name, "phrase": phrase})

        if path == "/api/voice/check":
            prof = _voice_profile(uid)
            if not prof:
                return self.send(200, {"enrolled": False, "recognised": False, "message": "No voice is enrolled yet — enrol your voice first."})
            count, locked = VOICE_FAILS.get(uid, (0, 0))
            if locked > time.time():
                return self.send(429, {"error": "Too many voice checks. Wait a few minutes and try again."})
            try:
                features = _voice_clean_features(data.get("features"))
            except ValueError as e:
                return self.send(400, {"error": str(e)})
            distance = _voice_distance(features, prof["features"])
            recognised = distance <= VOICE_THRESHOLD
            token = None
            if recognised:
                VOICE_FAILS.pop(uid, None)
                token = secrets.token_hex(16)
                with JOBS_LOCK:
                    VOICE_TOKENS[token] = (uid, time.time() + 300)
            else:
                VOICE_FAILS[uid] = (count + 1, time.time() + VOICE_LOCK_SECONDS if count + 1 >= VOICE_MAX_TRIES else 0)
            return self.send(200, {"enrolled": True, "recognised": recognised, "distance": round(distance, 3),
                                   "voice_token": token,
                                   "message": "Voice recognised — you can run jobs for 5 minutes." if recognised
                                              else "I don't recognise that voice, so I won't run any jobs."})

        # ---------- Passcode — second step after voice (George, 2026-11-16) ----------
        # Only George's voice PLUS his passcode opens Connie — in that
        # order. The passcode is set by George himself, on this server,
        # and only its salted hash is stored. It is never written to a
        # log, a file, chat, or the README, and it is never sent to
        # the assistant. No code is unbreakable: a 4-digit code has
        # only 10,000 combinations, so short codes are refused.
        if path == "/api/passcode/set":
            password = data.get("password", "")
            passcode = data.get("passcode", "")
            with connect() as c:
                row = c.execute("SELECT salt,hash FROM users WHERE id=?", (uid,)).fetchone()
                if not row or not isinstance(password, str) or not hmac.compare_digest(password_hash(password, row[0]), row[1]):
                    return self.send(403, {"error": "Your account password was not accepted — only George can set the passcode."})
                ok, why = _passcode_valid(passcode)
                if not ok:
                    return self.send(400, {"error": why})
                salt = secrets.token_hex(16)
                now = int(time.time())
                c.execute("INSERT INTO passcodes(owner,salt,hash,created,updated) VALUES(?,?,?, ?,?) "
                          "ON CONFLICT(owner) DO UPDATE SET salt=excluded.salt,hash=excluded.hash,updated=excluded.updated",
                          (uid, salt, password_hash(passcode, salt), now, now))
                audit(c, uid, "passcode set")
                c.commit()
            PASSCODE_FAILS.pop(uid, None)
            return self.send(200, {"set": True, "note": "Passcode set. Only your voice plus this passcode opens Connie now. Write it down somewhere private — nobody can look it up for you, not even me."})
        if path == "/api/passcode/check":
            # Voice first, then passcode — in that order.
            if _voice_profile(uid) is not None and not _voice_token_ok(uid, data.get("voice_token")):
                return self.send(403, {"error": "Check your voice first — I don't recognise that voice, so I won't run any jobs."})
            if not _passcode_set(uid):
                return self.send(400, {"error": "No passcode is set yet — set one in Settings first."})
            locked = _passcode_locked_until(uid)
            if locked:
                return self.send(429, {"error": "Too many wrong passcodes — Connie is locked for 15 minutes. Wait, then try again.", "locked_until": locked})
            passcode = data.get("passcode", "")
            row = _passcode_row(uid)
            valid = isinstance(passcode, str) and row and hmac.compare_digest(password_hash(passcode, row[0]), row[1])
            if not valid:
                count, _ = PASSCODE_FAILS.get(uid, (0, 0))
                count += 1
                PASSCODE_FAILS[uid] = (count, time.time() + PASSCODE_LOCK_SECONDS if count >= PASSCODE_MAX_TRIES else 0)
                left = PASSCODE_MAX_TRIES - count
                if count >= PASSCODE_MAX_TRIES:
                    return self.send(429, {"error": "Wrong passcode — Connie is now locked for 15 minutes.", "locked_until": PASSCODE_FAILS[uid][1]})
                return self.send(401, {"error": f"Wrong passcode — {left} {'try' if left == 1 else 'tries'} left before Connie locks for 15 minutes."})
            PASSCODE_FAILS.pop(uid, None)
            token = secrets.token_hex(16)
            with JOBS_LOCK:
                PASSCODE_TOKENS[token] = (uid, time.time() + PASSCODE_TOKEN_SECONDS)
            with connect() as c:
                audit(c, uid, "passcode check passed")
                c.commit()
            return self.send(200, {"ok": True, "passcode_token": token, "expires_in_seconds": PASSCODE_TOKEN_SECONDS,
                                   "note": "That's you — voice and passcode both match. You can run jobs for 1 hour before I ask again."})
        if path == "/api/passcode/remove":
            password = data.get("password", "")
            with connect() as c:
                row = c.execute("SELECT salt,hash FROM users WHERE id=?", (uid,)).fetchone()
                if not row or not isinstance(password, str) or not hmac.compare_digest(password_hash(password, row[0]), row[1]):
                    return self.send(403, {"error": "Your account password was not accepted — only George can remove the passcode."})
                result = c.execute("DELETE FROM passcodes WHERE owner=?", (uid,))
                audit(c, uid, "passcode removed")
                c.commit()
            with JOBS_LOCK:
                for t in [t for t, v in PASSCODE_TOKENS.items() if v[0] == uid]:
                    del PASSCODE_TOKENS[t]
            PASSCODE_FAILS.pop(uid, None)
            return self.send(200, {"set": False, "deleted": bool(result.rowcount)})

        handled = plus_post(self, uid, path, data)
        if handled is not None:
            return handled

        if path == "/api/jobs":
            job_type = data.get("type")
            if job_type not in JOB_TYPES:
                return self.send(400, {"error": "Unknown job type. Ask for one of: " + ", ".join(sorted(JOB_TYPES))})
            gate = _identity_gate(uid, data)
            if gate:
                return self.send(403, {"error": gate})
            with JOBS_LOCK:
                running = sum(1 for j in JOBS.get(uid, {}).values() if j["status"] == "running")
            if running >= 10:
                return self.send(429, {"error": "Too many jobs running at once — wait for one to finish first."})
            return self.send(201, {"job": _job_public(_start_job(uid, job_type))})

        if path == "/api/jobs/batch":
            types = data.get("types")
            if not isinstance(types, list) or not 1 <= len(types) <= 5 or any(t not in JOB_TYPES for t in types):
                return self.send(400, {"error": "Give 1-5 job types from: " + ", ".join(sorted(JOB_TYPES))})
            gate = _identity_gate(uid, data)
            if gate:
                return self.send(403, {"error": gate})
            with JOBS_LOCK:
                running = sum(1 for j in JOBS.get(uid, {}).values() if j["status"] == "running")
            if running + len(types) > 10:
                return self.send(429, {"error": "Too many jobs running at once — wait for one to finish first."})
            return self.send(201, {"jobs": [_job_public(_start_job(uid, t)) for t in types]})

        if path.startswith("/api/jobs/") and path.endswith("/cancel"):
            jid = path[len("/api/jobs/"):-len("/cancel")]
            with JOBS_LOCK:
                job = JOBS.get(uid, {}).get(jid)
                if job and job["status"] == "running":
                    job["cancelled"] = True
            if not job:
                return self.send(404, {"error": "Job not found"})
            return self.send(200, {"job": _job_public(job)})

        if path == "/api/logout":
            with connect() as c:
                c.execute("DELETE FROM sessions WHERE token_hash=?", (token_hash(self.token()),))
                c.commit()
            return self.send(200, {"ok": True})

        if path == "/api/monthly-upgrade":
            # Approve (or refuse) the monthly upgrade. Free for George.
            # Yes: save one "upgrades" record for that month. No: save
            # nothing and change nothing.
            uid = self.user()
            if uid is None:
                return self.send(401, {"error": "Sign in required"})
            try:
                year = int(data.get("year", time.gmtime().tm_year))
                month = int(data.get("month", time.gmtime().tm_mon))
                summary = monthly_upgrade_summary(uid, year, month)
            except (ValueError, TypeError):
                return self.send(400, {"error": "Give a real month and year, for example month=11 and year=2026"})
            if not data.get("approved"):
                return self.send(200, {"approved": False, "label": summary["label"],
                                       "note": "OK — no upgrade. Nothing was saved and nothing changed. Your upgrades are free."})
            with connect() as c:
                if c.execute("SELECT COUNT(*) FROM records WHERE owner=? AND kind='upgrades'", (uid,)).fetchone()[0] >= MAX_RECORDS_PER_USER:
                    return self.send(400, {"error": "Record limit reached"})
                now = int(time.time())
                c.execute("INSERT INTO records(id,owner,kind,payload,created,updated) VALUES(?,?,?,?,?,?)",
                          (secrets.token_hex(12), uid, "upgrades",
                           json.dumps({"month": month, "year": year, "label": summary["label"],
                                       "count": summary["count"], "approved": True, "free": True}), now, now))
                audit(c, uid, "monthly upgrade approved", summary["label"])
                c.commit()
            return self.send(200, {"approved": True, "label": summary["label"], "count": summary["count"],
                                   "note": "Monthly upgrade applied — a summary only. It did NOT retrain or change the model, did NOT change code, and did NOT go to the internet. Your upgrades are free."})

        if path == "/api/records":
            kind, payload = data.get("kind"), data.get("data")
            if kind not in KINDS or not isinstance(payload, dict):
                return self.send(400, {"error": "Invalid record type or payload"})
            if kind == "learned":
                # Connie refuses to learn anything against the law, and says why.
                reason = unlawful_reason(str(payload.get("text", "")))
                if reason:
                    return self.send(400, {"error": "I can't learn that, because " + reason + ". Ask me to learn something lawful instead."})
                # Memory upgrade 2026-11-21: every note gets a topic, so
                # unlimited memory stays sorted and searchable.
                if not payload.get("topic"):
                    payload["topic"] = plus.guess_topic(payload.get("text", ""))
            raw = json.dumps(payload)
            if len(raw) > MAX_RECORD:
                return self.send(400, {"error": "Record too large"})
            rid = secrets.token_hex(12)
            with connect() as c:
                # Unlimited memory (George, 2026-11-21): learned notes never count
                # against the record limit — Connie never stops learning.
                if kind != "learned" and c.execute("SELECT COUNT(*) FROM records WHERE owner=? AND kind!='learned'", (uid,)).fetchone()[0] >= MAX_RECORDS_PER_USER:
                    return self.send(400, {"error": "Record limit reached. Export a backup and remove old records."})
                now = int(time.time())
                c.execute("INSERT INTO records(id,owner,kind,payload,created,updated) VALUES(?,?,?,?,?,?)", (rid, uid, kind, raw, now, now))
                audit(c, uid, "added " + kind, rid)
                c.commit()
            return self.send(201, {"id": rid, "kind": kind, "created": now})

        if path == "/api/import":
            recs = data.get("records")
            if not isinstance(recs, list) or len(recs) > 5000:
                return self.send(400, {"error": "Expected up to 5000 records"})
            good = [(r.get("kind"), json.dumps(r.get("data"))) for r in recs
                    if isinstance(r, dict) and r.get("kind") in KINDS and isinstance(r.get("data"), dict)]
            good = [g for g in good if len(g[1]) <= MAX_RECORD]
            with connect() as c:
                have = c.execute("SELECT COUNT(*) FROM records WHERE owner=?", (uid,)).fetchone()[0]
                if have + len(good) > MAX_RECORDS_PER_USER:
                    return self.send(400, {"error": "Import would pass the record limit"})
                now = int(time.time())
                for kind, raw in good:
                    c.execute("INSERT INTO records(id,owner,kind,payload,created,updated) VALUES(?,?,?,?,?,?)", (secrets.token_hex(12), uid, kind, raw, now, now))
                audit(c, uid, "import", f"{len(good)} records")
                c.commit()
            return self.send(200, {"imported": len(good), "skipped": len(recs) - len(good)})

        if path == "/api/ai/chat":
            providers = ai_providers()
            if not providers:
                return self.send(503, {"error": "AI is not connected yet. The owner needs to add an AI key on the server (see README)."})
            # The Assistant can ask for a specific provider (Anthropic/Claude
            # Fable or Opus, or OpenAI/ChatGPT GPT-6.2 Astra). Only a provider
            # whose key is set on the server is honoured; anything else is
            # not connected. No other provider is wired in.
            wanted = data.get("provider") if isinstance(data, dict) else None
            if wanted == "allinone" and not plus.allinone_brains(providers):
                return self.send(503, {"error": "All in One is not connected yet — it needs the Anthropic key (Fable + Opus), and the OpenAI key too for GPT-6.2 Astra."})
            if wanted == "allinone":
                provider = "allinone"
            elif wanted:
                if wanted not in providers:
                    return self.send(503, {"error": f"{wanted} is not connected yet. The owner needs to add that provider's key on the server (see README)."})
                provider = wanted
            else:
                provider = providers[0]
            gate = _identity_gate(uid, data)
            if gate:
                return self.send(403, {"error": gate})
            try:
                messages = clean_messages(data.get("messages"))
            except ValueError as e:
                return self.send(400, {"error": str(e)})
            now = time.time()
            used = [t for t in AI_USE.get(uid, []) if t > now - 3600]
            if len(used) >= AI_HOURLY_LIMIT:
                return self.send(429, {"error": "Hourly AI limit reached. Try again later."})
            AI_USE[uid] = used + [now]
            system = SYSTEM_PROMPT
            # Things George taught Connie are part of every live-AI answer:
            # learned notes are local only — they never retrain or change
            # the model, and they never go anywhere except to the provider
            # as part of this one question, like the rest of the context.
            # Smart recall (memory upgrade 2026-11-21): memory is unlimited, so
            # the pinned notes plus the most relevant ones go with each question.
            all_notes = plus.learned_records(uid)
            picked = plus.relevant_notes(all_notes, messages[-1]["content"])
            if picked:
                system += (f"\n\nThings George taught you (learned notes, local only — {len(all_notes)} in total, "
                           "the most relevant are below; use them when answering):\n"
                           + "\n".join("- " + ("[pinned] " if n["data"].get("pinned") else "") + str(n["data"].get("text", "")) for n in picked))
            ctx = data.get("context")
            if isinstance(ctx, str) and ctx.strip():
                system += "\n\nOwner's saved context and current figures (entered by the owner, unverified):\n" + ctx[:4000]
            brains = None
            try:
                if provider == "allinone":
                    reply, brains = plus.all_in_one(system, messages, providers)
                else:
                    reply = call_ai(provider, system, messages)
            except (urllib.error.URLError, TimeoutError, KeyError, ValueError, OSError):
                return self.send(502, {"error": "The AI service did not answer. Check the key, model name and billing, then try again."})
            with connect() as c:
                audit(c, uid, "AI request", provider)
                c.commit()
            out = {"reply": reply, "provider": provider}
            if brains:
                out["brains"] = [plus.BRAIN_NAMES[b] for b in brains]
            return self.send(200, out)

        return self.send(404, {"error": "Not found"})

    # ---------- PUT ----------
    def do_PUT(self):
        if not self._https_ok():
            return self.send(426, {"error": "Use HTTPS — when hosted, Connie only answers over HTTPS. Open her https:// address, not http://."})
        uid = self.user()
        if uid is None:
            return self.send(401, {"error": "Sign in required"})
        path = urlparse(self.path).path
        if not path.startswith("/api/records/"):
            return self.send(404, {"error": "Not found"})
        try:
            data = self.body()
        except (ValueError, TypeError, json.JSONDecodeError):
            return self.send(400, {"error": "Invalid request"})
        payload = data.get("data") if isinstance(data, dict) else None
        if not isinstance(payload, dict) or len(json.dumps(payload)) > MAX_RECORD:
            return self.send(400, {"error": "Invalid payload"})
        rid = path.rsplit("/", 1)[-1]
        with connect() as c:
            r = c.execute("UPDATE records SET payload=?,updated=? WHERE id=? AND owner=?", (json.dumps(payload), int(time.time()), rid, uid))
            if r.rowcount:
                audit(c, uid, "edited record", rid)
            c.commit()
        return self.send(200 if r.rowcount else 404, {"updated": bool(r.rowcount)})

    # ---------- DELETE ----------
    def do_DELETE(self):
        if not self._https_ok():
            return self.send(426, {"error": "Use HTTPS — when hosted, Connie only answers over HTTPS. Open her https:// address, not http://."})
        uid = self.user()
        if uid is None:
            return self.send(401, {"error": "Sign in required"})
        path = urlparse(self.path).path
        if path == "/api/account":
            try:
                password = self.body().get("password", "")
            except (ValueError, TypeError, json.JSONDecodeError, AttributeError):
                return self.send(400, {"error": "Password required"})
            with connect() as c:
                row = c.execute("SELECT salt,hash FROM users WHERE id=?", (uid,)).fetchone()
                if not isinstance(password, str) or not hmac.compare_digest(password_hash(password, row[0]), row[1]):
                    return self.send(403, {"error": "Password not accepted"})
                for table, col in (("records", "owner"), ("sessions", "owner"), ("audit", "owner"), ("voice_profiles", "owner"), ("passcodes", "owner"), ("users", "id")):
                    c.execute(f"DELETE FROM {table} WHERE {col}=?", (uid,))
                c.commit()
            with JOBS_LOCK:
                for t in [t for t, v in VOICE_TOKENS.items() if v[0] == uid]:
                    del VOICE_TOKENS[t]
                for t in [t for t, v in PASSCODE_TOKENS.items() if v[0] == uid]:
                    del PASSCODE_TOKENS[t]
            PASSCODE_FAILS.pop(uid, None)
            VOICE_FAILS.pop(uid, None)
            return self.send(200, {"deleted": True})
        if path == "/api/voice":
            with connect() as c:
                result = c.execute("DELETE FROM voice_profiles WHERE owner=?", (uid,))
                audit(c, uid, "voice removed (Forget)")
                c.commit()
            with JOBS_LOCK:
                for t in [t for t, v in VOICE_TOKENS.items() if v[0] == uid]:
                    del VOICE_TOKENS[t]
            return self.send(200, {"deleted": bool(result.rowcount), "enrolled": False})
        if not path.startswith("/api/records/"):
            return self.send(404, {"error": "Not found"})
        rid = path.rsplit("/", 1)[-1]
        with connect() as c:
            result = c.execute("DELETE FROM records WHERE id=? AND owner=?", (rid, uid))
            if result.rowcount:
                audit(c, uid, "deleted record", rid)
            c.commit()
        return self.send(200 if result.rowcount else 404, {"deleted": bool(result.rowcount)})


# ======================================================================
# Connie Plus — 2026-11-21 upgrade pack (see connie_plus.py)
# ======================================================================
PLUS_FEATURES = {
    "memory": "unlimited learned notes, topics, pinning, smart recall, search; Connie suggests things to remember and asks first",
    "allinone": "All in One brain — Fable 5.2 + Opus 5.5 (one Anthropic key) + GPT-6.2 Astra (OpenAI key) answer together, Fable merges",
    "reminders": "real times, repeat, snooze — Connie speaks and notifies when one is due (app open)",
    "briefing": "morning briefing — calendar, reminders, tasks, money, Stripe, email, bills, business watch",
    "business_watch": "overdue invoices, low stock, late tasks, urgent calls, spending, bills, Stripe failures — read-only",
    "books": "separate books for each business — money in, money out, profit/loss, tax set-aside",
    "bills": "bills under George's name — Connie asks first, always; she never pays on her own",
    "receipts": "photo of a receipt becomes a draft expense for George to check",
    "connectors": "Stripe (read-only), Google Calendar (read; add after yes), Google Drive (file search + backups), email (read; send after yes)",
    "daily_backup": "every night to a 'Connie Backups' folder in George's Google Drive, plus 14 copies on Connie's own disk",
    "wake_word": "'Hey Connie' hands-free, while the app is open",
    "offline": "last records kept on the phone; changes made offline are sent when back online",
}


def _gate_q(uid, q):
    return _identity_gate(uid, {"voice_token": (q.get("voice_token") or [None])[0],
                                "passcode_token": (q.get("passcode_token") or [None])[0]})


def _plus_safe(h, fn):
    try:
        return h.send(200, fn())
    except Exception as e:
        return h.send(502, {"error": "That service did not answer: " + plus._short_err(e)})


def _tax_rate(uid):
    by = plus.records_by_kind(uid)
    s = (by.get("settings") or [{}])[0].get("data", {}) if by.get("settings") else {}
    try:
        n = float(s.get("tax_reserve", 25))
        return n if 0 <= n <= 100 else 25.0
    except (TypeError, ValueError):
        return 25.0


def _g_books(h, uid, q):
    def num(k):
        try:
            return int((q.get(k) or [""])[0])
        except ValueError:
            return None
    return h.send(200, plus.business_books(uid, _tax_rate(uid), num("year"), num("month")))


def _g_email(h, uid, q):
    gate = _gate_q(uid, q)
    if gate:
        return h.send(403, {"error": gate})
    return _plus_safe(h, lambda: plus.email_inbox(10))


PLUS_GET = {
    "/api/briefing": lambda h, uid, q: _plus_safe(h, lambda: plus.morning_briefing(uid)),
    "/api/watch": lambda h, uid, q: _plus_safe(h, lambda: {"alerts": plus.business_watch(uid, plus.stripe_summary())}),
    "/api/reminders/due": lambda h, uid, q: h.send(200, {"due": plus.due_reminders(uid), "now": int(time.time()),
                                                          "upcoming": [r for r in plus.due_reminders(uid, ahead_seconds=86400) if r["due_ts"] > time.time()]}),
    "/api/memory/search": lambda h, uid, q: h.send(200, {"notes": plus.search_memory(uid, (q.get("q") or [""])[0]),
                                                         "total": len(plus.learned_records(uid)), "unlimited": True}),
    "/api/plus/connectors": lambda h, uid, q: h.send(200, {"connectors": plus.connector_status(), "features": PLUS_FEATURES,
                                                          "allinone_available": plus.allinone_available(ai_providers()),
                                                          "allinone_brains": [plus.BRAIN_NAMES[b] for b in plus.allinone_brains(ai_providers())]}),
    "/api/connect/stripe": lambda h, uid, q: _plus_safe(h, plus.stripe_summary),
    "/api/connect/calendar": lambda h, uid, q: _plus_safe(h, lambda: plus.calendar_events(max(1, min(31, int((q.get("days") or ["7"])[0]) if (q.get("days") or ["7"])[0].isdigit() else 7)))),
    "/api/connect/drive": lambda h, uid, q: _plus_safe(h, lambda: plus.drive_search((q.get("q") or [""])[0])),
    "/api/connect/email": _g_email,
    "/api/backup/status": lambda h, uid, q: h.send(200, {"last": plus.kv_get(uid, "last_backup"), "daily": plus.daily_backup_on(),
                                                         "hour": plus.backup_hour(), "drive": plus.google_ready()}),
    "/api/books": _g_books,
    "/api/bills": lambda h, uid, q: h.send(200, {"bills": plus.bills_status(uid),
                                                 "rule": "Connie asks first, always. She never pays a bill on her own."}),
}


def plus_post(h, uid, path, data):
    """Connie Plus POST routes. Returns the response, or None if not a Plus route."""
    if path == "/api/reminders/parse":
        text = str(data.get("text", ""))[:500]
        if not text.strip():
            return h.send(400, {"error": "Tell me what to remind you about."})
        return h.send(200, plus.parse_reminder(text))
    m = re.fullmatch(r"/api/reminders/([0-9a-f]{24})/(done|snooze)", path)
    if m:
        kind, rec = plus.get_record(uid, m.group(1))
        if kind != "reminders":
            return h.send(404, {"error": "Reminder not found"})
        if m.group(2) == "snooze":
            mins = max(1, min(1440, int(data.get("minutes", 10)) if str(data.get("minutes", 10)).isdigit() else 10))
            rec["snooze_until"] = int(time.time()) + mins * 60
            plus.update_record(uid, m.group(1), rec)
            return h.send(200, {"snoozed": True, "minutes": mins})
        nxt = plus.next_repeat(rec) if rec.get("repeat") else None
        if nxt:
            rec["at"], rec["due"], rec["snooze_until"] = nxt.isoformat(timespec="minutes"), nxt.date().isoformat(), 0
            plus.update_record(uid, m.group(1), rec)
            return h.send(200, {"done": True, "next": rec["at"], "next_text": plus.nice_when(nxt)})
        rec["done"] = True
        plus.update_record(uid, m.group(1), rec)
        return h.send(200, {"done": True})
    if path == "/api/memory/suggest":
        have = [str(n["data"].get("text", "")) for n in plus.learned_records(uid)]
        return h.send(200, {"suggestions": plus.suggest_memories(data.get("text", ""), have, unlawful_reason),
                            "note": "Nothing is saved until you say yes."})
    if path == "/api/memory/pin":
        rid = str(data.get("id", ""))
        kind, rec = plus.get_record(uid, rid)
        if kind != "learned":
            return h.send(404, {"error": "Note not found"})
        rec["pinned"] = bool(data.get("pinned", True))
        if data.get("topic"):
            rec["topic"] = str(data["topic"])[:40]
        plus.update_record(uid, rid, rec)
        return h.send(200, {"ok": True, "pinned": rec["pinned"], "topic": rec.get("topic")})
    if path == "/api/connect/calendar/add":
        if data.get("approved") is not True:
            return h.send(400, {"error": "I only add it after you say yes."})
        gate = _identity_gate(uid, data)
        if gate:
            return h.send(403, {"error": gate})
        try:
            ev = plus.calendar_add(str(data.get("title", "Event")), str(data.get("start", "")), data.get("end"), str(data.get("where", "")))
        except Exception as e:
            return h.send(400, {"error": plus._short_err(e) if not isinstance(e, ValueError) else str(e)})
        with connect() as c:
            audit(c, uid, "calendar event added (George said yes)", ev.get("title"))
            c.commit()
        return h.send(201, ev)
    if path == "/api/connect/email/send":
        if data.get("approved") is not True:
            return h.send(400, {"error": "I only send it after you say yes."})
        gate = _identity_gate(uid, data)
        if gate:
            return h.send(403, {"error": gate})
        try:
            plus.email_send(uid, data.get("to", ""), data.get("subject", ""), data.get("body", ""))
        except ValueError as e:
            return h.send(400, {"error": str(e)})
        except Exception as e:
            return h.send(502, {"error": "Email did not send: " + str(e)[:140]})
        with connect() as c:
            audit(c, uid, "email sent (George said yes)", str(data.get("to"))[:80])
            c.commit()
        return h.send(200, {"sent": True})
    if path == "/api/backup/now":
        gate = _identity_gate(uid, data)
        if gate:
            return h.send(403, {"error": gate})
        return h.send(200, plus.backup_user(uid, DB, VERSION))
    if path == "/api/receipt/read":
        gate = _identity_gate(uid, data)
        if gate:
            return h.send(403, {"error": gate})
        img, mt = data.get("image"), data.get("media_type")
        if not isinstance(img, str) or len(img) < 100:
            return h.send(400, {"error": "Send a photo of the receipt."})
        now = time.time()
        used = [t for t in AI_USE.get(uid, []) if t > now - 3600]
        if len(used) >= AI_HOURLY_LIMIT:
            return h.send(429, {"error": "Hourly AI limit reached. Try again later."})
        AI_USE[uid] = used + [now]
        try:
            out = plus.read_receipt(img, mt, ai_providers())
        except LookupError:
            return h.send(503, {"error": "Receipt reading needs a brain — add the Anthropic or OpenAI key on the server. You can still type the expense in by hand."})
        except ValueError as e:
            return h.send(400, {"error": str(e)})
        except (urllib.error.URLError, TimeoutError, OSError, KeyError):
            return h.send(502, {"error": "The AI service did not answer. Try again."})
        out["note"] = "Draft only — check it, then tap Save. The photo itself is not kept."
        return h.send(200, out)
    m = re.fullmatch(r"/api/bills/([0-9a-f]{24})/(approve|decline|paid)", path)
    if m:
        kind, bill = plus.get_record(uid, m.group(1))
        if kind != "bills":
            return h.send(404, {"error": "Bill not found"})
        action = m.group(2)
        if action == "decline":
            bill["status"] = "George said not yet"
            plus.update_record(uid, m.group(1), bill)
            return h.send(200, {"status": bill["status"], "note": "OK — I won't pay it. Nothing was paid."})
        # Approving or marking paid is George's own decision: voice + passcode when set.
        gate = _identity_gate(uid, data)
        if gate:
            return h.send(403, {"error": gate})
        if data.get("approved") is not True:
            return h.send(400, {"error": "I only do this after you say yes."})
        with connect() as c:
            if action == "approve":
                bill["status"] = "Approved by George"
                note = ("You said yes. No bank is connected to Connie, so no money moved — pay it from your bank "
                        "or the biller's site, then tap 'Mark paid' and I'll book it to the right account.")
            else:
                bill["status"] = "Paid"
                bill["paid_on"] = plus.now_local().date().isoformat()
                c.execute("INSERT INTO records(id,owner,kind,payload,created,updated) VALUES(?,?,?,?,?,?)",
                          (secrets.token_hex(12), uid, "transactions",
                           json.dumps({"date": bill["paid_on"], "kind": "Expense", "category": bill.get("category") or "Bills",
                                       "amount": plus._num(bill.get("amount")), "account": bill.get("account") or "",
                                       "notes": "Bill paid: " + str(bill.get("payee") or "")}), int(time.time()), int(time.time())))
                note = "Marked paid and booked as an expense in " + (bill.get("account") or "Unsorted") + "."
            c.execute("UPDATE records SET payload=?,updated=? WHERE id=? AND owner=?", (json.dumps(bill), int(time.time()), m.group(1), uid))
            audit(c, uid, "bill " + action + " (George said yes)", str(bill.get("payee"))[:80])
            c.commit()
        return h.send(200, {"status": bill["status"], "note": note})
    return None


def make_server(host=None, port=None):
    connect().close()
    # Hosting-ready binding: on a host (Render/Railway/Fly.io) the
    # platform sets PORT and expects the app to listen on 0.0.0.0.
    # Locally, with no PORT set, it still binds 127.0.0.1 only, so
    # it cannot be reached from the internet by accident. An explicit
    # HOST always wins over both defaults.
    if host is None:
        host = os.getenv("HOST") or ("0.0.0.0" if os.getenv("PORT") else "127.0.0.1")
    port = int(port if port is not None else os.getenv("PORT", "8765"))
    return ThreadingHTTPServer((host, port), Handler)


if __name__ == "__main__":
    srv = make_server()
    print(f"George's Assistant v{VERSION} running at http://{srv.server_address[0]}:{srv.server_address[1]}")
    print("AI connected:" , bool(ai_providers()))
    plus.start_daily_backup(DB)
    print("Daily backup:", "on, after %02d:00 local" % plus.backup_hour() if plus.daily_backup_on() else "off")
    srv.serve_forever()
