#!/usr/bin/env python3
"""Драйвер прогона анкеты-разговора в чате: кликает кнопки по точному тексту внутри <main>.
Все JS-выражения обёрнуты в IIFE, чтобы const не конфликтовал между eval-вызовами."""
import json
import subprocess
import time
import sys

def ab(*args, timeout=30):
    r = subprocess.run(['agent-browser', *args], capture_output=True, text=True, timeout=timeout)
    return r.stdout.strip(), r.stderr.strip(), r.returncode

def eval_js(js):
    out, err, code = ab('eval', js)
    if code != 0:
        return f'__err__ {err[:120]}'
    try:
        return json.loads(out)
    except Exception:
        return out

def iife(body):
    return f'(()=>{{{body}}})()'

def click_text(text):
    body = (
        "const btns=[...document.querySelectorAll('main button')];"
        f"const b=btns.find(x=>x.textContent.trim()==={json.dumps(text)});"
        "if(b){b.click();return 'clicked'}return 'notfound:'+btns.length;"
    )
    return eval_js(iife(body))

def current_question():
    body = (
        "const q=[...document.querySelectorAll('main p')]"
        ".filter(p=>String(p.className).includes('font-semibold'));"
        "return q.length?q[q.length-1].textContent.trim():'';"
    )
    return eval_js(iife(body))

def progress_text():
    body = (
        "const el=[...document.querySelectorAll('main span')]"
        ".find(s=>/\\d+ из \\d+/.test(s.textContent));"
        "return el?el.textContent.trim():'';"
    )
    return eval_js(iife(body))

def type_answer(text):
    body = (
        "const ta=document.querySelector('main textarea');"
        "if(!ta)return 'notextarea';"
        "const s=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;"
        f"s.call(ta,{json.dumps(text)});"
        "ta.dispatchEvent(new Event('input',{bubbles:true}));"
        "return 'typed';"
    )
    r = eval_js(iife(body))
    time.sleep(0.4)
    click = eval_js(iife(
        "const b=[...document.querySelectorAll('main button')]"
        ".find(x=>x.getAttribute('aria-label')==='Отправить');"
        "if(b&&!b.disabled){b.click();return 'sent'}return b?'disabled':'nosend';"
    ))
    return r, click

def screenshot(path):
    ab('screenshot', path, timeout=30)

# карта: фрагмент вопроса → действие
PLAN = [
    ('Как тебя зовут', 'type', 'Александр'),
    ('Сколько тебе лет', 'type', '17'),
    ('Чем ты сейчас занят', 'chip', 'Ещё в школе'),
    ('Где ты учился в школе', 'chip', 'В Германии'),
    ('В какой школе ты учился', 'chip', 'Realschule'),
    ('Какое у тебя образование', 'chip', 'Realschulabschluss / Mittlere Reife'),
    ('средний балл', 'chip', '2.1–2.5 (хорошо)'),
    ('Какие предметы давались', 'multi', ['Математика', 'Информатика']),
    ('сертификаты', 'skip', None),
    ('уровень немецкого', 'chip', 'B1'),
    ('А английский', 'chip', 'Средний (B1–B2)'),
    ('Другие языки', 'skip', None),
    ('право на работе', 'chip', 'Гражданство ЕС'),
    ('право на работу в Германии', 'chip', 'Гражданство ЕС'),
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

SKIP_LABELS = ['Пропустить', 'Не помню точно', 'Не знаю / пока не учил',
               'Не разобрался — пусть агент подскажет', 'Опыта пока нет',
               'Не определился — по всей Германии', 'Пусть агент решит',
               'Ничего больше', 'Не помню — не важно',
               'Не определился — пусть агент учтёт сам', 'Передумал — пусть ИИ подберёт сам',
               'Пропустить — агент поймёт по остальным ответам']

def skip_current():
    for label in SKIP_LABELS:
        r = click_text(label)
        if r == 'clicked':
            return label
    return None

def main():
    for i, (frag, kind, val) in enumerate(PLAN):
        q = current_question()
        if not q or frag.lower() not in q.lower():
            print(f"[{i+1}] !! вопрос {q[:50]!r} не совпал с планом {frag!r} — скип шага")
            continue
        if kind == 'type':
            r1, r2 = type_answer(val)
            print(f"[{i+1}] {q[:40]!r} → typed {val!r}: {r1}/{r2}")
        elif kind == 'chip':
            r = click_text(val)
            print(f"[{i+1}] {q[:40]!r} → chip {val!r}: {r}")
        elif kind == 'multi':
            for item in val:
                r = click_text(item)
            time.sleep(0.3)
            r = click_text('Готово')
            print(f"[{i+1}] {q[:40]!r} → multi {val}: {r}")
        elif kind == 'skip':
            r = skip_current()
            print(f"[{i+1}] {q[:40]!r} → skip: {r}")
        time.sleep(0.7)
    print('Прогресс:', progress_text())
    print('Финальный вопрос:', current_question()[:80])
    screenshot('/tmp/render/10-summary.png')
    print('=== план выполнен ===')

if __name__ == '__main__':
    main()
