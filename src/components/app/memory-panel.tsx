'use client';

// Панель «Память агента» — что агент понял, запомнил и держит в голове.
// Работает в двух вариантах: диалог из чата и встроенная вкладка на странице профиля.
//
// Память живёт во времени: у каждого факта есть полураспад доверия.
//   свежий — агент опирается спокойно;
//   устаревает — просит перепроверить;
//   забыто — факт в архиве (можно восстановить или удалить навсегда).
// Всё, что подтверждено человеком, становится свежим снова.

import { useEffect, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  ArrowLeftRight,
  BadgeCheck,
  Brain,
  CheckCircle2,
  CircleHelp,
  FileText,
  History,
  Lightbulb,
  LightbulbOff,
  NotebookPen,
  Trash2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type {
  JournalEntry,
  MemoryFact,
  MemorySection,
  PersonMemoryMeta,
  PersonModel,
} from '@/lib/types';
import { factAgeLabel, factEffective, factStatusCounts, factStatusOf } from '@/lib/memory-decay';

export interface MemoryPanelDataProps {
  model: PersonModel | null;
  sessionId?: string | null;
  onModelChange?: (m: PersonModel) => void;
}

type FactAction = 'confirm' | 'forget' | 'restore' | 'purge';

const SOURCE_STYLES: { match: (s: string) => boolean; className: string }[] = [
  {
    match: (s) => s.startsWith('Файл:'),
    className: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  },
  {
    match: (s) => s === 'Ответ в чате',
    className: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
  },
  {
    match: (s) => s === 'Вывод ИИ' || s === 'Анализ анкеты',
    className: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  },
  {
    match: () => true,
    className: 'bg-muted text-muted-foreground',
  },
];

function SourceBadge({ source }: { source: string }) {
  const style = SOURCE_STYLES.find((x) => x.match(source))!;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium leading-tight',
        style.className,
      )}
    >
      {source}
    </span>
  );
}

/** Полоска свежести: эффективная уверенность с учётом полураспада. */
function FreshnessBar({ fact, sectionId }: { fact: MemoryFact; sectionId: string }) {
  const eff = factEffective(fact, sectionId);
  const status = factStatusOf(eff);
  const color =
    status === 'fresh'
      ? 'bg-emerald-500'
      : status === 'aging'
        ? 'bg-stone-400'
        : 'bg-amber-500';
  const label =
    status === 'stale' ? 'могло устареть' : status === 'aging' ? 'давность в норме' : 'свежий';
  return (
    <div className="flex shrink-0 items-center gap-2" title={`${label}: ${eff}%`}>
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${eff}%` }} />
      </div>
      <span
        className={cn(
          'text-[11px] tabular-nums',
          status === 'stale' ? 'font-medium text-amber-600 dark:text-amber-400' : 'text-muted-foreground',
        )}
      >
        {eff}%
      </span>
    </div>
  );
}

/** Полоска уровня (секции/факта) без учёта времени. */
function LevelBar({ value, stale }: { value: number; stale?: boolean }) {
  const color = stale ? 'bg-amber-500' : value >= 80 ? 'bg-emerald-500' : value >= 50 ? 'bg-stone-400' : 'bg-red-400';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${value}%` }} />
      </div>
      <span className="text-[11px] tabular-nums text-muted-foreground">{value}%</span>
    </div>
  );
}

function FactRow({
  f,
  sectionId,
  pending,
  onAction,
}: {
  f: MemoryFact;
  sectionId: string;
  pending: string | null;
  onAction: (action: FactAction, text: string) => void;
}) {
  const status = factStatusOf(factEffective(f, sectionId));
  const age = factAgeLabel(f);
  return (
    <li className="group flex items-start justify-between gap-2 rounded-lg bg-muted/40 px-2.5 py-1.5">
      <div className="min-w-0">
        <span className="text-[13px] leading-snug">
          {f.text}
          {status === 'stale' && (
            <span className="ml-1.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
              (могло устареть, {age})
            </span>
          )}
          {status !== 'stale' && f.confidence < 60 && (
            <span className="ml-1.5 text-[11px] text-amber-600 dark:text-amber-400">
              (уверенность {f.confidence}%)
            </span>
          )}
        </span>
        <div className="mt-0.5 flex items-center gap-1.5">
          <SourceBadge source={f.source} />
          <span className="text-[10px] text-muted-foreground">{age}</span>
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <FreshnessBar fact={f} sectionId={sectionId} />
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {status === 'stale' ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-2 text-[11px] text-emerald-600 hover:text-emerald-700 dark:text-emerald-400"
                disabled={pending === f.text}
                onClick={() => onAction('confirm', f.text)}
              >
                <CheckCircle2 className="h-3 w-3" />
                Подтвердить
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                disabled={pending === f.text}
                onClick={() => onAction('forget', f.text)}
              >
                <LightbulbOff className="h-3 w-3" />
                Забыть
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
              disabled={pending === f.text}
              onClick={() => onAction('forget', f.text)}
            >
              <LightbulbOff className="h-3 w-3" />
              Забыть
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}

function Section({ sec, pending, onAction }: { sec: MemorySection; pending: string | null; onAction: (a: FactAction, t: string) => void }) {
  if (!sec.facts.length && !sec.gaps.length) return null;
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[13px] font-semibold">{sec.title}</div>
        <LevelBar value={sec.confidence} />
      </div>
      {sec.facts.length > 0 && (
        <ul className="flex flex-col gap-1">
          {sec.facts.map((f, i) => (
            <FactRow key={i} f={f} sectionId={sec.id} pending={pending} onAction={onAction} />
          ))}
        </ul>
      )}
      {sec.gaps.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-1">
          {sec.gaps.map((g, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[12px] text-muted-foreground">
              <CircleHelp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
              <span>неясно: {g}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function JournalRow({ e }: { e: JournalEntry }) {
  const icon =
    e.kind === 'learned' ? (
      <NotebookPen className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    ) : e.kind === 'inferred' ? (
      <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
    ) : e.kind === 'forgotten' ? (
      <Archive className="mt-0.5 h-3.5 w-3.5 shrink-0 text-stone-400" />
    ) : e.kind === 'reconfirmed' ? (
      <BadgeCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
    ) : e.kind === 'transferred' ? (
      <ArrowLeftRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-500" />
    ) : (
      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
    );
  const time = new Date(e.at).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    <li className="flex items-start gap-2 text-[12px] leading-snug">
      {icon}
      <span className="min-w-0">
        {e.text}
        <span className="ml-1.5 whitespace-nowrap text-[10px] text-muted-foreground">
          · {e.source} · {time}
        </span>
      </span>
    </li>
  );
}

/**
 * Содержимое панели — используется и в диалоге чата, и как вкладка
 * «Память агента» на странице профиля.
 */
export function MemoryPanelContent({ model, sessionId, onModelChange }: MemoryPanelDataProps) {
  const [pending, setPending] = useState<string | null>(null);
  const [personModel, setPersonModel] = useState<PersonModel | null>(null);
  const [meta, setMeta] = useState<PersonMemoryMeta | null>(null);

  // Долговременная память человека: мета о сессиях; если у сессии своей памяти
  // ещё нет (анкету не отправляли) — показываем именно её, межсессионную.
  useEffect(() => {
    let alive = true;
    fetch('/api/memory')
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        setPersonModel(j?.model ?? null);
        setMeta(j?.meta ?? null);
      })
      .catch(() => null);
    return () => {
      alive = false;
    };
  }, []);

  const act = async (action: FactAction, factText: string) => {
    setPending(factText);
    try {
      const res = await fetch('/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, factText, sessionId: sessionId ?? undefined }),
      });
      const json = await res.json();
      if (json?.model && onModelChange) onModelChange(json.model as PersonModel);
      if (json?.meta) setMeta(json.meta as PersonMemoryMeta);
      if (json?.personModel) setPersonModel(json.personModel as PersonModel);
    } catch {
      // тихо: кнопка просто не изменит модель
    } finally {
      setPending(null);
    }
  };

  const display = model ?? personModel;
  const now = Date.now();
  const counts = display ? factStatusCounts(display, now) : { fresh: 0, aging: 0, stale: 0, archived: 0 };
  const facts = display ? display.sections.reduce((n, s) => n + s.facts.length, 0) : 0;
  const inferences = display?.inferences.length ?? 0;
  const openQuestions = display?.openQuestions.length ?? 0;
  const archived = display?.archivedFacts ?? [];

  return (
    <div className="flex min-h-0 flex-col">
      {/* Шапка */}
      <div className="shrink-0 pb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-red-600 to-amber-500 text-white">
            <Brain className="h-4.5 w-4.5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold">Память агента</div>
            <div className="text-xs text-muted-foreground">
              Что я понял, запомнил и использую при поиске. Факты со временем «выцветают» —
              подтверждённые становятся свежими снова.
            </div>
          </div>
        </div>

        {display ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="gap-1.5">
              Понимание: {display.overallConfidence}%
            </Badge>
            <Badge variant="secondary">{facts} фактов</Badge>
            {counts.stale > 0 && (
              <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-300">
                {counts.stale} устаревает
              </Badge>
            )}
            <Badge variant="secondary">{inferences} выводов</Badge>
            {archived.length > 0 && (
              <Badge variant="secondary" className="gap-1">
                <Archive className="h-3 w-3" />
                {archived.length} забыто
              </Badge>
            )}
            {openQuestions > 0 ? (
              <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-300">
                {openQuestions} открытых вопросов
              </Badge>
            ) : (
              <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950 dark:text-emerald-300">
                открытых вопросов нет
              </Badge>
            )}
            {meta && meta.sessionsCount > 0 && (
              <Badge variant="outline" className="gap-1">
                <History className="h-3 w-3" />
                сессий: {meta.sessionsCount}
              </Badge>
            )}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            Память ещё пуста — отправь анкету агенту, и он внимательно изучит её и всё запомнит.
          </p>
        )}
      </div>

      {display && (
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-3 pb-4">
            {/* Устаревающие факты — просим перепроверить */}
            {counts.stale > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-950/20">
                <div className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold">
                  <History className="h-4 w-4 text-amber-500" />
                  Требует подтверждения — давно не проверялось
                </div>
                <p className="mb-2 text-[12px] text-muted-foreground">
                  Уверенность в этих данных упала со временем. Подтверди — и они снова станут свежими.
                </p>
                <ul className="flex flex-col gap-1">
                  {display.sections.flatMap((sec) =>
                    sec.facts
                      .filter((f) => factStatusOf(factEffective(f, sec.id, now)) === 'stale')
                      .map((f, i) => (
                        <li
                          key={`${sec.id}-${i}`}
                          className="flex items-center justify-between gap-2 rounded-lg bg-background/70 px-2.5 py-1.5"
                        >
                          <span className="min-w-0 text-[13px] leading-snug">
                            {f.text}
                            <span className="ml-1.5 text-[11px] text-muted-foreground">· {sec.title}</span>
                          </span>
                          <span className="flex shrink-0 items-center gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 gap-1 border-emerald-300 px-2 text-[11px] text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950"
                              disabled={pending === f.text}
                              onClick={() => act('confirm', f.text)}
                            >
                              <CheckCircle2 className="h-3 w-3" />
                              В силе
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                              disabled={pending === f.text}
                              onClick={() => act('forget', f.text)}
                            >
                              <LightbulbOff className="h-3 w-3" />
                              Забыть
                            </Button>
                          </span>
                        </li>
                      )),
                  )}
                </ul>
              </div>
            )}

            {display.inferences.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-950/20">
                <div className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold">
                  <Lightbulb className="h-4 w-4 text-amber-500" />
                  Выводы, которые я сделал о тебе
                </div>
                <ul className="flex flex-col gap-1">
                  {display.inferences.map((inf, i) => (
                    <li key={i} className="text-[13px] leading-snug">
                      {inf.text}
                      {inf.basis && <span className="text-muted-foreground"> — {inf.basis}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {display.sections.map((sec) => (
              <Section key={sec.id} sec={sec} pending={pending} onAction={act} />
            ))}

            {/* Архив забытого */}
            {archived.length > 0 && (
              <div className="rounded-xl border border-dashed border-border bg-muted/30 p-3">
                <div className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold">
                  <Archive className="h-4 w-4 text-muted-foreground" />
                  Забыто по времени — архив памяти
                </div>
                <p className="mb-2 text-[12px] text-muted-foreground">
                  Эти факты давно не подтверждались, и я перестал их использовать. Можно вернуть в
                  память или стереть навсегда.
                </p>
                <ul className="flex flex-col gap-1">
                  {archived.map((f, i) => (
                    <li
                      key={i}
                      className="flex items-center justify-between gap-2 rounded-lg bg-background/60 px-2.5 py-1.5"
                    >
                      <span className="min-w-0 text-[12.5px] leading-snug text-muted-foreground">
                        <s className="no-underline opacity-80">{f.text}</s>
                        {f.forgottenAt && (
                          <span className="ml-1.5 whitespace-nowrap text-[10px]">
                            · забыл {factAgeLabel(f)}
                          </span>
                        )}
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 gap-1 px-2 text-[11px]"
                          disabled={pending === f.text}
                          onClick={() => act('restore', f.text)}
                        >
                          <ArchiveRestore className="h-3 w-3" />
                          Вернуть
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 gap-1 px-2 text-[11px] text-red-500 hover:text-red-600 dark:text-red-400"
                          disabled={pending === f.text}
                          onClick={() => act('purge', f.text)}
                        >
                          <Trash2 className="h-3 w-3" />
                          Стереть
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {display.openQuestions.length > 0 && (
              <div className="rounded-xl border border-border bg-card p-3">
                <div className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold">
                  <CircleHelp className="h-4 w-4 text-amber-500" />
                  Открытые вопросы — жду твоих ответов в чате
                </div>
                <ul className="list-inside list-decimal flex flex-col gap-1 text-[13px] text-muted-foreground">
                  {display.openQuestions.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Как устроено забывание */}
            <div className="rounded-xl border border-border bg-muted/30 p-3 text-[12px] leading-relaxed text-muted-foreground">
              <div className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
                <History className="h-4 w-4" />
                Как я забываю
              </div>
              У каждого факта — свой срок полураспада: ожидания по доходу и локация выцветают
              быстрее (~1,5–3 мес.), образование и документы держатся годами. Если факт давно не
              подтверждался, я перестаю на него опираться и мягко перепроверяю в разговоре.
              Подтверждение — и он снова свежий.
            </div>

            {display.journal.length > 0 && (
              <div className="rounded-xl border border-border bg-card p-3">
                <div className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  Журнал памяти — что и когда я запомнил
                </div>
                <ul className="flex flex-col gap-1.5">
                  {display.journal
                    .slice(-24)
                    .reverse()
                    .map((e, i) => (
                      <JournalRow key={i} e={e} />
                    ))}
                </ul>
              </div>
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

/** Диалог «Память агента» из чата. */
export function MemoryPanel({
  open,
  onOpenChange,
  model,
  sessionId,
  onModelChange,
}: MemoryPanelDataProps & { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogTitle className="sr-only">Память агента</DialogTitle>
        <DialogDescription className="sr-only">
          Что агент запомнил о человеке, что устарело и что забыто по времени
        </DialogDescription>
        <div className="flex min-h-0 flex-1 flex-col px-5 pb-4 pt-5">
          <MemoryPanelContent model={model} sessionId={sessionId} onModelChange={onModelChange} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
