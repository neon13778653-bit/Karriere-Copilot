'use client';

import { formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale';
import {
  Briefcase,
  GraduationCap,
  MessageSquare,
  Moon,
  Plus,
  Settings2,
  Sparkles,
  Sun,
  Trash2,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { Goal, SessionSummary } from '@/lib/types';

const GOAL_ICONS: Record<Goal, typeof Briefcase> = {
  job: Briefcase,
  ausbildung: GraduationCap,
  chat: MessageSquare,
};

export function Sidebar({
  sessions,
  activeId,
  onSelect,
  onNewSearch,
  onDelete,
  onOpenSettings,
  backendLabel,
}: {
  sessions: SessionSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewSearch: () => void;
  onDelete: (id: string) => void;
  onOpenSettings: () => void;
  backendLabel: string;
}) {
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex h-full w-full flex-col bg-zinc-950 text-zinc-100">
      <div className="flex items-center gap-2.5 px-4 pb-3 pt-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-red-600 to-amber-500">
          <Sparkles className="h-4.5 w-4.5 text-white" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-bold tracking-tight">Karriere Copilot</div>
          <div className="truncate text-[11px] text-zinc-400">ИИ-агент · работа и Ausbildung</div>
        </div>
      </div>

      <div className="px-3 pb-2">
        <Button
          onClick={onNewSearch}
          className="w-full gap-2 bg-red-600 text-white hover:bg-red-500"
          size="sm"
        >
          <Plus className="h-4 w-4" />
          Новый поиск
        </Button>
      </div>

      <div className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
        История
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-0.5 px-2 pb-2">
          {sessions.length === 0 && (
            <div className="px-2 py-6 text-center text-xs text-zinc-500">
              Пока пусто — начни первый поиск
            </div>
          )}
          {sessions.map((s) => {
            const Icon = GOAL_ICONS[s.goal] || MessageSquare;
            const active = s.id === activeId;
            return (
              <div
                key={s.id}
                className={`group relative flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors ${
                  active ? 'bg-zinc-800' : 'hover:bg-zinc-900'
                }`}
                onClick={() => onSelect(s.id)}
              >
                {active && (
                  <div className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded bg-red-500" />
                )}
                <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-red-400' : 'text-zinc-500'}`} />
                <div className="min-w-0 flex-1">
                  <div
                    className="line-clamp-2 break-words text-[13px] font-medium leading-snug text-zinc-200"
                    title={s.title}
                  >
                    {s.title}
                  </div>
                  <div className="truncate text-[11px] text-zinc-500">
                    {formatDistanceToNow(new Date(s.updatedAt), { addSuffix: true, locale: ru })}
                  </div>
                </div>
                <button
                  className="absolute right-1.5 hidden h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-800 hover:text-red-400 group-hover:flex"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(s.id);
                  }}
                  aria-label="Удалить сессию"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      <TooltipProvider delayDuration={200}>
        <div className="flex items-center gap-1 border-t border-zinc-800 px-3 py-3">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 flex-1 justify-start gap-2 px-2 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white"
            onClick={onOpenSettings}
          >
            <Settings2 className="h-4 w-4" />
            <span className="truncate">ИИ-сервер: {backendLabel}</span>
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 shrink-0 p-0 text-zinc-400 hover:bg-zinc-800 hover:text-white"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                aria-label="Сменить тему"
              >
                {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Тема</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    </div>
  );
}
