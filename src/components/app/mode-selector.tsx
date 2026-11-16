'use client';

import { motion } from 'framer-motion';
import { BatteryFull, Gauge, Loader2, Target } from 'lucide-react';
import { MODE_META } from '@/lib/types';
import type { SearchMode } from '@/lib/types';

const MODE_STYLE: Record<SearchMode, { icon: typeof Gauge; ring: string; iconBg: string }> = {
  easy: {
    icon: Gauge,
    ring: 'hover:border-emerald-400 dark:hover:border-emerald-700',
    iconBg: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400',
  },
  medium: {
    icon: BatteryFull,
    ring: 'hover:border-amber-400 dark:hover:border-amber-700',
    iconBg: 'bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400',
  },
  max: {
    icon: Target,
    ring: 'hover:border-red-500 dark:hover:border-red-800',
    iconBg: 'bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400',
  },
};

export function ModeSelector({
  onSelect,
  busy,
}: {
  onSelect: (mode: SearchMode) => void;
  busy: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto w-full max-w-3xl rounded-2xl border border-border bg-card p-4 shadow-sm"
    >
      <div className="mb-3 text-center text-sm font-semibold">
        Выбери режим поиска
        <span className="ml-2 font-normal text-muted-foreground">
          — от него зависит глубина и время
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {(Object.keys(MODE_META) as SearchMode[]).map((mode) => {
          const meta = MODE_META[mode];
          const style = MODE_STYLE[mode];
          const Icon = style.icon;
          return (
            <motion.button
              key={mode}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.97 }}
              disabled={busy}
              onClick={() => onSelect(mode)}
              className={`flex flex-col gap-2 rounded-xl border border-border bg-background p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${style.ring}`}
            >
              <div className="flex items-center justify-between">
                <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${style.iconBg}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <span className="text-[11px] font-medium text-muted-foreground">{meta.est}</span>
              </div>
              <div>
                <div className="font-semibold">{meta.label}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{meta.desc}</div>
                <div className="mt-2 text-xs leading-relaxed text-muted-foreground/80">
                  {meta.details}
                </div>
              </div>
              {busy && mode === 'max' && <Loader2 className="h-4 w-4 animate-spin" />}
            </motion.button>
          );
        })}
      </div>
    </motion.div>
  );
}
