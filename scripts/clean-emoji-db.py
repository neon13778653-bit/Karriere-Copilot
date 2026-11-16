#!/usr/bin/env python3
"""Одноразовая чистка БД: убирает декоративные эмодзи из старых сообщений,
вакансий и заголовков сессий + синхронизирует goal сессии с профилем."""
import json
import re
import sqlite3

DB = 'db/custom.db'

EMOJI = re.compile(
    '[\U0001F000-\U0001FAFF\u2600-\u27BF\u2B00-\u2BFF\u231A\u231B\u23E9-\u23FA\u2049\u203C\uFE0F\uFE0E\u200D]'
)

TITLE_PREFIX = re.compile(r'^(Работа|Ausbildung|Поиск работы|Профиль)\s*:')


def strip(text):
    if not text:
        return text
    lines = []
    for line in text.split('\n'):
        if not EMOJI.search(line):
            # даже без эмодзи чиним пробелы внутри **жирного**, оставшиеся от эмодзи
            fixed = re.sub(r'([*_]{2})[ \t]+([^*_\n]+?)[ \t]*\1', r'\1\2\1', line)
            lines.append(fixed)
            continue
        cleaned = EMOJI.sub('', line)
        cleaned = re.sub(r'([*_]{2})[ \t]+([^*_\n]+?)[ \t]*\1', r'\1\2\1', cleaned)
        cleaned = re.sub(r'[ \t]{2,}', ' ', cleaned)
        cleaned = re.sub(r'[ \t]+([,.!?;:])', r'\1', cleaned).strip()
        lines.append(cleaned)
    out = []
    for line in lines:
        if line == '' and out and out[-1] == '':
            continue
        out.append(line)
    return '\n'.join(out).lstrip('\n').strip()


def main():
    conn = sqlite3.connect(DB)
    cur = conn.cursor()

    # --- Сообщения ---
    rows = cur.execute("SELECT id, role, content FROM Message").fetchall()
    n = 0
    for mid, role, content in rows:
        if role != 'assistant':
            continue
        clean = strip(content)
        if clean != content:
            cur.execute("UPDATE Message SET content=? WHERE id=?", (clean, mid))
            n += 1
    print(f'Messages cleaned: {n}')

    # --- Вакансии ---
    rows = cur.execute("SELECT id, title, company, location, salary, verdict, snippet, description, reasons, risks, tags FROM Vacancy").fetchall()
    n = 0
    for vid, title, company, location, salary, verdict, snippet, description, reasons, risks, tags in rows:
        clean = (
            strip(title or ''), strip(company or ''), strip(location or ''),
            strip(salary or ''), strip(verdict or ''), strip(snippet or ''),
            strip(description or ''),
            json.dumps([strip(x) for x in json.loads(reasons)]) if reasons else None,
            json.dumps([strip(x) for x in json.loads(risks)]) if risks else None,
            json.dumps([strip(x) for x in json.loads(tags)]) if tags else None,
        )
        orig = (title, company or '', location or '', salary or '', verdict or '', snippet or '', description or '', reasons, risks, tags)
        if tuple(clean) != orig:
            cur.execute(
                "UPDATE Vacancy SET title=?, company=?, location=?, salary=?, verdict=?, snippet=?, description=?, reasons=?, risks=?, tags=? WHERE id=?",
                (*clean, vid),
            )
            n += 1
    print(f'Vacancies cleaned: {n}')

    # --- Заголовки сессий + синхронизация goal с профилем ---
    rows = cur.execute("SELECT id, title, goal, profile FROM SearchSession").fetchall()
    n_t, n_g = 0, 0
    for sid, title, goal, profile_raw in rows:
        new_title = strip(title or '')
        if new_title != title:
            cur.execute("UPDATE SearchSession SET title=? WHERE id=?", (new_title, sid))
            n_t += 1
        try:
            profile = json.loads(profile_raw) if profile_raw else None
        except Exception:
            profile = None
        if isinstance(profile, dict):
            p_goal = profile.get('goal')
            if p_goal in ('job', 'ausbildung') and p_goal != goal:
                if TITLE_PREFIX.match(new_title):
                    new_title2 = (p_goal.capitalize() if p_goal == 'ausbildung' else 'Работа') + ':' + new_title[new_title.index(':') + 1:]
                else:
                    new_title2 = new_title
                cur.execute("UPDATE SearchSession SET goal=?, title=? WHERE id=?", (p_goal, new_title2, sid))
                n_g += 1
    print(f'Session titles cleaned: {n_t}, goals synced: {n_g}')

    # --- aiAnalysis / aiDirections в профилях ---
    rows = cur.execute("SELECT id, profile FROM SearchSession").fetchall()
    n = 0
    for sid, profile_raw in rows:
        if not profile_raw:
            continue
        try:
            profile = json.loads(profile_raw)
        except Exception:
            continue
        changed = False
        for key in ('aiAnalysis', 'aiDirections'):
            val = profile.get(key)
            if isinstance(val, str):
                clean = strip(val)
                if clean != val:
                    profile[key] = clean
                    changed = True
            elif isinstance(val, list):
                clean = [strip(x) for x in val]
                if clean != val:
                    profile[key] = clean
                    changed = True
        if changed:
            cur.execute("UPDATE SearchSession SET profile=? WHERE id=?", (json.dumps(profile, ensure_ascii=False), sid))
            n += 1
    print(f'Profiles cleaned: {n}')

    conn.commit()
    conn.close()
    print('Done.')


if __name__ == '__main__':
    main()
