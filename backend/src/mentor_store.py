"""
Mentor-Mentee store — parses uploaded Excel/CSV and answers
student/faculty queries via Groq LLM.

Strategy:
- ID-based lookup          → exact match, return card
- Mentor list queries      → Python direct render (no LLM, no token limits)
- Student name lookup      → if 1 match: card; if multiple: ask for ID clarification
- Ambiguous/general        → LLM fallback
"""
import json
import os
import re
from pathlib import Path
from typing import Optional, List, Tuple

_HERE = os.path.dirname(os.path.abspath(__file__))
STORE_PATH = os.path.normpath(os.path.join(_HERE, '..', 'data', 'mentor_mentee.json'))

MENTOR_INTENTS = [
    'mentor', 'mentee', 'mentees', 'assigned to', 'under',
    'enrollment', 'enrolment', 'registration', 'admission no',
    'student details', 'show details', 'who is mentor',
    'list students', 'how many students',
]

# ── field aliases ──────────────────────────────────────────────────────────────
_FIELD_ALIASES = {
    'registration_id':    ['registration_id', 'student_registration_id', 'roll_no', 'enrollment_no'],
    'application_number': ['application_number', 'student_application_number', 'admission_no'],
    'name':               ['name', 'student_name'],
    'email':              ['email', 'student_email'],
    'phone':              ['phone', 'student_phone', 'student_phone_number', 'mobile'],
    'programme':          ['programme', 'student_programme', 'program', 'course'],
    'department':         ['department', 'student_department', 'dept'],
    'batch_year':         ['batch_year', 'batch', 'student_batch'],
    'current_year':       ['current_year', 'student_current_year', 'year'],
    'gender':             ['gender', 'student_gender'],
    'quota':              ['quota', 'student_quota'],
    'academic_status':    ['academic_status', 'student_status', 'status'],
    'mentor_name':        ['mentor_name', 'mentor', 'faculty_name', 'assigned_mentor'],
    'mentor_phone':       ['mentor_phone', 'mentor_contact_number', 'mentor_contact', 'mentor_mobile'],
    'mentor_email':       ['mentor_email', 'mentor_email_id'],
}

# Stop words for name extraction
_NAME_STOP = {
    'who', 'what', 'show', 'list', 'give', 'details', 'all', 'the',
    'of', 'and', 'for', 'under', 'assigned', 'mentor', 'mentee',
    'mentees', 'student', 'students', 'sir', 'mam', "ma'am", 'madam',
    'prof', 'professor', 'dr', 'mr', 'ms', 'mrs', 'faculty',
    'how', 'many', 'are', 'is', 'my', 'their', 'his', 'her', 'its',
    'a', 'an', 'to', 'in', 'by', 'with', 'count', 'total', 'number',
    'complete', 'full', 'entire', 'tell', 'about', 'info', 'information',
}

# HTML table style
_TABLE_STYLE = """
<style>
.mm-table{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px}
.mm-table th{background:linear-gradient(135deg,#6d28d9,#4f46e5);color:#fff;
  padding:8px 10px;text-align:left;white-space:nowrap}
.mm-table td{padding:7px 10px;border-bottom:1px solid #334155;color:#cbd5e1;
  vertical-align:top}
.mm-table tr:hover td{background:#1e293b}
.mm-badge{display:inline-block;padding:2px 8px;border-radius:9999px;
  font-size:11px;font-weight:600}
.mm-yr1{background:#1e3a5f;color:#93c5fd}
.mm-yr2{background:#1e3a2f;color:#86efac}
.mm-yr3{background:#3b2a1e;color:#fcd34d}
.mm-yr4{background:#3b1e2a;color:#f9a8d4}
</style>
"""


def _get(record: dict, field: str) -> str:
    """Fetch a field trying all known aliases."""
    for alias in _FIELD_ALIASES.get(field, [field]):
        v = record.get(alias)
        if v is not None and str(v).strip() not in ('', 'None', 'nan'):
            return str(v).strip()
    return ''


def _year_badge(year_str: str) -> str:
    y = year_str.lower()
    cls = 'mm-yr1' if '1' in y else 'mm-yr2' if '2' in y else 'mm-yr3' if '3' in y else 'mm-yr4'
    label = year_str if year_str else '—'
    return f'<span class="mm-badge {cls}">{label}</span>'


# ── persistence ────────────────────────────────────────────────────────────────

def _load() -> dict:
    if os.path.exists(STORE_PATH):
        try:
            with open(STORE_PATH, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return {"students": [], "last_updated": None}


def _save(data: dict):
    os.makedirs(os.path.dirname(STORE_PATH), exist_ok=True)
    with open(STORE_PATH, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"[MentorStore] Written to {STORE_PATH}")


def save_mentor_data(students: list) -> int:
    import datetime
    data = {"students": students, "last_updated": datetime.datetime.now().isoformat()}
    _save(data)
    print(f"[MentorStore] Saved {len(students)} student records")
    if students:
        print(f"[MentorStore] Sample keys: {list(students[0].keys())}")
    return len(students)


def get_all_students() -> list:
    return _load().get("students", [])


# ── intent detection ───────────────────────────────────────────────────────────

def is_mentor_intent(msg: str) -> bool:
    m = msg.lower()
    return any(k in m for k in MENTOR_INTENTS)


# ── lookup helpers ─────────────────────────────────────────────────────────────

def _name_tokens(query: str) -> List[str]:
    return [t for t in re.findall(r"\b[A-Za-z']{2,}\b", query)
            if t.lower() not in _NAME_STOP]


def _find_by_id(students: list, query: str) -> List[dict]:
    """Exact match by registration ID (10-15 digits) or application number."""
    # Strip non-digits for pure number queries like "230160203052"
    digits_only = re.sub(r'\D', '', query)

    # Long registration IDs (10-15 digits)
    reg_match = re.search(r'\b(\d{10,15})\b', query)
    if reg_match:
        rid = reg_match.group(1)
        found = [s for s in students if _get(s, 'registration_id') == rid]
        if found:
            return found

    # Also try stripping spaces/dashes in stored values
    if len(digits_only) >= 10:
        found = [s for s in students
                 if re.sub(r'\D', '', _get(s, 'registration_id')) == digits_only]
        if found:
            return found

    # Application / admission numbers (5-10 digit, optionally prefixed)
    adm_match = re.search(r'\b([A-Z]{0,3}\d{5,10})\b', query, re.I)
    if adm_match:
        adm = re.sub(r'\D', '', adm_match.group(1))
        found = [s for s in students
                 if re.sub(r'\D', '', _get(s, 'application_number')) == adm]
        if found:
            return found

    return []


def _find_by_mentor(students: list, query: str) -> List[dict]:
    """Return all students whose mentor name matches tokens in query."""
    tokens = [t for t in _name_tokens(query) if len(t) >= 3]
    if not tokens:
        return []
    matched = []
    for s in students:
        mentor = _get(s, 'mentor_name').lower()
        if mentor and any(t.lower() in mentor for t in tokens):
            matched.append(s)
    # Deduplicate by registration_id
    seen, deduped = set(), []
    for s in matched:
        key = _get(s, 'registration_id') or id(s)
        if key not in seen:
            seen.add(key)
            deduped.append(s)
    print(f"[MentorStore] _find_by_mentor: tokens={tokens}, found={len(deduped)}")
    return deduped


def _find_by_student_name(students: list, query: str) -> List[dict]:
    """Return students whose name matches tokens. Returns ALL matches (caller handles duplicates)."""
    tokens = [t for t in _name_tokens(query) if len(t) >= 3]
    if not tokens:
        return []
    matched = []
    for s in students:
        sname = _get(s, 'name').lower()
        if sname and any(t.lower() in sname for t in tokens):
            matched.append(s)
    return matched


# ── renderers ─────────────────────────────────────────────────────────────────

def _render_mentee_table(mentees: List[dict], mentor_name: str) -> str:
    """Render full HTML table of mentees."""
    count = len(mentees)
    print(f"[MentorStore] Rendering table for '{mentor_name}': {count} mentees")
    rows = []
    for i, s in enumerate(mentees, 1):
        yr = _get(s, 'current_year')
        prog = _get(s, 'programme')
        prog_short = (prog
            .replace('BACHELOR OF TECHNOLOGY - ', 'B.Tech - ')
            .replace('Bachelor of Technology - ', 'B.Tech - ')
            .replace('BACHELOR OF COMPUTER APPLICATIONS', 'BCA')
            .replace('MASTER OF COMPUTER APPLICATIONS', 'MCA')
            .replace('Master of Computer Application', 'MCA'))
        rows.append(
            f"<tr>"
            f"<td style='color:#94a3b8;text-align:center'>{i}</td>"
            f"<td><strong style='color:#e2e8f0'>{_get(s,'name') or '—'}</strong>"
            f"<br><span style='font-size:11px;color:#64748b'>{_get(s,'email') or ''}</span></td>"
            f"<td style='font-family:monospace;font-size:12px;color:#a78bfa'>{_get(s,'registration_id') or '—'}</td>"
            f"<td style='font-family:monospace;font-size:12px;color:#818cf8'>{_get(s,'application_number') or '—'}</td>"
            f"<td style='font-size:12px;color:#cbd5e1'>{prog_short or '—'}</td>"
            f"<td style='text-align:center'>{_year_badge(yr)}</td>"
            f"</tr>"
        )
    return (
        f"{_TABLE_STYLE}"
        f"<div style='margin-bottom:8px'>"
        f"<span style='color:#a78bfa;font-weight:700;font-size:14px'>Mentees of {mentor_name}</span>"
        f"&nbsp;&nbsp;<span style='background:#1e3a2f;color:#86efac;padding:2px 10px;"
        f"border-radius:9999px;font-size:12px;font-weight:600'>{count} student{'s' if count != 1 else ''}</span>"
        f"</div>"
        f"<div style='overflow-x:auto'>"
        f"<table class='mm-table'><thead><tr>"
        f"<th style='width:32px'>#</th><th>Name</th><th>Reg ID</th>"
        f"<th>App No</th><th>Programme</th><th>Year</th>"
        f"</tr></thead><tbody>{''.join(rows)}</tbody></table></div>"
    )


def _render_student_card(s: dict) -> str:
    """Render a single student's full detail card."""
    def row(label, val):
        if not val:
            return ''
        return (f"<tr><td style='color:#94a3b8;white-space:nowrap;padding:5px 10px'>{label}</td>"
                f"<td style='color:#e2e8f0;padding:5px 10px'>{val}</td></tr>")

    rows = ''.join([
        row('Name',            _get(s, 'name')),
        row('Registration ID', _get(s, 'registration_id')),
        row('Application No',  _get(s, 'application_number')),
        row('Programme',       _get(s, 'programme')),
        row('Department',      _get(s, 'department')),
        row('Batch Year',      _get(s, 'batch_year')),
        row('Current Year',    _get(s, 'current_year')),
        row('Gender',          _get(s, 'gender')),
        row('Email',           _get(s, 'email')),
        row('Phone',           _get(s, 'phone')),
        row('Academic Status', _get(s, 'academic_status')),
        row('Quota',           _get(s, 'quota')),
        row('Mentor Name',     _get(s, 'mentor_name')),
        row('Mentor Phone',    _get(s, 'mentor_phone')),
        row('Mentor Email',    _get(s, 'mentor_email')),
    ])
    return (
        f"{_TABLE_STYLE}"
        f"<div style='color:#a78bfa;font-weight:600;margin-bottom:6px'>Student Details</div>"
        f"<table class='mm-table' style='max-width:600px'><tbody>{rows}</tbody></table>"
    )


def _render_clarification(matches: List[dict], original_query: str) -> str:
    """Ask user to clarify which student they mean when multiple share a name."""
    rows = []
    for i, s in enumerate(matches, 1):
        rows.append(
            f"<tr>"
            f"<td style='color:#94a3b8;text-align:center;padding:6px 10px'>{i}</td>"
            f"<td style='color:#e2e8f0;padding:6px 10px'><strong>{_get(s,'name')}</strong></td>"
            f"<td style='font-family:monospace;color:#a78bfa;padding:6px 10px'>{_get(s,'registration_id') or '—'}</td>"
            f"<td style='font-family:monospace;color:#818cf8;padding:6px 10px'>{_get(s,'application_number') or '—'}</td>"
            f"<td style='color:#cbd5e1;font-size:12px;padding:6px 10px'>{_get(s,'programme')[:40] or '—'}</td>"
            f"<td style='color:#86efac;padding:6px 10px'>{_get(s,'current_year') or '—'}</td>"
            f"</tr>"
        )
    return (
        f"{_TABLE_STYLE}"
        f"<div style='color:#fbbf24;margin-bottom:8px;font-weight:600'>⚠️ Multiple students found with that name.</div>"
        f"<div style='color:#94a3b8;margin-bottom:8px;font-size:13px'>"
        f"Please reply with the <strong style='color:#a78bfa'>Registration ID</strong> or "
        f"<strong style='color:#818cf8'>Application No</strong> to identify the correct student:</div>"
        f"<div style='overflow-x:auto'>"
        f"<table class='mm-table'><thead><tr>"
        f"<th>#</th><th>Name</th><th>Reg ID</th><th>App No</th><th>Programme</th><th>Year</th>"
        f"</tr></thead><tbody>{''.join(rows)}</tbody></table></div>"
    )


# ── main entry point ───────────────────────────────────────────────────────────

def answer_mentor_query(user_message: str) -> Optional[str]:
    """Answer mentor-mentee queries. Returns HTML or None."""
    if not is_mentor_intent(user_message.lower()):
        return None

    students = get_all_students()
    if not students:
        return (
            "<div>No mentor-mentee data uploaded yet. "
            "Please ask an admin to upload the Excel file from "
            "<strong>Admin Panel → Mentor-Mentee</strong> tab.</div>"
        )

    q = user_message.lower()

    # ── A. ID-based lookup (most specific — always exact) ─────────────────────
    id_matches = _find_by_id(students, user_message)
    if id_matches:
        return _render_student_card(id_matches[0])

    # ── B. Mentor/faculty list queries ────────────────────────────────────────
    is_mentor_list_query = any(kw in q for kw in [
        'mentee', 'mentees', 'list', 'under', 'assigned to',
        'how many', 'count', 'students of', 'students under', 'all mentees',
    ])
    if is_mentor_list_query:
        mentor_matches = _find_by_mentor(students, user_message)
        if mentor_matches:
            mentor_name = _get(mentor_matches[0], 'mentor_name')
            return _render_mentee_table(mentor_matches, mentor_name)

    # ── C. Student-specific queries (mentor of X / details of X) ─────────────
    is_student_query = any(kw in q for kw in [
        'who is mentor', 'mentor of', 'details of', 'show details',
        'complete details', 'give details', 'information about',
        'enrollment', 'enrolment', 'registration', 'admission no',
    ])
    if is_student_query:
        student_matches = _find_by_student_name(students, user_message)
        if len(student_matches) == 1:
            return _render_student_card(student_matches[0])
        elif len(student_matches) > 1:
            # Multiple students with same name — ask for clarification
            return _render_clarification(student_matches, user_message)

    # ── D. Fallback: try mentor list, then student name, then clarification ───
    mentor_matches = _find_by_mentor(students, user_message)
    if mentor_matches:
        mentor_name = _get(mentor_matches[0], 'mentor_name')
        return _render_mentee_table(mentor_matches, mentor_name)

    student_matches = _find_by_student_name(students, user_message)
    if len(student_matches) == 1:
        return _render_student_card(student_matches[0])
    elif len(student_matches) > 1:
        return _render_clarification(student_matches, user_message)

    # ── E. Nothing found ──────────────────────────────────────────────────────
    return (
        "<div style='color:#94a3b8'>"
        "No matching student or mentor found. "
        "Try using a <strong>Registration ID</strong>, "
        "<strong>Application Number</strong>, or full name.</div>"
    )
