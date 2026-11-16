'use client';

// Анкета профиля как страница-«регистрация»: этапы слева, поля этапа в центре.
// Каждый вопрос можно пропустить («не определился», «не помню») — агент учтёт
// остальными ответами. Отдельный этап — документы (Lebenslauf, PDF/DOCX/TXT),
// текст которых агент читает и использует при анализе и поиске.

import { useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Brain,
  Briefcase,
  Check,
  CheckCircle2,
  ClipboardCheck,
  CloudUpload,
  Compass,
  FileText,
  GraduationCap,
  Languages,
  Loader2,
  MapPin,
  Menu,
  MessageSquare,
  Plus,
  RotateCcw,
  Save,
  Send,
  Sparkles,
  Trash2,
  User,
  Wrench,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  CUSTOM_STAGE,
  DOCUMENTS_STAGE,
  WIZARD_STAGE_COUNT,
  profileChanges,
  wizardStages,
  answerToText,
  isAnswered,
  isSkipped,
  questionValue,
  visibleQuestions,
  type WizardQuestion,
  type ProfileChange,
  type WizardStage,
} from '@/lib/profile-wizard';
import {
  CUSTOM_LIMITS,
  CUSTOM_SECTION_TEMPLATES,
  customFieldLines,
  customFilledCount,
  newCustomId,
} from '@/lib/custom-sections';
import { MemoryPanelContent } from '@/components/app/memory-panel';
import { GOAL_LABELS } from '@/lib/types';
import type { CustomSection, Goal, PersonModel, ProfileDocument, UserProfile } from '@/lib/types';

const STAGE_ICONS = [User, GraduationCap, Languages, Compass, Wrench, MapPin, FileText, Sparkles];

const ACCEPT = '.pdf,.docx,.doc,.txt,.md,.rtf,.csv';
const MAX_FILE = 10 * 1024 * 1024;
const MAX_DOCS = 6;

interface UploadItem {
  id: string;
  name: string;
  size: number;
  status: 'parse' | 'error';
  error?: string;
}

interface ProfileFormPageProps {
  goal: Goal;
  profile: UserProfile;
  busy: boolean;
  submitting: boolean;
  sessionId: string;
  /** Профиль уже проанализирован и открыт на правку: сессия и анализ не сбрасываются. */
  editMode: boolean;
  /** Снимок профиля на момент открытия правки (для отметки изменений). */
  baseline: UserProfile | null;
  onAnswer: (q: WizardQuestion, value: string | string[]) => void;
  onSkip: (q: WizardQuestion) => void;
  onClear: (q: WizardQuestion) => void;
  onCustomSectionsChange: (sections: CustomSection[]) => void;
  onDocumentsChange: (docs: ProfileDocument[]) => void;
  onSubmit: (finalProfile: UserProfile) => void;
  onSaveEdit: (reanalyze: boolean) => void;
  onModelChange: (m: PersonModel) => void;
  onExit: () => void;
  onToggleSidebar: () => void;
}

const REVIEW_STEP = WIZARD_STAGE_COUNT; // 8 — шаг «Проверка и отправка»
const MEMORY_STEP = REVIEW_STEP + 1; // 9 — вкладка «Память агента»

export function ProfileFormPage(props: ProfileFormPageProps) {
  const {
    goal,
    profile,
    busy,
    submitting,
    sessionId,
    editMode,
    baseline,
    onAnswer,
    onSkip,
    onClear,
    onCustomSectionsChange,
    onDocumentsChange,
    onSubmit,
    onSaveEdit,
    onModelChange,
    onExit,
    onToggleSidebar,
  } = props;

  const [step, setStep] = useState(0);
  const [uploads, setUploads] = useState<UploadItem[]>([]);

  const questions = useMemo(() => visibleQuestions(goal, profile), [goal, profile]);
  const stages = useMemo(() => wizardStages(goal), [goal]);
  const answeredCount = questions.filter((q) => isAnswered(q, profile)).length;
  const uploading = uploads.some((u) => u.status === 'parse');
  const docs = profile.documents || [];

  /* Текстовые поля: каждое нажатие сразу наверх (page сам дебаунсит сохранение) */
  const setTextField = (q: WizardQuestion, value: string) => onAnswer(q, value);

  const stageQuestions = (idx: number) => questions.filter((q) => q.stageIdx === idx);

  const stageStats = (idx: number): { done: number; total: number; complete: boolean } => {
    if (idx === DOCUMENTS_STAGE) {
      // Документы: этап необязательный, считается заполненным, если что-то приложено
      return { done: docs.length, total: 0, complete: docs.length > 0 };
    }
    if (idx === CUSTOM_STAGE) {
      // Свои разделы: необязательный этап, заполнен, если есть хотя бы одно своё поле со значением
      const filled = customFilledCount(profile.customSections);
      return { done: filled, total: 0, complete: filled > 0 };
    }
    const qs = stageQuestions(idx);
    const done = qs.filter((q) => isAnswered(q, profile)).length;
    return { done, total: qs.length, complete: qs.length > 0 && done === qs.length };
  };

  const goTo = (target: number) => setStep(target);

  const submit = () => onSubmit(profile);

  // Что поменялось с момента открытия правки (только в режиме правки)
  const diff = useMemo(
    () => (editMode ? profileChanges(goal, baseline, profile) : null),
    [editMode, goal, baseline, profile],
  );

  const GoalIcon = goal === 'job' ? Briefcase : goal === 'ausbildung' ? GraduationCap : MessageSquare;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Шапка */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-3 sm:px-4">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 lg:hidden"
          onClick={onToggleSidebar}
          aria-label="Меню"
        >
          <Menu className="h-5 w-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">
            {editMode ? 'Редактирование профиля' : 'Заполнение профиля'}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {editMode
              ? `${GOAL_LABELS[goal]} · правь любой ответ, изменения сохраняются сразу, анализ не сбрасывается`
              : `${GOAL_LABELS[goal]} · как в регистрации: этап за этапом, всё можно пропустить`}
          </div>
        </div>
        <Button variant="ghost" size="sm" className="shrink-0 gap-1.5" onClick={onExit}>
          <MessageSquare className="h-4 w-4" />
          <span className="hidden sm:inline">{editMode ? 'Готово, в чат' : 'Свернуть в чат'}</span>
          <span className="sm:hidden">{editMode ? 'Готово' : 'Чат'}</span>
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Левая колонка этапов (desktop) */}
        <nav className="hidden w-64 shrink-0 flex-col border-r border-border bg-muted/30 md:flex">
          <div className="px-4 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Этапы анкеты
          </div>
          <div className="flex flex-col gap-1 p-2">
            {stages.map((s, i) => {
              const Icon = STAGE_ICONS[i];
              const st = stageStats(i);
              const active = step === i;
              return (
                <button
                  key={s.title}
                  type="button"
                  onClick={() => goTo(i)}
                  className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
                    active
                      ? 'bg-background font-medium shadow-sm ring-1 ring-border'
                      : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
                  }`}
                >
                  <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-red-600 dark:text-red-400' : ''}`} />
                  <span className="min-w-0 flex-1 truncate">{s.title}</span>
                  {st.complete ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                  ) : st.total > 0 ? (
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                      {st.done}/{st.total}
                    </span>
                  ) : null}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => goTo(REVIEW_STEP)}
              className={`mt-1 flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
                step === REVIEW_STEP
                  ? 'bg-background font-medium shadow-sm ring-1 ring-border'
                  : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
              }`}
            >
              <ClipboardCheck
                className={`h-4 w-4 shrink-0 ${step === REVIEW_STEP ? 'text-red-600 dark:text-red-400' : ''}`}
              />
              <span className="min-w-0 flex-1 truncate">
                {editMode ? 'Проверка и сохранение' : 'Проверка и отправка'}
              </span>
              {diff && diff.changes.length > 0 && (
                <span className="shrink-0 rounded-full bg-amber-100 px-1.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                  {diff.changes.length}
                </span>
              )}
              {answeredCount === questions.length && (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
              )}
            </button>
            <button
              type="button"
              onClick={() => goTo(MEMORY_STEP)}
              className={`mt-1 flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
                step === MEMORY_STEP
                  ? 'bg-background font-medium shadow-sm ring-1 ring-border'
                  : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
              }`}
            >
              <Brain
                className={`h-4 w-4 shrink-0 ${step === MEMORY_STEP ? 'text-red-600 dark:text-red-400' : ''}`}
              />
              <span className="min-w-0 flex-1 truncate">Память агента</span>
              {profile.personModel && profile.personModel.sections.some((s) => s.facts.length > 0) && (
                <BrainBadge model={profile.personModel} />
              )}
            </button>
          </div>
          <div className="mt-auto px-4 pb-4 text-[11px] leading-relaxed text-muted-foreground">
            Отвечено {answeredCount} из {questions.length}. Пропущенное агент восстановит из
            остальных ответов и приложенных документов.
          </div>
        </nav>

        {/* Основная колонка */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Этапы (mobile) */}
          <div className="shrink-0 overflow-x-auto border-b border-border px-3 py-2 md:hidden">
            <div className="flex gap-1.5">
              {stages.map((s, i) => {
                const st = stageStats(i);
                return (
                  <button
                    key={s.title}
                    type="button"
                    onClick={() => goTo(i)}
                    className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                      step === i
                        ? 'border-red-500 bg-red-50 font-medium text-red-700 dark:bg-red-950/50 dark:text-red-300'
                        : 'border-border text-muted-foreground'
                    }`}
                  >
                    {st.complete && <Check className="h-3 w-3 text-emerald-500" />}
                    {s.title}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => goTo(REVIEW_STEP)}
                className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                  step === REVIEW_STEP
                    ? 'border-red-500 bg-red-50 font-medium text-red-700 dark:bg-red-950/50 dark:text-red-300'
                    : 'border-border text-muted-foreground'
                }`}
              >
                Проверка
              </button>
              <button
                type="button"
                onClick={() => goTo(MEMORY_STEP)}
                className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                  step === MEMORY_STEP
                    ? 'border-red-500 bg-red-50 font-medium text-red-700 dark:bg-red-950/50 dark:text-red-300'
                    : 'border-border text-muted-foreground'
                }`}
              >
                Память
              </button>
            </div>
          </div>

          {/* Содержимое этапа */}
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
            <div className="mx-auto w-full max-w-2xl">
              <AnimatePresence mode="wait">
                <motion.div
                  key={step}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18 }}
                  className="flex flex-col gap-6"
                >
                  {step === MEMORY_STEP ? (
                    <MemoryPanelContent
                      model={profile.personModel ?? null}
                      sessionId={sessionId}
                      onModelChange={onModelChange}
                    />
                  ) : step === REVIEW_STEP ? (
                    <ReviewView
                      goal={goal}
                      profile={profile}
                      questions={questions}
                      onJump={goTo}
                      onEditDoc={() => goTo(DOCUMENTS_STAGE)}
                      onOpenMemory={() => goTo(MEMORY_STEP)}
                      onSubmit={submit}
                      editMode={editMode}
                      diff={diff}
                      onSaveEdit={onSaveEdit}
                      busy={busy}
                      submitting={submitting}
                      uploading={uploading}
                    />
                  ) : (
                    <>
                      <StageHeader idx={step} stages={stages} />
                      {step === DOCUMENTS_STAGE ? (
                        <DocumentsBlock
                          docs={docs}
                          uploads={uploads}
                          setUploads={setUploads}
                          onChangeDocs={onDocumentsChange}
                        />
                      ) : step === CUSTOM_STAGE ? (
                        <CustomSectionsBlock
                          sections={profile.customSections ?? []}
                          onChange={onCustomSectionsChange}
                        />
                      ) : (
                        <div className="flex flex-col gap-5">
                          {stageQuestions(step).length === 0 && (
                            <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                              Вопросы этого этапа появятся, как только ты выберешь цель на первом шаге.
                            </p>
                          )}
                          {stageQuestions(step).map((q) => (
                            <QuestionField
                              key={q.id}
                              q={q}
                              profile={profile}
                              onAnswer={onAnswer}
                              onSkip={onSkip}
                              onClear={onClear}
                              onText={setTextField}
                            />
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>

          {/* Нижняя панель */}
          <div className="shrink-0 border-t border-border bg-background px-4 py-3 sm:px-8">
            <div className="mx-auto flex w-full max-w-2xl flex-col gap-2.5">
              {(step !== REVIEW_STEP && step !== MEMORY_STEP) && (
                <div className="flex items-center gap-3">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
                    <div
                      className="h-full rounded-full bg-red-600 transition-all"
                      style={{
                        width: `${questions.length ? (answeredCount / questions.length) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {answeredCount}/{questions.length}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                <Button
                  variant="ghost"
                  className="gap-1.5"
                  onClick={() => goTo(Math.max(0, step - 1))}
                  disabled={step === 0}
                >
                  <ArrowLeft className="h-4 w-4" />
                  Назад
                </Button>
                {step !== REVIEW_STEP && step !== MEMORY_STEP && (
                  <Button
                    className="gap-1.5 bg-red-600 hover:bg-red-500"
                    onClick={() => goTo(Math.min(REVIEW_STEP, step + 1))}
                  >
                    {step === WIZARD_STAGE_COUNT - 1 ? 'К проверке' : 'Далее'}
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- Шапка этапа ------------------------------- */

function StageHeader({ idx, stages }: { idx: number; stages: readonly WizardStage[] }) {
  const stage = stages[idx];
  const Icon = STAGE_ICONS[idx] || FileText;
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400">
        <Icon className="h-5.5 w-5.5" />
      </div>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-red-600 dark:text-red-400">
          Этап {idx + 1} из {stages.length}
        </div>
        <h2 className="text-lg font-bold leading-snug">{stage?.title}</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{stage?.subtitle}</p>
      </div>
    </div>
  );
}

/* ------------------------------ Поле вопроса ------------------------------ */

function QuestionField({
  q,
  profile,
  onAnswer,
  onSkip,
  onClear,
  onText,
}: {
  q: WizardQuestion;
  profile: UserProfile;
  onAnswer: (q: WizardQuestion, value: string | string[]) => void;
  onSkip: (q: WizardQuestion) => void;
  onClear: (q: WizardQuestion) => void;
  onText: (q: WizardQuestion, value: string) => void;
}) {
  const value = questionValue(q, profile);
  const skipped = isSkipped(q, profile);
  const selectedMulti = q.kind === 'multi' ? ((value as string[]) || []) : [];
  const [custom, setCustom] = useState('');

  // «Свой вариант» доступен и для мультивыбора, и для одиночного выбора (кроме цели и «знаю/не знаю»)
  const allowsCustom =
    q.kind === 'multi' || (q.kind === 'single' && !!q.options && q.id !== 'goalPick' && q.id !== 'decided');
  const customSingle =
    q.kind === 'single' && typeof value === 'string' && !!q.options && !q.options.includes(value)
      ? value
      : '';
  const hasAnswer =
    value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0);

  const addCustom = () => {
    const v = custom.trim();
    if (!v) return;
    if (q.kind === 'multi') {
      if (selectedMulti.includes(v)) return;
      onAnswer(q, [...selectedMulti, v]);
    } else {
      onAnswer(q, v);
    }
    setCustom('');
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
      <Label className="text-[15px] font-semibold leading-snug">{q.question}</Label>
      {q.hint && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{q.hint}</p>}

      {/* Цель в свободном чате — особый выбор из двух карточек */}
      {q.id === 'goalPick' ? (
        <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
          {q.options?.map((opt) => {
            const active = value === opt;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => onAnswer(q, opt)}
                className={`flex items-center gap-2.5 rounded-xl border p-3.5 text-left text-sm font-medium transition-colors ${
                  active
                    ? 'border-red-500 bg-red-50/70 dark:border-red-700 dark:bg-red-950/40'
                    : 'border-border hover:border-red-300 hover:bg-muted/40'
                }`}
              >
                {opt === 'Ausbildung' ? (
                  <GraduationCap className="h-4.5 w-4.5 shrink-0 text-amber-600 dark:text-amber-400" />
                ) : (
                  <Briefcase className="h-4.5 w-4.5 shrink-0 text-red-600 dark:text-red-400" />
                )}
                <span className="flex-1">{opt}</span>
                {active && <Check className="h-4 w-4 shrink-0 text-red-600" />}
              </button>
            );
          })}
        </div>
      ) : q.kind === 'text' ? (
        <>
          {q.wide ? (
            <Textarea
              value={typeof value === 'string' ? value : ''}
              onChange={(e) => onText(q, e.target.value)}
              onBlur={() => onText(q, (typeof value === 'string' ? value : '').trimEnd())}
              placeholder={q.placeholder}
              rows={3}
              className="mt-3 resize-none"
            />
          ) : (
            <Input
              value={typeof value === 'string' ? value : ''}
              onChange={(e) => onText(q, e.target.value)}
              placeholder={q.placeholder}
              className="mt-3"
            />
          )}
          {q.examples && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {q.examples.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => onAnswer(q, ex)}
                  className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-red-300 hover:text-red-600"
                >
                  {ex}
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {q.options?.map((opt) => {
            const active = q.kind === 'multi' ? selectedMulti.includes(opt) : value === opt;
            return (
              <button
                key={opt}
                type="button"
                onClick={() =>
                  q.kind === 'multi'
                    ? onAnswer(
                        q,
                        active ? selectedMulti.filter((x) => x !== opt) : [...selectedMulti, opt],
                      )
                    : onAnswer(q, opt)
                }
                className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-[13px] font-medium transition-colors ${
                  active
                    ? 'border-red-500 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-950/50 dark:text-red-300'
                    : 'border-border bg-background text-foreground hover:border-red-300 hover:text-red-600'
                }`}
              >
                {active && <Check className="h-3.5 w-3.5" />}
                {opt}
              </button>
            );
          })}
          {q.kind === 'multi' &&
            selectedMulti
              .filter((v) => !q.options?.includes(v))
              .map((v) => (
                <button
                  key={`custom-${v}`}
                  type="button"
                  onClick={() => onAnswer(q, selectedMulti.filter((x) => x !== v))}
                  title="Убрать"
                  className="inline-flex items-center gap-1.5 rounded-full border border-red-500 bg-red-50 px-3.5 py-2 text-[13px] font-medium text-red-700 dark:border-red-700 dark:bg-red-950/50 dark:text-red-300"
                >
                  <Check className="h-3.5 w-3.5" />
                  {v}
                  <X className="h-3 w-3 opacity-60" />
                </button>
              ))}
          {customSingle && (
            <button
              type="button"
              onClick={() => onClear(q)}
              title="Убрать свой вариант"
              className="inline-flex items-center gap-1.5 rounded-full border border-red-500 bg-red-50 px-3.5 py-2 text-[13px] font-medium text-red-700 dark:border-red-700 dark:bg-red-950/50 dark:text-red-300"
            >
              <Check className="h-3.5 w-3.5" />
              {customSingle}
              <X className="h-3 w-3 opacity-60" />
            </button>
          )}
        </div>
      )}

      {/* Свой вариант ответа */}
      {allowsCustom && (
        <div className="mt-2.5 flex gap-2">
          <Input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addCustom();
              }
            }}
            placeholder="Свой вариант…"
            className="h-9"
          />
          <Button variant="outline" size="sm" className="h-9 shrink-0 gap-1" onClick={addCustom}>
            <Plus className="h-3.5 w-3.5" />
            {q.kind === 'multi' ? 'Добавить' : 'Задать'}
          </Button>
        </div>
      )}

      {/* Пропуск, сброс и отметка о пропуске */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {q.skipLabel && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
            onClick={() => onSkip(q)}
          >
            <RotateCcw className="h-3 w-3" />
            {q.skipLabel}
          </Button>
        )}
        {(hasAnswer || skipped) && q.id !== 'goalPick' && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
            onClick={() => onClear(q)}
          >
            <X className="h-3 w-3" />
            Сбросить ответ
          </Button>
        )}
        {skipped && (
          <span className="rounded-full border border-dashed border-border bg-muted/40 px-2.5 py-1 text-[11px] italic text-muted-foreground">
            пропущено — агент учтёт сам по остальным ответам
          </span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ Свои разделы ------------------------------ */

function CustomSectionsBlock({
  sections,
  onChange,
}: {
  sections: CustomSection[];
  onChange: (next: CustomSection[]) => void;
}) {
  const canAddSection = sections.length < CUSTOM_LIMITS.sections;

  const addSection = (title = '', labels: string[] = ['']) => {
    if (!canAddSection) return;
    onChange([
      ...sections,
      {
        id: newCustomId('sec'),
        title,
        fields: labels.map((label) => ({ id: newCustomId('fld'), label, value: '' })),
      },
    ]);
  };
  const patchSection = (id: string, patch: Partial<CustomSection>) =>
    onChange(sections.map((sec) => (sec.id === id ? { ...sec, ...patch } : sec)));
  const removeSection = (id: string) => onChange(sections.filter((sec) => sec.id !== id));
  const patchField = (secId: string, fldId: string, patch: { label?: string; value?: string }) =>
    onChange(
      sections.map((sec) =>
        sec.id === secId
          ? { ...sec, fields: sec.fields.map((f) => (f.id === fldId ? { ...f, ...patch } : f)) }
          : sec,
      ),
    );
  const addField = (secId: string) =>
    onChange(
      sections.map((sec) =>
        sec.id === secId && sec.fields.length < CUSTOM_LIMITS.fieldsPerSection
          ? { ...sec, fields: [...sec.fields, { id: newCustomId('fld'), label: '', value: '' }] }
          : sec,
      ),
    );
  const removeField = (secId: string, fldId: string) =>
    onChange(
      sections.map((sec) =>
        sec.id === secId ? { ...sec, fields: sec.fields.filter((f) => f.id !== fldId) } : sec,
      ),
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
        <div className="text-[15px] font-semibold leading-snug">Добавь то, чего нет в анкете</div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Свой раздел — это заголовок и поля «название — значение»: проекты, ссылки, хобби, особые
          условия. Агент читает их наравне с остальными ответами и запоминает.
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {CUSTOM_SECTION_TEMPLATES.map((t) => (
            <button
              key={t.title}
              type="button"
              disabled={!canAddSection}
              onClick={() => addSection(t.title, t.labels)}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-red-300 hover:text-red-600 disabled:opacity-50"
            >
              <Plus className="h-3 w-3" />
              {t.title}
            </button>
          ))}
          <button
            type="button"
            disabled={!canAddSection}
            onClick={() => addSection()}
            className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-red-300 hover:text-red-600 disabled:opacity-50"
          >
            <Plus className="h-3 w-3" />
            Свой раздел
          </button>
        </div>
        {!canAddSection && (
          <p className="mt-2 text-xs text-muted-foreground">
            Достигнут предел: {CUSTOM_LIMITS.sections} разделов.
          </p>
        )}
      </div>

      {sections.length === 0 && (
        <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          Пока пусто. Выбери шаблон или создай свой раздел — этот этап необязательный.
        </p>
      )}

      {sections.map((sec) => (
        <div key={sec.id} className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
          <div className="flex items-center gap-2">
            <Input
              value={sec.title}
              onChange={(e) => patchSection(sec.id, { title: e.target.value })}
              maxLength={CUSTOM_LIMITS.title}
              placeholder="Название раздела"
              aria-label="Название раздела"
              className="h-9 font-semibold"
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 text-muted-foreground hover:text-red-600"
              onClick={() => removeSection(sec.id)}
              aria-label="Удалить раздел"
              title="Удалить раздел"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>

          <div className="mt-3 flex flex-col gap-3">
            {sec.fields.map((f) => (
              <div key={f.id} className="rounded-xl border border-border/70 bg-muted/20 p-3">
                <div className="flex items-center gap-2">
                  <Input
                    value={f.label}
                    onChange={(e) => patchField(sec.id, f.id, { label: e.target.value })}
                    maxLength={CUSTOM_LIMITS.label}
                    placeholder="Название поля (например, GitHub)"
                    aria-label="Название поля"
                    className="h-8 text-sm"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-red-600"
                    onClick={() => removeField(sec.id, f.id)}
                    aria-label="Удалить поле"
                    title="Удалить поле"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <Textarea
                  value={f.value}
                  onChange={(e) => patchField(sec.id, f.id, { value: e.target.value })}
                  maxLength={CUSTOM_LIMITS.value}
                  placeholder="Значение"
                  aria-label="Значение поля"
                  rows={2}
                  className="mt-2 resize-none text-sm"
                />
              </div>
            ))}
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="mt-2 h-8 gap-1.5 px-2 text-xs text-muted-foreground"
            onClick={() => addField(sec.id)}
            disabled={sec.fields.length >= CUSTOM_LIMITS.fieldsPerSection}
          >
            <Plus className="h-3.5 w-3.5" />
            Добавить поле
          </Button>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------ Документы ------------------------------ */

function DocumentsBlock({
  docs,
  uploads,
  setUploads,
  onChangeDocs,
}: {
  docs: ProfileDocument[];
  uploads: UploadItem[];
  setUploads: (fn: (prev: UploadItem[]) => UploadItem[]) => void;
  onChangeDocs: (docs: ProfileDocument[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const docsRef = useRef(docs);
  docsRef.current = docs;

  const handleFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    for (const file of list) {
      if (docsRef.current.length + uploads.length >= MAX_DOCS) break;
      if (file.size > MAX_FILE) {
        setUploads((prev) => [
          ...prev,
          {
            id: `${file.name}-${Date.now()}`,
            name: file.name,
            size: file.size,
            status: 'error',
            error: 'файл больше 10 МБ',
          },
        ]);
        continue;
      }
      const id = `${file.name}-${Date.now()}`;
      setUploads((prev) => [...prev, { id, name: file.name, size: file.size, status: 'parse' }]);
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error('не удалось прочитать файл'));
          reader.readAsDataURL(file);
        });
        const base64 = dataUrl.split(',')[1] || '';
        const res = await fetch('/api/agent/parse-file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: file.name, data: base64 }),
        });
        const json = await res.json();
        if (!json?.ok) throw new Error(json?.error || 'не удалось распознать файл');
        const doc: ProfileDocument = {
          id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: file.name,
          mime: file.type || 'application/octet-stream',
          size: file.size,
          chars: json.text.length,
          text: json.text,
          addedAt: new Date().toISOString(),
        };
        onChangeDocs([...docsRef.current, doc]);
        setUploads((prev) => prev.filter((u) => u.id !== id));
      } catch (e) {
        setUploads((prev) =>
          prev.map((u) =>
            u.id === id
              ? { ...u, status: 'error', error: e instanceof Error ? e.message : 'ошибка' }
              : u,
          ),
        );
      }
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
          dragOver
            ? 'border-red-400 bg-red-50/60 dark:bg-red-950/30'
            : 'border-border bg-muted/30 hover:border-red-300 hover:bg-muted/50'
        }`}
      >
        <CloudUpload className="h-8 w-8 text-muted-foreground" />
        <div className="text-sm font-medium">
          Перетащи файлы сюда или нажми, чтобы выбрать
        </div>
        <div className="text-xs text-muted-foreground">
          Lebenslauf, аттестат, сертификаты — PDF, DOCX, TXT, RTF · до 10 МБ · максимум {MAX_DOCS} файлов
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {docs.length > 0 && (
        <div className="flex flex-col gap-2">
          {docs.map((d) => (
            <div
              key={d.id}
              className="flex items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3"
            >
              <FileText className="h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{d.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {Math.round(d.size / 1024)} КБ · прочитано, {d.chars} символов — агент учтёт при анализе
                </div>
              </div>
              <button
                type="button"
                onClick={() => onChangeDocs(docs.filter((x) => x.id !== d.id))}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-red-600"
                aria-label={`Убрать ${d.name}`}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {uploads.length > 0 && (
        <div className="flex flex-col gap-2">
          {uploads.map((u) => (
            <div
              key={u.id}
              className="flex items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3"
            >
              {u.status === 'parse' ? (
                <Loader2 className="h-5 w-5 shrink-0 animate-spin text-red-600" />
              ) : (
                <AlertCircle className="h-5 w-5 shrink-0 text-amber-600" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{u.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {u.status === 'parse' ? 'читаю файл…' : u.error}
                </div>
              </div>
              {u.status === 'error' && (
                <button
                  type="button"
                  onClick={() => setUploads((prev) => prev.filter((x) => x.id !== u.id))}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-red-600"
                  aria-label="Убрать"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="text-xs leading-relaxed text-muted-foreground">
        Текст из файлов извлекается автоматически: агент прочитает Lebenslauf перед анализом и
        будет учитывать его при подборе направлений, оценке вакансий и ответах на вопросы. Если у
        тебя нет готового резюме — просто пропусти этот этап, анкеты будет достаточно.
      </p>
    </div>
  );
}

/* --------------------------- Проверка и отправка --------------------------- */

/** Мини-бейдж с числом фактов в памяти (для навигации слева). */
function BrainBadge({ model }: { model: PersonModel }) {
  const facts = model.sections.reduce((n, s) => n + s.facts.length, 0);
  return (
    <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
      {facts}
    </span>
  );
}

function ReviewView({
  goal,
  profile,
  questions,
  onJump,
  onEditDoc,
  onOpenMemory,
  onSubmit,
  editMode,
  diff,
  onSaveEdit,
  busy,
  submitting,
  uploading,
}: {
  goal: Goal;
  profile: UserProfile;
  questions: WizardQuestion[];
  onJump: (step: number) => void;
  onEditDoc: () => void;
  onOpenMemory: () => void;
  onSubmit: () => void;
  editMode: boolean;
  diff: { changes: ProfileChange[]; needsReanalysis: boolean } | null;
  onSaveEdit: (reanalyze: boolean) => void;
  busy: boolean;
  submitting: boolean;
  uploading: boolean;
}) {
  const docs = profile.documents || [];
  const changeById = new Map((diff?.changes ?? []).map((c) => [c.id, c]));
  const customLines = customFieldLines(profile.customSections);
  const customChange = changeById.get('customSections');
  const groups: { stageIdx: number; items: WizardQuestion[] }[] = [];
  for (const q of questions) {
    const last = groups[groups.length - 1];
    if (last && last.stageIdx === q.stageIdx) last.items.push(q);
    else groups.push({ stageIdx: q.stageIdx, items: [q] });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400">
          <ClipboardCheck className="h-5.5 w-5.5" />
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-bold leading-snug">
            {editMode ? 'Проверь правки и сохрани' : 'Проверь ответы и отправь агенту'}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {editMode ? (
              <>
                Любой ответ можно поправить, не начиная заново: нажми «Изменить» у нужного блока.
                «Сохранить» обновляет профиль и память агента, прежний анализ остаётся. Если правки
                меняют картину, можно пересчитать анализ.
              </>
            ) : (
              <>
                После отправки я внимательно и глубоко проанализирую анкету
                {docs.length ? ' вместе с приложенными документами' : ''}, пойму, кто ты и что тебе
                подходит. Если что-то останется неясным — задам уточняющие вопросы прямо в чате. Когда
                пойму на 100% — спрошу: «Готов начать поиск?»
              </>
            )}
          </p>
        </div>
      </div>

      {editMode && diff && (
        <div
          className={`rounded-2xl border p-4 text-sm ${
            diff.changes.length
              ? 'border-amber-300 bg-amber-50/70 dark:border-amber-800 dark:bg-amber-950/30'
              : 'border-border bg-muted/30 text-muted-foreground'
          }`}
        >
          {diff.changes.length ? (
            <>
              <div className="font-medium">Изменено: {diff.changes.length}</div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {diff.needsReanalysis
                  ? 'Эти правки влияют на портрет и подбор — после сохранения лучше пересчитать анализ.'
                  : 'Эти правки не влияют на анализ — пересчёт не нужен.'}
              </p>
            </>
          ) : (
            'Пока без изменений. Нажми «Изменить» у нужного блока, чтобы поправить ответ.'
          )}
        </div>
      )}

      {groups.map((g) => (
        <div key={g.stageIdx} className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {wizardStages(goal)[g.stageIdx]?.title}
            </div>
            <button
              type="button"
              onClick={() => onJump(g.stageIdx)}
              className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:underline dark:text-red-400"
            >
              Изменить
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          <dl className="flex flex-col divide-y divide-border">
            {g.items.map((q) => {
              const value = questionValue(q, profile);
              const skipped = isSkipped(q, profile);
              const ch = changeById.get(q.id);
              return (
                <div
                  key={q.id}
                  className={`flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0 ${
                    ch ? 'rounded-lg bg-amber-50/70 px-2 dark:bg-amber-950/30' : ''
                  }`}
                >
                  <dt className="shrink-0 text-sm text-muted-foreground">{q.label}</dt>
                  <dd
                    className={`text-right text-sm font-medium ${
                      skipped ? 'italic text-muted-foreground/80' : ''
                    }`}
                  >
                    {skipped && value === undefined ? 'пропущено' : answerToText(value)}
                    {ch && (
                      <div className="text-[11px] font-normal text-muted-foreground">
                        было: {ch.before}
                      </div>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      ))}

      <div
        className={`rounded-2xl border bg-card p-4 shadow-sm sm:p-5 ${
          customChange ? 'border-amber-300 dark:border-amber-800' : 'border-border'
        }`}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Свои разделы
          </div>
          <button
            type="button"
            onClick={() => onJump(CUSTOM_STAGE)}
            className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:underline dark:text-red-400"
          >
            {customLines.length ? 'Изменить' : 'Добавить'}
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>
        {customLines.length ? (
          <ul className="flex flex-col gap-1.5 text-sm">
            {customLines.map((line) => (
              <li key={line} className="leading-snug">
                {line}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            Не добавлено — проекты, ссылки, хобби и особые условия можно вписать сюда.
          </p>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Документы
          </div>
          <button
            type="button"
            onClick={onEditDoc}
            className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:underline dark:text-red-400"
          >
            {docs.length ? 'Изменить' : 'Приложить'}
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>
        {docs.length ? (
          <ul className="flex flex-col gap-1.5">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center gap-2 text-sm">
                <FileText className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
                <span className="truncate font-medium">{d.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {Math.round(d.size / 1024)} КБ · {d.chars} символов
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            Не приложено — этого достаточно, но с Lebenslauf анализ будет точнее.
          </p>
        )}
      </div>

      {editMode ? (
        <div className="flex flex-col gap-2.5">
          <Button
            size="lg"
            className={`w-full gap-2 ${
              diff?.needsReanalysis ? '' : 'bg-red-600 hover:bg-red-500'
            }`}
            variant={diff?.needsReanalysis ? 'outline' : 'default'}
            onClick={() => onSaveEdit(false)}
            disabled={busy || submitting || uploading}
          >
            <Save className="h-4 w-4" />
            Сохранить изменения
          </Button>
          <Button
            size="lg"
            className={`w-full gap-2 ${diff?.needsReanalysis ? 'bg-red-600 hover:bg-red-500' : ''}`}
            variant={diff?.needsReanalysis ? 'default' : 'outline'}
            onClick={() => onSaveEdit(true)}
            disabled={busy || submitting || uploading}
          >
            {submitting || busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            Сохранить и пересчитать анализ
          </Button>
        </div>
      ) : (
        <Button
          size="lg"
          className="w-full gap-2 bg-red-600 hover:bg-red-500"
          onClick={onSubmit}
          disabled={busy || submitting || uploading}
        >
          {submitting || busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Отправить агенту
        </Button>
      )}
      <div className="flex items-center justify-center">
        <button
          type="button"
          onClick={onOpenMemory}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <Brain className="h-3.5 w-3.5" />
          Посмотреть, что агент уже помнит и что забыл по времени
        </button>
      </div>
      <p className="text-center text-xs text-muted-foreground">
        {uploading ? 'Дождись окончания чтения файлов…' : `Цель: ${GOAL_LABELS[goal]}`}
      </p>
    </div>
  );
}
