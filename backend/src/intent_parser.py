"""
Intent parser — uses Groq LLM to extract structured intent from
any natural language timetable query.

Returns a dict like:
{
  "intent": "get_schedule" | "get_free_slots" | "get_classroom" | "next_class",
  "day": "Mo" | "Tu" | "We" | "Th" | "Fr" | null,
  "time_after": "14:00" | null,   # e.g. "after 2pm"
  "time_before": "12:00" | null,  # e.g. "before noon"
  "want_free": true | false        # "free slots / free periods"
}
"""
import json
import re
from datetime import date
from typing import Optional

WEEKDAY_TO_ABBR = ["Mo", "Tu", "We", "Th", "Fr"]

SYSTEM_PROMPT = """You are an intent extractor for a university timetable chatbot.
Extract structured information from the user's message and return ONLY valid JSON.

Output format (all fields required):
{
  "intent": "get_schedule" | "get_free_slots" | "get_classroom" | "next_class",
  "day": "Mo" | "Tu" | "We" | "Th" | "Fr" | null,
  "time_after": "HH:MM" | null,
  "time_before": "HH:MM" | null,
  "want_free": true | false
}

Rules:
- "today" → resolve to current weekday abbreviation
- "tomorrow" → resolve to next weekday abbreviation  
- "after 2pm" → time_after: "14:00"
- "before noon" → time_before: "12:00"
- "free class/slot/period" → want_free: true, intent: "get_free_slots"
- "where is my class" → intent: "get_classroom"
- "what class do I have" → intent: "get_schedule"
- "next class" → intent: "next_class"
- If no day mentioned → day: null
- Return ONLY the JSON object, no explanation
"""

_groq_client = None


def _get_groq_client():
    global _groq_client
    if _groq_client is None:
        try:
            from src.config import settings
            from groq import Groq
            if getattr(settings, 'GROQ_API_KEY', None) and settings.GROQ_API_KEY != "your_groq_api_key_here":
                _groq_client = Groq(api_key=settings.GROQ_API_KEY)
        except Exception as e:
            print(f"[Intent] Groq init failed: {e}")
    return _groq_client


def _today_abbr() -> Optional[str]:
    idx = date.today().weekday()
    return WEEKDAY_TO_ABBR[idx] if idx <= 4 else None


def _tomorrow_abbr() -> Optional[str]:
    idx = date.today().weekday() + 1
    return WEEKDAY_TO_ABBR[idx] if idx <= 4 else None


def _fallback_parse(msg: str) -> dict:
    """Rule-based fallback if Groq is unavailable."""
    m = msg.lower()
    day = None
    day_map = {
        "today": _today_abbr(), "tomorrow": _tomorrow_abbr(),
        "monday": "Mo", "mon": "Mo", "tuesday": "Tu", "tue": "Tu",
        "wednesday": "We", "wed": "We", "thursday": "Th", "thu": "Th",
        "friday": "Fr", "fri": "Fr",
    }
    for k, v in day_map.items():
        if k in m:
            day = v
            break

    time_after = None
    time_before = None

    # "after X pm/am"
    ta = re.search(r'after\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?', m)
    if ta:
        h = int(ta.group(1))
        mins = int(ta.group(2) or 0)
        if ta.group(3) == 'pm' and h < 12:
            h += 12
        time_after = f"{h:02d}:{mins:02d}"

    tb = re.search(r'before\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?', m)
    if tb:
        h = int(tb.group(1))
        mins = int(tb.group(2) or 0)
        if tb.group(3) == 'pm' and h < 12:
            h += 12
        time_before = f"{h:02d}:{mins:02d}"

    want_free = any(w in m for w in ['free', 'empty', 'no class', 'gap', 'break'])

    if want_free:
        intent = "get_free_slots"
    elif 'next class' in m or 'upcoming' in m:
        intent = "next_class"
    elif 'where' in m or 'room' in m or 'classroom' in m:
        intent = "get_classroom"
    else:
        intent = "get_schedule"

    return {
        "intent": intent,
        "day": day,
        "time_after": time_after,
        "time_before": time_before,
        "want_free": want_free,
    }


def parse_intent(user_message: str) -> dict:
    """
    Parse user message into structured intent using Groq LLM.
    Falls back to rule-based parsing if Groq unavailable.
    """
    client = _get_groq_client()

    if client:
        try:
            # Inject today/tomorrow context so LLM can resolve them
            today = date.today().strftime("%A")  # e.g. "Monday"
            tomorrow_idx = date.today().weekday() + 1
            tomorrow = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"][tomorrow_idx] if tomorrow_idx < 7 else "weekend"

            user_prompt = (
                f"Today is {today}. Tomorrow is {tomorrow}.\n"
                f"User message: \"{user_message}\"\n"
                f"Extract intent as JSON:"
            )

            resp = client.chat.completions.create(
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
                model="llama-3.1-8b-instant",
                max_tokens=150,
                temperature=0.0,
            )
            raw = resp.choices[0].message.content.strip()
            # Extract JSON from response
            m = re.search(r'\{[\s\S]+\}', raw)
            if m:
                parsed = json.loads(m.group())
                # Validate required keys
                for k in ['intent', 'day', 'time_after', 'time_before', 'want_free']:
                    if k not in parsed:
                        parsed[k] = None if k != 'want_free' else False
                return parsed
        except Exception as e:
            print(f"[Intent] LLM parse failed: {e}, using fallback")

    return _fallback_parse(user_message)
