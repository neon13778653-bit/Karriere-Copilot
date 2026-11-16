// Анкета-регистрация: определения вопросов для поэтапной формы профиля.
// Каждый вопрос можно ответить кнопкой, своим текстом — или пропустить
// («не определился», «не помню», «пусть агент решит»). Пропуски агент
// компенсирует остальными ответами профиля.

import { customFieldLines, normalizeCustomSections } from './custom-sections';
import type { Goal, UserProfile } from './types';

export interface WizardQuestion {
  id: string; // уникальный id (совпадает с полем профиля для простых вопросов)
  label: string; // короткое имя для сводки и транскрипта
  stageIdx: number; // 0..5 — визуальная группа
  question: string; // текст вопроса в чате
  hint?: string; // пояснение под вопросом
  kind: 'text' | 'single' | 'multi';
  options?: string[]; // варианты для single/multi
  examples?: string[]; // быстрые чипы для текстовых вопросов
  placeholder?: string;
  wide?: boolean; // многострочный ответ (намекаем, что можно писать развёрнуто)
  skipLabel?: string; // если задан — показываем кнопку пропуска с этой подписью
  skipValue?: string; // значение, записываемое при пропуске (иначе — метка в wizardSkipped)
  field?: keyof UserProfile;
  store?: (value: string) => Partial<UserProfile>;
  read?: (p: UserProfile) => string | string[] | undefined;
  depends?: (p: UserProfile) => boolean;
}

export interface WizardStage {
  title: string;
  subtitle: string;
}

/** Все анкеты состоят из 8 этапов: 6 с вопросами, «Документы» (6) и «Свои разделы» (7). */
export const WIZARD_STAGE_COUNT = 8;
export const DOCUMENTS_STAGE = 6;
export const CUSTOM_STAGE = 7;

const AUSBILDUNG_STAGES: readonly WizardStage[] = [
  {
    title: 'Знакомство',
    subtitle: 'Пара слов о тебе — чтобы я знал, как к тебе обращаться и на каком ты этапе.',
  },
  {
    title: 'Школа и оценки',
    subtitle:
      'Аттестат и оценки — для Ausbildung это ключевые данные: у многих мест есть минимальные требования.',
  },
  {
    title: 'Языки и статус',
    subtitle:
      'Немецкий нужен и в компании, и в Berufsschule, а статус проживания определяет, можно ли начать Ausbildung.',
  },
  {
    title: 'Профессия и вид обучения',
    subtitle:
      'Знаешь, на какую Ausbildung хочешь? Если нет — не страшно, я подберу по остальным ответам.',
  },
  {
    title: 'Практика и навыки',
    subtitle: 'Практика, подработки и навыки — даже школьный опыт и помощь в семье считаются.',
  },
  {
    title: 'Место и условия',
    subtitle: 'Где искать место, когда начать и какая Ausbildungsvergütung тебя устроит.',
  },
  {
    title: 'Документы',
    subtitle:
      'Приложи Zeugnis, Lebenslauf или другие документы — я их прочитаю и учту при анализе и поиске.',
  },
  {
    title: 'Свои разделы',
    subtitle:
      'Чего нет в анкете, но важно: проекты, ссылки, хобби, особые условия. Создай свои разделы и поля — агент прочитает их наравне с остальным.',
  },
];

const JOB_STAGES: readonly WizardStage[] = [
  {
    title: 'Знакомство',
    subtitle: 'Пара слов о тебе — чтобы я знал, как к тебе обращаться и в какой ты сейчас ситуации.',
  },
  {
    title: 'Образование и квалификация',
    subtitle:
      'Профессия, диплом и его признание в Германии — от этого зависит, подойдут ли позиции специалиста или только помощника.',
  },
  {
    title: 'Языки и право на работу',
    subtitle: 'Языки и право на работу — от этого зависит, какие вакансии тебе реально доступны.',
  },
  {
    title: 'Должность и уровень',
    subtitle:
      'Знаешь, кем хочешь работать? Если нет — не страшно, я подберу по остальным ответам.',
  },
  {
    title: 'Опыт и навыки',
    subtitle: 'Где и кем ты работал(а) и чем владеешь — в том числе опыт в другой стране.',
  },
  {
    title: 'Условия работы',
    subtitle: 'Где искать, когда выйти, какие доход, график и договор тебя устраивают.',
  },
  {
    title: 'Документы',
    subtitle:
      'Приложи Lebenslauf, дипломы или рекомендации — я их прочитаю и учту при анализе и поиске.',
  },
  {
    title: 'Свои разделы',
    subtitle:
      'Чего нет в анкете, но важно: проекты, ссылки, хобби, особые условия. Создай свои разделы и поля — агент прочитает их наравне с остальным.',
  },
];

const CHAT_STAGES: readonly WizardStage[] = [
  { title: 'Цель', subtitle: 'Сначала определимся, что ты ищешь — остальная анкета подстроится под цель.' },
  { title: 'Образование', subtitle: 'Этот этап появится после выбора цели на первом шаге.' },
  { title: 'Языки и право', subtitle: 'Этот этап появится после выбора цели на первом шаге.' },
  { title: 'Направление', subtitle: 'Этот этап появится после выбора цели на первом шаге.' },
  { title: 'Опыт и навыки', subtitle: 'Этот этап появится после выбора цели на первом шаге.' },
  { title: 'Условия', subtitle: 'Этот этап появится после выбора цели на первом шаге.' },
  {
    title: 'Документы',
    subtitle: 'Приложи Lebenslauf или другие документы — я их прочитаю и учту при анализе и поиске.',
  },
  {
    title: 'Свои разделы',
    subtitle:
      'Чего нет в анкете, но важно: проекты, ссылки, хобби, особые условия. Создай свои разделы и поля — агент прочитает их наравне с остальным.',
  },
];

/** Названия и пояснения этапов — у каждой цели свои. */
export function wizardStages(goal: Goal): readonly WizardStage[] {
  if (goal === 'ausbildung') return AUSBILDUNG_STAGES;
  if (goal === 'job') return JOB_STAGES;
  return CHAT_STAGES;
}

/* ------------------------------- Справочники ------------------------------- */

const STATUSES_AUSBILDUNG = [
  'Ещё учусь в школе',
  'Школу закончил(а), ищу место',
  'Учусь в вузе или колледже, думаю сменить путь',
  'Работаю или подрабатываю',
  'Сейчас ничем не занят(а)',
  'Живу не в Германии — планирую переезд',
];

const STATUSES_JOB = [
  'Работаю, ищу другую работу',
  'Сейчас не работаю',
  'Учусь и ищу подработку или работу после учёбы',
  'Самозанятый / фрилансер',
  'Переезжаю в Германию',
];

const SCHOOL_TYPES = [
  'Hauptschule',
  'Realschule',
  'Gymnasium',
  'Gesamtschule / Oberschule',
  'Berufsschule / колледж',
  'Обычная школа в другой стране',
  'Лицей / гимназия в другой стране',
  'Вуз / университет',
  'Другое',
];

const GRADUATIONS = [
  'Ещё учусь (аттестат будет позже)',
  'Hauptschulabschluss',
  'Realschulabschluss / Mittlere Reife',
  'Fachabitur (Fachhochschulreife)',
  'Abitur',
  'Аттестат другой страны',
  'Профессиональный диплом / колледж',
  'Диплом вуза (бакалавр / специалист / магистр)',
  'Пока без аттестата',
];

const GRADE_BANDS = [
  '1.0–1.5 (отлично)',
  '1.6–2.0 (очень хорошо)',
  '2.1–2.5 (хорошо)',
  '2.6–3.0 (средне)',
  '3.1–3.5 (ниже среднего)',
  '3.6–4.0 (впритык)',
  'Не помню точно',
];

const SUBJECTS = [
  'Математика',
  'Физика',
  'Химия',
  'Биология',
  'Информатика',
  'Немецкий',
  'Английский',
  'Другие языки',
  'История',
  'География',
  'Экономика / бизнес',
  'Искусство / рисование',
  'Музыка',
  'Спорт',
  'Ручной труд / техника',
  'Обществознание',
];

const GERMAN_LEVELS = [
  'Не знаю немецкого',
  'A1',
  'A2',
  'B1',
  'B2',
  'C1',
  'C2',
  'Родной язык',
];
const ENGLISH_LEVELS = ['Нет', 'Базовый (A1–A2)', 'Средний (B1–B2)', 'Свободный (C1+)'];

const PERMITS = [
  'Гражданство ЕС',
  'Голубая карта / §18 уже есть',
  'Чансенкарта (Chancenkarte)',
  'Виза соискателя работы',
  'Нужна виза / спонсорство',
  'Студент (до 20 ч/нед)',
];

const INTERESTS = [
  'Люди и общение',
  'Техника и машины',
  'Компьютеры и IT',
  'Медицина и уход',
  'Ремёсла и работа руками',
  'Кулинария и еда',
  'Строительство и ремонт',
  'Природа и животные',
  'Транспорт и вождение',
  'Дети и педагогика',
  'Офисная работа и документы',
  'Творчество и дизайн',
  'Продажи и сервис',
  'Физическая / практическая работа',
  'Науки и лаборатории',
  'Порядок и организация',
];

const VALUES_AUSBILDUNG = [
  'Остаться в компании после Ausbildung',
  'Хорошая Ausbildungsvergütung',
  'Стабильная профессия',
  'Помогать людям',
  'Творчество',
  'Работать руками',
  'Команда и общение',
  'Близко к дому',
  'Хорошие наставники',
  'Карьерный рост после обучения',
  'Спокойная обстановка',
];

const VALUES_JOB = [
  'Хороший доход',
  'Стабильность',
  'Карьерный рост',
  'Помогать людям',
  'Творчество',
  'Работать руками',
  'Команда и общение',
  'Гибкий график',
  'Близко к дому',
  'Быстро выйти на работу',
  'Самостоятельность',
  'Спокойная работа',
];

const AUSBILDUNG_EXAMPLES = [
  'Fachinformatiker/in',
  'Kfz-Mechatroniker/in',
  'Pflegefachkraft',
  'Koch / Köchin',
  'Verkäufer/in',
  'Elektroniker/in',
  'Anlagenmechaniker SHK',
  'Friseur/in',
  'Steuerfachangestellte/r',
  'Hotelfachmann/frau',
];

const JOB_EXAMPLES = [
  'Водитель (кат. B / C)',
  'Склад / логистика',
  'Повар',
  'Уход за пожилыми',
  'Строительство',
  'Производство / фабрика',
  'Продавец-кассир',
  'Клининг / уборка',
  'IT / поддержка',
  'Доставка',
];

const CITY_EXAMPLES = [
  'Берлин',
  'Мюнхен',
  'Гамбург',
  'Франкфурт-на-Майне',
  'Кёльн',
  'Дюссельдорф',
  'Штутгарт',
  'Лейпциг',
  'Дрезден',
  'Ганновер',
  'Вся Германия',
];

const RADII = [
  'В самом городе',
  '+10 км от города',
  '+25 км',
  '+50 км',
  '+100 км',
  '+200 км',
  'Вся федеральная земля / регион',
  'Вся Германия',
];

const RELOCATIONS_AUSBILDUNG = [
  'Только из дома или рядом',
  'Готов(а) переехать в другой город Германии',
  'Готов(а) переехать, если помогут с жильём (Wohnheim / WG)',
];

const RELOCATIONS_JOB = [
  'Не готов к переезду',
  'Готов переехать в другой город Германии',
  'Готов переехать, если работодатель поможет с жильём',
];

const LICENSES_JOB = [
  'Нет',
  'Категория B (легковые)',
  'B + C (грузовые)',
  'C / CE (дальнобой)',
  'A (мотоцикл)',
];

const LICENSES_AUSBILDUNG = [
  'Нет, пока не планирую',
  'Сдаю или скоро сдам (B)',
  'Категория B (легковые)',
  'AM (мопед) или A (мотоцикл)',
  'B + C (грузовые)',
];

const FORMATS_JOB = [
  'Любой',
  'Полный день',
  'Неполный день',
  'Минижоб',
  'Сменный график',
  'Удалённо',
  'Гибрид',
];

const TRAINING_TYPES = [
  'Дуальная: в компании + Berufsschule',
  'Школьная: в Berufsfachschule (например, уход, воспитание)',
  'Неполный день (Teilzeitausbildung)',
  'Не знаю разницы — объясни',
  'Любая',
];

const SALARY_EXAMPLES_JOB = [
  'Не определился — пусть агент оценит по рынку',
  '14–18 €/час',
  '2500–3000 € брутто/мес',
  '3000–4000 € брутто/мес',
  '4000+ € брутто/мес',
];

const VERGUETUNG_EXAMPLES = [
  'Не определился — пусть агент оценит по рынку',
  'Главное — взяли, доход не критичен',
  'От 800 € в месяц',
  'От 1000 € в месяц',
  'От 1200 € в месяц',
  'Нужна поддержка (BAB / Wohngeld)',
];

const GRADUATIONS_JOB = [
  'Школа, без профессионального образования',
  'Профессиональное училище / колледж / техникум',
  'Немецкая Berufsausbildung',
  'Meister / Techniker',
  'Диплом вуза (бакалавр)',
  'Диплом вуза (магистр / специалист)',
  'Нет формального образования',
];

const PERMITS_AUSBILDUNG = [
  'Гражданство ЕС / ПМЖ',
  'Вид на жительство, работать можно',
  'Duldung / Gestattung (нужно разрешение на Ausbildung)',
  'Нужна виза для Ausbildung (§16a AufenthG)',
  'Не разобрался — нужна консультация',
];

const RECOGNITION_AUSBILDUNG = [
  'Признан (Zeugnisbewertung / anabin)',
  'Подал(а), жду результата',
  'Не подавал(а)',
  'Не знаю, что это — объясни',
];

const RECOGNITION_JOB = [
  'Признан полностью',
  'Подал(а) заявку, жду',
  'Не подавал(а) — нужна помощь',
  'Для моей профессии не требуется',
  'Не знаю, что это — объясни',
];

const START_AUSBILDUNG = [
  'Как можно скорее',
  'С ближайшего набора (обычно август–сентябрь)',
  'Через год',
  'Пока не знаю',
];

const START_JOB = [
  'Сразу',
  'Через 2–4 недели',
  'Через 1–3 месяца (срок увольнения)',
  'Позже, чем через 3 месяца',
  'Пока не знаю',
];

const TRYOUT_OPTIONS = [
  'Да, готов(а) на пробный день или практику',
  'Да, и на EQ (подготовительный год перед Ausbildung)',
  'Только сразу на Ausbildung',
  'Не знаю, что это — объясни',
];

const SENIORITY = [
  'Без опыта в этой сфере — начинаю с нуля',
  'Помощник (Helfer), без квалификации',
  'Квалифицированный специалист (Fachkraft)',
  'Опытный специалист / Senior',
  'Руководитель / Teamleiter',
];

const GERMANY_EXPERIENCE = [
  'Да, официальная работа',
  'Да, минижоб или подработка',
  'Нет, только в другой стране',
  'Нет опыта работы вообще',
];

const CONTRACTS = [
  'Любой',
  'Только бессрочный (unbefristet)',
  'Срочный подойдёт (befristet)',
  'Zeitarbeit подойдёт',
];

const DECIDED_YES = 'Знаю, кем хочу быть';
const DECIDED_NO = 'Ещё не определился — пусть ИИ подберёт по моей анкете';

/* -------------------------------- Вопросы -------------------------------- */

const SKIP = 'Пропустить';
const notGermany = (p: UserProfile) => !!p.schoolCountry && p.schoolCountry !== 'В Германии';

/** Анкета для Ausbildung: школа, оценки, вид обучения, старт, Vergütung. */
function ausbildungQuestions(): WizardQuestion[] {
  return [
    // ---------- Этап 1: знакомство ----------
    {
      id: 'name', label: 'Имя', stageIdx: 0,
      question: 'Как тебя зовут?',
      hint: 'Можно только имя — так удобнее разговаривать.',
      kind: 'text', field: 'name', placeholder: 'например, Александр', skipLabel: SKIP,
    },
    {
      id: 'age', label: 'Возраст', stageIdx: 0,
      question: 'Сколько тебе лет?',
      hint: 'Для Ausbildung возраст важен: у части мест есть возрастные рамки, а для несовершеннолетних действуют особые правила.',
      kind: 'text', field: 'age', placeholder: 'например, 17', skipLabel: SKIP,
    },
    {
      id: 'status', label: 'Чем занят сейчас', stageIdx: 0,
      question: 'Чем ты сейчас занят?',
      hint: 'Школа, поиск места или переезд — подстрою поиск под твою ситуацию.',
      kind: 'single', field: 'status', options: STATUSES_AUSBILDUNG, skipLabel: SKIP,
    },

    // ---------- Этап 2: школа и оценки ----------
    {
      id: 'schoolCountry', label: 'Где учился', stageIdx: 1,
      question: 'Где ты учился в школе?',
      kind: 'single', field: 'schoolCountry',
      options: ['В Германии', 'В другой стране', 'В обеих странах'], skipLabel: SKIP,
    },
    {
      id: 'schoolType', label: 'Тип школы', stageIdx: 1,
      question: 'В какой школе ты учился?',
      hint: 'Hauptschule, Realschule, Gymnasium… или обычная школа в другой стране.',
      kind: 'single', field: 'schoolType', options: SCHOOL_TYPES, skipLabel: 'Не помню — не важно',
    },
    {
      id: 'graduation', label: 'Аттестат', stageIdx: 1,
      question: 'Какой у тебя аттестат или диплом?',
      hint: 'Для Ausbildung это ключевой вопрос: многие места указывают минимальный аттестат.',
      kind: 'single', field: 'graduation', options: GRADUATIONS,
      skipLabel: 'Не определился — пусть агент учтёт сам',
    },
    {
      id: 'gradeAverage', label: 'Средний балл', stageIdx: 1,
      question: 'Какой у тебя средний балл (Notendurchschnitt)?',
      hint: 'Немецкая шкала: 1.0 — отлично, 4.0 — на грани. Если школа была в другой стране — напиши по своей шкале (например «4.6 из 5»), я переведу сам.',
      kind: 'text', field: 'gradeAverage', examples: GRADE_BANDS,
      placeholder: 'например, 2.4 или «4.6 из 5»', skipLabel: 'Не помню точно',
    },
    {
      id: 'bestSubjects', label: 'Лучшие предметы', stageIdx: 1,
      question: 'Какие предметы давались лучше всего или нравились?',
      hint: 'Можешь выбрать несколько или написать свои. По ним я подберу направления, если ты ещё не определился.',
      kind: 'multi', field: 'bestSubjects', options: SUBJECTS, skipLabel: SKIP,
    },
    {
      id: 'weakSubjects', label: 'Тяжёлые предметы', stageIdx: 1,
      question: 'А какие предметы давались тяжело?',
      hint: 'Чтобы не предлагать профессии, где это главное (например, математика у Elektroniker/in).',
      kind: 'multi', field: 'weakSubjects', options: SUBJECTS, skipLabel: 'Таких нет',
    },
    {
      id: 'recognition', label: 'Признание аттестата', stageIdx: 1,
      question: 'Признан ли твой аттестат в Германии?',
      hint: 'Для Ausbildung его часто нужно оценить: Zeugnisbewertung или проверка по базе anabin.',
      kind: 'single', field: 'recognition', options: RECOGNITION_AUSBILDUNG,
      skipLabel: 'Не знаю — пусть агент объяснит', depends: notGermany,
    },
    {
      id: 'certificates', label: 'Сертификаты и курсы', stageIdx: 1,
      question: 'Есть сертификаты, курсы, грамоты?',
      hint: 'Goethe B1, курсы первой помощи, онлайн-курсы, олимпиады…',
      kind: 'text', field: 'certificates', placeholder: 'Goethe B1, курсы первой помощи…', skipLabel: SKIP,
    },

    // ---------- Этап 3: языки и статус ----------
    {
      id: 'germanLevel', label: 'Немецкий', stageIdx: 2,
      question: 'Какой у тебя уровень немецкого?',
      hint: 'Berufsschule ведётся на немецком: для большинства мест нужен минимум B1, для ухода и сервиса чаще B2.',
      kind: 'single', field: 'germanLevel', options: GERMAN_LEVELS,
      skipLabel: 'Не знаю / пока не учил', skipValue: 'Не знаю немецкого',
    },
    {
      id: 'englishLevel', label: 'Английский', stageIdx: 2,
      question: 'А английский?',
      kind: 'single', field: 'englishLevel', options: ENGLISH_LEVELS, skipLabel: SKIP,
    },
    {
      id: 'otherLanguages', label: 'Другие языки', stageIdx: 2,
      question: 'Другие языки знаешь?',
      hint: 'Русский, украинский, польский… — для некоторых профессий это плюс.',
      kind: 'text', field: 'otherLanguages', placeholder: 'Русский — родной, польский — A2…', skipLabel: SKIP,
    },
    {
      id: 'workPermit', label: 'Статус проживания', stageIdx: 2,
      question: 'Какой у тебя статус проживания в Германии?',
      hint: 'От него зависит, можно ли начать Ausbildung и нужно ли отдельное разрешение или виза.',
      kind: 'single', field: 'workPermit', options: PERMITS_AUSBILDUNG,
      skipLabel: 'Не разобрался — пусть агент подскажет',
      skipValue: 'Не разобрался — нужна консультация',
    },

    // ---------- Этап 4: профессия и вид обучения ----------
    {
      id: 'decided', label: 'Направление', stageIdx: 3,
      question: 'Ты уже знаешь, на какую Ausbildung хочешь?',
      hint: 'Если ещё не определился — не страшно: я разберу твои интересы, предметы и оценки, и сам подберу профессии.',
      kind: 'single', options: [DECIDED_YES, DECIDED_NO],
      read: (p) => (p.decided === true ? DECIDED_YES : p.decided === false ? DECIDED_NO : undefined),
      store: (value) =>
        value === DECIDED_YES ? { decided: true } : { decided: false, position: undefined },
    },
    {
      id: 'position', label: 'Желаемая профессия', stageIdx: 3,
      question: 'Какую профессию Ausbildung хочешь?',
      hint: 'Напиши своими словами — я пойму и переведу в немецкие названия профессий.',
      kind: 'text', field: 'position', examples: AUSBILDUNG_EXAMPLES,
      placeholder: 'Fachinformatiker, Pflegefachkraft…',
      skipLabel: 'Передумал — пусть ИИ подберёт сам',
      depends: (p) => p.decided === true, store: (value) => ({ position: value }),
    },
    {
      id: 'interests', label: 'Интересы', stageIdx: 3,
      question: 'Что тебе интересно?',
      hint: 'Выбери или напиши своё — по интересам я пойму, какие профессии тебе подойдут.',
      kind: 'multi', field: 'interests', options: INTERESTS,
      skipLabel: 'Пропустить — агент поймёт по остальным ответам',
      depends: (p) => p.decided === false,
    },
    {
      id: 'workValues', label: 'Важно в учёбе', stageIdx: 3,
      question: 'Что для тебя важно в обучении и будущей профессии?',
      kind: 'multi', field: 'workValues', options: VALUES_AUSBILDUNG, skipLabel: SKIP,
      depends: (p) => p.decided === false,
    },
    {
      id: 'strengths', label: 'Сильные стороны', stageIdx: 3,
      question: 'Что у тебя получается лучше всего?',
      hint: 'Например: хорошо объясняю, быстро учусь руками, внимателен к деталям…',
      kind: 'text', field: 'strengths', placeholder: 'быстро учусь, внимателен к деталям…',
      wide: true, skipLabel: SKIP, depends: (p) => p.decided === false,
    },
    {
      id: 'likes', label: 'Что нравилось', stageIdx: 3,
      question: 'Что нравилось в школе или на практике?',
      hint: 'Например: любил лабораторные по химии, разбирал технику, играл в команде…',
      kind: 'text', field: 'likes', placeholder: 'лабораторные, спорт, разбирал технику…',
      wide: true, skipLabel: SKIP, depends: (p) => p.decided === false,
    },
    {
      id: 'format', label: 'Вид обучения', stageIdx: 3,
      question: 'Какой вид Ausbildung подходит?',
      hint: 'Дуальная идёт в компании и в Berufsschule, школьная — целиком в учебном заведении.',
      kind: 'single', field: 'format', options: TRAINING_TYPES,
      skipLabel: 'Не знаю — пусть агент объяснит', skipValue: 'Не знаю разницы — объясни',
    },

    // ---------- Этап 5: практика и навыки ----------
    {
      id: 'experience', label: 'Практика', stageIdx: 4,
      question: 'Была практика, подработка или проект по этой теме?',
      hint: 'Schulpraktikum, Ferienjob, помощь в семейном деле, кружки, волонтёрство — всё считается.',
      kind: 'text', field: 'experience', placeholder: 'летом на складе, практика в мастерской…',
      wide: true, skipLabel: 'Практики пока нет',
    },
    {
      id: 'skills', label: 'Навыки', stageIdx: 4,
      question: 'Что умеешь делать руками или головой?',
      hint: 'Компьютер, рисование, готовка, ремонт, уход за детьми или животными…',
      kind: 'text', field: 'skills', placeholder: 'компьютер, готовка, ремонт…', skipLabel: SKIP,
    },
    {
      id: 'tryout', label: 'Пробный день и EQ', stageIdx: 4,
      question: 'Готов(а) начать с пробного дня или практики?',
      hint: 'Многие компании берут на Ausbildung после Probearbeiten, Praktikum или Einstiegsqualifizierung (EQ) — это заметно повышает шансы.',
      kind: 'single', field: 'tryout', options: TRYOUT_OPTIONS, skipLabel: SKIP,
    },
    {
      id: 'drivingLicense', label: 'Водительские права', stageIdx: 4,
      question: 'Есть водительские права или планируешь сдавать?',
      hint: 'Для части профессий и для дороги до компании это плюс.',
      kind: 'single', field: 'drivingLicense', options: LICENSES_AUSBILDUNG, skipLabel: SKIP,
    },

    // ---------- Этап 6: место и условия ----------
    {
      id: 'city', label: 'Город / регион', stageIdx: 5,
      question: 'Где искать место — город или регион?',
      hint: 'Напиши свой вариант или выбери город. Радиус зададим следующим вопросом.',
      kind: 'text', field: 'city', examples: CITY_EXAMPLES,
      placeholder: 'Берлин, Бавария, вся Германия…',
      skipLabel: 'Не определился — по всей Германии', skipValue: 'Вся Германия',
    },
    {
      id: 'radius', label: 'Радиус', stageIdx: 5,
      question: 'Как далеко от дома готов(а) ездить?',
      hint: 'В компанию и в Berufsschule придётся ездить каждый день — многие выбирают дорогу до часа в одну сторону.',
      kind: 'single', field: 'radius', options: RADII, skipLabel: 'Пусть агент решит',
    },
    {
      id: 'relocation', label: 'Переезд', stageIdx: 5,
      question: 'Готов(а) переехать ради места?',
      kind: 'single', field: 'relocation', options: RELOCATIONS_AUSBILDUNG, skipLabel: SKIP,
    },
    {
      id: 'startDate', label: 'Начало обучения', stageIdx: 5,
      question: 'Когда хочешь начать обучение?',
      hint: 'Большинство Ausbildung стартуют в августе–сентябре, часть — зимой или весной.',
      kind: 'single', field: 'startDate', options: START_AUSBILDUNG, skipLabel: SKIP,
    },
    {
      id: 'salary', label: 'Ausbildungsvergütung', stageIdx: 5,
      question: 'Какая Ausbildungsvergütung тебя устроит?',
      hint: 'Платят по-разному: зависит от профессии и года обучения. Можно пропустить — я оценю для каждого места по рынку.',
      kind: 'text', field: 'salary', examples: VERGUETUNG_EXAMPLES,
      placeholder: 'от 1000 € в месяц…',
      skipLabel: 'Не определился по доходу',
      skipValue: 'Не определился — пусть агент оценит по рынку',
    },
    {
      id: 'extra', label: 'Дополнительно', stageIdx: 5,
      question: 'Что-то ещё, что мне стоит о тебе знать?',
      hint: 'Семья, здоровье, чего хочешь избегать, особые пожелания…',
      kind: 'text', field: 'extra', placeholder: 'пожелания, ограничения, что важно…',
      wide: true, skipLabel: 'Ничего больше',
    },
  ];
}

/** Анкета для поиска работы: профессия, диплом и его признание, опыт, уровень, договор. */
function jobQuestions(): WizardQuestion[] {
  return [
    // ---------- Этап 1: знакомство ----------
    {
      id: 'name', label: 'Имя', stageIdx: 0,
      question: 'Как тебя зовут?',
      hint: 'Можно только имя — так удобнее разговаривать.',
      kind: 'text', field: 'name', placeholder: 'например, Александр', skipLabel: SKIP,
    },
    {
      id: 'age', label: 'Возраст', stageIdx: 0,
      question: 'Сколько тебе лет?',
      hint: 'Для некоторых вакансий и виз возраст имеет значение.',
      kind: 'text', field: 'age', placeholder: 'например, 34', skipLabel: SKIP,
    },
    {
      id: 'status', label: 'Текущая ситуация', stageIdx: 0,
      question: 'Какая у тебя сейчас ситуация?',
      hint: 'Работаешь ли ты сейчас — от этого зависит, как быстро ты можешь выйти на новое место.',
      kind: 'single', field: 'status', options: STATUSES_JOB, skipLabel: SKIP,
    },

    // ---------- Этап 2: образование и квалификация ----------
    {
      id: 'schoolCountry', label: 'Где получено образование', stageIdx: 1,
      question: 'Где ты получил(а) образование?',
      kind: 'single', field: 'schoolCountry',
      options: ['В Германии', 'В другой стране', 'В обеих странах'], skipLabel: SKIP,
    },
    {
      id: 'graduation', label: 'Образование', stageIdx: 1,
      question: 'Какое у тебя профессиональное образование?',
      hint: 'От этого зависит, подойдут ли позиции Fachkraft или только Helfer.',
      kind: 'single', field: 'graduation', options: GRADUATIONS_JOB,
      skipLabel: 'Не определился — пусть агент учтёт сам',
    },
    {
      id: 'qualification', label: 'Профессия по диплому', stageIdx: 1,
      question: 'Какая у тебя профессия или специальность?',
      hint: 'Что написано в дипломе или чем ты занимался(ась) больше всего — например «электрик», «бухгалтер», «водитель-дальнобойщик».',
      kind: 'text', field: 'qualification', placeholder: 'электрик, бухгалтер, повар…',
      skipLabel: 'Нет специальности',
    },
    {
      id: 'recognition', label: 'Признание диплома', stageIdx: 1,
      question: 'Признан ли твой диплом в Германии (Anerkennung)?',
      hint: 'Для регулируемых профессий (медицина, уход, педагогика, часть ремёсел) признание обязательно, для остальных — повышает шансы и зарплату.',
      kind: 'single', field: 'recognition', options: RECOGNITION_JOB,
      skipLabel: 'Не знаю — пусть агент объяснит', depends: notGermany,
    },
    {
      id: 'certificates', label: 'Сертификаты и допуски', stageIdx: 1,
      question: 'Есть сертификаты, курсы, допуски?',
      hint: 'Staplerschein, Hygienepass, Erste Hilfe, Schweißzeugnis, Goethe-Zertifikat…',
      kind: 'text', field: 'certificates', placeholder: 'Staplerschein, Hygienepass…', skipLabel: SKIP,
    },

    // ---------- Этап 3: языки и право на работу ----------
    {
      id: 'germanLevel', label: 'Немецкий', stageIdx: 2,
      question: 'Какой у тебя уровень немецкого?',
      hint: 'Для склада и производства обычно хватает A2–B1, для сервиса и ухода нужен B2, для офиса — B2–C1.',
      kind: 'single', field: 'germanLevel', options: GERMAN_LEVELS,
      skipLabel: 'Не знаю / пока не учил', skipValue: 'Не знаю немецкого',
    },
    {
      id: 'englishLevel', label: 'Английский', stageIdx: 2,
      question: 'А английский?',
      hint: 'В IT и международных компаниях английский часто важнее немецкого.',
      kind: 'single', field: 'englishLevel', options: ENGLISH_LEVELS, skipLabel: SKIP,
    },
    {
      id: 'otherLanguages', label: 'Другие языки', stageIdx: 2,
      question: 'Другие языки знаешь?',
      hint: 'Русский, украинский, польский… — плюс для международных компаний и работы с клиентами.',
      kind: 'text', field: 'otherLanguages', placeholder: 'Русский — родной, польский — A2…', skipLabel: SKIP,
    },
    {
      id: 'workPermit', label: 'Право на работу', stageIdx: 2,
      question: 'Как у тебя с правом на работу в Германии?',
      kind: 'single', field: 'workPermit', options: PERMITS,
      skipLabel: 'Не разобрался — пусть агент подскажет',
      skipValue: 'Не разобрался — нужна консультация',
    },

    // ---------- Этап 4: должность и уровень ----------
    {
      id: 'decided', label: 'Направление', stageIdx: 3,
      question: 'Ты уже знаешь, кем хочешь работать?',
      hint: 'Если ещё не определился — не страшно: я разберу твой опыт, образование и интересы, и сам подберу направления.',
      kind: 'single', options: [DECIDED_YES, DECIDED_NO],
      read: (p) => (p.decided === true ? DECIDED_YES : p.decided === false ? DECIDED_NO : undefined),
      store: (value) =>
        value === DECIDED_YES ? { decided: true } : { decided: false, position: undefined },
    },
    {
      id: 'position', label: 'Желаемая должность', stageIdx: 3,
      question: 'Какая должность или сфера тебя интересует?',
      hint: 'Напиши своими словами — я пойму и переведу в немецкие термины поиска.',
      kind: 'text', field: 'position', examples: JOB_EXAMPLES,
      placeholder: 'Водитель погрузчика, повар, разработчик…',
      skipLabel: 'Передумал — пусть ИИ подберёт сам',
      depends: (p) => p.decided === true, store: (value) => ({ position: value }),
    },
    {
      id: 'interests', label: 'Интересы', stageIdx: 3,
      question: 'Что тебе интересно?',
      hint: 'Выбери или напиши своё — по интересам я пойму, какие направления тебе подойдут.',
      kind: 'multi', field: 'interests', options: INTERESTS,
      skipLabel: 'Пропустить — агент поймёт по остальным ответам',
      depends: (p) => p.decided === false,
    },
    {
      id: 'workValues', label: 'Важно в работе', stageIdx: 3,
      question: 'Что для тебя важно в работе?',
      kind: 'multi', field: 'workValues', options: VALUES_JOB, skipLabel: SKIP,
      depends: (p) => p.decided === false,
    },
    {
      id: 'strengths', label: 'Сильные стороны', stageIdx: 3,
      question: 'Что у тебя получается лучше всего?',
      hint: 'Например: самостоятельно организую работу, быстро разбираюсь в технике, умею договариваться…',
      kind: 'text', field: 'strengths', placeholder: 'организую работу, разбираюсь в технике…',
      wide: true, skipLabel: SKIP, depends: (p) => p.decided === false,
    },
    {
      id: 'likes', label: 'Что нравилось в работе', stageIdx: 3,
      question: 'Что нравилось на прошлых работах или в учёбе?',
      hint: 'Например: работа с людьми, самостоятельность, техника, порядок, чёткие задачи…',
      kind: 'text', field: 'likes', placeholder: 'работа с людьми, техника, порядок…',
      wide: true, skipLabel: SKIP, depends: (p) => p.decided === false,
    },
    {
      id: 'seniority', label: 'Уровень позиции', stageIdx: 3,
      question: 'Какой уровень позиции тебе подходит?',
      hint: 'Helfer и Fachkraft — разные вакансии с разной оплатой: так я не буду предлагать слишком низкие или слишком высокие.',
      kind: 'single', field: 'seniority', options: SENIORITY, skipLabel: SKIP,
    },
    {
      id: 'avoid', label: 'Чего избегать', stageIdx: 3,
      question: 'Чего ты точно не хочешь в работе?',
      hint: 'Например: ночные смены, тяжёлый физический труд, общение с клиентами, долгая дорога.',
      kind: 'text', field: 'avoid', placeholder: 'ночные смены, тяжёлый труд…',
      wide: true, skipLabel: 'Ограничений нет',
    },

    // ---------- Этап 5: опыт и навыки ----------
    {
      id: 'experience', label: 'Опыт работы', stageIdx: 4,
      question: 'Какой у тебя опыт работы?',
      hint: 'Где и кем работал(а), сколько лет — в том числе в другой стране. Можно коротко, подробности возьму из Lebenslauf.',
      kind: 'text', field: 'experience', placeholder: '3 года водителем, 2 года на складе…',
      wide: true, skipLabel: 'Опыта пока нет',
    },
    {
      id: 'germanyExperience', label: 'Опыт в Германии', stageIdx: 4,
      question: 'Есть опыт работы в Германии?',
      hint: 'Немецкие работодатели смотрят на это отдельно.',
      kind: 'single', field: 'germanyExperience', options: GERMANY_EXPERIENCE, skipLabel: SKIP,
    },
    {
      id: 'skills', label: 'Навыки', stageIdx: 4,
      question: 'Какими навыками и программами владеешь?',
      hint: 'Касса, склад, Excel, SAP, сварка, кулинария, ремонт техники…',
      kind: 'text', field: 'skills', placeholder: 'касса, склад, Excel…', skipLabel: SKIP,
    },
    {
      id: 'drivingLicense', label: 'Водительские права', stageIdx: 4,
      question: 'Есть водительские права?',
      kind: 'single', field: 'drivingLicense', options: LICENSES_JOB, skipLabel: SKIP,
    },

    // ---------- Этап 6: условия работы ----------
    {
      id: 'city', label: 'Город / регион', stageIdx: 5,
      question: 'Где искать работу — город или регион?',
      hint: 'Напиши свой вариант или выбери город. Радиус зададим следующим вопросом.',
      kind: 'text', field: 'city', examples: CITY_EXAMPLES,
      placeholder: 'Берлин, Бавария, вся Германия…',
      skipLabel: 'Не определился — по всей Германии', skipValue: 'Вся Германия',
    },
    {
      id: 'radius', label: 'Радиус', stageIdx: 5,
      question: 'Как далеко от города готов ездить на работу?',
      hint: 'Например: «25 км» — значит, ищем и в соседних городах в этом радиусе.',
      kind: 'single', field: 'radius', options: RADII, skipLabel: 'Пусть агент решит',
    },
    {
      id: 'relocation', label: 'Переезд', stageIdx: 5,
      question: 'Готов переехать ради работы?',
      kind: 'single', field: 'relocation', options: RELOCATIONS_JOB, skipLabel: SKIP,
    },
    {
      id: 'startDate', label: 'Когда выйти', stageIdx: 5,
      question: 'Когда готов выйти на работу?',
      hint: 'Если ты сейчас работаешь, учти срок увольнения.',
      kind: 'single', field: 'startDate', options: START_JOB, skipLabel: SKIP,
    },
    {
      id: 'salary', label: 'Доход', stageIdx: 5,
      question: 'Какие ожидания по доходу?',
      hint: 'Можно пропустить: тогда для каждой вакансии я честно оценю, сколько на ней платят по рынку.',
      kind: 'text', field: 'salary', examples: SALARY_EXAMPLES_JOB,
      placeholder: '14–18 €/час, 2800 € брутто…',
      skipLabel: 'Не определился по доходу',
      skipValue: 'Не определился — пусть агент оценит по рынку',
    },
    {
      id: 'format', label: 'График', stageIdx: 5,
      question: 'Какой формат работы подходит?',
      kind: 'single', field: 'format', options: FORMATS_JOB,
      skipLabel: 'Не определился', skipValue: 'Не определился',
    },
    {
      id: 'contract', label: 'Тип договора', stageIdx: 5,
      question: 'Какой тип договора тебя устроит?',
      hint: 'Unbefristet — бессрочный, befristet — на срок, Zeitarbeit — через агентство временного найма.',
      kind: 'single', field: 'contract', options: CONTRACTS, skipLabel: SKIP,
    },
    {
      id: 'extra', label: 'Дополнительно', stageIdx: 5,
      question: 'Что-то ещё, что мне стоит о тебе знать?',
      hint: 'Семья, график, ограничения по здоровью, особые пожелания…',
      kind: 'text', field: 'extra', placeholder: 'пожелания, ограничения, что важно…',
      wide: true, skipLabel: 'Ничего больше',
    },
  ];
}

/** Свободный чат: сначала нужно выбрать цель, потом анкета подстроится. */
function goalPickQuestion(): WizardQuestion {
  return {
    id: 'goalPick', label: 'Цель', stageIdx: 0,
    question: 'Что ты хочешь найти?',
    hint: 'Определимся с целью — остальная анкета подстроится под неё.',
    kind: 'single', options: ['Поиск работы', 'Ausbildung'],
    read: (p) =>
      p.goal === 'job' ? 'Поиск работы' : p.goal === 'ausbildung' ? 'Ausbildung' : undefined,
    store: (value) => ({ goal: value.startsWith('Ausbildung') ? 'ausbildung' : 'job' }),
    skipLabel: 'Пока не решил — просто пообщаемся',
  };
}

/** У каждой цели — своя анкета, а не одна с подменой слов. */
export function buildWizardQuestions(goal: Goal): WizardQuestion[] {
  if (goal === 'ausbildung') return ausbildungQuestions();
  if (goal === 'job') return jobQuestions();
  return [goalPickQuestion()];
}

/* ------------------------------- Хелперы ------------------------------- */

export function questionValue(
  q: WizardQuestion,
  p: UserProfile,
): string | string[] | undefined {
  if (q.read) return q.read(p);
  const v = p[q.field as keyof UserProfile];
  if (Array.isArray(v)) {
    const strings = v.filter((x): x is string => typeof x === 'string');
    return strings.length ? strings : undefined;
  }
  if (typeof v === 'string') return v.trim() ? v : undefined;
  if (typeof v === 'boolean') return v ? 'да' : 'нет';
  return undefined;
}

export function isSkipped(q: WizardQuestion, p: UserProfile): boolean {
  return !!p.wizardSkipped?.includes(q.id) && questionValue(q, p) === undefined;
}

export function isAnswered(q: WizardQuestion, p: UserProfile): boolean {
  return questionValue(q, p) !== undefined || isSkipped(q, p);
}

export function visibleQuestions(goal: Goal, p: UserProfile): WizardQuestion[] {
  return buildWizardQuestions(goal).filter((q) => !q.depends || q.depends(p));
}

/** Записать ответ (клик по чипу, выбор или свой текст). */
export function applyAnswer(
  goal: Goal,
  p: UserProfile,
  q: WizardQuestion,
  value: string | string[],
): UserProfile {
  const patch: Partial<UserProfile> = q.store
    ? q.store(Array.isArray(value) ? value.join(', ') : value)
    : q.field
      ? { [q.field]: value } as Partial<UserProfile>
      : {};
  // снимаем метку «пропущено»
  const skipped = (p.wizardSkipped || []).filter((id) => id !== q.id);
  const next: UserProfile = { ...p, ...patch, wizardSkipped: skipped.length ? skipped : undefined };

  // смена выбора «знаю/не определился» — подчистить зависимые поля противоположной ветки
  if (q.id === 'decided') {
    const decided = patch.decided;
    if (decided === true) {
      delete next.interests;
      delete next.workValues;
      delete next.strengths;
      delete next.likes;
    } else if (decided === false) {
      delete next.position;
    }
  }
  // выбор цели в свободном чате меняет набор примеров дальше — пересобираем вопросы автоматически
  return next;
}

/** Пропустить вопрос. */
export function applySkip(goal: Goal, p: UserProfile, q: WizardQuestion): UserProfile {
  if (q.skipValue) {
    return applyAnswer(goal, p, q, q.skipValue);
  }
  const skipped = p.wizardSkipped ?? [];
  return { ...p, wizardSkipped: skipped.includes(q.id) ? [...skipped] : [...skipped, q.id] };
}

/** Сбросить ответ: вопрос снова «не отвечен» (без пометки «пропущено»). */
export function applyClear(p: UserProfile, q: WizardQuestion): UserProfile {
  if (q.id === 'goalPick') return p; // цель сбросить нельзя — от неё зависит вся анкета
  const next: UserProfile = { ...p };
  if (q.id === 'decided') {
    delete next.decided;
    delete next.position;
  } else if (q.field) {
    delete (next as unknown as Record<string, unknown>)[q.field];
  }
  const skipped = (p.wizardSkipped ?? []).filter((id) => id !== q.id);
  next.wizardSkipped = skipped.length ? skipped : undefined;
  return next;
}

export function answerToText(value: string | string[] | undefined): string {
  if (value === undefined) return 'Пропущено';
  if (Array.isArray(value)) return value.join(', ');
  return value;
}

/** Чистит профиль перед отправкой агенту: убирает служебное и мусор веток. */
export function finalizeProfile(
  goal: Goal,
  p: UserProfile,
  opts: { keepAnalysis?: boolean } = {},
): UserProfile {
  const decided = p.decided;
  const clean: UserProfile = {
    ...p,
    goal: p.goal && p.goal !== 'chat' ? p.goal : goal,
    name: p.name?.trim() || undefined,
    age: p.age?.trim() || undefined,
    certificates: p.certificates?.trim() || undefined,
    otherLanguages: p.otherLanguages?.trim() || undefined,
    gradeAverage: p.gradeAverage?.trim() || undefined,
    position: decided === false ? undefined : p.position?.trim() || undefined,
    strengths: decided === false ? p.strengths?.trim() || undefined : undefined,
    likes: decided === false ? p.likes?.trim() || undefined : undefined,
    experience: p.experience?.trim() || undefined,
    skills: p.skills?.trim() || undefined,
    city: p.city?.trim() || undefined,
    salary: p.salary?.trim() || undefined,
    extra: p.extra?.trim() || undefined,
    customSections: normalizeCustomSections(p.customSections, { dropEmpty: true }),
    // по умолчанию анализ будет сделан заново; при правке без пересчёта оставляем прежний
    aiAnalysis: opts.keepAnalysis ? p.aiAnalysis : undefined,
    aiDirections: opts.keepAnalysis ? p.aiDirections : undefined,
    analysisRounds: opts.keepAnalysis ? p.analysisRounds : 0,
  };
  // признание аттестата/диплома спрашивается только при учёбе вне Германии
  if (clean.schoolCountry === 'В Германии') delete clean.recognition;
  if (!clean.weakSubjects?.length) delete clean.weakSubjects;
  clean.qualification = clean.qualification?.trim() || undefined;
  clean.avoid = clean.avoid?.trim() || undefined;
  if (!clean.customSections?.length) delete clean.customSections;
  if (!clean.interests?.length) delete clean.interests;
  if (!clean.workValues?.length) delete clean.workValues;
  if (!clean.bestSubjects?.length) delete clean.bestSubjects;
  return clean;
}

/* ------------------------- Что изменилось в профиле ------------------------- */

export interface ProfileChange {
  id: string;
  label: string;
  before: string;
  after: string;
}

/** Правки, после которых пересчитывать анализ не нужно. */
const LIGHT_CHANGE_IDS = new Set(['name']);

function normText(v: string | string[] | undefined): string {
  if (v === undefined) return '';
  return (Array.isArray(v) ? v.join(', ') : v).trim();
}

/**
 * Сравнивает профиль с сохранённым снимком: какие ответы поменялись, нужен ли пересчёт анализа.
 * Учитываются ответы анкеты (включая пропуски), документы и свои разделы.
 */
export function profileChanges(
  goal: Goal,
  prev: UserProfile | null | undefined,
  next: UserProfile,
): { changes: ProfileChange[]; needsReanalysis: boolean } {
  const before = prev ?? ({ goal } as UserProfile);
  const changes: ProfileChange[] = [];

  for (const q of buildWizardQuestions(goal)) {
    const a = normText(questionValue(q, before));
    const b = normText(questionValue(q, next));
    const aSkip = isSkipped(q, before);
    const bSkip = isSkipped(q, next);
    if (a === b && aSkip === bSkip) continue;
    changes.push({
      id: q.id,
      label: q.label,
      before: a || (aSkip ? 'пропущено' : 'не отвечено'),
      after: b || (bSkip ? 'пропущено' : 'не отвечено'),
    });
  }

  const docIds = (p: UserProfile) => (p.documents ?? []).map((d) => d.id).join('|');
  if (docIds(before) !== docIds(next)) {
    changes.push({
      id: 'documents',
      label: 'Документы',
      before: `${before.documents?.length ?? 0} шт.`,
      after: `${next.documents?.length ?? 0} шт.`,
    });
  }

  const cb = customFieldLines(before.customSections).join('\n');
  const cn = customFieldLines(next.customSections).join('\n');
  if (cb !== cn) {
    changes.push({
      id: 'customSections',
      label: 'Свои разделы',
      before: `${customFieldLines(before.customSections).length} полей`,
      after: `${customFieldLines(next.customSections).length} полей`,
    });
  }

  return { changes, needsReanalysis: changes.some((c) => !LIGHT_CHANGE_IDS.has(c.id)) };
}

/**
 * Перенос памяти в новую сессию: какие поля анкеты человека уже известны.
 * Цель (работа/Ausbildung) и доход не переносим — их спрашивают заново,
 * всё остальное (школа, языки, город, документы…) переезжает как есть.
 */
export function prefillFromProfile(prev: UserProfile | null, goal: Goal): Partial<UserProfile> {
  if (!prev) return {};
  const src = prev as unknown as Record<string, unknown>;
  // Только то, что не зависит от цели и со временем почти не меняется.
  // Старт, доход, договор, уровень позиции и т.п. всегда спрашиваются заново.
  const carryKeys = [
    'name', 'age', 'status',
    'schoolCountry', 'schoolType', 'graduation', 'gradeAverage', 'bestSubjects', 'weakSubjects',
    'qualification', 'recognition', 'certificates',
    'germanLevel', 'englishLevel', 'otherLanguages', 'workPermit',
    'experience', 'germanyExperience', 'skills', 'drivingLicense',
    'city', 'radius', 'relocation', 'format', 'extra',
    'interests', 'workValues', 'strengths', 'likes',
    'documents',
  ] as const;
  // У анкеты каждой цели свои вопросы и свои варианты ответов: переносим поле только если
  // в новой анкете такой вопрос есть, а выбранное значение входит в её варианты.
  const asked = new Map(
    buildWizardQuestions(goal)
      .filter((q) => q.field)
      .map((q) => [q.field as string, q]),
  );
  const out: Record<string, unknown> = {};
  for (const k of carryKeys) {
    const v = src[k];
    if (v === undefined || v === null || v === '') continue;
    if (k !== 'documents') {
      const q = asked.get(k);
      if (!q) continue;
      if (q.kind === 'single' && q.options && typeof v === 'string' && !q.options.includes(v)) continue;
    }
    out[k] = v;
  }
  if (prev.decided === false && asked.has('interests')) out.interests = prev.interests ?? [];
  return out as Partial<UserProfile>;
}
