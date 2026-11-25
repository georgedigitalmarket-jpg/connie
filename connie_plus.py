"""Connie Plus — the 2026-11-21 upgrade pack for George's Assistant (Connie).
Owner and creator: George Wederski.
© 2026 George Wederski. All rights reserved. No part of this book/app may be copied, reproduced, or shared without written permission from George Wederski.

What this adds (George's list, 2026-11-20/21):
  * Memory upgrades — unlimited learned notes, topics, pinning, smart recall
    (the most relevant notes go to the brain, not a capped list), memory
    search, and "never stop learning": Connie spots things worth remembering
    in what George says and ASKS before saving them.
  * All in One — Connie's combined brain: the same question goes to every
    connected brain (Claude Fable 5.2, Claude Opus 5.5, GPT-6.2 Astra) at
    once, then Fable merges them into one best answer.
  * Reminders that actually remind — real times ("at 3pm", "in 20 minutes",
    "every Monday"), due checks, snooze, repeat.
  * Morning briefing — today's calendar, appointments, reminders, tasks,
    money, Stripe, email and business-watch alerts, as text Connie speaks.
  * Business watch — overdue invoices, low stock, overdue tasks, urgent calls
    not followed up, spending over income, unusual expenses, Stripe failures.
  * Receipt reading — a photo of a receipt becomes a draft expense
    (vendor, date, total, tax, category). George checks it before it saves.
  * Real connectors — Stripe (read-only), Google Calendar (read + add event
    after George's yes), Google Drive (search file names + backups), email
    (read inbox headers; send only after George's yes).
  * Daily Drive backup — every night Connie saves a backup of George's
    records to a "Connie Backups" folder in his Google Drive, and keeps the
    last 14 copies on her own disk too.

Keys and passwords NEVER live in this file, the zip, the browser, chat or
logs. They come from the server's environment variables, or from
connie_secrets.json next to server.py (written by connect_google.py, file
permissions owner-only, never served to the browser, never zipped).
Standard library only.
"""
import os, json, time, re, threading, base64, secrets, ssl, sqlite3
import urllib.request, urllib.parse, urllib.error
import imaplib, smtplib, email, datetime as dt
from email.header import decode_header, make_header
from email.message import EmailMessage
from email.utils import parseaddr
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SECRETS_FILE = Path(os.getenv("CONNIE_SECRETS_FILE", str(ROOT / "connie_secrets.json")))

# Filled in by init() from server.py, so this module never imports server.py.
_connect = None
_call_ai = None
_ai_providers = None
_audit = None


def init(connect_fn, call_ai_fn, ai_providers_fn, audit_fn):
    global _connect, _call_ai, _ai_providers, _audit
    _connect, _call_ai, _ai_providers, _audit = connect_fn, call_ai_fn, ai_providers_fn, audit_fn


# ---------------------------------------------------------------- secrets
def _secrets_file():
    try:
        return json.loads(SECRETS_FILE.read_text())
    except (OSError, ValueError):
        return {}


def secret(name):
    """A key from the environment first, else from connie_secrets.json. Never logged."""
    v = os.getenv(name)
    if v:
        return v
    v = _secrets_file().get(name)
    return v if isinstance(v, str) and v else None


def save_secrets(values):
    """Used by connect_google.py. Owner-only file permissions."""
    cur = _secrets_file()
    cur.update({k: v for k, v in values.items() if isinstance(v, str)})
    SECRETS_FILE.write_text(json.dumps(cur, indent=2))
    try:
        os.chmod(SECRETS_FILE, 0o600)
    except OSError:
        pass


# ---------------------------------------------------------------- time
def tz():
    name = os.getenv("CONNIE_TZ", "America/Denver")   # George is in Wyoming
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(name)
    except Exception:  # no tz database on this machine — Mountain Standard Time
        return dt.timezone(dt.timedelta(hours=-7), "MST")


def now_local():
    return dt.datetime.now(tz())


def nice_when(d):
    today = now_local().date()
    day = "today" if d.date() == today else "tomorrow" if d.date() == today + dt.timedelta(days=1) else d.strftime("%A %b %-d") if os.name != "nt" else d.strftime("%A %b %d")
    t = d.strftime("%I:%M %p").lstrip("0")
    return f"{day} at {t}"


# ---------------------------------------------------------------- records
def records_by_kind(uid):
    with _connect() as c:
        rows = c.execute("SELECT id,kind,payload,created,updated FROM records WHERE owner=?", (uid,)).fetchall()
    out = {}
    for rid, kind, payload, created, updated in rows:
        try:
            data = json.loads(payload)
        except ValueError:
            continue
        out.setdefault(kind, []).append({"id": rid, "data": data, "created": created, "updated": updated})
    return out


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _date(v):
    try:
        return dt.date.fromisoformat(str(v)[:10])
    except (TypeError, ValueError):
        return None


def kv_get(uid, key):
    with _connect() as c:
        c.execute("CREATE TABLE IF NOT EXISTS plus_kv (owner INTEGER NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(owner,key))")
        row = c.execute("SELECT value FROM plus_kv WHERE owner=? AND key=?", (uid, key)).fetchone()
    return json.loads(row[0]) if row else None


def kv_set(uid, key, value):
    with _connect() as c:
        c.execute("CREATE TABLE IF NOT EXISTS plus_kv (owner INTEGER NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(owner,key))")
        c.execute("INSERT INTO plus_kv(owner,key,value) VALUES(?,?,?) ON CONFLICT(owner,key) DO UPDATE SET value=excluded.value",
                  (uid, key, json.dumps(value)))
        c.commit()


# ================================================================ MEMORY
STOP = set("the a an and or but to of in on at for with is are was were be been it this that these those i me my we our you your he she they them his her its from by as about what when where how why who which do does did can could would should will just so if then than there here have has had not no yes".split())
TOPIC_WORDS = {
    "Customers": ["customer", "client", "job", "appointment", "invoice", "quote"],
    "Money": ["price", "cost", "pay", "paid", "bank", "stripe", "dollar", "$", "budget", "tax", "money", "sell", "sale"],
    "Business": ["business", "shop", "product", "book", "bot", "store", "market", "ad", "supplier", "inventory", "whop", "fungies"],
    "Home & family": ["home", "house", "wife", "son", "daughter", "kid", "family", "dog", "cat", "truck", "car", "garage"],
    "Preferences": ["like", "prefer", "love", "hate", "favorite", "favourite", "always", "never", "usually"],
}


def words(text):
    return [w for w in re.findall(r"[a-z0-9$']+", str(text).lower()) if len(w) >= 3 and w not in STOP]


def guess_topic(text):
    low = str(text).lower()
    best, score = "Other", 0
    for topic, keys in TOPIC_WORDS.items():
        s = sum(1 for k in keys if k in low)
        if s > score:
            best, score = topic, s
    return best


def learned_records(uid):
    return records_by_kind(uid).get("learned", [])


def relevant_notes(notes, question, k=40):
    """Smart recall: with a few notes, send them all. With hundreds or
    thousands, send the pinned ones plus the k most relevant to this
    question — so Connie's memory can grow without limit and the brain
    still gets the right things. notes: list of record dicts."""
    notes = [n for n in notes if str(n["data"].get("text", "")).strip()]
    if len(notes) <= k:
        return notes
    q = set(words(question))
    newest = max((n["created"] for n in notes), default=0) or 1

    def score(n):
        d = n["data"]
        w = set(words(d.get("text", "")) + words(d.get("topic", "")))
        overlap = len(q & w)
        return (100 if d.get("pinned") else 0) + overlap * 10 + (n["created"] / newest)

    ranked = sorted(notes, key=score, reverse=True)
    return ranked[:k]


def search_memory(uid, q):
    q = str(q or "").strip().lower()
    notes = learned_records(uid)
    if not q:
        return notes
    qw = set(words(q))
    hits = []
    for n in notes:
        text = str(n["data"].get("text", "")).lower()
        topic = str(n["data"].get("topic", "")).lower()
        if q in text or q in topic or (qw and qw & set(words(text + " " + topic))):
            hits.append(n)
    return hits


SUGGEST_PATTERNS = [
    re.compile(r"\b(my|our) ((?:[a-z']+ ){0,4}?[a-z']+) (is|are|was|were) ([^.?!\n]{2,90})", re.I),
    re.compile(r"\bI (always|never|usually|prefer|like|love|hate|don't like|do not like|work|live|drive|own|use|sell) ([^.?!\n]{2,90})", re.I),
    re.compile(r"\b(call|text|email) me ([^.?!\n]{2,60})", re.I),
    re.compile(r"\bI'm (allergic to|a |an |the |from |based in |working on )([^.?!\n]{2,80})", re.I),
]


def _third_person(s):
    s = re.sub(r"\bI'm\b", "George is", s)
    s = re.sub(r"\bI am\b", "George is", s, flags=re.I)
    s = re.sub(r"\bI\b", "George", s)
    s = re.sub(r"\bmy\b", "George's", s, flags=re.I)
    s = re.sub(r"\bour\b", "George's", s, flags=re.I)
    s = re.sub(r"\bme\b", "George", s, flags=re.I)
    s = re.sub(r"\bmine\b", "George's", s, flags=re.I)
    s = s.strip(" ,;:")
    return s[0].upper() + s[1:] if s else s


def suggest_memories(text, existing_texts=(), unlawful=None):
    """Never stop learning — but ask first. Finds up to 3 things in what
    George just said that look worth remembering. Nothing is saved here;
    the app asks George and only saves what he says yes to."""
    text = str(text or "")
    if len(text) > 3000 or text.strip().endswith("?") or re.match(r"\s*(learn|remember|teach|forget)\b", text, re.I):
        return []
    have = {t.strip().lower() for t in existing_texts}
    out = []
    for sentence in re.split(r"(?<=[.!\n])\s+", text):
        if sentence.strip().endswith("?"):
            continue
        for pat in SUGGEST_PATTERNS:
            m = pat.search(sentence)
            if not m:
                continue
            fact = _third_person(m.group(0))
            if len(fact) < 8 or fact.lower() in have or fact in out:
                continue
            if unlawful and unlawful(fact):
                continue
            out.append(fact)
            break
        if len(out) >= 3:
            break
    return out


# ================================================================ ALL IN ONE
BRAIN_NAMES = {"anthropic": "Claude Fable 5.2", "opus": "Claude Opus 5.5", "openai": "GPT-6.2 Astra"}


def allinone_brains(providers):
    return [p for p in ("anthropic", "opus", "openai") if p in providers]


def allinone_available(providers):
    return len(allinone_brains(providers)) >= 2


def all_in_one(system, messages, providers):
    """Ask every connected brain at once, then merge into one best answer.
    One ANTHROPIC_API_KEY runs two of the three brains (Fable + Opus);
    GPT-6.2 Astra joins when OPENAI_API_KEY is set too."""
    brains = allinone_brains(providers)
    if not brains:
        raise ValueError("No brain connected")
    answers, errors = {}, {}

    def ask(p):
        try:
            answers[p] = _call_ai(p, system, messages)
        except Exception as e:  # one brain failing must not stop the others
            errors[p] = str(e)[:120]

    threads = [threading.Thread(target=ask, args=(p,), daemon=True) for p in brains]
    for t in threads:
        t.start()
    for t in threads:
        t.join(75)
    got = [p for p in brains if answers.get(p, "").strip()]
    if not got:
        raise ValueError("No brain answered")
    if len(got) == 1:
        return answers[got[0]], got
    judge = "anthropic" if "anthropic" in got else got[0]
    question = messages[-1]["content"] if isinstance(messages[-1]["content"], str) else "(see above)"
    pack = "\n\n".join(f"[{BRAIN_NAMES[p]}]\n{answers[p][:6000]}" for p in got)
    merge_system = (system + "\n\nYou are Connie's 'All in One' brain. Several AI brains answered George's last "
                    "question. Write ONE best answer for George: keep what is correct and useful from each, fix "
                    "anything wrong, drop repeats, keep it clear and brief. Do not list the brains or say who said "
                    "what — unless they truly disagree on something that matters, then say so in one short line.")
    merge_messages = messages[:-1] + [{"role": "user", "content": f"George's question:\n{question}\n\nAnswers from the brains:\n{pack}"}]
    try:
        return _call_ai(judge, merge_system, merge_messages), got
    except Exception:
        return answers[judge], got


# ================================================================ REMINDERS
WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]


def parse_reminder(text, now=None):
    """'remind me to call Smith tomorrow at 3pm' -> title + a real local time."""
    now = now or now_local()
    t = " " + str(text or "").strip() + " "
    t = re.sub(r"^\s*(hey connie,?\s*)?(please\s+)?(remind me|set a reminder|reminder)( to| that| about|:)?\s*", " ", t, flags=re.I)
    low = t.lower()
    date, hour, minute, repeat, used = None, None, None, "", []

    m = re.search(r"\bin (\d{1,3}|an?|one|two|three|five|ten|fifteen|twenty|thirty) ?(minutes?|mins?|hours?|hrs?|days?)\b", low)
    if m:
        n = {"a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "five": 5, "ten": 10, "fifteen": 15, "twenty": 20, "thirty": 30}.get(m.group(1))
        n = n if n is not None else int(m.group(1))
        unit = m.group(2)
        delta = dt.timedelta(minutes=n) if unit.startswith("m") else dt.timedelta(hours=n) if unit.startswith("h") else dt.timedelta(days=n)
        at = (now + delta).replace(second=0, microsecond=0)
        used.append(m.group(0))
        title = _clean_title(t, used)
        return {"title": title, "at": at.isoformat(timespec="minutes"), "due": at.date().isoformat(), "repeat": "", "when_text": nice_when(at), "guessed": False}

    if re.search(r"\b(every ?day|daily)\b", low):
        repeat = "daily"; used.append(re.search(r"\b(every ?day|daily)\b", low).group(0))
    m = re.search(r"\b(every week|weekly)\b", low)
    if m:
        repeat = "weekly"; used.append(m.group(0))
    m = re.search(r"\bevery (monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b", low)
    if m:
        repeat = "weekly"; used.append(m.group(0))
        date = _next_weekday(now.date(), WEEKDAYS.index(m.group(1)), allow_today=True)
    m = re.search(r"\bevery month|monthly\b", low)
    if m:
        repeat = "monthly"; used.append(m.group(0))

    if re.search(r"\btomorrow\b", low):
        date = now.date() + dt.timedelta(days=1); used.append("tomorrow")
    elif re.search(r"\btonight\b", low):
        date = now.date(); hour, minute = 20, 0; used.append("tonight")
    elif re.search(r"\btoday\b", low):
        date = now.date(); used.append("today")
    if date is None:
        m = re.search(r"\b(on |next |this )?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b", low)
        if m:
            date = _next_weekday(now.date(), WEEKDAYS.index(m.group(2)), allow_today=False)
            if (m.group(1) or "").strip() == "next" and (date - now.date()).days < 7 and False:
                date += dt.timedelta(days=7)
            used.append(m.group(0))
    if date is None:
        m = re.search(r"\b(on )?(\d{1,2})/(\d{1,2})(/(\d{2,4}))?\b", low)
        if m:
            y = int(m.group(5)) if m.group(5) else now.year
            y = y + 2000 if y < 100 else y
            try:
                date = dt.date(y, int(m.group(2)), int(m.group(3)))
                if not m.group(5) and date < now.date():
                    date = date.replace(year=y + 1)
                used.append(m.group(0))
            except ValueError:
                pass
    if date is None:
        m = re.search(r"\b(on )?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? (\d{1,2})(st|nd|rd|th)?\b", low)
        if m:
            try:
                date = dt.date(now.year, MONTHS.index(m.group(2)) + 1, int(m.group(3)))
                if date < now.date():
                    date = date.replace(year=now.year + 1)
                used.append(m.group(0))
            except ValueError:
                pass

    m = re.search(r"\bat (\d{1,2})(:(\d{2}))? ?(a\.?m\.?|p\.?m\.?)?\b", low) or re.search(r"\b(\d{1,2})(:(\d{2}))? ?(a\.?m\.?|p\.?m\.?)\b", low)
    if m:
        h = int(m.group(1)); mi = int(m.group(3) or 0); ap = (m.group(4) or "").replace(".", "")
        if ap == "pm" and h < 12:
            h += 12
        if ap == "am" and h == 12:
            h = 0
        if not ap and 1 <= h <= 6:   # "at 3" means 3 in the afternoon
            h += 12
        if 0 <= h <= 23 and 0 <= mi <= 59:
            hour, minute = h, mi
            used.append(m.group(0))
    elif re.search(r"\bat noon\b|\bnoon\b", low):
        hour, minute = 12, 0; used.append("noon"); used.append("at noon")
    elif re.search(r"\b(in the )?morning\b", low):
        hour, minute = 9, 0; used.append(re.search(r"\b(in the )?morning\b", low).group(0))
    elif re.search(r"\b(in the )?afternoon\b", low):
        hour, minute = 14, 0; used.append(re.search(r"\b(in the )?afternoon\b", low).group(0))
    elif re.search(r"\b(in the )?evening\b", low):
        hour, minute = 18, 0; used.append(re.search(r"\b(in the )?evening\b", low).group(0))

    guessed = False
    if date is None and hour is None and not repeat:
        date, hour, minute, guessed = now.date() + dt.timedelta(days=1), 9, 0, True
    if hour is None:
        hour, minute = 9, 0
    if date is None:
        date = now.date()
        if (hour, minute) <= (now.hour, now.minute):
            date += dt.timedelta(days=1)
    at = dt.datetime(date.year, date.month, date.day, hour, minute, tzinfo=tz())
    title = _clean_title(t, used)
    when = nice_when(at) + ({"daily": ", every day", "weekly": ", every week", "monthly": ", every month"}.get(repeat, ""))
    return {"title": title, "at": at.isoformat(timespec="minutes"), "due": date.isoformat(), "repeat": repeat, "when_text": when, "guessed": guessed}


def _next_weekday(d, wd, allow_today):
    days = (wd - d.weekday()) % 7
    if days == 0 and not allow_today:
        days = 7
    return d + dt.timedelta(days=days)


def _clean_title(t, used):
    s = t
    for u in sorted(set(used), key=len, reverse=True):
        s = re.sub(re.escape(u), " ", s, flags=re.I)
    s = re.sub(r"\s+", " ", s).strip(" ,.;:-")
    s = re.sub(r"\b(on|at|by)$", "", s).strip(" ,.;:-")
    return (s[0].upper() + s[1:]) if s else "Reminder"


def reminder_time(data):
    """Epoch seconds a reminder is due, or None."""
    at = data.get("at")
    if at:
        try:
            d = dt.datetime.fromisoformat(str(at))
            if d.tzinfo is None:
                d = d.replace(tzinfo=tz())
            return d.timestamp()
        except ValueError:
            pass
    day = _date(data.get("due"))
    if day:
        return dt.datetime(day.year, day.month, day.day, 9, 0, tzinfo=tz()).timestamp()
    return None


def due_reminders(uid, now_ts=None, ahead_seconds=0):
    now_ts = now_ts or time.time()
    out = []
    for r in records_by_kind(uid).get("reminders", []):
        d = r["data"]
        if d.get("done") in (True, "true"):
            continue
        when = reminder_time(d)
        if when is None:
            continue
        snooze = _num(d.get("snooze_until"))
        if snooze and snooze > now_ts:
            continue
        if when <= now_ts + ahead_seconds:
            out.append({"id": r["id"], "title": d.get("title") or "Reminder", "at": d.get("at") or d.get("due"),
                        "due_ts": int(when), "repeat": d.get("repeat", "")})
    return sorted(out, key=lambda x: x["due_ts"])


def next_repeat(data):
    when = reminder_time(data)
    if when is None:
        return None
    d = dt.datetime.fromtimestamp(when, tz())
    step = {"daily": dt.timedelta(days=1), "weekly": dt.timedelta(days=7)}.get(data.get("repeat"))
    now = now_local()
    if data.get("repeat") == "monthly":
        while d <= now:
            month = d.month % 12 + 1
            year = d.year + (d.month == 12)
            day = min(d.day, 28)
            d = d.replace(year=year, month=month, day=day)
    elif step:
        while d <= now:
            d += step
    else:
        return None
    return d


def update_record(uid, rid, data):
    with _connect() as c:
        r = c.execute("UPDATE records SET payload=?,updated=? WHERE id=? AND owner=?", (json.dumps(data), int(time.time()), rid, uid))
        c.commit()
        return bool(r.rowcount)


def get_record(uid, rid):
    with _connect() as c:
        row = c.execute("SELECT kind,payload FROM records WHERE id=? AND owner=?", (rid, uid)).fetchone()
    return (row[0], json.loads(row[1])) if row else (None, None)


# ================================================================ BUSINESS WATCH
def business_watch(uid, stripe=None):
    """Connie keeps an eye on the business. Read-only — it only points things out."""
    by = records_by_kind(uid)
    today = now_local().date()
    alerts = []

    def add(level, area, text, tab):
        alerts.append({"level": level, "area": area, "text": text, "tab": tab})

    unpaid = [r["data"] for r in by.get("invoices", []) if r["data"].get("status") not in ("Paid", "Draft")]
    overdue = [i for i in unpaid if (_date(i.get("due")) and _date(i.get("due")) < today) or i.get("status") == "Overdue"]
    if overdue:
        add("high", "Invoices", f"{len(overdue)} invoice(s) overdue, ${sum(_num(i.get('amount')) for i in overdue):,.2f} owed — "
            + ", ".join(str(i.get("customer") or "?") for i in overdue[:4]) + ". Want me to draft friendly reminders?", "invoices")
    soon = [i for i in unpaid if i not in overdue and _date(i.get("due")) and 0 <= (_date(i.get("due")) - today).days <= 3]
    if soon:
        add("info", "Invoices", f"{len(soon)} invoice(s) due in the next 3 days.", "invoices")

    inv = [r["data"] for r in by.get("inventory", [])]
    out_of = [i for i in inv if _num(i.get("quantity")) <= 0 and str(i.get("quantity", "")) != ""]
    low = [i for i in inv if i not in out_of and str(i.get("low_stock", "")) != "" and _num(i.get("quantity")) <= _num(i.get("low_stock"))]
    if out_of:
        add("high", "Inventory", "Out of stock: " + ", ".join(str(i.get("item")) for i in out_of[:6]) + ".", "inventory")
    if low:
        add("medium", "Inventory", "Running low: " + ", ".join(str(i.get("item")) for i in low[:6]) + ".", "inventory")

    tasks = [r["data"] for r in by.get("tasks", []) if r["data"].get("done") not in (True, "true")]
    late = [t for t in tasks if _date(t.get("due")) and _date(t.get("due")) < today]
    if late:
        add("medium", "Tasks", f"{len(late)} task(s) past due: " + ", ".join(str(t.get("title")) for t in late[:4]) + ".", "tasks")

    urgent = [r["data"] for r in by.get("calls", []) if r["data"].get("urgent") in (True, "true") and not str(r["data"].get("follow_up", "")).strip()]
    if urgent:
        add("high", "Front Desk", f"{len(urgent)} urgent call(s) with no follow-up yet: " + ", ".join(str(c.get("caller")) for c in urgent[:4]) + ".", "frontdesk")

    tx = [r["data"] for r in by.get("transactions", [])]
    month = [t for t in tx if _date(t.get("date")) and _date(t.get("date")).replace(day=1) == today.replace(day=1)]
    inc = sum(_num(t.get("amount")) for t in month if t.get("kind") == "Income")
    exp = sum(_num(t.get("amount")) for t in month if t.get("kind") == "Expense")
    if exp > inc and exp > 0:
        add("medium", "Money", f"This month you've spent ${exp:,.2f} and brought in ${inc:,.2f} — spending is ahead of income.", "money")
    expenses = [_num(t.get("amount")) for t in tx if t.get("kind") == "Expense" and _num(t.get("amount")) > 0]
    if len(expenses) >= 5:
        avg = sum(expenses) / len(expenses)
        big = [t for t in month if t.get("kind") == "Expense" and _num(t.get("amount")) > 3 * avg]
        if big:
            add("info", "Money", f"Unusual expense this month: ${_num(big[0].get('amount')):,.2f} ({big[0].get('category') or 'no category'}) — over 3× your usual.", "money")
    incomes = [t for t in tx if t.get("kind") == "Income" and _date(t.get("date"))]
    if incomes and max(_date(t.get("date")) for t in incomes) < today - dt.timedelta(days=14):
        add("info", "Money", "No income entered in the last 14 days.", "money")

    for b in by.get("bills", []):
        d = b["data"]
        if d.get("status") == "Paid":
            continue
        due = _date(d.get("due"))
        if due and due < today:
            add("high", "Bills", f"Bill from {d.get('payee') or '?'} for ${_num(d.get('amount')):,.2f} was due {due.isoformat()} — pay it?", "money")
        elif due and (due - today).days <= 3:
            add("medium", "Bills", f"Bill from {d.get('payee') or '?'} for ${_num(d.get('amount')):,.2f} is due {due.isoformat()} — can I mark it to pay?", "money")

    if stripe and stripe.get("connected") and not stripe.get("error"):
        if stripe.get("failed_7d"):
            add("high", "Stripe", f"{stripe['failed_7d']} failed payment(s) on Stripe in the last 7 days.", "integrations")
        if stripe.get("disputes_open"):
            add("high", "Stripe", f"{stripe['disputes_open']} open Stripe dispute(s) — these have deadlines.", "integrations")

    order = {"high": 0, "medium": 1, "info": 2}
    alerts.sort(key=lambda a: order[a["level"]])
    return alerts


# ================================================================ CONNECTORS
def _http(method, url, headers=None, data=None, timeout=20):
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
    return raw


# ---- Stripe (read-only) ----
def stripe_key():
    return secret("STRIPE_SECRET_KEY") or secret("STRIPE_RESTRICTED_KEY")


def stripe_get(path, params=None):
    url = "https://api.stripe.com/v1/" + path + ("?" + urllib.parse.urlencode(params, doseq=True) if params else "")
    raw = _http("GET", url, {"Authorization": "Bearer " + stripe_key()})
    return json.loads(raw)


def stripe_summary():
    if not stripe_key():
        return {"connected": False}
    try:
        bal = stripe_get("balance")
        avail = sum(b["amount"] for b in bal.get("available", []) if b.get("currency") == "usd") / 100
        pend = sum(b["amount"] for b in bal.get("pending", []) if b.get("currency") == "usd") / 100
        week = int(time.time()) - 7 * 86400
        day = int(time.time()) - 86400
        charges = stripe_get("charges", {"limit": 100, "created[gte]": week}).get("data", [])
        ok = [c for c in charges if c.get("status") == "succeeded" and not c.get("refunded")]
        failed = [c for c in charges if c.get("status") == "failed"]
        disputes = stripe_get("disputes", {"limit": 20}).get("data", [])
        open_d = [d for d in disputes if d.get("status") in ("needs_response", "warning_needs_response")]
        recent = [{"amount": c["amount"] / 100, "status": c.get("status"), "description": c.get("description") or (c.get("billing_details") or {}).get("name") or "",
                   "created": c.get("created")} for c in charges[:8]]
        return {"connected": True, "available": avail, "pending": pend,
                "sales_24h": sum(c["amount"] for c in ok if c["created"] >= day) / 100,
                "count_24h": sum(1 for c in ok if c["created"] >= day),
                "sales_7d": sum(c["amount"] for c in ok) / 100, "count_7d": len(ok),
                "failed_7d": len(failed), "disputes_open": len(open_d), "recent": recent,
                "mode": "test" if stripe_key().startswith(("sk_test", "rk_test")) else "live"}
    except Exception as e:
        return {"connected": True, "error": "Stripe did not answer: " + _short_err(e)}


def _short_err(e):
    if isinstance(e, urllib.error.HTTPError):
        try:
            body = json.loads(e.read())
            msg = (body.get("error") or {}).get("message") if isinstance(body.get("error"), dict) else body.get("error_description") or body.get("error")
            return f"{e.code} {msg or ''}".strip()
        except Exception:
            return str(e.code)
    return str(e)[:140]


# ---- Google (Drive + Calendar) via OAuth refresh token ----
_GTOKEN = {"token": None, "expires": 0}
GOOGLE_SCOPES = ["https://www.googleapis.com/auth/drive.file",
                 "https://www.googleapis.com/auth/drive.metadata.readonly",
                 "https://www.googleapis.com/auth/calendar.events"]


def google_ready():
    return bool(secret("GOOGLE_CLIENT_ID") and secret("GOOGLE_CLIENT_SECRET") and secret("GOOGLE_REFRESH_TOKEN"))


def google_token():
    if _GTOKEN["token"] and _GTOKEN["expires"] > time.time() + 60:
        return _GTOKEN["token"]
    body = urllib.parse.urlencode({"client_id": secret("GOOGLE_CLIENT_ID"), "client_secret": secret("GOOGLE_CLIENT_SECRET"),
                                   "refresh_token": secret("GOOGLE_REFRESH_TOKEN"), "grant_type": "refresh_token"}).encode()
    d = json.loads(_http("POST", "https://oauth2.googleapis.com/token", {"Content-Type": "application/x-www-form-urlencoded"}, body))
    _GTOKEN.update(token=d["access_token"], expires=time.time() + int(d.get("expires_in", 3600)))
    return _GTOKEN["token"]


def gapi(method, url, body=None, raw=None, content_type="application/json"):
    headers = {"Authorization": "Bearer " + google_token()}
    data = None
    if body is not None:
        data = json.dumps(body).encode(); headers["Content-Type"] = "application/json"
    elif raw is not None:
        data = raw; headers["Content-Type"] = content_type
    out = _http(method, url, headers, data, timeout=40)
    return json.loads(out) if out else {}


def calendar_events(days=1, start=None):
    """Events from George's Google Calendar: the API when Google is connected,
    else his calendar's secret iCal address (read-only)."""
    start = start or now_local().replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + dt.timedelta(days=days)
    if google_ready():
        q = urllib.parse.urlencode({"timeMin": start.isoformat(), "timeMax": end.isoformat(), "singleEvents": "true",
                                    "orderBy": "startTime", "maxResults": 50})
        d = gapi("GET", "https://www.googleapis.com/calendar/v3/calendars/primary/events?" + q)
        out = []
        for e in d.get("items", []):
            s = e.get("start", {})
            out.append({"title": e.get("summary") or "(no title)", "start": s.get("dateTime") or s.get("date"),
                        "all_day": "date" in s and "dateTime" not in s, "where": e.get("location") or ""})
        return {"connected": True, "source": "google", "events": out}
    ics = secret("GOOGLE_CALENDAR_ICS_URL") or secret("CALENDAR_ICS_URL")
    if ics:
        text = _http("GET", ics, timeout=20).decode("utf-8", "replace")
        return {"connected": True, "source": "ics", "events": parse_ics(text, start, end)}
    return {"connected": False, "events": []}


def parse_ics(text, start, end):
    text = re.sub(r"\r?\n[ \t]", "", text)   # unfold lines
    out = []
    for block in re.findall(r"BEGIN:VEVENT(.*?)END:VEVENT", text, re.S):
        props = {}
        for line in block.strip().splitlines():
            if ":" not in line:
                continue
            k, v = line.split(":", 1)
            name, _, params = k.partition(";")
            props.setdefault(name.upper(), (params, v))
        if "DTSTART" not in props:
            continue
        params, v = props["DTSTART"]
        when, all_day = _ics_time(params, v)
        if when is None:
            continue
        title = props.get("SUMMARY", ("", "(no title)"))[1].replace("\\,", ",").replace("\\n", " ")
        rrule = props.get("RRULE", ("", ""))[1]
        hits = [when]
        if rrule:   # simple repeats: DAILY / WEEKLY, enough for a daily briefing
            freq = re.search(r"FREQ=(DAILY|WEEKLY)", rrule)
            if freq:
                step = dt.timedelta(days=1 if freq.group(1) == "DAILY" else 7)
                until = re.search(r"UNTIL=(\d{8})", rrule)
                stop = dt.datetime.strptime(until.group(1), "%Y%m%d").replace(tzinfo=tz()) if until else end
                cur = when
                hits = []
                for _ in range(2000):
                    if cur >= end or cur > stop + dt.timedelta(days=1):
                        break
                    if cur >= start:
                        hits.append(cur)
                    cur += step
        for h in hits:
            if start <= h < end:
                out.append({"title": title, "start": h.date().isoformat() if all_day else h.isoformat(), "all_day": all_day,
                            "where": props.get("LOCATION", ("", ""))[1].replace("\\,", ",")})
    return sorted(out, key=lambda e: e["start"])


def _ics_time(params, v):
    v = v.strip()
    try:
        if "VALUE=DATE" in params.upper() or re.fullmatch(r"\d{8}", v):
            d = dt.datetime.strptime(v[:8], "%Y%m%d").replace(tzinfo=tz())
            return d, True
        if v.endswith("Z"):
            return dt.datetime.strptime(v, "%Y%m%dT%H%M%SZ").replace(tzinfo=dt.timezone.utc).astimezone(tz()), False
        m = re.search(r"TZID=([^;:]+)", params)
        zone = tz()
        if m:
            try:
                from zoneinfo import ZoneInfo
                zone = ZoneInfo(m.group(1))
            except Exception:
                pass
        return dt.datetime.strptime(v[:15], "%Y%m%dT%H%M%S").replace(tzinfo=zone).astimezone(tz()), False
    except ValueError:
        return None, False


def calendar_add(title, start_iso, end_iso=None, where=""):
    if not google_ready():
        raise ValueError("Google is not connected — run connect_google.py once on the server (see README).")
    s = dt.datetime.fromisoformat(start_iso)
    if s.tzinfo is None:
        s = s.replace(tzinfo=tz())
    e = dt.datetime.fromisoformat(end_iso) if end_iso else s + dt.timedelta(hours=1)
    if e.tzinfo is None:
        e = e.replace(tzinfo=tz())
    ev = gapi("POST", "https://www.googleapis.com/calendar/v3/calendars/primary/events",
              {"summary": title[:200], "location": where[:200], "start": {"dateTime": s.isoformat()}, "end": {"dateTime": e.isoformat()}})
    return {"id": ev.get("id"), "link": ev.get("htmlLink"), "title": ev.get("summary")}


def drive_search(q=""):
    if not google_ready():
        return {"connected": False, "files": []}
    query = "trashed=false"
    if q:
        safe = str(q).replace("\\", "\\\\").replace("'", "\\'")[:100]
        query += f" and name contains '{safe}'"
    params = urllib.parse.urlencode({"q": query, "orderBy": "modifiedTime desc", "pageSize": 15,
                                     "fields": "files(id,name,mimeType,modifiedTime,webViewLink)"})
    d = gapi("GET", "https://www.googleapis.com/drive/v3/files?" + params)
    return {"connected": True, "files": d.get("files", [])}


def drive_folder(uid, name="Connie Backups"):
    fid = kv_get(uid, "drive_backup_folder")
    if fid:
        return fid
    q = urllib.parse.urlencode({"q": f"name='{name}' and mimeType='application/vnd.google-apps.folder' and trashed=false", "fields": "files(id)"})
    found = gapi("GET", "https://www.googleapis.com/drive/v3/files?" + q).get("files", [])
    if found:
        fid = found[0]["id"]
    else:
        fid = gapi("POST", "https://www.googleapis.com/drive/v3/files", {"name": name, "mimeType": "application/vnd.google-apps.folder"})["id"]
    kv_set(uid, "drive_backup_folder", fid)
    return fid


def drive_upload(name, content_bytes, mime, parent):
    boundary = "connie" + secrets.token_hex(8)
    meta = json.dumps({"name": name, "parents": [parent]}).encode()
    body = (b"--" + boundary.encode() + b"\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + meta +
            b"\r\n--" + boundary.encode() + b"\r\nContent-Type: " + mime.encode() + b"\r\n\r\n" + content_bytes +
            b"\r\n--" + boundary.encode() + b"--")
    return gapi("POST", "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
                raw=body, content_type="multipart/related; boundary=" + boundary)


# ---- Email (IMAP read, SMTP send after George's yes) ----
def email_ready():
    return bool(secret("EMAIL_ADDRESS") and secret("EMAIL_APP_PASSWORD"))


def _dec(v):
    try:
        return str(make_header(decode_header(v or "")))
    except Exception:
        return str(v or "")


def email_inbox(limit=8):
    if not email_ready():
        return {"connected": False}
    host = secret("IMAP_HOST") or "imap.gmail.com"
    try:
        m = imaplib.IMAP4_SSL(host, timeout=20)
        m.login(secret("EMAIL_ADDRESS"), secret("EMAIL_APP_PASSWORD"))
        m.select("INBOX", readonly=True)
        _, unseen = m.search(None, "UNSEEN")
        ids = (unseen[0] or b"").split()
        latest = []
        for mid in reversed(ids[-limit:]):
            _, data = m.fetch(mid, "(BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])")
            msg = email.message_from_bytes(data[0][1])
            name, addr = parseaddr(_dec(msg.get("From")))
            latest.append({"from": name or addr, "from_address": addr, "subject": _dec(msg.get("Subject")) or "(no subject)", "date": msg.get("Date", "")})
        m.logout()
        return {"connected": True, "unread": len(ids), "latest": latest}
    except Exception as e:
        return {"connected": True, "error": "Email did not answer: " + str(e)[:140]}


SENT_TIMES = {}


def email_send(uid, to, subject, body):
    if not email_ready():
        raise ValueError("Email is not connected — set EMAIL_ADDRESS and EMAIL_APP_PASSWORD on the server.")
    to = str(to).strip()
    if not re.fullmatch(r"[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+", to):
        raise ValueError("That email address doesn't look right.")
    recent = [t for t in SENT_TIMES.get(uid, []) if t > time.time() - 3600]
    if len(recent) >= 20:
        raise ValueError("That's 20 emails this hour — wait a bit before sending more.")
    msg = EmailMessage()
    msg["From"] = secret("EMAIL_ADDRESS")
    msg["To"] = to
    msg["Subject"] = str(subject)[:200]
    msg.set_content(str(body)[:20000])
    host = secret("SMTP_HOST") or "smtp.gmail.com"
    with smtplib.SMTP_SSL(host, int(secret("SMTP_PORT") or 465), context=ssl.create_default_context(), timeout=30) as s:
        s.login(secret("EMAIL_ADDRESS"), secret("EMAIL_APP_PASSWORD"))
        s.send_message(msg)
    SENT_TIMES[uid] = recent + [time.time()]
    return True


def connector_status():
    return {"stripe": bool(stripe_key()), "google": google_ready(),
            "calendar": google_ready() or bool(secret("GOOGLE_CALENDAR_ICS_URL") or secret("CALENDAR_ICS_URL")),
            "calendar_source": "google" if google_ready() else ("ics" if (secret("GOOGLE_CALENDAR_ICS_URL") or secret("CALENDAR_ICS_URL")) else None),
            "drive": google_ready(), "email": email_ready(),
            "daily_backup": daily_backup_on(), "backup_hour": backup_hour()}


# ================================================================ BRIEFING
def morning_briefing(uid, name="George"):
    now = now_local()
    by = records_by_kind(uid)
    today = now.date()
    hello = "Good morning" if now.hour < 12 else "Good afternoon" if now.hour < 17 else "Good evening"
    sections, spoken = [], [f"{hello}, {name}. It's {now.strftime('%A, %B')} {now.day}."]

    try:
        cal = calendar_events(1)
    except Exception as e:
        cal = {"connected": True, "error": _short_err(e), "events": []}
    appts = [r["data"] for r in by.get("appointments", []) if str(r["data"].get("date", ""))[:10] == today.isoformat() and r["data"].get("status") != "Cancelled"]
    items = []
    for e in cal.get("events", []):
        items.append(("All day" if e["all_day"] else _clock(e["start"])) + " — " + e["title"])
    for a in appts:
        items.append((a.get("time") or "Today") + " — " + str(a.get("title")) + (f" with {a['customer']}" if a.get("customer") else ""))
    sections.append({"title": "Today's schedule", "items": items or ["Nothing on the calendar today."],
                     "note": cal.get("error") and "Couldn't reach your calendar: " + cal["error"]})
    spoken.append(f"You have {len(items)} thing{'s' if len(items) != 1 else ''} on today." if items else "Your calendar is clear today.")
    if items:
        spoken.append("First up: " + items[0] + ".")

    end_today = dt.datetime(today.year, today.month, today.day, 23, 59, tzinfo=tz()).timestamp()
    rem = due_reminders(uid, now_ts=end_today)
    sections.append({"title": "Reminders", "items": [f"{_clock_ts(r['due_ts'])} — {r['title']}" for r in rem] or ["No reminders today."]})
    if rem:
        spoken.append(f"{len(rem)} reminder{'s' if len(rem) != 1 else ''} today, starting with {rem[0]['title']}.")

    tasks = [r["data"] for r in by.get("tasks", []) if r["data"].get("done") not in (True, "true")]
    due_now = [t for t in tasks if _date(t.get("due")) and _date(t.get("due")) <= today]
    high = [t for t in tasks if t.get("priority") == "High" and t not in due_now]
    sections.append({"title": "Tasks", "items": [f"{t.get('title')} (due {t.get('due')})" for t in due_now[:8]] + [f"{t.get('title')} (high priority)" for t in high[:4]] or ["No tasks due."]})
    if due_now:
        spoken.append(f"{len(due_now)} task{'s' if len(due_now) != 1 else ''} due or past due.")

    tx = [r["data"] for r in by.get("transactions", [])]
    month = [t for t in tx if _date(t.get("date")) and _date(t.get("date")).replace(day=1) == today.replace(day=1)]
    inc = sum(_num(t.get("amount")) for t in month if t.get("kind") == "Income")
    exp = sum(_num(t.get("amount")) for t in month if t.get("kind") == "Expense")
    owed = sum(_num(r["data"].get("amount")) for r in by.get("invoices", []) if r["data"].get("status") not in ("Paid", "Draft"))
    money_items = [f"This month: ${inc:,.2f} in, ${exp:,.2f} out (your entered figures).", f"Owed to you on invoices: ${owed:,.2f}."]
    stripe = stripe_summary()
    if stripe.get("connected"):
        if stripe.get("error"):
            money_items.append(stripe["error"])
        else:
            money_items.append(f"Stripe: ${stripe['sales_24h']:,.2f} in the last 24 hours ({stripe['count_24h']} sale{'s' if stripe['count_24h'] != 1 else ''}), ${stripe['available']:,.2f} available.")
            spoken.append(f"Stripe brought in {stripe['sales_24h']:,.2f} dollars in the last day.")
    sections.append({"title": "Money", "items": money_items})
    bills = [b for b in bills_status(uid) if b["days_left"] is not None and b["days_left"] <= 7]
    if bills:
        sections.append({"title": "Bills to approve", "items": [f"{b['payee']} — ${b['amount']:,.2f}, due {b['due']} ({b['account']})" for b in bills]})
        spoken.append(f"{len(bills)} bill{'s' if len(bills) != 1 else ''} due this week — I'll wait for your yes before any is paid.")

    mail = email_inbox(5)
    if mail.get("connected"):
        if mail.get("error"):
            sections.append({"title": "Email", "items": [mail["error"]]})
        else:
            sections.append({"title": "Email", "items": [f"{mail['unread']} unread."] + [f"{m['from']}: {m['subject']}" for m in mail["latest"]]})
            if mail["unread"]:
                spoken.append(f"You have {mail['unread']} unread email{'s' if mail['unread'] != 1 else ''}.")

    alerts = business_watch(uid, stripe)
    sections.append({"title": "Business watch", "items": [a["text"] for a in alerts[:6]] or ["Nothing needs your attention. Everything looks good."]})
    hi = [a for a in alerts if a["level"] == "high"]
    if hi:
        spoken.append("Heads up: " + hi[0]["text"])
    elif not alerts:
        spoken.append("Business watch says everything looks good.")
    spoken.append("That's your briefing. What would you like to do first?")
    return {"generated": int(time.time()), "date": today.isoformat(), "sections": sections, "spoken": " ".join(spoken), "alerts": alerts}


def _clock(iso):
    try:
        d = dt.datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        if d.tzinfo:
            d = d.astimezone(tz())
        return d.strftime("%I:%M %p").lstrip("0")
    except ValueError:
        return str(iso)


def _clock_ts(ts):
    return dt.datetime.fromtimestamp(ts, tz()).strftime("%I:%M %p").lstrip("0")


# ================================================================ RECEIPTS
RECEIPT_CATEGORIES = ["Supplies", "Materials", "Fuel", "Meals", "Tools", "Office", "Software", "Advertising", "Travel", "Utilities", "Rent", "Repairs", "Shipping", "Other"]
RECEIPT_PROMPT = ("Read this receipt. Reply with ONLY a JSON object, no other words, with these keys: "
                  "vendor (string), date (YYYY-MM-DD or empty), subtotal (number or null), tax (number or null), "
                  "total (number), payment (string, e.g. 'Visa ending 1234' or 'cash', or empty), "
                  "category (one of: " + ", ".join(RECEIPT_CATEGORIES) + "), "
                  "items (list of {name, price}, at most 15), confidence ('high', 'medium' or 'low'). "
                  "If it is not a receipt, reply {\"error\": \"not a receipt\"}.")


def read_receipt(image_b64, media_type, providers):
    if media_type not in ("image/jpeg", "image/png", "image/webp", "image/gif"):
        raise ValueError("Send a JPG, PNG or WEBP photo of the receipt.")
    base64.b64decode(image_b64[:100] + "=" * (-len(image_b64[:100]) % 4))  # sanity check only
    if "anthropic" in providers or "opus" in providers:
        p = "anthropic" if "anthropic" in providers else "opus"
        content = [{"type": "image", "source": {"type": "base64", "media_type": media_type, "data": image_b64}},
                   {"type": "text", "text": RECEIPT_PROMPT}]
    elif "openai" in providers:
        p = "openai"
        content = [{"type": "text", "text": RECEIPT_PROMPT},
                   {"type": "image_url", "image_url": {"url": f"data:{media_type};base64,{image_b64}"}}]
    else:
        raise LookupError("no brain")
    text = _call_ai(p, "You read receipts accurately and reply with JSON only.", [{"role": "user", "content": content}])
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise ValueError("I couldn't read that receipt — try a clearer, flatter photo.")
    d = json.loads(m.group(0))
    if d.get("error"):
        raise ValueError("That doesn't look like a receipt.")
    if d.get("category") not in RECEIPT_CATEGORIES:
        d["category"] = "Other"
    d["items"] = [i for i in (d.get("items") or []) if isinstance(i, dict)][:15]
    d["brain"] = p
    return d


# ================================================================ BACKUPS
def daily_backup_on():
    return os.getenv("CONNIE_DAILY_BACKUP", "1") != "0"


def backup_hour():
    try:
        return max(0, min(23, int(os.getenv("CONNIE_BACKUP_HOUR", "2"))))
    except ValueError:
        return 2


def backup_dir(db_path):
    d = Path(os.getenv("CONNIE_BACKUP_DIR", str(Path(db_path).parent / "connie_backups")))
    d.mkdir(parents=True, exist_ok=True)
    return d


def backup_user(uid, db_path, version="1.2"):
    with _connect() as c:
        rows = c.execute("SELECT id,kind,payload,created,updated FROM records WHERE owner=? ORDER BY created", (uid,)).fetchall()
    recs = [{"id": r[0], "kind": r[1], "data": json.loads(r[2]), "created": r[3], "updated": r[4]} for r in rows]
    stamp = now_local().strftime("%Y-%m-%d")
    blob = json.dumps({"app": "George's Assistant — Connie", "version": version, "backup_of_user": uid,
                       "exported": int(time.time()), "records": recs}, indent=1).encode()
    name = f"connie-backup-{stamp}.json"
    folder = backup_dir(db_path)
    local = folder / f"user{uid}-{name}"
    local.write_bytes(blob)
    try:
        os.chmod(local, 0o600)
    except OSError:
        pass
    old = sorted(folder.glob(f"user{uid}-connie-backup-*.json"))
    for f in old[:-14]:
        try:
            f.unlink()
        except OSError:
            pass
    result = {"date": stamp, "records": len(recs), "local": True, "drive": False, "time": int(time.time())}
    if google_ready():
        try:
            up = drive_upload(name, blob, "application/json", drive_folder(uid))
            result.update(drive=True, drive_link=up.get("webViewLink"), drive_name=up.get("name"))
        except Exception as e:
            result["drive_error"] = _short_err(e)
    else:
        result["drive_error"] = "Google Drive is not connected yet — saved on Connie's own disk only."
    kv_set(uid, "last_backup", result)
    with _connect() as c:
        _audit(c, uid, "backup", f"{len(recs)} records, drive={result['drive']}")
        c.commit()
    return result


_BACKUP_THREAD = {"started": False}


def start_daily_backup(db_path):
    """George asked for this: every night, a backup of his records goes to
    his Google Drive. Runs once a day after CONNIE_BACKUP_HOUR (local)."""
    if _BACKUP_THREAD["started"] or not daily_backup_on():
        return
    _BACKUP_THREAD["started"] = True

    def loop():
        while True:
            try:
                now = now_local()
                if now.hour >= backup_hour():
                    with _connect() as c:
                        uids = [r[0] for r in c.execute("SELECT id FROM users").fetchall()]
                    for uid in uids:
                        last = kv_get(uid, "last_backup") or {}
                        if last.get("date") != now.strftime("%Y-%m-%d"):
                            backup_user(uid, db_path)
            except Exception:
                pass
            time.sleep(600)

    threading.Thread(target=loop, daemon=True, name="connie-daily-backup").start()


# ================================================================ BUSINESS BOOKS (separate accounts)
# George, 2026-11-21: every business keeps its own money — what comes in,
# what goes out, where it goes, profit or loss, and its own tax reserve.
# A transaction's "account" says which business it belongs to.
DEFAULT_ACCOUNTS = ["George's Little Handy Books", "ALI — All-in-One Superbot", "People's Bot",
                    "GDP — George's Digital Products", "Next Gen Production & Studios",
                    "G.W. Clothing Co", "George's Ad Agency — Gillette", "Personal"]


def account_names(by):
    names = list(DEFAULT_ACCOUNTS)
    for kind in ("transactions", "bills", "invoices"):
        for r in by.get(kind, []):
            a = str(r["data"].get("account") or "").strip()
            if a and a not in names:
                names.append(a)
    return names


def business_books(uid, tax_rate=25.0, year=None, month=None):
    """Money in, money out, profit/loss and tax set-aside for each account."""
    by = records_by_kind(uid)
    out = {}
    for name in account_names(by) + ["Unsorted"]:
        out[name] = {"account": name, "income": 0.0, "expenses": 0.0, "by_category": {}, "count": 0, "bills_due": 0.0}

    def in_period(d):
        if not d:
            return year is None
        if year and d.year != year:
            return False
        if month and d.month != month:
            return False
        return True

    for r in by.get("transactions", []):
        t = r["data"]
        d = _date(t.get("date"))
        if not in_period(d):
            continue
        acct = str(t.get("account") or "").strip() or "Unsorted"
        row = out.setdefault(acct, {"account": acct, "income": 0.0, "expenses": 0.0, "by_category": {}, "count": 0, "bills_due": 0.0})
        amt = _num(t.get("amount"))
        row["count"] += 1
        if t.get("kind") == "Income":
            row["income"] += amt
        else:
            row["expenses"] += amt
            cat = str(t.get("category") or "Other")
            row["by_category"][cat] = row["by_category"].get(cat, 0.0) + amt
    for r in by.get("bills", []):
        b = r["data"]
        if b.get("status") != "Paid":
            acct = str(b.get("account") or "").strip() or "Unsorted"
            out.setdefault(acct, {"account": acct, "income": 0.0, "expenses": 0.0, "by_category": {}, "count": 0, "bills_due": 0.0})
            out[acct]["bills_due"] += _num(b.get("amount"))
    rows = []
    for row in out.values():
        if row["account"] == "Unsorted" and not row["count"] and not row["bills_due"]:
            continue
        row["profit"] = row["income"] - row["expenses"]
        row["tax_reserve"] = max(0.0, row["profit"]) * tax_rate / 100
        row["status"] = "making money" if row["profit"] > 0 else "losing money" if row["profit"] < 0 else "even"
        rows.append(row)
    total = {k: sum(r[k] for r in rows) for k in ("income", "expenses", "profit", "tax_reserve", "bills_due")}
    return {"accounts": rows, "total": total, "tax_rate": tax_rate,
            "note": "From the figures you entered (and Stripe when connected) — estimates, not bank balances, and not tax advice."}


# ================================================================ BILLS — ask first, always
# Connie tracks bills that come in under George's name and ASKS him
# before any bill is paid. She never pays on her own. No bank is
# connected in this build, so "Yes, pay it" marks the bill approved and
# George pays it himself (or his bank's bill-pay does); "Mark paid"
# records the payment as an expense in that bill's account.
def bills_status(uid):
    by = records_by_kind(uid)
    today = now_local().date()
    out = []
    for r in by.get("bills", []):
        b = r["data"]
        if b.get("status") == "Paid":
            continue
        due = _date(b.get("due"))
        days = (due - today).days if due else None
        out.append({"id": r["id"], "payee": b.get("payee") or "Bill", "amount": _num(b.get("amount")), "due": b.get("due"),
                    "account": b.get("account") or "Unsorted", "status": b.get("status") or "Waiting for George",
                    "days_left": days, "late": days is not None and days < 0})
    return sorted(out, key=lambda x: (x["days_left"] is None, x["days_left"] if x["days_left"] is not None else 0))
