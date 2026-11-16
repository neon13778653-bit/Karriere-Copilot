'use client';

import { motion } from 'framer-motion';
import { ArrowRight, Briefcase, GraduationCap, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Goal } from '@/lib/types';

export function WelcomeScreen({ onChoose }: { onChoose: (goal: Goal | 'skip') => void }) {
  return (
    <div className="relative flex h-full flex-col items-center justify-center overflow-y-auto px-4 py-10">
      {/* Полосы флага Германии сверху — фирменный акцент */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex h-1.5 flex-col">
        <div className="h-1/3 w-full bg-zinc-900" />
        <div className="h-1/3 w-full bg-red-600" />
        <div className="h-1/3 w-full bg-amber-500" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex w-full max-w-3xl flex-col items-center"
      >
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-red-600 to-amber-500 shadow-lg shadow-red-600/20">
          <Sparkles className="h-8 w-8 text-white" />
        </div>
        <h1 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
          Karriere&nbsp;Copilot
        </h1>
        <p className="mt-3 max-w-xl text-center text-muted-foreground">
          ИИ-агент для поиска работы и Ausbildung в Германии. Выбери цель — откроется анкета
          профиля, или пропусти и сразу перейди к чату.
        </p>

        <div className="mt-10 grid w-full gap-4 sm:grid-cols-2">
          <motion.button
            whileHover={{ y: -3 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => onChoose('job')}
            className="group flex flex-col items-start gap-3 rounded-2xl border border-border bg-card p-6 text-left shadow-sm transition-colors hover:border-red-400 hover:shadow-md"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400">
              <Briefcase className="h-6 w-6" />
            </div>
            <div>
              <div className="text-lg font-semibold">Поиск работы</div>
              <div className="mt-1 text-sm text-muted-foreground">
                Агент найдёт вакансии на Indeed, StepStone, Arbeitsagentur, LinkedIn и сайтах
                компаний — и оценит, какие подходят именно тебе.
              </div>
            </div>
            <span className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-red-600 opacity-0 transition-opacity group-hover:opacity-100 dark:text-red-400">
              Начать <ArrowRight className="h-4 w-4" />
            </span>
          </motion.button>

          <motion.button
            whileHover={{ y: -3 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => onChoose('ausbildung')}
            className="group flex flex-col items-start gap-3 rounded-2xl border border-border bg-card p-6 text-left shadow-sm transition-colors hover:border-amber-400 hover:shadow-md"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400">
              <GraduationCap className="h-6 w-6" />
            </div>
            <div>
              <div className="text-lg font-semibold">Ausbildung</div>
              <div className="mt-1 text-sm text-muted-foreground">
                Учебные места (Ausbildungsplätze) под твой уровень немецкого и интересы — с
                оценкой шансов на зачисление.
              </div>
            </div>
            <span className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-amber-600 opacity-0 transition-opacity group-hover:opacity-100 dark:text-amber-400">
              Начать <ArrowRight className="h-4 w-4" />
            </span>
          </motion.button>
        </div>

        <Button
          variant="ghost"
          size="lg"
          className="mt-6 gap-2 text-muted-foreground"
          onClick={() => onChoose('skip')}
        >
          Просто пропустить — сразу к чату с ИИ-агентом
          <ArrowRight className="h-4 w-4" />
        </Button>

        <p className="mt-10 max-w-md text-center text-xs text-muted-foreground">
          Работает на встроенном облачном ИИ. В настройках можно подключить локальную модель
          (Ollama) или свой сервер с мощным железом.
        </p>
      </motion.div>
    </div>
  );
}
