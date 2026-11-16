#!/usr/bin/env python3
"""Продолжение прогона анкеты: с вопроса про право на работу до конца."""
import importlib.util
import time

_spec = importlib.util.spec_from_file_location(
    'wizard_drive', '/home/z/my-project/scripts/wizard-drive.py'
)
w = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(w)

steps = [
    ('правом на работу', 'chip', 'Гражданство ЕС'),
    ('уже знаешь, кем хочешь', 'chip', 'Ещё не определился — пусть ИИ подберёт по моей анкете'),
    ('Что тебе интересно', 'multi', ['Компьютеры и IT', 'Техника и машины']),
    ('важно в работе', 'multi', ['Хороший доход']),
    ('получается лучше всего', 'type', 'быстро учусь, внимательный к деталям'),
    ('Что нравилось в школе', 'skip', None),
    ('опыт работы', 'type', 'летом подрабатывал на складе, разбирал технику'),
    ('Что умеешь', 'skip', None),
    ('водительские права', 'chip', 'Категория B (легковые)'),
    ('Где искать', 'chip', 'Мюнхен'),
    ('Как далеко от города', 'chip', '+25 км'),
    ('Готов переехать', 'chip', 'Не готов к переезду'),
    ('ожидания по доходу', 'chip', 'Не определился — пусть агент оценит по рынку'),
    ('формат работы', 'chip', 'Не определился'),
    ('Что-то ещё', 'skip', None),
]

for i, (frag, kind, val) in enumerate(steps):
    q = w.current_question()
    if not q or frag.lower() not in q.lower():
        print(f"[{i}] !! {q[:45]!r} != {frag!r}")
        continue
    if kind == 'type':
        r1, r2 = w.type_answer(val)
        print(f"[{i}] typed {val!r}: {r1}/{r2}")
    elif kind == 'chip':
        print(f"[{i}] chip {val!r}:", w.click_text(val))
    elif kind == 'multi':
        for item in val:
            w.click_text(item)
        time.sleep(0.3)
        print(f"[{i}] multi {val}:", w.click_text('Готово'))
    elif kind == 'skip':
        print(f"[{i}] skip:", w.skip_current())
    time.sleep(0.7)

print('Прогресс:', w.progress_text())
print('Финальный вопрос:', w.current_question()[:80])
w.screenshot('/tmp/render/10-summary.png')
