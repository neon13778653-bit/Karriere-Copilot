'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { useToast } from '@/hooks/use-toast';
import { ChatView, type SearchProgress } from '@/components/app/chat-view';
import { ProfileFormPage } from '@/components/app/profile-form';
import { SettingsDialog } from '@/components/app/settings-dialog';
import { Sidebar } from '@/components/app/sidebar';
import { WelcomeScreen } from '@/components/app/welcome-screen';
import { applyAnswer, applyClear, applySkip, finalizeProfile, profileChanges } from '@/lib/profile-wizard';
import { DEFAULT_BACKEND, MODE_META } from '@/lib/types';
import type {
  AgentEvent,
  BackendConfig,
  ChatMsg,
  CustomSection,
  Goal,
  PersonModel,
  ProfileDocument,
  SearchMode,
  SessionStage,
  SessionSummary,
  UserProfile,
  VacancyDTO,
} from '@/lib/types';
import type { WizardQuestion } from '@/lib/profile-wizard';

const ACTIVE_KEY = 'kc-active-session';
const BACKEND_KEY = 'kc-backend';

function backendLabel(cfg: BackendConfig): string {
  if (cfg.provider === 'ollama') return 'Ollama (локально)';
  if (cfg.provider === 'lmstudio') return 'LM Studio (локально)';
  if (cfg.provider === 'groq') return 'GroqCloud';
  if (cfg.provider === 'openrouter') return 'OpenRouter';
  if (cfg.provider === 'custom') return 'Свой сервер';
  return 'Встроенный ИИ';
}

export default function Home() {
  const { toast } = useToast();

  const [phase, setPhase] = useState<'welcome' | 'chat'>('welcome');
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSession, setActiveSession] = useState<SessionSummary | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [vacancies, setVacancies] = useState<VacancyDTO[]>([]);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [progress, setProgress] = useState<SearchProgress | null>(null);
  const [modeSelectorOpen, setModeSelectorOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [backend, setBackend] = useState<BackendConfig>(DEFAULT_BACKEND);
  const [booted, setBooted] = useState(false);
  const busyRef = useRef(false);

  /* ---------- Анкета-регистрация (отдельная страница) ---------- */
  const [wizardDraft, setWizardDraft] = useState<UserProfile | null>(null);
  const [wizardView, setWizardView] = useState<'form' | 'chat'>('form');
  const [wizardSubmitting, setWizardSubmitting] = useState(false);
  const wizardDraftRef = useRef<UserProfile | null>(null);
  // Режим правки уже проанализированного профиля: сессия остаётся в чате, анализ не сбрасывается
  const [profileEditMode, setProfileEditMode] = useState(false);
  const profileBaselineRef = useRef<UserProfile | null>(null);
  const [profileBaseline, setProfileBaselineState] = useState<UserProfile | null>(null);
  const setBaseline = useCallback((p: UserProfile | null) => {
    profileBaselineRef.current = p;
    setProfileBaselineState(p); // для отрисовки: ref во время рендера читать нельзя
  }, []);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    wizardDraftRef.current = wizardDraft;
  }, [wizardDraft]);

  const stage: SessionStage = activeSession?.stage ?? 'chat';

  /** Действие в панели памяти: обновить модель в профиле сессии и в черновике анкеты. */
  const handleMemoryChange = useCallback((m: PersonModel) => {
    setActiveSession((prev) =>
      prev
        ? { ...prev, profile: { ...(prev.profile ?? { goal: prev.goal }), personModel: m } }
        : prev,
    );
    setWizardDraft((prev) => {
      const base = prev;
      if (!base) return prev;
      const next = { ...base, personModel: m };
      wizardDraftRef.current = next;
      return next;
    });
  }, []);

  /** Эффективная цель: профиль может сменить цель в свободном чате. */
  const effectiveGoal: Goal = useMemo(() => {
    const pGoal = wizardDraft?.goal ?? activeSession?.profile?.goal;
    if (pGoal && pGoal !== 'chat') return pGoal;
    return activeSession?.goal ?? 'chat';
  }, [wizardDraft, activeSession]);

  /* ---------- SSE ---------- */
  const consumeSSE = async (res: Response, onEvent: (evt: AgentEvent) => void) => {
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      throw new Error(text || `HTTP ${res.status}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';
      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith('data:')) continue;
        try {
          onEvent(JSON.parse(line.slice(5).trim()) as AgentEvent);
        } catch {
          // игнорируем битые события
        }
      }
    }
  };

  const handleStepEvt = (evt: AgentEvent & { type: 'step' }) => {
    setProgress((prev) => {
      const base = prev ?? { steps: [], logs: [], mode: null };
      const steps = [...base.steps];
      const idx = steps.findIndex((s) => s.key === evt.key);
      if (idx === -1) steps.push({ key: evt.key, label: evt.label, status: evt.status });
      else steps[idx] = { key: evt.key, label: evt.label, status: evt.status };
      return { ...base, steps };
    });
  };

  const handleLogEvt = (evt: AgentEvent & { type: 'log' }) => {
    setProgress((prev) =>
      prev ? { ...prev, logs: [...prev.logs, evt.text].slice(-40) } : prev,
    );
  };

  /* ---------- Сессии ---------- */
  const loadSession = useCallback(async (id: string) => {
    const res = await fetch(`/api/sessions/${id}`);
    if (!res.ok) return;
    const json = await res.json();
    setActiveSession(json.session);
    setMessages(json.messages || []);
    setVacancies(json.vacancies || []);
    setStreamingText(null);
    setProgress(null);
    setModeSelectorOpen(false);
    setPhase('chat');
    const sStage: SessionStage = json.session?.stage ?? 'chat';
    const sGoal: Goal = json.session?.goal ?? 'chat';
    const draft: UserProfile | null =
      sStage === 'wizard' ? (json.session.profile ?? { goal: sGoal }) : null;
    setWizardDraft(draft);
    setWizardView(sStage === 'wizard' ? 'form' : 'chat');
    setProfileEditMode(false);
    setBaseline(null);
    localStorage.setItem(ACTIVE_KEY, id);
    setSidebarOpen(false);
  }, [setBaseline]);

  const refreshSessions = async () => {
    try {
      const res = await fetch('/api/sessions');
      const json = await res.json();
      if (Array.isArray(json.sessions)) setSessions(json.sessions);
    } catch {
      // игнорируем
    }
  };

  /* ---------- Загрузка при старте ---------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const savedBackend = localStorage.getItem(BACKEND_KEY);
        if (savedBackend) {
          const parsed = JSON.parse(savedBackend);
          if (parsed && typeof parsed.provider === 'string') setBackend(parsed);
        }
        const res = await fetch('/api/sessions');
        const json = await res.json();
        if (!cancelled && Array.isArray(json.sessions)) setSessions(json.sessions);

        const activeId = localStorage.getItem(ACTIVE_KEY);
        if (activeId && json.sessions?.some((s: SessionSummary) => s.id === activeId)) {
          await loadSession(activeId);
        }
      } catch {
        // offline — просто показываем welcome
      } finally {
        if (!cancelled) setBooted(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadSession]);


  const createSession = async (goal: Goal) => {
    setCreating(true);
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Ошибка создания сессии');
      setSessions((prev) => [json.session, ...prev]);
      setActiveSession(json.session);
      setMessages(json.messages || []);
      setVacancies([]);
      setStreamingText(null);
      setProgress(null);
      setModeSelectorOpen(false);
      setPhase('chat');
      setWizardDraft(json.session.stage === 'wizard' ? (json.session.profile ?? { goal }) : null);
      setWizardView(json.session.stage === 'wizard' ? 'form' : 'chat');
      setProfileEditMode(false);
      setBaseline(null);
      localStorage.setItem(ACTIVE_KEY, json.session.id);
    } catch (e) {
      toast({
        title: 'Не удалось создать сессию',
        description: e instanceof Error ? e.message : 'Попробуй ещё раз',
        variant: 'destructive',
      });
    } finally {
      setCreating(false);
    }
  };

  const chooseGoal = (goal: Goal | 'skip') => {
    createSession(goal === 'skip' ? 'chat' : goal);
  };

  const deleteSession = async (id: string) => {
    await fetch(`/api/sessions/${id}`, { method: 'DELETE' }).catch(() => null);
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (activeSession?.id === id) {
      setActiveSession(null);
      setMessages([]);
      setVacancies([]);
      setWizardDraft(null);
      setPhase('welcome');
      localStorage.removeItem(ACTIVE_KEY);
    }
  };

  const newSearch = () => {
    if (busyRef.current) return;
    setActiveSession(null);
    setMessages([]);
    setVacancies([]);
    setStreamingText(null);
    setProgress(null);
    setModeSelectorOpen(false);
    setWizardDraft(null);
    setWizardView('form');
    setProfileEditMode(false);
    setBaseline(null);
    setPhase('welcome');
    localStorage.removeItem(ACTIVE_KEY);
    setSidebarOpen(false);
  };

  const patchSession = useCallback(
    async (id: string, data: Record<string, unknown>): Promise<boolean> => {
      try {
        const res = await fetch(`/api/sessions/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        return res.ok;
      } catch {
        return false;
      }
    },
    [],
  );

  /* ---------- Анкета-регистрация ---------- */
  const profilePatchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Сохранение профиля в БД с дебаунсом (печатает в текстовых полях — не спамим запросами). */
  const patchProfile = useCallback(
    (id: string, profile: UserProfile, immediate = false) => {
      if (profilePatchTimer.current) {
        clearTimeout(profilePatchTimer.current);
        profilePatchTimer.current = null;
      }
      const run = () => {
        profilePatchTimer.current = null;
        void patchSession(id, { profile });
      };
      if (immediate) run();
      else profilePatchTimer.current = setTimeout(run, 700);
    },
    [patchSession],
  );

  const wizardAnswer = useCallback(
    (q: WizardQuestion, value: string | string[]) => {
      if (!activeSession) return;
      const base: UserProfile = wizardDraftRef.current ?? { goal: effectiveGoal };
      const next = applyAnswer(effectiveGoal, base, q, value);
      wizardDraftRef.current = next;
      setWizardDraft(next);
      setActiveSession((prev) => (prev ? { ...prev, profile: next } : prev));

      if (q.id === 'goalPick' && next.goal && next.goal !== 'chat') {
        const g = next.goal;
        const newTitle = g === 'ausbildung' ? 'Ausbildung' : 'Поиск работы';
        setActiveSession((prev) => (prev ? { ...prev, goal: g, title: newTitle } : prev));
        patchProfile(activeSession.id, next, true);
        patchSession(activeSession.id, { goal: g, title: newTitle });
        refreshSessions();
      } else {
        patchProfile(activeSession.id, next);
      }
    },
    [activeSession, effectiveGoal, patchSession],
  );

  const wizardSkip = useCallback(
    (q: WizardQuestion) => {
      if (!activeSession) return;
      const base: UserProfile = wizardDraftRef.current ?? { goal: effectiveGoal };
      const next = applySkip(effectiveGoal, base, q);
      wizardDraftRef.current = next;
      setWizardDraft(next);
      setActiveSession((prev) => (prev ? { ...prev, profile: next } : prev));
      patchProfile(activeSession.id, next, true);
    },
    [activeSession, effectiveGoal, patchProfile],
  );

  const wizardClear = useCallback(
    (q: WizardQuestion) => {
      if (!activeSession) return;
      const base: UserProfile = wizardDraftRef.current ?? { goal: effectiveGoal };
      const next = applyClear(base, q);
      wizardDraftRef.current = next;
      setWizardDraft(next);
      setActiveSession((prev) => (prev ? { ...prev, profile: next } : prev));
      patchProfile(activeSession.id, next, true);
    },
    [activeSession, effectiveGoal, patchProfile],
  );

  const wizardCustomSections = useCallback(
    (sections: CustomSection[]) => {
      if (!activeSession) return;
      const base = wizardDraftRef.current ?? ({ goal: effectiveGoal } as UserProfile);
      const next: UserProfile = { ...base, customSections: sections };
      wizardDraftRef.current = next;
      setWizardDraft(next);
      setActiveSession((prev) => (prev ? { ...prev, profile: next } : prev));
      patchProfile(activeSession.id, next); // с задержкой: человек печатает
    },
    [activeSession, effectiveGoal, patchProfile],
  );

  const wizardDocuments = useCallback(
    (patch: ProfileDocument[] | ((prev: ProfileDocument[]) => ProfileDocument[])) => {
      if (!activeSession) return;
      const base = wizardDraftRef.current;
      if (!base) return;
      const nextDocs = typeof patch === 'function' ? patch(base.documents || []) : patch;
      const next: UserProfile = { ...base, documents: nextDocs };
      wizardDraftRef.current = next;
      setWizardDraft(next);
      setActiveSession((prev) => (prev ? { ...prev, profile: next } : prev));
      patchProfile(activeSession.id, next, true);
    },
    [activeSession, patchProfile],
  );

  /** Открыть анкету (кнопка «Профиль» в чате). */
  const startProfileWizard = useCallback(async () => {
    if (!activeSession || busyRef.current) return;
    const draft: UserProfile = activeSession.profile ?? { goal: activeSession.goal };
    setWizardDraft(draft);
    wizardDraftRef.current = draft;
    setWizardView('form');
    // Профиль уже проанализирован: открываем режим правки — сессия остаётся в чате, поиск и анализ не сбрасываются
    if (activeSession.stage === 'ready' || activeSession.stage === 'chat') {
      setBaseline(draft);
      setProfileEditMode(true);
      return;
    }
    setActiveSession((prev) => (prev ? { ...prev, stage: 'wizard', profile: draft } : prev));
    await patchSession(activeSession.id, { stage: 'wizard', profile: draft });
    refreshSessions();
  }, [activeSession, patchSession]);

  /** Отправить анкету агенту → глубокий анализ. */
  /* ---------- Глубокий анализ профиля ---------- */
  const runAnalyze = useCallback(async () => {
    const session = activeSession;
    if (!session) return;
    setBusy(true);
    setProgress({ steps: [], logs: [], mode: null });
    setStreamingText('');
    try {
      const res = await fetch('/api/agent/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.id, backend }),
      });
      await consumeSSE(res, (evt) => {
        if (evt.type === 'delta') {
          setStreamingText((prev) => (prev ?? '') + evt.text);
        } else if (evt.type === 'step') {
          handleStepEvt(evt);
        } else if (evt.type === 'log') {
          handleLogEvt(evt);
        } else if (evt.type === 'backend') {
          toast({ title: 'Переключение ИИ', description: evt.note });
        } else if (evt.type === 'analysis') {
          setStreamingText(null);
          setMessages((prev) => [
            ...prev,
            { id: `local-a-${Date.now()}`, role: 'assistant', content: evt.text },
          ]);
        } else if (evt.type === 'memory') {
          // агент обновил память о человеке — сразу отражаем в панели
          setActiveSession((prev) =>
            prev ? { ...prev, profile: { ...(prev.profile ?? { goal: prev.goal }), personModel: evt.model } } : prev,
          );
        } else if (evt.type === 'ready') {
          setActiveSession((prev) => (prev ? { ...prev, stage: 'ready' } : prev));
        } else if (evt.type === 'error') {
          toast({ title: 'Анализ не удался', description: evt.message, variant: 'destructive' });
        }
      });
    } catch (e) {
      toast({
        title: 'Не удалось проанализировать анкету',
        description: e instanceof Error ? e.message : 'Проверь соединение',
        variant: 'destructive',
      });
    } finally {
      setStreamingText(null);
      setProgress(null);
      setBusy(false);
      await loadSession(session.id);
      refreshSessions();
    }
  }, [activeSession, backend, loadSession]);

  const submitWizard = useCallback(
    async (override?: UserProfile) => {
      if (!activeSession || busyRef.current) return;
      const draft = override ?? wizardDraftRef.current;
      if (!draft) return;
      setWizardSubmitting(true);
      try {
        // отменяем отложенное сохранение черновика — сейчас сохраняем финальную анкету
        if (profilePatchTimer.current) {
          clearTimeout(profilePatchTimer.current);
          profilePatchTimer.current = null;
        }
        const finalGoal: Goal =
          draft.goal && draft.goal !== 'chat' ? draft.goal : activeSession.goal;
        const final = finalizeProfile(finalGoal, draft);
        const dir = final.position || (final.decided === false ? 'подбор направления' : '');
        const goalWord =
          finalGoal === 'job' ? 'Работа' : finalGoal === 'ausbildung' ? 'Ausbildung' : 'Профиль';
        const newTitle = `${goalWord}${dir ? `: ${dir}` : ''}${final.city ? ` · ${final.city}` : ''}`;

        const ok = await patchSession(activeSession.id, {
          profile: final,
          stage: 'analysis',
          title: newTitle,
          syncMemory: true,
          ...(finalGoal !== 'chat' ? { goal: finalGoal } : {}),
        });
        if (!ok) throw new Error('Не удалось сохранить анкету');

        wizardDraftRef.current = null;
        setWizardDraft(null);
        setWizardView('chat');
        setActiveSession((prev) =>
          prev
            ? {
                ...prev,
                stage: 'analysis',
                profile: final,
                title: newTitle,
                ...(finalGoal !== 'chat' ? { goal: finalGoal } : {}),
              }
            : prev,
        );
        refreshSessions();
        await runAnalyze();
      } catch (e) {
        toast({
          title: 'Не удалось отправить анкету',
          description: e instanceof Error ? e.message : 'Попробуй ещё раз',
          variant: 'destructive',
        });
      } finally {
        setWizardSubmitting(false);
      }
    },
    [activeSession, patchSession, patchProfile, runAnalyze],
  );

  /**
   * Сохранить правки профиля. reanalyze=false — анализ остаётся прежним, обновляются
   * только ответы и факты памяти из анкеты; reanalyze=true — как при первой отправке.
   */
  const saveProfileEdit = useCallback(
    async (reanalyze: boolean) => {
      if (!activeSession || busyRef.current) return;
      const draft = wizardDraftRef.current;
      if (!draft) return;
      if (reanalyze) {
        setProfileEditMode(false);
        setBaseline(null);
        await submitWizard(draft);
        return;
      }
      if (profilePatchTimer.current) {
        clearTimeout(profilePatchTimer.current);
        profilePatchTimer.current = null;
      }
      const goal: Goal = draft.goal && draft.goal !== 'chat' ? draft.goal : activeSession.goal;
      const final = finalizeProfile(goal, draft, { keepAnalysis: true });
      const { changes } = profileChanges(goal, profileBaselineRef.current, final);
      try {
        const res = await fetch(`/api/sessions/${activeSession.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profile: final, syncMemory: true, refreshMemory: true }),
        });
        if (!res.ok) throw new Error('Не удалось сохранить профиль');
        const json = await res.json();
        const saved: UserProfile = json.profile ?? final;
        setActiveSession((prev) => (prev ? { ...prev, profile: saved } : prev));
        wizardDraftRef.current = null;
        setWizardDraft(null);
        setProfileEditMode(false);
        setBaseline(null);
        setWizardView('chat');
        refreshSessions();
        toast({
          title: changes.length ? 'Профиль сохранён' : 'Изменений нет',
          description: changes.length
            ? `Изменено: ${changes.length}. Память агента обновлена, анализ остался прежним — при желании его можно пересчитать.`
            : 'Профиль остался прежним.',
        });
      } catch (e) {
        toast({
          title: 'Не удалось сохранить',
          description: e instanceof Error ? e.message : 'Попробуй ещё раз.',
          variant: 'destructive',
        });
      }
    },
    [activeSession, submitWizard],
  );

  /** Выход из режима правки: если что-то поменялось — сохраняем (с обновлением памяти). */
  const exitProfileEdit = useCallback(() => {
    const draft = wizardDraftRef.current;
    const goal: Goal = draft?.goal && draft.goal !== 'chat' ? draft.goal : (activeSession?.goal ?? 'chat');
    const changed =
      !!draft &&
      profileChanges(goal, profileBaselineRef.current, finalizeProfile(goal, draft, { keepAnalysis: true }))
        .changes.length > 0;
    if (changed) {
      void saveProfileEdit(false);
      return;
    }
    wizardDraftRef.current = null;
    setWizardDraft(null);
    setProfileEditMode(false);
    setBaseline(null);
    setWizardView('chat');
  }, [activeSession, saveProfileEdit]);

  /* ---------- Чат ---------- */
  const sendMessage = async (text: string, vacancyId?: string) => {
    if (!activeSession || busyRef.current) return;
    const wasAnalysisStage = (activeSession.stage ?? 'chat') === 'analysis';
    const userMsg: ChatMsg = { id: `local-u-${Date.now()}`, role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);
    setBusy(true);
    setStreamingText('');
    if (wasAnalysisStage) setProgress({ steps: [], logs: [], mode: null });
    try {
      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: activeSession.id, message: text, vacancyId, backend }),
      });
      await consumeSSE(res, (evt) => {
        if (evt.type === 'delta') {
          setStreamingText((prev) => (prev ?? '') + evt.text);
        } else if (evt.type === 'step') {
          handleStepEvt(evt);
        } else if (evt.type === 'log') {
          handleLogEvt(evt);
        } else if (evt.type === 'backend') {
          toast({ title: 'Переключение ИИ', description: evt.note });
        } else if (evt.type === 'memory') {
          setActiveSession((prev) =>
            prev ? { ...prev, profile: { ...(prev.profile ?? { goal: prev.goal }), personModel: evt.model } } : prev,
          );
        } else if (evt.type === 'ready') {
          setActiveSession((prev) => (prev ? { ...prev, stage: 'ready' } : prev));
        } else if (evt.type === 'error') {
          toast({ title: 'Ошибка агента', description: evt.message, variant: 'destructive' });
        }
      });
    } catch (e) {
      toast({
        title: 'Не удалось отправить сообщение',
        description: e instanceof Error ? e.message : 'Проверь соединение',
        variant: 'destructive',
      });
    } finally {
      setStreamingText(null);
      setBusy(false);
      setProgress(null);
      if (activeSession) await loadSession(activeSession.id);
      refreshSessions();
    }
  };

  /* ---------- Поиск ---------- */
  const startSearch = async (mode: SearchMode) => {
    if (!activeSession || busyRef.current) return;
    setModeSelectorOpen(false);
    setBusy(true);
    setProgress({ steps: [], logs: [], mode });
    setMessages((prev) => [
      ...prev,
      {
        id: `local-u-${Date.now()}`,
        role: 'user',
        content: `Запусти поиск в режиме «${MODE_META[mode].label}»`,
      },
    ]);
    try {
      const res = await fetch('/api/agent/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: activeSession.id, mode, backend }),
      });
      await consumeSSE(res, (evt) => {
        if (evt.type === 'step') {
          handleStepEvt(evt);
        } else if (evt.type === 'log') {
          handleLogEvt(evt);
        } else if (evt.type === 'backend') {
          toast({ title: 'Переключение ИИ', description: evt.note });
        } else if (evt.type === 'analysis') {
          // карточка «как я тебя понял» — сразу в чат, до результатов поиска
          setMessages((prev) => [
            ...prev,
            {
              id: `local-a-${Date.now()}`,
              role: 'assistant',
              content: evt.text,
            },
          ]);
        } else if (evt.type === 'vacancies') {
          setVacancies(evt.items);
          setMessages((prev) => [
            ...prev,
            {
              id: `local-a-${Date.now()}`,
              role: 'assistant',
              content: evt.summary,
              vacancyIds: evt.items.map((v) => v.id),
            },
          ]);
          setProgress(null);
        } else if (evt.type === 'error') {
          toast({ title: 'Поиск не удался', description: evt.message, variant: 'destructive' });
          setProgress(null);
        }
      });
    } catch (e) {
      toast({
        title: 'Ошибка поиска',
        description: e instanceof Error ? e.message : 'Проверь соединение',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
      setProgress(null);
      if (activeSession) await loadSession(activeSession.id);
      refreshSessions();
    }
  };

  const askVacancy = (v: VacancyDTO) => {
    sendMessage(
      `Расскажи подробнее про вакансию «${v.title}»${v.company ? ` в ${v.company}` : ''}: стоит ли подавать заявку, что подготовить?`,
      v.id,
    );
  };

  /* ---------- Рендер ---------- */
  const sidebarNode = (
    <Sidebar
      sessions={sessions}
      activeId={activeSession?.id || null}
      onSelect={loadSession}
      onNewSearch={newSearch}
      onDelete={deleteSession}
      onOpenSettings={() => {
        setSettingsOpen(true);
        setSidebarOpen(false);
      }}
      backendLabel={backendLabel(backend)}
    />
  );

  const inFormView =
    phase === 'chat' &&
    !!activeSession &&
    wizardView === 'form' &&
    (stage === 'wizard' || profileEditMode);

  if (!booted) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin text-red-600" />
          Загружаю Karriere Copilot…
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <aside className="hidden w-[264px] shrink-0 lg:block">{sidebarNode}</aside>

      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="w-[280px] p-0">
          <SheetTitle className="sr-only">Навигация</SheetTitle>
          <SheetDescription className="sr-only">
            История поисковых сессий и настройки ИИ-сервера
          </SheetDescription>
          {sidebarNode}
        </SheetContent>
      </Sheet>

      <main className="relative flex min-w-0 flex-1 flex-col">
        {phase === 'welcome' && <WelcomeScreen onChoose={chooseGoal} />}

        {phase === 'chat' && activeSession && inFormView && (
          <ProfileFormPage
            key={activeSession.id}
            goal={effectiveGoal}
            profile={wizardDraft ?? { goal: effectiveGoal }}
            busy={busy}
            submitting={wizardSubmitting}
            sessionId={activeSession.id}
            editMode={profileEditMode}
            baseline={profileBaseline}
            onAnswer={wizardAnswer}
            onSkip={wizardSkip}
            onClear={wizardClear}
            onCustomSectionsChange={wizardCustomSections}
            onDocumentsChange={wizardDocuments}
            onSubmit={(profile) => submitWizard(profile)}
            onSaveEdit={saveProfileEdit}
            onModelChange={handleMemoryChange}
            onExit={profileEditMode ? exitProfileEdit : () => setWizardView('chat')}
            onToggleSidebar={() => setSidebarOpen(true)}
          />
        )}

        {phase === 'chat' && activeSession && !inFormView && (
          <ChatView
            title={activeSession.title}
            goal={effectiveGoal}
            stage={stage}
            messages={messages}
            vacancies={vacancies}
            streamingText={streamingText}
            progress={progress}
            modeSelectorOpen={modeSelectorOpen}
            busy={busy}
            backendLabel={backendLabel(backend)}
            personModel={activeSession.profile?.personModel ?? null}
            sessionId={activeSession.id}
            onMemoryChange={handleMemoryChange}
            showWizardResume={stage === 'wizard' && !busy}
            onResumeWizard={() => {
              if (!wizardDraft) {
                const draft: UserProfile = activeSession.profile ?? { goal: effectiveGoal };
                setWizardDraft(draft);
                wizardDraftRef.current = draft;
              }
              setWizardView('form');
            }}
            onOpenModeSelector={() => {
              if (stage === 'wizard') {
                toast({
                  title: 'Сначала заполни анкету',
                  description:
                    'Ответь на вопросы анкеты — после отправки я глубоко проанализирую её и сразу предложу начать поиск.',
                });
              } else if (stage === 'analysis') {
                toast({
                  title: 'Я ещё разбираюсь в твоём профиле',
                  description: 'Ответь на уточняющие вопросы выше — и сразу начнём поиск.',
                });
              } else if (!activeSession.profile) {
                startProfileWizard();
              } else {
                setModeSelectorOpen(true);
              }
            }}
            onSelectMode={startSearch}
            onSendMessage={sendMessage}
            onAskVacancy={askVacancy}
            onEditProfile={startProfileWizard}
            onOpenSettings={() => setSettingsOpen(true)}
            onToggleSidebar={() => setSidebarOpen(true)}
          />
        )}
      </main>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        value={backend}
        onSave={(cfg) => {
          setBackend(cfg);
          localStorage.setItem(BACKEND_KEY, JSON.stringify(cfg));
          toast({
            title: 'ИИ-сервер сохранён',
            description: `Теперь агент работает через: ${backendLabel(cfg)}`,
          });
        }}
      />
    </div>
  );
}
