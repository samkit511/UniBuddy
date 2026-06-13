import re, json, os
from collections import deque, defaultdict
from typing import Dict, Any, Optional
from src.threaded_rag import ThreadedRAGSystem
from src.threaded_models import ThreadedModelManager
from src.config import DEBUG_RAG, TOP_K_RESULTS
from src.timetable_lookup import get_timetable_context
from src.timetable_store import answer_timetable_query, is_timetable_intent, has_active_timetable_session, is_timetable_escape
from src.mentor_store import answer_mentor_query, is_mentor_intent

rag = ThreadedRAGSystem()
models = ThreadedModelManager()
session_histories: Dict[str, deque] = defaultdict(lambda: deque(maxlen=10))

PROMPT_TEMPLATE = '''System: You are UniBuddy, the official intelligent assistant for GD Goenka University. Use ONLY the retrieved context and conversation history. Answer concisely (2–6 sentences) and include sources. If a field is missing, say "Not available in sources".

Retrieved Context:
{RAG_CONTEXT}

Conversation History:
{HISTORY}

Current Question:
{USER_QUESTION}

Provide a short factual summary (2–6 sentences), then a structured block with headings: Role, Location, Education (short), Research Interests (short), Experience (short). Do NOT include a Sources or Links section.
'''

FOLLOWUP_RE = re.compile(r"\b(him|her|them|his|hers|more about|details|research|publications)\b", re.I)


def _rewrite_followup_if_needed(session_id: str, user_query: str) -> str:
    if not session_id or not FOLLOWUP_RE.search(user_query):
        return user_query
    hist = session_histories.get(session_id)
    if not hist:
        return user_query
    person = None
    for entry in reversed(hist):
        u = entry.get('user') or ''
        m = re.search(r"([A-Z][a-z]+\s+[A-Z][a-z]+)", u)
        if m:
            person = m.group(1)
            break
    if person:
        rewritten = f"{person} {user_query}"
        if DEBUG_RAG:
            print(f"[RAG] Rewrote follow-up: '{user_query}' -> '{rewritten}'")
        return rewritten
    return user_query


def _compose_history(session_id: str) -> str:
    hist = session_histories.get(session_id)
    if not hist:
        return ''
    return '\n'.join(f"User: {e.get('user','')}\nAssistant: {e.get('assistant','')}" for e in hist)


def _store_session(session_id: str, user: str, assistant: str):
    # store sanitized versions to avoid debug fragments
    try:
        user_clean = re.sub(r"(?i)(?:<current_tab_state>[\s\S]*?</current_tab_state>|\\u003ccurrent_tab_state\\u003e[\s\S]*?\\u003c\\/current_tab_state\\u003e)", "", user or '').strip()
        assistant_clean = re.sub(r"(?i)(?:<current_tab_state>[\s\S]*?</current_tab_state>|\\u003ccurrent_tab_state\\u003e[\s\S]*?\\u003c\\/current_tab_state\\u003e)", "", assistant or '').strip()
        session_histories[session_id].append({'user': user_clean, 'assistant': assistant_clean})
    except Exception:
        session_histories[session_id].append({'user': user, 'assistant': assistant})


def _save_structured_to_vectordb(name_key: str, structured: Dict[str,Any]):
    try:
        safe = re.sub(r"\W+","_", name_key.lower())
        vpath = os.path.join('data','vectordb',f"extra_{safe}.json")
        os.makedirs(os.path.dirname(vpath), exist_ok=True)
        with open(vpath,'w',encoding='utf-8') as f:
            json.dump(structured, f, ensure_ascii=False, indent=2)
        if DEBUG_RAG:
            print(f"[RAG] Saved structured data for {name_key} to {vpath}")
    except Exception as e:
        print(f"[RAG] Failed to save structured data: {e}")


def dedupe_sentences(text: str) -> str:
    parts = re.split(r'(?<=[.!?])\s+', (text or '').strip())
    seen = set()
    out = []
    for p in parts:
        s = re.sub(r'\s+', ' ', p).strip()
        if not s:
            continue
        key = s.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(s)
    return ' '.join(out)


def summarize_text(text: str, max_sentences: int = 5) -> str:
    text = dedupe_sentences(text)
    sentences = re.split(r'(?<=[.!?])\s+', text)
    if len(sentences) <= max_sentences:
        return ' '.join(sentences).strip()
    return ' '.join(sentences[:max_sentences]).strip()


def parse_structured_from_text(text: str) -> Dict[str,Any]:
    data = {'name':None,'role':None,'department':None,'location':None,'education':[],'research':[], 'experience':[], 'links':[], 'sources':[]}
    m = re.search(r"\*\*(Dr\.?\s*[^\*]+?)\*\*", text)
    if m:
        data['name'] = m.group(1).strip()
    else:
        m2 = re.search(r"\b([A-Z][a-z]+\s+[A-Z][a-z]+)\b", text)
        if m2:
            data['name'] = m2.group(1)
    for url in re.findall(r"https?://[^\s<>\"]+", text):
        if url not in data['links']:
            data['links'].append(url)
            data['sources'].append(url)
    ed = re.search(r"Education[:\*\n\r]+([\s\S]{0,200})", text)
    if ed:
        data['education'] = [s.strip() for s in re.split(r'[\n\r\u2022\-]+', ed.group(1)) if s.strip()][:3]
    rs = re.search(r"Research Interests[:\*\n\r]+([\s\S]{0,200})", text)
    if rs:
        data['research'] = [s.strip() for s in re.split(r'[\n\r\u2022\-]+', rs.group(1)) if s.strip()][:5]
    ex = re.search(r"Experience[:\*\n\r]+([\s\S]{0,200})", text)
    if ex:
        data['experience'] = [s.strip() for s in re.split(r'[\n\r\u2022\-]+', ex.group(1)) if s.strip()][:5]
    return data


def _sanitize_visible_text(text: str) -> str:
    # remove debug tags
    text = re.sub(r"(?i)(?:<current_tab_state>[\s\S]*?</current_tab_state>|\\u003ccurrent_tab_state\\u003e[\s\S]*?\\u003c\\/current_tab_state\\u003e)", "", text)
    # remove inline [Source: ...] markers
    text = re.sub(r"\[Source:[^\]]+\]", "", text)
    # remove "Retrieved Context: ..." lines that the LLM echoes back
    text = re.sub(r"[-*•]\s*Retrieved Context:[^\n]*", "", text)
    text = re.sub(r"Retrieved Context:[^\n]*", "", text)
    # collapse repeated separators
    text = re.sub(r"(\s*---\s*)+", "\n---\n", text)
    # strip debug lines
    text = "\n".join(l for l in text.splitlines() if not re.search(r"^(Local Machine:|Open Widgets:)", l))
    return text.strip()


def get_reply(user_message: str, session_id: str = None, user_profile: Dict = None) -> Dict[str,Any]:
    # sanitize incoming user message (remove embedded debug fragments)
    if not user_message:
        user_message = ''
    user_message = re.sub(r"(?i)(?:<current_tab_state>[\s\S]*?</current_tab_state>|\\u003ccurrent_tab_state\\u003e[\s\S]*?\\u003c\\/current_tab_state\\u003e)", "", user_message).strip()

    # --- Routing priority ---
    # 1. If timetable session is mid-flow, let it handle everything first
    # 2. Otherwise, mentor queries take priority (to avoid 'how many' / 'faculty' clashes)
    # 3. Then timetable for fresh timetable queries
    # 4. Finally RAG

    history = list(session_histories.get(session_id, []))

    # If already in a timetable conversation, keep it there — unless it's an escape query
    if has_active_timetable_session(session_id) and not is_timetable_escape(user_message):
        timetable_answer = answer_timetable_query(user_message, session_id=session_id, history=history)
        if timetable_answer:
            if session_id:
                _store_session(session_id, user_message, timetable_answer)
            return {'reply': timetable_answer, 'data': {}, 'sources': []}

    # Mentor-Mentee fast-path (before timetable to avoid 'how many'/'faculty' clashes)
    if is_mentor_intent(user_message):
        mentor_answer = answer_mentor_query(user_message)
        if mentor_answer:
            if session_id:
                _store_session(session_id, user_message, mentor_answer)
            return {'reply': mentor_answer, 'data': {}, 'sources': []}

    # Timetable fast-path for fresh queries
    timetable_answer = answer_timetable_query(user_message, session_id=session_id, history=history)
    if timetable_answer:
        if session_id:
            _store_session(session_id, user_message, timetable_answer)
        return {'reply': timetable_answer, 'data': {}, 'sources': []}
    # -------------------------------------------------------------------------

    # Build student context block if profile provided
    student_context = ""
    timetable_context = ""
    if user_profile:
        name     = user_profile.get("name", "")
        degree   = user_profile.get("degree", "")
        branch   = user_profile.get("branch", "")
        year     = user_profile.get("year", "")
        section  = user_profile.get("section", "")
        email    = user_profile.get("email", "")

        student_context = f"""Student Info:
- Name: {name}
- Email: {email}
- Degree: {degree} {branch} Year {year}
- Section: {section}"""

        # Inject timetable if query is about schedule
        timetable_context = get_timetable_context(section, user_message)
        if timetable_context:
            student_context += f"\n\n{timetable_context}"

    rewritten = _rewrite_followup_if_needed(session_id, user_message)
    queries = []
    for q in (rewritten, f"{rewritten} profile", f"{rewritten} research"):
        if q and q not in queries:
            queries.append(q)
    # build contexts (deduped and sanitized)
    contexts = []
    seen = set()
    topk = TOP_K_RESULTS
    for q in queries:
        ctx = rag.get_context_for_query(q, top_k=topk)
        if not ctx:
            continue
        ctx = re.sub(r"(?i)(?:<current_tab_state>[\s\S]*?</current_tab_state>|\\u003ccurrent_tab_state\\u003e[\s\S]*?\\u003c\\/current_tab_state\\u003e)", "", ctx)
        norm = re.sub(r"\s+"," ", ctx).strip()
        if norm in seen:
            continue
        seen.add(norm)
        contexts.append(ctx)
        if len(contexts) >= 3:
            break
    full_context = '\n\n'.join(contexts)
    full_context = re.sub(r"(\[Source:[^\]]+\])(?:\s*\1)+","\1", full_context)

    history = _compose_history(session_id)
    prompt = PROMPT_TEMPLATE.format(
        STUDENT_CONTEXT=student_context,
        RAG_CONTEXT=full_context or 'No relevant context found',
        HISTORY=history,
        USER_QUESTION=user_message
    )
    model = models.models.get('groq-llama') or next(iter(models.models.values()))
    try:
        resp = model.generate(prompt, max_tokens=800, temperature=0.1)
        text = getattr(resp, 'content', None) or getattr(resp, 'text', '') or ''
    except Exception:
        text = full_context[:3000] or 'No response generated'

    # sanitize visible reply
    text = _sanitize_visible_text(text)
    text = dedupe_sentences(text)
    short = summarize_text(text, max_sentences=5)

    structured = parse_structured_from_text(text)

    # Build clean HTML — summary first, then only non-empty structured fields
    html_parts = []
    if short:
        short_clean = re.sub(r"^[\s\-\.:]+", '', short).strip()
        short_clean = re.sub(r"(---\s*\.?\s*)+", "\n", short_clean)
        # Strip any leftover "Retrieved Context:" lines from summary
        short_clean = re.sub(r"Retrieved Context:[^\n<]*", "", short_clean).strip()
        if short_clean:
            html_parts.append(f"<div>{short_clean}</div>")

    block = []
    if structured.get('role'):
        block.append(f"<div><strong>Role:</strong> {structured['role']}</div>")
    if structured.get('location'):
        block.append(f"<div><strong>Location:</strong> {structured['location']}</div>")
    if structured.get('education'):
        eds = ''.join(f"<li>{e}</li>" for e in structured['education'])
        block.append(f"<div><strong>Education:</strong><ul style='margin:6px 0 0 18px'>{eds}</ul></div>")
    if structured.get('research'):
        rrs = ''.join(f"<li>{r}</li>" for r in structured['research'])
        block.append(f"<div><strong>Research Interests:</strong><ul style='margin:6px 0 0 18px'>{rrs}</ul></div>")
    if structured.get('experience'):
        exs = ''.join(f"<li>{e}</li>" for e in structured['experience'])
        block.append(f"<div><strong>Experience:</strong><ul style='margin:6px 0 0 18px'>{exs}</ul></div>")
    # Only show real URLs, not "Retrieved Context:" strings
    real_links = [l for l in structured.get('links', []) if l.startswith('http')]
    if real_links:
        links = ''.join(f"<li><a href='{l}' target='_blank'>{l}</a></li>" for l in real_links[:3])
        block.append(f"<div><strong>Links:</strong><ul style='margin:6px 0 0 18px'>{links}</ul></div>")
    # Cap sources at 3 unique real URLs only
    real_sources = list(dict.fromkeys(
        s for s in structured.get('sources', []) if s.startswith('http')
    ))[:3]
    if real_sources:
        srcs = ''.join(f"<li><a href='{s}' target='_blank'>{s}</a></li>" for s in real_sources)
        block.append(f"<div><strong>Sources:</strong><ul style='margin:6px 0 0 18px'>{srcs}</ul></div>")

    if block:
        html_parts.append('<div style="margin-top:8px">' + ''.join(block) + '</div>')

    html_reply = ''.join(html_parts) if html_parts else '<div>Not available in sources</div>'

    # save structured
    if structured.get('name') and structured['name'] != 'Not available in sources':
        _save_structured_to_vectordb(structured['name'], structured)
    if session_id:
        _store_session(session_id, user_message, short)

    return {'reply': html_reply, 'data': structured, 'sources': structured.get('sources', [])}
