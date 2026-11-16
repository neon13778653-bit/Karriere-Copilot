'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowUp,
  Brain,
  Briefcase,
  Building2,
  CheckCircle2,
  ClipboardList,
  GraduationCap,
  Loader2,
  Map as MapIcon,
  Menu,
  MessageCircleQuestion,
  MessageSquare,
  Search,
  Sparkles,
  Trophy,
  UserCog,
  Zap,
} from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Markdown } from '@/components/app/markdown';
import { MemoryPanel } from '@/components/app/memory-panel';
import { ModeSelector } from '@/components/app/mode-selector';
import { VacancyCard } from '@/components/app/vacancy-card';
import { GOAL_LABELS, MODE_META, STAGE_LABELS } from '@/lib/types';
import type {
  ChatMsg,
  Goal,
  PersonModel,
  SearchMode,
  SessionStage,
  VacancyDTO,
} from '@/lib/types';

export interface SearchProgress {
  steps: { key: string; label: string; status: 'active' | 'done' }[];
  logs: string[];
  mode: SearchMode | null;
}

interface ChatViewProps {
  title: string;
  goal: Goal;
  stage: SessionStage;
  messages: ChatMsg[];
  vacancies: VacancyDTO[];
  streamingText: string | null;
  progress: SearchProgress | null;
  modeSelectorOpen: boolean;
  busy: boolean;
  backendLabel: string;

  /** Модель человека — структурная память агента (для панели «Память»). */
  personModel: PersonModel | null;

  /** id сессии — чтобы действия в панели памяти правили и память сессии */
  sessionId?: string;
  /** Обновление модели после действия в панели (подтвердить/забыть/вернуть) */
  onMemoryChange?: (m: PersonModel) => void;

  /** Сессия ещё на стадии анкеты — показать в чате карточку «продолжить заполнение». */
  showWizardResume: boolean;
  onResumeWizard: () => void;

  /* Общие действия */
  onOpenModeSelector: () => void;
  onSelectMode: (mode: SearchMode) => void;
  onSendMessage: (text: string, vacancyId?: string) => void;
  onAskVacancy: (v: VacancyDTO) => void;
  onEditProfile: () => void;
  onOpenSettings: () => void;
  onToggleSidebar: () => void;
}

const STEP_ICONS: Record<string, typeof Search> = {
  understand: Brain,
  analyze: MapIcon,
  search: Search,
  extract: ClipboardList,
  enrich: Building2,
  rank: Trophy,
};

const STAGE_ICONS: Record<SessionStage, typeof Search> = {
  wizard: ClipboardList,
  analysis: Brain,
  ready: CheckCircle2,
  chat: MessageSquare,
};

function AgentAvatar() {
  return (
    <Avatar className="mt-0.5 h-8 w-8 shrink-0">
      <AvatarFallback className="bg-gradient-to-br from-red-600 to-amber-500 text-white">
        <Sparkles className="h-4 w-4" />
      </AvatarFallback>
    </Avatar>
  );
}

export function ChatView(props: ChatViewProps) {
  const {
    title,
    goal,
    stage,
    messages,
    vacancies,
    streamingText,
    progress,
    modeSelectorOpen,
    busy,
    backendLabel,
    personModel,
    sessionId,
    onMemoryChange,
    showWizardResume,
    onResumeWizard,
    onOpenModeSelector,
    onSelectMode,
    onSendMessage,
    onAskVacancy,
    onEditProfile,
    onOpenSettings,
    onToggleSidebar,
  } = props;

  const [input, setInput] = useState('');
  const [memoryOpen, setMemoryOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);

  useLayoutEffect(() => {
    if (stickToBottom.current && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: streamingText ? 'auto' : 'smooth', block: 'end' });
    }
  }, [messages, streamingText, progress?.logs.length, progress?.steps, modeSelectorOpen]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
  };

  const send = () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    onSendMessage(text);
  };

  const quickAsk = (text: string) => {
    if (busy) return;
    onSendMessage(text);
  };

  const vacancyMap = new Map(vacancies.map((v) => [v.id, v]));
  const msgVacancies = (ids?: string[]): VacancyDTO[] => {
    if (!ids?.length) return [];
    return ids
      .map((id) => vacancyMap.get(id))
      .filter((v): v is VacancyDTO => !!v)
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  };

  const GoalIcon = goal === 'job' ? Briefcase : goal === 'ausbildung' ? GraduationCap : MessageSquare;
  const StageIcon = STAGE_ICONS[stage] || MessageSquare;

  const isAusbildung = goal === 'ausbildung';

  const inputPlaceholder = busy
    ? 'Агент занят — подожди немного…'
    : stage === 'wizard'
      ? 'Спроси агента о чём угодно — анкета заполняется отдельно…'
      : stage === 'analysis'
        ? 'Ответь агенту своими словами…'
        : isAusbildung
          ? 'Спроси что угодно или попроси найти учебные места…'
          : 'Спроси что угодно или попроси найти вакансии…';

  const showSearchButtons = (stage === 'ready' || stage === 'chat') && !busy && !modeSelectorOpen;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Шапка */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/80 px-3 backdrop-blur sm:px-4">
        <Button variant="ghost" size="icon" className="h-9 w-9 lg:hidden" onClick={onToggleSidebar} aria-label="Меню">
          <Menu className="h-5 w-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{title}</div>
        </div>
        {stage !== 'chat' && (
          <Badge variant="secondary" className="hidden shrink-0 gap-1.5 sm:inline-flex">
            <StageIcon className="h-3.5 w-3.5" />
            {STAGE_LABELS[stage]}
          </Badge>
        )}
        <button
          onClick={() => setMemoryOpen(true)}
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-red-300 hover:text-red-600"
          title="Что агент знает и запомнил о тебе"
        >
          <Brain className="h-3.5 w-3.5" />
          Память
          {personModel && (
            <span className="font-semibold tabular-nums">{personModel.overallConfidence}%</span>
          )}
        </button>
        <Badge variant="secondary" className="hidden shrink-0 gap-1.5 md:inline-flex">
          <GoalIcon className="h-3.5 w-3.5" />
          {GOAL_LABELS[goal]}
        </Badge>
        <button
          onClick={onOpenSettings}
          className="hidden shrink-0 items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-red-300 hover:text-red-600 md:flex"
          title="Настройки ИИ-сервера"
        >
          <Zap className="h-3.5 w-3.5" />
          {backendLabel}
        </button>
        <Button variant="outline" size="sm" className="shrink-0 gap-1.5" onClick={onEditProfile}>
          <UserCog className="h-4 w-4" />
          <span className="hidden sm:inline">Профиль</span>
        </Button>
      </header>

      {/* Лента сообщений (прижата к низу — как в привычных чатах) */}
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-3 py-6 sm:px-6">
        <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-end gap-6">
          {messages.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-red-600 px-4 py-2.5 text-[15px] leading-relaxed text-white shadow-sm">
                  {m.content}
                </div>
              </div>
            ) : (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex gap-3"
              >
                <AgentAvatar />
                <div className="min-w-0 flex-1">
                  <div className="mb-1 text-xs font-semibold text-muted-foreground">
                    Karriere Copilot
                  </div>
                  <div className="rounded-2xl rounded-tl-md border border-border bg-card px-4 py-3 shadow-sm">
                    <Markdown text={m.content} />
                  </div>
                  {msgVacancies(m.vacancyIds).length > 0 && (
                    <VacancyList items={msgVacancies(m.vacancyIds)} onAsk={onAskVacancy} goal={goal} />
                  )}
                </div>
              </motion.div>
            ),
          )}

          {/* Анкета ещё не отправлена — карточка «продолжить заполнение» */}
          {stage === 'wizard' && !progress && streamingText == null && showWizardResume && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex gap-3">
              <AgentAvatar />
              <div className="min-w-0 flex-1">
                <div className="mb-1 text-xs font-semibold text-muted-foreground">
                  Karriere Copilot
                </div>
                <div className="rounded-2xl rounded-tl-md border border-amber-300/70 bg-amber-50/60 px-4 py-3.5 shadow-sm dark:border-amber-800 dark:bg-amber-950/30">
                  <div className="text-[15px] font-semibold">
                    Анкета профиля ещё не отправлена
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Она заполняется по этапам на отдельной странице. Ответь на вопросы, пропусти
                    то, чего не знаешь, и приложи Lebenslauf — я всё учту. А пока можешь спросить
                    меня о чём угодно здесь.
                  </p>
                  <Button
                    className="mt-3 gap-1.5 bg-red-600 hover:bg-red-500"
                    onClick={onResumeWizard}
                  >
                    <ClipboardList className="h-4 w-4" />
                    Продолжить заполнение
                  </Button>
                </div>
              </div>
            </motion.div>
          )}

          {/* Готов начать поиск? — показываем, пока поиск ещё не выполнялся */}
          {stage === 'ready' && vacancies.length === 0 && !progress && streamingText == null && !modeSelectorOpen && !busy && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex gap-3">
              <AgentAvatar />
              <div className="min-w-0 flex-1">
                <div className="mb-1 text-xs font-semibold text-muted-foreground">
                  Karriere Copilot
                </div>
                <div className="rounded-2xl rounded-tl-md border border-emerald-300/70 bg-emerald-50/60 px-4 py-3.5 shadow-sm dark:border-emerald-800 dark:bg-emerald-950/30">
                  <div className="text-[15px] font-semibold">
                    Я понял тебя — готов начать поиск. Начинаем?
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Выбери режим: от быстрого обзора до глубокого MAX с оценкой каждой вакансии
                    под твой профиль.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      className="gap-1.5 bg-red-600 hover:bg-red-500"
                      onClick={onOpenModeSelector}
                    >
                      <Search className="h-4 w-4" />
                      Да, начинаем поиск
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => inputRef.current?.focus()}
                      className="gap-1.5"
                    >
                      <MessageCircleQuestion className="h-4 w-4" />
                      Сначала спрошу
                    </Button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Прогресс поиска */}
          {progress && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3">
              <AgentAvatar />
              <div className="min-w-0 flex-1">
                <div className="mb-1 text-xs font-semibold text-muted-foreground">
                  Karriere Copilot {progress.mode ? `· режим ${MODE_META[progress.mode].label}` : ''}
                </div>
                <div className="rounded-2xl rounded-tl-md border border-border bg-card px-4 py-3.5 shadow-sm">
                  <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                    <Loader2 className="h-4 w-4 animate-spin text-red-600" />
                    {progress.steps.some((s) => s.status === 'active')
                      ? 'Ищу и анализирую…'
                      : 'Завершаю…'}
                  </div>
                  <ol className="mb-3 space-y-2">
                    {progress.steps.map((s) => {
                      const Icon = STEP_ICONS[s.key];
                      return (
                        <li key={s.key} className="flex items-start gap-2.5 text-sm">
                          {s.status === 'done' ? (
                            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                          ) : (
                            <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-red-600" />
                          )}
                          <span className={s.status === 'done' ? 'text-muted-foreground' : 'font-medium'}>
                            {Icon && <Icon className="mr-1.5 inline h-3.5 w-3.5 align-[-2px]" />}
                            {s.label}
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                  {progress.logs.length > 0 && (
                    <div className="max-h-36 overflow-y-auto rounded-lg bg-muted/60 px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
                      {progress.logs.slice(-14).map((l, i) => (
                        <div key={i} className="whitespace-pre-wrap">
                          {l}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {/* Стримящийся ответ */}
          {streamingText != null && (
            <div className="flex gap-3">
              <AgentAvatar />
              <div className="min-w-0 flex-1">
                <div className="mb-1 text-xs font-semibold text-muted-foreground">
                  Karriere Copilot
                </div>
                <div className="rounded-2xl rounded-tl-md border border-border bg-card px-4 py-3 shadow-sm">
                  <Markdown text={streamingText} />
                  <span className="ml-0.5 inline-block h-4 w-2 animate-pulse rounded-sm bg-red-600 align-middle" />
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} className="h-px" />
        </div>
      </div>

      <MemoryPanel
        open={memoryOpen}
        onOpenChange={setMemoryOpen}
        model={personModel}
        sessionId={sessionId}
        onModelChange={onMemoryChange}
      />

      {/* Нижняя зона */}
      <div className="shrink-0 border-t border-border bg-background px-3 pb-4 pt-3 sm:px-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          <AnimatePresence>
            {modeSelectorOpen && !busy && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
              >
                <ModeSelector onSelect={onSelectMode} busy={busy} />
              </motion.div>
            )}
          </AnimatePresence>

          {!busy && !modeSelectorOpen && showSearchButtons && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" className="gap-1.5 bg-red-600 hover:bg-red-500" onClick={onOpenModeSelector}>
                <Search className="h-3.5 w-3.5" />
                Начать поиск
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={onEditProfile}>
                <UserCog className="h-3.5 w-3.5" />
                Профиль
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="gap-1.5 text-muted-foreground"
                onClick={() =>
                  quickAsk(
                    isAusbildung
                      ? 'Сколько обычно платят во время Ausbildung и после неё в моей сфере в Германии?'
                      : 'Сколько обычно платят в моей сфере в Германии?',
                  )
                }
              >
                <MessageCircleQuestion className="h-3.5 w-3.5" />
                Сколько платят в моей сфере?
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="hidden gap-1.5 text-muted-foreground sm:inline-flex"
                onClick={() =>
                  quickAsk(
                    isAusbildung
                      ? 'Какая виза нужна для Ausbildung в Германии в моём случае?'
                      : 'Какая виза нужна для работы в Германии в моём случае?',
                  )
                }
              >
                <MessageCircleQuestion className="h-3.5 w-3.5" />
                Какая виза мне нужна?
              </Button>
            </div>
          )}

          {stage === 'analysis' && !busy && !modeSelectorOpen && (
            <p className="text-center text-xs text-muted-foreground">
              Агент разбирается в твоём профиле — ответь на его вопросы выше, чтобы он понял тебя
              на 100%.
            </p>
          )}

          <div className="flex items-end gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm focus-within:border-red-400">
            <Textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={1}
              placeholder={inputPlaceholder}
              disabled={busy}
              className="field-sizing-content max-h-40 min-h-[40px] flex-1 resize-none border-0 bg-transparent px-2 py-2 text-[15px] shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
            <Button
              size="icon"
              className="h-9 w-9 shrink-0 rounded-xl bg-red-600 hover:bg-red-500"
              onClick={send}
              disabled={busy || !input.trim()}
              aria-label="Отправить"
            >
              <ArrowUp className="h-4.5 w-4.5" />
            </Button>
          </div>
          <p className="text-center text-[11px] text-muted-foreground">
            Enter — отправить · Shift+Enter — новая строка · Агент ищет реальные вакансии в интернете
          </p>
        </div>
      </div>
    </div>
  );
}

function VacancyList({
  items,
  onAsk,
  goal,
}: {
  items: VacancyDTO[];
  onAsk: (v: VacancyDTO) => void;
  goal: Goal;
}) {
  const top = items[0];
  return (
    <div className="mt-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Trophy className="h-3.5 w-3.5" />
        {goal === 'ausbildung'
          ? 'Найденные учебные места (Ausbildung) — лучшие сверху'
          : 'Найденные вакансии — лучшие сверху'}
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium normal-case">
          {items.length}
        </span>
        {top?.score != null && (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium normal-case text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            топ: {top.score}/100
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2.5">
        {items.map((v, i) => (
          <VacancyCard key={v.id} vacancy={v} rank={i + 1} onAsk={onAsk} />
        ))}
      </div>
    </div>
  );
}
