'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  Ban,
  Brain,
  Building2,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  ExternalLink,
  Link2,
  MapPin,
  MessageCircleQuestion,
  ShieldAlert,
  Wallet,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { ApplyAdvice, LinkCheck, VacancyDetails, VacancyDTO, VacancyFit } from '@/lib/types';

function scoreColor(score?: number | null): string {
  if (score == null) return 'text-muted-foreground border-border';
  if (score >= 80) return 'text-emerald-600 border-emerald-300 bg-emerald-50 dark:bg-emerald-950 dark:border-emerald-800';
  if (score >= 60) return 'text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950 dark:border-amber-800';
  return 'text-zinc-500 border-zinc-300 bg-zinc-50 dark:bg-zinc-900 dark:border-zinc-700';
}

const ADVICE_STYLE: Record<ApplyAdvice, string> = {
  apply: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300',
  maybe: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
  skip: 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300',
};

function formatChecked(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function LinkBadge({ link }: { link: LinkCheck }) {
  const style =
    link.state === 'ok'
      ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
      : link.state === 'closed'
        ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300'
        : 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300';
  const label = link.state === 'ok' ? 'Ссылка проверена' : link.state === 'closed' ? 'Неактуальна' : 'Ссылку проверь сам';
  const Icon = link.state === 'ok' ? Link2 : link.state === 'closed' ? Ban : ShieldAlert;
  return (
    <span
      title={link.note}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${style}`}
    >
      <Icon className="h-3 w-3 shrink-0" />
      {label}
    </span>
  );
}

function FitBlock({ fit }: { fit: VacancyFit }) {
  return (
    <div className={`mb-3 rounded-xl border p-3 ${ADVICE_STYLE[fit.advice]}`}>
      <div className="text-xs font-semibold uppercase tracking-wide">Подходит ли тебе: {fit.label}</div>
      {fit.summary && <p className="mt-1 text-sm leading-relaxed text-foreground/90">{fit.summary}</p>}
      <FitList title="Жёсткие несоответствия" items={fit.blockers} tone="red" icon={<Ban className="h-3.5 w-3.5 shrink-0" />} />
      <FitList title="Совпадает с твоим профилем" items={fit.matches} tone="green" icon={<CheckCircle2 className="h-3.5 w-3.5 shrink-0" />} />
      <FitList title="Чего не хватает" items={fit.gaps} tone="amber" icon={<AlertTriangle className="h-3.5 w-3.5 shrink-0" />} />
      <FitList title="Что сделать перед откликом" items={fit.actions} tone="neutral" icon={<ClipboardList className="h-3.5 w-3.5 shrink-0" />} numbered />
    </div>
  );
}

function FitList({
  title,
  items,
  tone,
  icon,
  numbered,
}: {
  title: string;
  items: string[];
  tone: 'red' | 'green' | 'amber' | 'neutral';
  icon: React.ReactNode;
  numbered?: boolean;
}) {
  if (!items.length) return null;
  const color =
    tone === 'red'
      ? 'text-red-700 dark:text-red-400'
      : tone === 'green'
        ? 'text-emerald-700 dark:text-emerald-400'
        : tone === 'amber'
          ? 'text-amber-700 dark:text-amber-400'
          : 'text-foreground';
  const List = numbered ? 'ol' : 'ul';
  return (
    <div className="mt-2.5">
      <div className={`mb-1 flex items-center gap-1.5 text-xs font-semibold ${color}`}>
        {icon}
        {title}
      </div>
      <List className={`${numbered ? 'list-decimal' : 'list-disc'} space-y-0.5 pl-5 text-sm text-foreground/80`}>
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </List>
    </div>
  );
}

function DetailsBlock({ d }: { d: VacancyDetails }) {
  const facts: [string, string | null | undefined][] = [
    ['Срок подачи', d.deadline],
    ['Начало', d.startDate],
    ['Опубликовано', d.postedAt],
    ['Тип занятости', d.employmentType],
    ['Длительность обучения', d.duration],
    ['Доход / Vergütung', d.salary],
    ['Нужный немецкий', d.germanRequired],
    ['Образование', d.education],
  ];
  const shown = facts.filter(([, v]) => !!v);
  const lists: [string, string[]][] = [
    ['Требования', d.requirements],
    ['Задачи', d.tasks],
    ['Условия', d.benefits],
  ];
  const hasLists = lists.some(([, l]) => l.length);
  if (!shown.length && !hasLists && !d.howToApply && !d.contact) return null;
  return (
    <div className="mb-3 rounded-xl border border-border p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <CalendarClock className="h-3.5 w-3.5 shrink-0" />
        Главное о вакансии
        <span className="ml-auto font-normal normal-case tracking-normal">
          {d.source === 'page' ? 'со страницы вакансии' : 'из краткой выдачи поиска'}
        </span>
      </div>
      {shown.length > 0 && (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
          {shown.map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <dt className="shrink-0 text-muted-foreground">{k}:</dt>
              <dd className="font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {lists.map(([title, items]) =>
        items.length ? (
          <div key={title} className="mt-2.5">
            <div className="mb-1 text-xs font-semibold text-muted-foreground">{title}</div>
            <ul className="list-disc space-y-0.5 pl-5 text-sm text-foreground/80">
              {items.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </div>
        ) : null,
      )}
      {(d.howToApply || d.contact) && (
        <div className="mt-2.5 text-sm">
          {d.howToApply && (
            <p>
              <span className="text-muted-foreground">Как подать заявку: </span>
              {d.howToApply}
            </p>
          )}
          {d.contact && (
            <p>
              <span className="text-muted-foreground">Контакт: </span>
              {d.contact}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function VacancyCard({
  vacancy,
  rank,
  onAsk,
}: {
  vacancy: VacancyDTO;
  rank: number;
  onAsk: (v: VacancyDTO) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(rank * 0.04, 0.4) }}
    >
      <Collapsible open={open} onOpenChange={setOpen}>
        <div
          className={`rounded-xl border bg-card shadow-sm transition-shadow ${
            open ? 'border-red-300 shadow-md dark:border-red-800' : 'border-border hover:shadow-md'
          }`}
        >
          <CollapsibleTrigger className="w-full px-4 py-3.5 text-left">
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-lg bg-muted text-sm font-bold text-muted-foreground">
                {rank}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-semibold leading-snug">{vacancy.title}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                      {vacancy.company && (
                        <span className="inline-flex items-center gap-1 truncate">
                          <Building2 className="h-3.5 w-3.5 shrink-0" />
                          {vacancy.company}
                        </span>
                      )}
                      {vacancy.location && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5 shrink-0" />
                          {vacancy.location}
                        </span>
                      )}
                      {vacancy.salary && (
                        <span className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400">
                          <Wallet className="h-3.5 w-3.5 shrink-0" />
                          {vacancy.salary}
                        </span>
                      )}
                    </div>
                    {vacancy.intel && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {vacancy.intel.fit && (
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${ADVICE_STYLE[vacancy.intel.fit.advice]}`}
                          >
                            {vacancy.intel.fit.label}
                          </span>
                        )}
                        <LinkBadge link={vacancy.intel.link} />
                      </div>
                    )}
                    {vacancy.tags && vacancy.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {vacancy.tags.slice(0, 4).map((t) => (
                          <Badge key={t} variant="secondary" className="px-2 py-0 text-[11px] font-normal">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-center gap-1">
                    <div
                      className={`flex h-11 w-11 flex-col items-center justify-center rounded-full border-2 ${scoreColor(
                        vacancy.score,
                      )}`}
                    >
                      <span className="text-sm font-bold leading-none">
                        {vacancy.score ?? '—'}
                      </span>
                      <span className="text-[8px] leading-none opacity-70">/100</span>
                    </div>
                    <ChevronDown
                      className={`h-4 w-4 text-muted-foreground transition-transform ${
                        open ? 'rotate-180' : ''
                      }`}
                    />
                  </div>
                </div>
              </div>
            </div>
          </CollapsibleTrigger>

          <CollapsibleContent>
            <div className="border-t border-border px-4 py-3">
              {vacancy.intel?.fit && <FitBlock fit={vacancy.intel.fit} />}
              {vacancy.verdict && !vacancy.intel?.fit && (
                <div className="mb-3 flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-sm font-medium">
                  <Brain className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
                  <span>Мнение ИИ: {vacancy.verdict}</span>
                </div>
              )}
              {vacancy.description && (
                <p className="mb-3 text-sm leading-relaxed text-foreground/90">
                  {vacancy.description}
                </p>
              )}
              {vacancy.intel?.details && <DetailsBlock d={vacancy.intel.details} />}
              {!vacancy.intel?.fit && vacancy.reasons && vacancy.reasons.length > 0 && (
                <div className="mb-2">
                  <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    Почему подходит
                  </div>
                  <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
                    {vacancy.reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}
              {!vacancy.intel?.fit && vacancy.risks && vacancy.risks.length > 0 && (
                <div className="mb-2">
                  <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    На что обратить внимание
                  </div>
                  <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
                    {vacancy.risks.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}
              {vacancy.snippet && (
                <p className="mb-3 line-clamp-3 rounded-lg bg-muted/60 px-3 py-2 text-xs italic text-muted-foreground">
                  {vacancy.snippet}
                </p>
              )}
              {vacancy.intel && (
                <p className="mb-2 text-xs leading-relaxed text-muted-foreground">
                  {vacancy.intel.link.note}
                  {vacancy.intel.link.checkedAt ? ` Проверено ${formatChecked(vacancy.intel.link.checkedAt)}.` : ''}{' '}
                  Перед откликом сверь срок и требования на сайте работодателя.
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button asChild size="sm" variant="default" className="gap-1.5">
                  <a href={vacancy.url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-3.5 w-3.5" />
                    Открыть вакансию
                  </a>
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onAsk(vacancy)}>
                  <MessageCircleQuestion className="h-3.5 w-3.5" />
                  Спросить в чате
                </Button>
                {vacancy.source && (
                  <span className="ml-auto text-xs text-muted-foreground">источник: {vacancy.source}</span>
                )}
              </div>
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </motion.div>
  );
}
