#!/bin/bash
# Скоростной прогон анкеты в чате (900px — сайдбар скрыт, клики только по кнопкам)
bb() { agent-browser find role button click --name "$1" >/dev/null 2>&1 || echo "FAIL: $1"; sleep 0.55; }
btype() {
  agent-browser eval "const ta=document.querySelector('textarea[placeholder*=\"Ответь текстом\"]'); if(ta){const setter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set; setter.call(ta,'$1'); ta.dispatchEvent(new Event('input',{bubbles:true}));} 'ok'" >/dev/null 2>&1
  sleep 0.25
  agent-browser press Enter >/dev/null 2>&1
  sleep 0.6
}

bb "Ещё в школе"
bb "В Германии"
bb "Realschule"
bb "Realschulabschluss / Mittlere Reife"
bb "2.1–2.5 (хорошо)"
bb "Математика"
bb "Информатика"
bb "Готово"
bb "Пропустить"           # сертификаты
bb "B1"
bb "Средний (B1–B2)"
bb "Пропустить"           # другие языки
bb "Гражданство ЕС"
bb "Ещё не определился — пусть ИИ подберёт по моей анкете"
bb "Компьютеры и IT"
bb "Техника и машины"
bb "Готово"
bb "Хороший доход"
bb "Готово"
btype "быстро учусь, внимательный"
bb "Пропустить"           # что нравилось
btype "летом подрабатывал на складе"
bb "Пропустить"           # навыки
bb "Категория B (легковые)"
bb "Мюнхен"
bb "+25 км"
bb "Не готов к переезду"
bb "Не определился — пусть агент оценит по рынку"
bb "Не определился"
bb "Ничего больше"
echo "=== wizard run done ==="
