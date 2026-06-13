"""
Timetable store — multi-turn guided flow to identify the user's class,
then passes the timetable as context to Groq LLM to answer ANY question.

Flow:
  1. Detect timetable intent (or active session)
  2. Ask Year → Branch → Section until class is resolved
  3. Build a compact text representation of the timetable
  4. Send to Groq: "Given this timetable, answer: <user question>"
  5. Return the LLM's focused answer
"""
import json
import os
import re
from datetime import date, datetime
from typing import Optional

_HERE = os.path.dirname(os.path.abspath(__file__))
STORE_PATH   = os.path.normpath(os.path.join(_HERE, '..', 'data', 'timetables.json'))
SESSION_PATH = os.path.normpath(os.path.join(_HERE, '..', 'data', 'timetable_sessions.json'))

WEEKDAY_TO_ABBR = ["Mo", "Tu", "We", "Th", "Fr"]
DAY_FULL = {"Mo": "Monday", "Tu": "Tuesday", "We": "Wednesday", "Th": "Thursday", "Fr": "Friday"}

TIMETABLE_INTENTS = [
    'class', 'classroom', 'room', 'lecture', 'timetable', 'schedule',
    'subject', 'slot', 'period', 'today', 'tomorrow',
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday',
    'free', 'gap', 'break', 'next class', 'when is', 'where is',
    'what do i have', 'my schedule', 'my class', 'which subject',
    'who teaches', 'how many class', 'how many period', 'how many lab',
    'first class', 'last class',
]

# Queries that should NEVER be handled by timetable, even inside an active session
TIMETABLE_ESCAPE = [
    'faculty info', 'about faculty', 'tell me about', 'who is', 'details of',
    'profile of', 'mentor', 'mentee', 'fee', 'fees', 'admission',
    'professor', 'dr.', 'sir teach', 'sir profile',
]

# ── persistence ────────────────────────────────────────────────────────────────

def _load() -> dict:
    if os.path.exists(STORE_PATH):
        try:
            with open(STORE_PATH, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def _save(data: dict):
    os.makedirs(os.path.dirname(STORE_PATH), exist_ok=True)
    with open(STORE_PATH, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"[Timetable] Written to {STORE_PATH}")


def save_timetable(parsed_result: dict):
    store = _load()
    for tt in parsed_result.get('timetables', []):
        class_name = (tt.get('class') or '').strip()
        if not class_name:
            class_name = f"Page {tt.get('page', '?')}"
        store[class_name] = tt
    _save(store)
    print(f"[Timetable] Saved {len(store)} class(es) to {STORE_PATH}")
    return list(store.keys())


def get_all_classes() -> list:
    return list(_load().keys())


# ── session state ──────────────────────────────────────────────────────────────

def _load_sessions() -> dict:
    if os.path.exists(SESSION_PATH):
        try:
            with open(SESSION_PATH, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def _save_sessions(s: dict):
    os.makedirs(os.path.dirname(SESSION_PATH), exist_ok=True)
    with open(SESSION_PATH, 'w', encoding='utf-8') as f:
        json.dump(s, f, ensure_ascii=False, indent=2)


def _get_session(sid: str) -> dict:
    return _load_sessions().get(sid, {})


def _set_session(sid: str, data: dict):
    s = _load_sessions()
    s[sid] = data
    _save_sessions(s)


def _clear_session(sid: str):
    s = _load_sessions()
    s.pop(sid, None)
    _save_sessions(s)


# ── timetable → compact text ───────────────────────────────────────────────────

# ── LLM answerer ───────────────────────────────────────────────────────────────

def _ask_llm(timetable_text: str, user_question: str, history: list = None) -> str:
    """Send timetable context + user question to Groq and return focused answer."""
    try:
        import os
        from pathlib import Path
        from dotenv import load_dotenv
        from groq import Groq

        env_path = Path(_HERE).parent / '.env'
        load_dotenv(dotenv_path=env_path, override=True)

        api_key = os.environ.get('GROQ_API_KEY', '').strip()
        if not api_key or api_key == "your_groq_api_key_here":
            print(f"[Timetable LLM] No GROQ_API_KEY — env path checked: {env_path}")
            return None

        client = Groq(api_key=api_key)

        system = (
            "You are a university timetable assistant. "
            "Answer the student's question using ONLY the timetable data provided.\n"
            "CRITICAL RULES:\n"
            "- Each column in the timetable is a SEPARATE day. NEVER mix data between columns.\n"
            "- Monday column data is ONLY for Monday. Tuesday column is ONLY for Tuesday. etc.\n"
            "- A cell showing '—' means NO CLASS for that day/slot. Do not invent classes.\n"
            "- Use the VERIFIED CLASS COUNT PER DAY section for counts — do not recount.\n"
            "- 'free periods/slots' = slots where the day column shows '—'.\n"
            "- 'which faculty/teacher' = give teacher name for that slot/day.\n"
            "- 'where is my class' = give room code (e.g. B116) and subject name.\n"
            "- 'after X pm' = only slots starting at or after that time.\n"
            "- 'tomorrow' = use the Tomorrow day shown in the timetable header.\n"
            "- 'today' = use the Today day shown in the timetable header.\n"
            "- When listing classes for a day, ONLY list entries from that day's column.\n"
            "- Be concise. 1-5 lines max unless listing multiple items.\n"
            "- Do NOT include URLs, faculty profile links, or external sources.\n"
            "- If not found in timetable, say 'No class found for that time/day'."
        )

        messages = [{"role": "system", "content": system}]

        # Add recent conversation history so "name them" has context
        if history:
            for h in history[-4:]:
                if h.get('user'):
                    messages.append({"role": "user", "content": h['user']})
                if h.get('assistant'):
                    clean = re.sub(r'<[^>]+>', ' ', h['assistant']).strip()
                    messages.append({"role": "assistant", "content": clean})

        messages.append({
            "role": "user",
            "content": f"TIMETABLE DATA:\n{timetable_text}\n\nSTUDENT QUESTION: {user_question}"
        })

        print(f"[Timetable LLM] Calling Groq for: '{user_question[:80]}'")
        resp = client.chat.completions.create(
            messages=messages,
            model="llama-3.1-8b-instant",
            max_tokens=400,
            temperature=0.0,
        )
        answer = resp.choices[0].message.content.strip()
        print(f"[Timetable LLM] Answer: {answer[:120]}")

        answer = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', answer)
        answer = re.sub(r'\*(.+?)\*', r'<em>\1</em>', answer)
        answer = answer.replace('\n', '<br>')
        return f"<div>{answer}</div>"

    except Exception as e:
        print(f"[Timetable LLM] Exception: {type(e).__name__}: {e}")
        return None


# ── class name parsing / filtering ────────────────────────────────────────────

def _parse_class_name(name: str) -> dict:
    n = name.lower()
    year = next((y for y in ['1st', '2nd', '3rd', '4th', '5th'] if y in n), None)
    degree = next((d for d in ['b.tech', 'bca', 'mca', 'm.tech', 'b.sc', 'm.sc', 'diploma', 'bba', 'mba'] if d in n), None)
    branch = next((b for b in ['cse', 'ece', 'me', 'ce', 'bme', 'data science', 'fire and safety',
                                'aerospace', 'biotechnology', 'microbiology', 'f.sc', 'aiml'] if b in n), None)
    sec_m = re.search(r'\(([^)]+)\)', name)
    section = sec_m.group(1).strip() if sec_m else None
    if not section:
        m2 = re.search(r'\b([A-Z][A-Z0-9]?|Core|DA|ML|SI)\b\.?$', name.strip())
        section = m2.group(1) if m2 else None
    return {'year': year, 'degree': degree, 'branch': branch, 'section': section}


def _filter_classes(year=None, degree=None, branch=None, section=None) -> list:
    store = _load()
    results = []
    for name in store:
        p = _parse_class_name(name)
        if year and p['year'] and year.lower() not in p['year']:
            continue
        if degree and p['degree'] and degree.lower() not in (p['degree'] or ''):
            continue
        # branch can match either the branch field OR the degree field
        # e.g. user says "diploma" → matches degree='diploma'
        # user says "cse" → matches branch='cse'
        if branch:
            branch_l = branch.lower()
            matches_branch = p['branch'] and branch_l in (p['branch'] or '')
            matches_degree = p['degree'] and branch_l in (p['degree'] or '')
            if not matches_branch and not matches_degree:
                continue
        if section and p['section'] and section.lower() not in (p['section'] or '').lower():
            continue
        results.append(name)
    return results


def _unique_branches(names: list) -> list:
    seen, out = set(), []
    for name in names:
        p = _parse_class_name(name)
        # Build a readable label
        degree = p.get('degree') or ''
        branch = p.get('branch') or ''
        key = f"{degree} {branch}".strip()
        if not key or key == ' ':
            continue  # skip entries with no identifiable branch
        if key not in seen:
            seen.add(key)
            out.append(key)
    return out


def _unique_sections(names: list) -> list:
    """Return clean section labels for display."""
    seen, out = set(), []
    for name in names:
        p = _parse_class_name(name)
        sec = p.get('section')
        # Use section code if available, else strip year/degree for cleaner label
        if sec:
            label = sec
        else:
            label = re.sub(r'^(1st|2nd|3rd|4th|5th)\s+year\s+', '', name.strip().rstrip('.'), flags=re.I).strip()
        if label not in seen:
            seen.add(label)
            out.append(label)
    return out


def _match_branch_from_reply(msg: str, year: str = None) -> Optional[str]:
    branch_keywords = [
        ('diploma cse', 'diploma'), ('diploma', 'diploma'),
        ('cse', 'cse'), ('ece', 'ece'), ('bme', 'bme'), ('data science', 'data science'),
        ('fire', 'fire and safety'), ('aerospace', 'aerospace'),
        ('biotechnology', 'biotechnology'), ('microbiology', 'microbiology'),
        ('aiml', 'aiml'), ('bca', 'bca'), ('mca', 'mca'),
        ('b.tech', 'b.tech'), ('btech', 'b.tech'), ('b.sc', 'b.sc'), ('bsc', 'b.sc'),
        ('m.sc', 'm.sc'), ('msc', 'm.sc'), ('m.tech', 'm.tech'),
        ('computer science', 'cse'), ('me ', 'me'), ('ce ', 'ce'),
    ]
    for kw, mapped in branch_keywords:
        if kw in msg:
            return mapped
    store = _load()
    candidates = _filter_classes(year=year) if year else list(store.keys())
    for b in _unique_branches(candidates):
        if any(w in msg for w in b.lower().split() if len(w) > 1):
            return b.split()[-1]
    return None


def _match_section_from_reply(msg: str, candidates: list) -> Optional[str]:
    """Match user's section reply to a class name."""
    msg_up = msg.upper().strip()
    msg_lower = msg.lower().strip()

    # Exact section match (e.g. "AIML A", "DA", "ML", "B1", "Core")
    for name in candidates:
        p = _parse_class_name(name)
        sec = (p.get('section') or '').upper()
        if sec and (sec == msg_up or sec in msg_up):
            return name

    # Match significant words from class name (e.g. "aiml a", "diploma cse")
    for name in candidates:
        words = [w for w in re.findall(r'\w+', name.lower())
                 if len(w) > 2 and w not in ('year', 'the', 'and', 'sec', 'section', 'btech', 'bca')]
        if sum(1 for w in words if w in msg_lower) >= 2:
            return name

    # Single candidate
    if len(candidates) == 1:
        return candidates[0]
    return None


def _extract_inline_filters(msg: str) -> dict:
    m = msg.lower()
    filters = {}
    for y in ['1st', '2nd', '3rd', '4th', '5th', 'first', 'second', 'third', 'fourth']:
        if y in m:
            filters['year'] = {'first': '1st', 'second': '2nd', 'third': '3rd', 'fourth': '4th'}.get(y, y)
            break
    for d in ['b.tech', 'btech', 'bca', 'mca', 'm.tech', 'b.sc', 'bsc', 'm.sc', 'diploma']:
        if d in m:
            filters['degree'] = d.replace('btech', 'b.tech').replace('bsc', 'b.sc').replace('msc', 'm.sc').replace('mtech', 'm.tech')
            break
    for b in ['cse', 'ece', 'me', 'bme', 'ce', 'data science', 'fire', 'aerospace',
              'biotechnology', 'microbiology', 'aiml']:
        if b in m:
            filters['branch'] = b
            break
    sec = re.search(r'\b(sec(?:tion)?\s*([a-z]\d?)|([a-z]\d)|da|ml|core|si)\b', m)
    if sec:
        filters['section'] = (sec.group(2) or sec.group(3) or sec.group(1)).upper()
    return filters


# ── intent detection ───────────────────────────────────────────────────────────

def is_timetable_intent(msg: str) -> bool:
    m = msg.lower()
    return any(k in m for k in TIMETABLE_INTENTS)


def is_timetable_escape(msg: str) -> bool:
    """Returns True if this message should bypass timetable even in an active session."""
    m = msg.lower()
    return any(k in m for k in TIMETABLE_ESCAPE)


def has_active_timetable_session(session_id: str) -> bool:
    """Returns True if this session is mid-flow in the timetable guided conversation."""
    if not session_id:
        return False
    state = _get_session(session_id)
    return bool(state)


# ── main entry point ───────────────────────────────────────────────────────────

def answer_timetable_query(user_message: str, session_id: str = None, history: list = None) -> Optional[str]:
    """
    Returns HTML answer string, or None to fall through to general RAG.
    """
    msg = user_message.lower().strip()
    store = _load()
    state = _get_session(session_id) if session_id else {}
    step = state.get('step')

    # ── If class already remembered, answer directly ──────────────────────────
    remembered = state.get('remembered_class')
    if remembered and not step:
        # Farewell
        if re.match(r'^(bye|goodbye|quit|exit|see you|cya|later|thanks|thank you)[\s!.?]*$', msg):
            _clear_session(session_id)
            return "<div>👋 Goodbye! Feel free to ask anytime. Have a great day!</div>"

        # Clear session on greetings
        if re.match(r'^(hi|hello|hey|good\s*(morning|evening|afternoon)|howdy)[\s!.?]*$', msg):
            _clear_session(session_id)
            return None

        # User correcting their class — restart guided flow
        if re.search(r'\b(no|wrong|actually|i am|i\'m)\b', msg, re.I) and \
           re.search(r'\b(1st|2nd|3rd|4th|5th|first|second|third|fourth|bca|btech|b\.tech|mca|cse|ece)\b', msg, re.I):
            _clear_session(session_id)
            state = {'step': 'ask_year', 'original_query': user_message}
            _set_session(session_id, state)
            return (
                "<div>No problem! Let me look up your correct timetable. 📅<br><br>"
                "Which <strong>year</strong> are you in?<br>"
                "<em>e.g. 1st, 2nd, 3rd, 4th</em></div>"
            )

        # "change timetable / switch class" — restart
        if re.search(r'\b(change|switch|different|another|other)\s+(class|timetable|section|year|branch)\b', msg, re.I):
            _clear_session(session_id)
            state = {'step': 'ask_year', 'original_query': user_message}
            _set_session(session_id, state)
            return (
                "<div>Sure! Let's find your timetable. 📅<br><br>"
                "Which <strong>year</strong> are you in?<br>"
                "<em>e.g. 1st, 2nd, 3rd, 4th</em></div>"
            )

        # Route to timetable only for actual timetable questions or short follow-up words
        # NOT for faculty info, mentor queries, general "tell me about X" questions
        FOLLOWUP_WORDS = {'name', 'list', 'when', 'where', 'what', 'which',
                          'count', 'total', 'all', 'today', 'tomorrow', 'monday',
                          'tuesday', 'wednesday', 'thursday', 'friday', 'labs', 'free'}
        if not is_timetable_escape(msg) and (
            is_timetable_intent(msg) or msg.lower().strip() in FOLLOWUP_WORDS
        ):
            return _answer_with_llm(remembered, user_message, session_id, history=history)
        # Otherwise fall through to RAG (faculty, mentor, fees, etc.)
        return None

    # ── Active session: continue guided flow ──────────────────────────────────
    if step == 'ask_year':
        for y in ['1st', '2nd', '3rd', '4th', '5th', 'first', 'second', 'third', 'fourth']:
            if y in msg:
                norm = {'first': '1st', 'second': '2nd', 'third': '3rd', 'fourth': '4th'}.get(y, y)
                state['year'] = norm
                break
        if 'year' not in state:
            return "<div>Please reply with your year — e.g. <strong>1st</strong>, <strong>2nd</strong>, <strong>3rd</strong>.</div>"
        state['step'] = 'ask_branch'
        _set_session(session_id, state)
        matches = _filter_classes(year=state['year'])
        return _ask_branch(_unique_branches(matches))

    if step == 'ask_branch':
        matched = _match_branch_from_reply(msg, state.get('year'))
        if not matched:
            matches = _filter_classes(year=state.get('year'))
            return f"<div>Please choose from:<br><strong>{', '.join(_unique_branches(matches))}</strong></div>"
        state['branch'] = matched
        state['step'] = 'ask_section'
        _set_session(session_id, state)
        matches = _filter_classes(year=state.get('year'), branch=matched)
        if len(matches) == 1:
            return _answer_with_llm(matches[0], state.get('original_query', user_message), session_id, history=history)
        return _ask_section(_unique_sections(matches))

    if step == 'ask_section':
        matches = _filter_classes(year=state.get('year'), branch=state.get('branch'))
        chosen = _match_section_from_reply(msg, matches)
        if not chosen:
            return f"<div>Please choose your section: <strong>{', '.join(_unique_sections(matches))}</strong></div>"
        return _answer_with_llm(chosen, state.get('original_query', user_message), session_id, history=history)

    # ── No active session — check intent ──────────────────────────────────────
    # Handle farewell even without active session
    if re.match(r'^(bye|goodbye|quit|exit|see you|cya|later)[\s!.?]*$', msg):
        return "<div>👋 Goodbye! Come back anytime. Have a great day!</div>"

    if not is_timetable_intent(msg):
        return None

    if not store:
        return (
            "<div>No timetable uploaded yet. "
            "Ask an admin to upload via <strong>Admin Panel → Timetable</strong>.</div>"
        )

    # Try inline filters first
    inline = _extract_inline_filters(user_message)
    if inline:
        matches = _filter_classes(**inline)
        if len(matches) == 1:
            return _answer_with_llm(matches[0], user_message, session_id)
        if len(matches) > 1:
            if 'year' in inline and 'branch' not in inline:
                state = {'step': 'ask_branch', 'year': inline['year'], 'original_query': user_message}
                _set_session(session_id, state)
                return _ask_branch(_unique_branches(matches))
            if 'year' in inline and 'branch' in inline:
                state = {'step': 'ask_section', 'year': inline['year'], 'branch': inline['branch'], 'original_query': user_message}
                _set_session(session_id, state)
                return _ask_section(_unique_sections(matches))

    # Start guided flow
    state = {'step': 'ask_year', 'original_query': user_message}
    _set_session(session_id, state)
    return (
        "<div>I can help with your timetable! 📅<br><br>"
        "Which <strong>year</strong> are you in?<br>"
        "<em>e.g. 1st, 2nd, 3rd, 4th</em></div>"
    )


# ── LLM answer ─────────────────────────────────────────────────────────────────

def _answer_with_llm(class_name: str, original_query: str, session_id: str, history: list = None) -> str:
    """Resolve class → answer query. Uses HTML tables for display requests, LLM for everything else."""
    if session_id:
        _set_session(session_id, {'remembered_class': class_name})

    store = _load()
    tt = store.get(class_name)
    if not tt:
        return f"<div>Timetable not found for <strong>{class_name}</strong>.</div>"

    schedule = tt.get('schedule', [])
    msg = original_query.lower()

    # ── Direct HTML rendering for display requests (no LLM needed) ────────────
    # Full timetable
    if any(p in msg for p in ['full timetable', 'full schedule', 'show timetable', 'show schedule',
                               'give me timetable', 'give timetable', 'entire timetable']):
        return _render_full_table(class_name, schedule)

    # Day-specific timetable display
    day = _detect_day_from_msg(msg)
    if day and any(p in msg for p in ['timetable for', 'schedule for', 'timetable on', 'schedule on',
                                       'classes on', 'class on', 'monday timetable', 'tuesday timetable',
                                       'wednesday timetable', 'thursday timetable', 'friday timetable']):
        return _render_day_table(class_name, day, schedule)

    # ── LLM for everything else ────────────────────────────────────────────────
    timetable_text = _timetable_to_text(tt)
    answer = _ask_llm(timetable_text, original_query, history=history)

    if answer:
        return answer
    return _render_full_table(class_name, schedule)


# ── timetable → compact text ───────────────────────────────────────────────────

def _is_valid_class(val: str) -> bool:
    """Return True if a cell value is a real class, not a fragment."""
    if not val or val == '—':
        return False
    val = val.strip()
    if len(val) <= 3:
        return False
    if re.match(r'^B\d{3}[A-Z]?$', val):  # room-only like B116
        return False
    if re.match(r'^[A-Z]\s', val) and len(val) < 6:  # fragment like "L Ms."
        return False
    return True


def _timetable_to_text(tt: dict) -> str:
    """
    Build timetable text for LLM. Uses a DAY-FIRST format to prevent
    the LLM from mixing up columns.
    """
    class_name = tt.get('class', 'Unknown')
    schedule = tt.get('schedule', [])
    legend = tt.get('legend', {})

    now = datetime.now()
    today_idx = now.weekday()
    today_abbr = WEEKDAY_TO_ABBR[today_idx] if today_idx <= 4 else None
    today_name = DAY_FULL.get(today_abbr, 'Weekend') if today_abbr else 'Weekend'
    tomorrow_idx = today_idx + 1
    tomorrow_abbr = WEEKDAY_TO_ABBR[tomorrow_idx] if tomorrow_idx <= 4 else None
    tomorrow_name = DAY_FULL.get(tomorrow_abbr, 'Weekend') if tomorrow_abbr else 'Weekend'

    days = ["Mo", "Tu", "We", "Th", "Fr"]
    day_names = {"Mo": "MONDAY", "Tu": "TUESDAY", "We": "WEDNESDAY", "Th": "THURSDAY", "Fr": "FRIDAY"}

    lines = [
        f"Class: {class_name}",
        f"Today: {today_name} | Tomorrow: {tomorrow_name} | Current time: {now.strftime('%H:%M')}",
        "",
        "=" * 60,
        "TIMETABLE (organized by day — each section is ONE day only)",
        "=" * 60,
    ]

    # Output day-by-day to prevent column confusion
    for d in days:
        day_label = day_names[d]
        marker = " ← TODAY" if d == today_abbr else (" ← TOMORROW" if d == tomorrow_abbr else "")
        lines.append(f"\n{day_label}{marker}:")
        has_any = False
        for slot in schedule:
            val = slot.get('classes', {}).get(d, '').replace('\n', ' ').strip()
            if _is_valid_class(val):
                lines.append(f"  {slot['time']}: {val}")
                has_any = True
        if not has_any:
            lines.append("  (no classes)")

    # Authoritative counts
    lines.append("\n" + "=" * 60)
    lines.append("VERIFIED CLASS COUNT (do not recount, use these):")
    for d in days:
        valid = [s for s in schedule if _is_valid_class(s.get('classes', {}).get(d, ''))]
        lines.append(f"  {day_names[d]}: {len(valid)} classes")

    if legend:
        lines.append("\nLEGEND:")
        for k, v in legend.items():
            lines.append(f"  {k} = {v}")

    return "\n".join(lines)


# ── formatters ─────────────────────────────────────────────────────────────────

def _ask_branch(branches: list) -> str:
    opts = ''.join(f"<li>{b}</li>" for b in branches)
    return f"<div>What is your <strong>branch / programme</strong>?<ul style='margin:6px 0 0 16px'>{opts}</ul></div>"


def _ask_section(sections: list) -> str:
    opts = ''.join(f"<li>{s}</li>" for s in sections)
    return f"<div>Which <strong>section</strong> are you in?<ul style='margin:6px 0 0 16px'>{opts}</ul></div>"


def _format_full_schedule(class_name: str, schedule: list) -> str:
    return _render_full_table(class_name, schedule)


def _detect_day_from_msg(msg: str) -> Optional[str]:
    """Extract day abbreviation from message text."""
    today_idx = datetime.now().weekday()
    if 'tomorrow' in msg:
        nxt = today_idx + 1
        return WEEKDAY_TO_ABBR[nxt] if nxt <= 4 else None
    if 'today' in msg:
        return WEEKDAY_TO_ABBR[today_idx] if today_idx <= 4 else None
    day_map = {
        "monday": "Mo", "mon": "Mo", "tuesday": "Tu", "tue": "Tu",
        "wednesday": "We", "wed": "We", "thursday": "Th", "thu": "Th",
        "friday": "Fr", "fri": "Fr",
    }
    for k, v in day_map.items():
        if k in msg:
            return v
    return None


def _render_full_table(class_name: str, schedule: list) -> str:
    """Render full week timetable as a styled HTML table."""
    days = ["Mo", "Tu", "We", "Th", "Fr"]
    day_labels = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]

    header_cells = "".join(
        f"<th style='padding:8px 12px;background:#4c1d95;color:#e9d5ff;font-weight:600;white-space:nowrap'>{d}</th>"
        for d in day_labels
    )
    header = (
        f"<tr>"
        f"<th style='padding:8px 12px;background:#4c1d95;color:#e9d5ff;font-weight:600'>Time</th>"
        f"{header_cells}</tr>"
    )

    rows = []
    for s in schedule:
        cells = ""
        has_class = False
        for d in days:
            val = s.get('classes', {}).get(d, '')
            if val:
                has_class = True
                # Format: room + subject + faculty on separate lines
                parts = val.replace('\n', '<br>').strip()
                cells += f"<td style='padding:6px 10px;font-size:12px;color:#c4b5fd'>{parts}</td>"
            else:
                cells += "<td style='padding:6px 10px;color:#4b5563;text-align:center'>—</td>"
        row_bg = "background:#1e1b4b" if has_class else "background:#111827"
        rows.append(
            f"<tr style='{row_bg};border-bottom:1px solid #374151'>"
            f"<td style='padding:6px 10px;color:#9ca3af;white-space:nowrap;font-size:12px'>{s['time']}</td>"
            f"{cells}</tr>"
        )

    return (
        f"<div style='overflow-x:auto'>"
        f"<p style='color:#a78bfa;font-weight:600;margin-bottom:8px'>{class_name}</p>"
        f"<table style='border-collapse:collapse;width:100%;font-size:12px'>"
        f"<thead>{header}</thead>"
        f"<tbody>{''.join(rows)}</tbody>"
        f"</table></div>"
    )


def _render_day_table(class_name: str, day: str, schedule: list) -> str:
    """Render a single day's timetable as a styled HTML table."""
    day_name = DAY_FULL.get(day, day)
    rows = []
    for s in schedule:
        val = s.get('classes', {}).get(day, '')
        if val:
            parts = val.replace('\n', '<br>').strip()
            rows.append(
                f"<tr style='background:#1e1b4b;border-bottom:1px solid #374151'>"
                f"<td style='padding:6px 12px;color:#9ca3af;white-space:nowrap;font-size:12px'>{s['time']}</td>"
                f"<td style='padding:6px 12px;color:#c4b5fd;font-size:12px'>{parts}</td>"
                f"</tr>"
            )

    if not rows:
        return f"<div>No classes on <strong>{day_name}</strong> for <strong>{class_name}</strong>.</div>"

    return (
        f"<div>"
        f"<p style='color:#a78bfa;font-weight:600;margin-bottom:8px'>{class_name} — {day_name}</p>"
        f"<table style='border-collapse:collapse;width:100%'>"
        f"<thead><tr>"
        f"<th style='padding:8px 12px;background:#4c1d95;color:#e9d5ff;text-align:left'>Time</th>"
        f"<th style='padding:8px 12px;background:#4c1d95;color:#e9d5ff;text-align:left'>Class</th>"
        f"</tr></thead>"
        f"<tbody>{''.join(rows)}</tbody>"
        f"</table></div>"
    )
