// Общие промпты и утилиты для ИИ-агента

import { personModelToText } from './person-model';
import { customFieldLines } from './custom-sections';
import { intelToText, parseIntel } from './vacancy-intel';
import type { Goal, UserProfile, VacancyIntel } from './types';

export function profileToText(profile: UserProfile | null | undefined): string {
  if (!profile) return '(профиль не заполнен)';
  const isAus = profile.goal === 'ausbildung';
  const p: string[] = [];
  // Основное
  if (profile.name) p.push(`Имя: ${profile.name}`);
  if (profile.age) p.push(`Возраст: ${profile.age}`);
  if (profile.status) p.push(`Статус: ${profile.status}`);
  p.push(`Цель: ${goalLabel(profile.goal)}`);

  // Образование и школа
  const edu: string[] = [];
  if (profile.schoolCountry) edu.push(`учился(ась) ${profile.schoolCountry.toLowerCase()}`);
  if (profile.schoolType) edu.push(`тип заведения: ${profile.schoolType}`);
  if (profile.graduation) edu.push(`${isAus ? 'аттестат/диплом' : 'образование'}: ${profile.graduation}`);
  if (edu.length) p.push(`Образование: ${edu.join('; ')}`);
  if (profile.qualification) p.push(`Профессия/специальность: ${profile.qualification}`);
  if (profile.recognition)
    p.push(`Признание ${isAus ? 'аттестата' : 'диплома'} в Германии: ${profile.recognition}`);
  if (profile.gradeAverage) p.push(`Средний балл: ${profile.gradeAverage}`);
  if (profile.bestSubjects?.length)
    p.push(`Лучшие/любимые предметы: ${profile.bestSubjects.join(', ')}`);
  if (profile.weakSubjects?.length)
    p.push(`Тяжёлые предметы (не предлагать профессии, где они главные): ${profile.weakSubjects.join(', ')}`);
  if (profile.certificates)
    p.push(`${isAus ? 'Сертификаты и курсы' : 'Сертификаты и допуски'}: ${profile.certificates}`);

  // Языки и документы
  if (profile.germanLevel) p.push(`Немецкий: ${profile.germanLevel}`);
  if (profile.englishLevel) p.push(`Английский: ${profile.englishLevel}`);
  if (profile.otherLanguages) p.push(`Другие языки: ${profile.otherLanguages}`);
  if (profile.workPermit)
    p.push(`${isAus ? 'Статус проживания (для Ausbildung)' : 'Право на работу в Германии'}: ${profile.workPermit}`);

  // Направление
  if (profile.decided === false) {
    p.push('Желаемое направление: НЕ ОПРЕДЕЛИЛСЯ — нужно подобрать направления по данным ниже:');
    if (profile.interests?.length) p.push(`Интересы: ${profile.interests.join(', ')}`);
    if (profile.workValues?.length)
      p.push(`${isAus ? 'Важно в учёбе' : 'Важно в работе'}: ${profile.workValues.join(', ')}`);
    if (profile.strengths) p.push(`Сильные стороны: ${profile.strengths}`);
    if (profile.likes) p.push(`Что нравилось: ${profile.likes}`);
  } else if (profile.position) {
    p.push(`Желаемая позиция/профессия: ${profile.position}`);
  }

  if (profile.seniority) p.push(`Желаемый уровень позиции: ${profile.seniority}`);
  if (profile.avoid) p.push(`Чего НЕ хочет: ${profile.avoid}`);

  // Опыт и навыки
  if (profile.experience) p.push(`${isAus ? 'Практика и подработки' : 'Опыт работы'}: ${profile.experience}`);
  if (profile.germanyExperience) p.push(`Опыт работы в Германии: ${profile.germanyExperience}`);
  if (profile.tryout) p.push(`Пробный день / практика / EQ: ${profile.tryout}`);
  if (profile.skills) p.push(`Навыки: ${profile.skills}`);
  if (profile.drivingLicense) p.push(`Водительские права: ${profile.drivingLicense}`);

  // Свои разделы и поля, которые человек добавил сам
  const custom = customFieldLines(profile.customSections);
  if (custom.length) {
    p.push('СВОИ РАЗДЕЛЫ ПРОФИЛЯ (человек добавил сам — учитывай наравне с анкетой):');
    for (const line of custom) p.push(`— ${line}`);
  }

  // Приложенные документы (Lebenslauf и другие) — основной источник данных о человеке
  if (profile.documents?.length) {
    p.push('ПРИЛОЖЕННЫЕ ДОКУМЕНТЫ (изуч их особенно внимательно):');
    let budget = 9000;
    for (const d of profile.documents) {
      const chunk = d.text.slice(0, Math.min(4000, budget));
      budget -= chunk.length;
      p.push(`— Файл «${d.name}» (${Math.round(d.size / 1024)} КБ, распознано ${d.chars} символов):`);
      p.push(chunk || '(текст не распознан)');
      if (budget <= 0) break;
    }
  }

  // Локация и условия
  if (profile.city)
    p.push(
      `Город/регион поиска: ${profile.city}${profile.radius ? ` (радиус: ${profile.radius})` : ''}`,
    );
  if (profile.relocation) p.push(`Переезд: ${profile.relocation}`);
  if (profile.startDate)
    p.push(`${isAus ? 'Когда начать обучение' : 'Когда готов выйти на работу'}: ${profile.startDate}`);
  if (profile.salary)
    p.push(`${isAus ? 'Ожидания по Ausbildungsvergütung' : 'Ожидания по доходу'}: ${profile.salary}`);
  if (profile.format) p.push(`${isAus ? 'Вид обучения' : 'Формат работы'}: ${profile.format}`);
  if (profile.contract) p.push(`Тип договора: ${profile.contract}`);
  if (profile.extra) p.push(`Дополнительно о себе: ${profile.extra}`);
  return p.join('\n');
}

export function goalLabel(goal: Goal | string | undefined): string {
  if (goal === 'job') return 'Поиск работы в Германии';
  if (goal === 'ausbildung') return 'Поиск Ausbildung (профессиональное обучение)';
  return 'Свободная консультация';
}

export function buildChatSystemPrompt(args: {
  profile: UserProfile | null;
  goal: Goal;
  vacanciesSummary: string;
  focusVacancy?: string | null;
  stage?: 'wizard' | 'analysis' | 'ready' | 'chat';
}): string {
  const { profile, goal, vacanciesSummary, focusVacancy, stage } = args;
  return [
    'Ты — Karriere Copilot, экспертный ИИ-агент по поиску работы и Ausbildung в Германии.',
    'Ты глубоко знаешь немецкий рынок труда, порталы (Indeed, StepStone, Arbeitsagentur, LinkedIn, Ausbildung.de, kimeta, Jobware),',
    'требования к визам (§18a/b, Chancenkarte, Blue Card), уровни немецкого A1–C2, систему дуального образования.',
    '',
    'ПРАВИЛА ОТВЕТА:',
    '— Отвечай на русском языке, дружелюбно и по делу (если пользователь явно не попросит другой язык).',
    '— НЕ используй эмодзи — пиши серьёзно и по делу.',
    '— Пиши структурировано: короткие абзацы, при уместности — списки. Не выдумывай факты: если чего-то не знаешь — скажи прямо.',
    '— Давай конкретные советы: названия порталов, формулировки, шаги, суммы, законы.',
    '— Если пользователь просит найти вакансии — предложи нажать кнопку «Начать поиск» и выбрать режим (Легкий / Средний / MAX).',
    '— Если в контексте есть вакансии и вопрос касается одной из них — анализируй её честно: плюсы, минусы, риски, что подготовить.',
    '— Для вакансий в контексте указаны проверка ссылки, срок подачи, контакты и рекомендация «подходит ли этому человеку». Опирайся только на эти данные: если срока, контакта или требования там нет — так и скажи, не выдумывай. Если ссылка не проверена или данные взяты только из краткой выдачи — предупреди и посоветуй открыть вакансию.',
    '— Если человек не определился с профессией — помогай выбрать: задавай уточняющие вопросы и опирайся на данные его профиля (интересы, предметы, оценки), а не на общие слова.',
    stage === 'wizard'
      ? '— Сейчас человек параллельно заполняет анкету в чате. Если он что-то спрашивает вне анкеты — отвечай кратко и по делу, не мешая анкете.'
      : '',
    stage === 'ready'
      ? '— Ты уже глубоко проанализировал профиль и подтвердил готовность. Если человек хочет вакансии — предложи нажать «Начать поиск» и выбрать режим.'
      : '',
    '',
    'КОНТЕКСТ ТЕКУЩЕЙ СЕССИИ:',
    `Цель пользователя: ${goalLabel(goal)}`,
    // Модель человека — структурная память агента: факты, источники, выводы, пробелы
    profile?.personModel
      ? `МОДЕЛЬ ЧЕЛОВЕКА (твоя память об этом человеке — опирайся на неё как на главный источник; факты помечены источниками и уверенностью, в конце — твои выводы и открытые вопросы. Факт с пометкой [ДАВНО НЕ ПОДТВЕРЖДАЛОСЬ] мог устареть — если он важен для ответа, мягко перепроверь):\n${personModelToText(profile.personModel)}`
      : '',
    `Профиль пользователя:\n${profileToText(profile)}`,
    profile?.aiAnalysis
      ? `\nГЛУБОКИЙ АНАЛИЗ ПРОФИЛЯ (агент сделал его перед поиском — опирайся на него):\n${profile.aiAnalysis}`
      : '',
    profile?.aiDirections?.length
      ? `Подобранные агентом направления: ${profile.aiDirections.join(', ')}`
      : '',
    '',
    'НАЙДЕННЫЕ ВАКАНСИИ В ЭТОЙ СЕССИИ (если пусто — поиск ещё не запускался):',
    vacanciesSummary || '(пока никаких)',
    focusVacancy ? `\nПОЛЬЗОВАТЕЛЬ СЕЙЧАС СПРАШИВАЕТ ПРО КОНКРЕТНУЮ ВАКАНСИЮ:\n${focusVacancy}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function vacanciesToContext(
  items: {
    title: string;
    company?: string | null;
    location?: string | null;
    url: string;
    score?: number | null;
    intel?: string | null; // JSON из БД (VacancyIntel)
  }[],
  max = 20,
): string {
  if (!items.length) return '';
  return items
    .slice(0, max)
    .map((v, i) => {
      const intel = parseIntel(v.intel);
      const rec = intel?.fit ? `; рекомендация: ${intel.fit.label}` : '';
      const link = intel?.link.state === 'unverified' ? '; ссылку проверить не удалось' : '';
      return `${i + 1}. «${v.title}» — ${v.company || 'компания не указана'}, ${v.location || 'локация не указана'}${
        v.score != null ? ` (совпадение ${v.score}/100${rec}${link})` : ''
      }\n   ${v.url}`;
    })
    .join('\n');
}

export function vacancyToFocusText(v: {
  title: string;
  company?: string | null;
  location?: string | null;
  url: string;
  salary?: string | null;
  description?: string | null;
  snippet?: string | null;
  score?: number | null;
  verdict?: string | null;
  reasons?: string[] | null;
  risks?: string[] | null;
  source?: string | null;
  intel?: VacancyIntel | null;
}): string {
  const parts = [
    `«${v.title}»`,
    v.company ? `Компания: ${v.company}` : null,
    v.location ? `Локация: ${v.location}` : null,
    v.salary ? `Доход: ${v.salary}` : null,
    v.source ? `Источник: ${v.source}` : null,
    `Ссылка: ${v.url}`,
    v.score != null ? `Оценка соответствия: ${v.score}/100` : null,
    v.verdict ? `Вердикт ИИ: ${v.verdict}` : null,
    v.reasons?.length ? `Сильные стороны: ${v.reasons.join('; ')}` : null,
    v.risks?.length ? `Риски: ${v.risks.join('; ')}` : null,
    v.description ? `Описание: ${v.description}` : v.snippet ? `Фрагмент: ${v.snippet}` : null,
    ...intelToText(v.intel),
  ].filter(Boolean);
  return parts.join('\n');
}
