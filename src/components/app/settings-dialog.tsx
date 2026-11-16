'use client';

import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  Cloud,
  Cpu,
  ExternalLink,
  HardDrive,
  Loader2,
  RefreshCw,
  Server,
  XCircle,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PROVIDER_META } from '@/lib/types';
import type { BackendConfig, BackendProvider } from '@/lib/types';

interface Preset {
  id: BackendProvider;
  title: string;
  desc: string;
  icon: typeof Cloud;
}

const GROUPS: { title: string; hint: string; presets: Preset[] }[] = [
  {
    title: 'Локально — на твоём ПК',
    hint: 'Приватно и бесплатно: мозги агента работают прямо на твоём компьютере',
    presets: [
      {
        id: 'ollama',
        title: 'Ollama',
        desc: 'Самый простой способ: ollama run qwen2.5:7b — и готово',
        icon: HardDrive,
      },
      {
        id: 'lmstudio',
        title: 'LM Studio',
        desc: 'Графическая программа: скачиваешь модель и включаешь локальный сервер',
        icon: HardDrive,
      },
    ],
  },
  {
    title: 'Облако — быстро и качественно',
    hint: 'Мощное железо через API: сильные модели, скорость, бесплатный тариф у Groq',
    presets: [
      {
        id: 'groq',
        title: 'GroqCloud',
        desc: 'Очень быстрый API, есть бесплатные модели (llama-3.3-70b и др.)',
        icon: Zap,
      },
      {
        id: 'openrouter',
        title: 'OpenRouter',
        desc: 'Сотни моделей через один ключ, включая бесплатные',
        icon: Cloud,
      },
      {
        id: 'custom',
        title: 'Свой сервер / любой OpenAI-совместимый API',
        desc: 'vLLM, llama.cpp, Together, DeepSeek, OpenAI…',
        icon: Cpu,
      },
    ],
  },
];

const BUILTIN_PRESET: Preset = {
  id: 'builtin',
  title: 'Встроенный ИИ',
  desc: 'Облачная модель, настроенная на этом компьютере (.z-ai-config или LLM_* в .env)',
  icon: Server,
};

function SettingsDialogInner({
  open,
  onOpenChange,
  value,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  value: BackendConfig;
  onSave: (cfg: BackendConfig) => void;
}) {
  const [cfg, setCfg] = useState<BackendConfig>(value);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsNote, setModelsNote] = useState('');
  const [status, setStatus] = useState<{ builtin: 'zai' | 'env' | 'none'; search: 'searxng' | 'brave' | 'zai' | 'none' } | null>(null);

  // Состояние формы сбрасывается ремаунтом (см. SettingsDialog ниже), поэтому тут только загрузка статуса.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch('/api/agent/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => !cancelled && setStatus(j))
      .catch(() => !cancelled && setStatus(null));
    return () => {
      cancelled = true;
    };
  }, [open]);

  const meta = cfg.provider !== 'builtin' ? PROVIDER_META[cfg.provider] : null;
  const isExternal = cfg.provider !== 'builtin';
  const needsKey = cfg.provider === 'groq' || cfg.provider === 'openrouter' || (cfg.provider === 'custom' && !!cfg.customKey);

  const pickProvider = (id: BackendProvider) => {
    const m = PROVIDER_META[id];
    setTestResult(null);
    setModels([]);
    setModelsNote('');
    setCfg((c) => ({
      ...c,
      provider: id,
      // подставляем дефолтный адрес/модель провайдера, если поле пустое или было от другого провайдера
      customUrl: c.customUrl && c.customUrl !== PROVIDER_META[c.provider]?.url ? c.customUrl : m.url || '',
      customModel: c.customModel && PROVIDER_META[c.provider]?.model ? c.customModel : m.model || '',
    }));
  };

  const loadModels = async () => {
    setLoadingModels(true);
    setModelsNote('');
    try {
      const res = await fetch('/api/agent/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: cfg.customUrl, key: cfg.customKey }),
      });
      const json = await res.json();
      if (json.ok) {
        setModels(json.models || []);
        if (!cfg.customModel && json.models?.length) {
          setCfg((c) => ({ ...c, customModel: json.models[0] }));
        }
        setModelsNote(json.message || '');
      } else {
        setModels([]);
        setModelsNote(json.message || 'Не удалось загрузить модели');
      }
    } catch {
      setModelsNote('Не удалось загрузить список моделей.');
    } finally {
      setLoadingModels(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/agent/test-backend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: cfg.customUrl, key: cfg.customKey, model: cfg.customModel }),
      });
      const json = await res.json();
      setTestResult({ ok: !!json.ok, message: json.message || '' });
    } catch {
      setTestResult({ ok: false, message: 'Не удалось выполнить проверку.' });
    } finally {
      setTesting(false);
    }
  };

  const save = () => {
    onSave({
      ...cfg,
      customUrl: isExternal ? cfg.customUrl?.trim() || undefined : undefined,
      customKey: isExternal ? cfg.customKey?.trim() || undefined : undefined,
      customModel: isExternal ? cfg.customModel?.trim() || undefined : undefined,
    });
    onOpenChange(false);
  };

  const presetCard = (preset: Preset, active: boolean) => {
    const Icon = preset.icon;
    return (
      <button
        key={preset.id}
        onClick={() => pickProvider(preset.id)}
        className={`flex w-full items-start gap-3 rounded-xl border p-3.5 text-left transition-colors ${
          active
            ? 'border-red-500 bg-red-50/60 dark:border-red-700 dark:bg-red-950/30'
            : 'border-border hover:bg-muted/50'
        }`}
      >
        <div
          className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
            active
              ? 'bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-300'
              : 'bg-muted text-muted-foreground'
          }`}
        >
          <Icon className="h-4.5 w-4.5" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold">{preset.title}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">{preset.desc}</div>
        </div>
        <div
          className={`ml-auto mt-1 h-4 w-4 shrink-0 rounded-full border-2 ${
            active ? 'border-red-600 bg-red-600' : 'border-muted-foreground/40'
          }`}
        />
      </button>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>ИИ-сервер агента</DialogTitle>
          <DialogDescription>
            Выбери, где работают «мозги» агента: локальная модель на твоём ПК или быстрый облачный
            API (GroqCloud, OpenRouter…). Если выбранный сервер недоступен до начала ответа и на
            этом компьютере настроен встроенный ИИ — агент переключится на него.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 rounded-xl border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">Что уходит наружу.</span> Анкета, текст
            твоих документов (Lebenslauf), сообщения чата и поисковые запросы отправляются тому
            ИИ-сервису и поисковому провайдеру, который ты выбрал. Это персональные данные: для
            облачных вариантов (встроенный ИИ, Groq, OpenRouter) они покидают твой компьютер. Чтобы
            данные остались у тебя, выбери локальную модель (Ollama или LM Studio) — тогда наружу
            уходят только поисковые запросы.
          </p>
          {status && status.builtin === 'none' && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-amber-700 dark:text-amber-300">
              Встроенный ИИ на этом компьютере не настроен. Выбери ниже Ollama, LM Studio или облако
              либо задай LLM_BASE_URL и LLM_API_KEY в файле .env.
            </p>
          )}
          {status && status.search === 'none' && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-amber-700 dark:text-amber-300">
              Веб-поиск вакансий не настроен: задай SEARXNG_URL или BRAVE_API_KEY в файле .env
              (инструкция в README). Без этого поиск вакансий вернёт пустой результат.
            </p>
          )}
          {status && status.search !== 'none' && (
            <p>
              Поиск вакансий:{' '}
              {{ searxng: 'SearXNG', brave: 'Brave Search API', zai: 'встроенный сервис' }[status.search]}.
            </p>
          )}
        </div>

        {presetCard(BUILTIN_PRESET, cfg.provider === 'builtin')}

        {GROUPS.map((group) => (
          <div key={group.title} className="grid gap-2.5">
            <div className="mt-1 flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.title}
              </span>
              <span className="h-px flex-1 bg-border" />
            </div>
            <p className="-mt-1.5 text-xs text-muted-foreground">{group.hint}</p>
            {group.presets.map((preset) => presetCard(preset, cfg.provider === preset.id))}
          </div>
        ))}

        {isExternal && meta && (
          <div className="grid gap-4 rounded-xl border border-border bg-muted/30 p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
              Настройки: {meta.label}
            </div>

            {cfg.provider === 'ollama' && (
              <p className="text-xs text-muted-foreground">
                Стандартный адрес:{' '}
                <code className="rounded bg-muted px-1 py-0.5 font-mono">http://localhost:11434/v1</code>
                . Модель запусти командой{' '}
                <code className="rounded bg-muted px-1 py-0.5 font-mono">ollama run qwen2.5:7b</code>.
              </p>
            )}
            {cfg.provider === 'lmstudio' && (
              <p className="text-xs text-muted-foreground">
                В LM Studio: Developer → Start Server (порт 1234). Адрес:{' '}
                <code className="rounded bg-muted px-1 py-0.5 font-mono">http://localhost:1234/v1</code>.
              </p>
            )}
            {cfg.provider === 'groq' && (
              <p className="text-xs text-muted-foreground">
                Бесплатный API-ключ:{' '}
                <a
                  href="https://console.groq.com/keys"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-red-600 hover:underline dark:text-red-400"
                >
                  console.groq.com/keys <ExternalLink className="h-3 w-3" />
                </a>{' '}
                — регистрация за минуту, тариф бесплатный.
              </p>
            )}
            {cfg.provider === 'openrouter' && (
              <p className="text-xs text-muted-foreground">
                Ключ:{' '}
                <a
                  href="https://openrouter.ai/settings/keys"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-red-600 hover:underline dark:text-red-400"
                >
                  openrouter.ai/settings/keys <ExternalLink className="h-3 w-3" />
                </a>
                . Есть модели с пометкой :free.
              </p>
            )}

            <div className="grid gap-2">
              <Label htmlFor="sd-url">Адрес сервера (Base URL)</Label>
              <Input
                id="sd-url"
                placeholder={meta.url || 'https://api.example.com/v1'}
                value={cfg.customUrl || ''}
                onChange={(e) => setCfg((c) => ({ ...c, customUrl: e.target.value }))}
              />
            </div>

            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="sd-model">Модель</Label>
                <button
                  onClick={loadModels}
                  disabled={loadingModels || !cfg.customUrl}
                  className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
                >
                  {loadingModels ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  Загрузить список моделей
                </button>
              </div>
              {models.length > 0 ? (
                <Select
                  value={cfg.customModel || '__none__'}
                  onValueChange={(v) => setCfg((c) => ({ ...c, customModel: v === '__none__' ? '' : v }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Выбери модель" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {models.map((m) => (
                      <SelectItem key={m} value={m} className="font-mono text-xs">
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id="sd-model"
                  placeholder={meta.model || 'имя модели'}
                  value={cfg.customModel || ''}
                  onChange={(e) => setCfg((c) => ({ ...c, customModel: e.target.value }))}
                />
              )}
              {modelsNote && <p className="text-xs text-muted-foreground">{modelsNote}</p>}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="sd-key">API-ключ {needsKey ? '' : '(если требуется)'}</Label>
              <Input
                id="sd-key"
                type="password"
                placeholder={cfg.provider === 'groq' ? 'gsk_…' : 'sk-…'}
                value={cfg.customKey || ''}
                onChange={(e) => setCfg((c) => ({ ...c, customKey: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                Ключ хранится только локально в твоём браузере и никуда не отправляется, кроме
                выбранного тобой сервера.
              </p>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="w-fit gap-2"
              onClick={test}
              disabled={testing || !cfg.customUrl}
            >
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Проверить соединение
            </Button>
            {testResult && (
              <div
                className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs leading-relaxed ${
                  testResult.ok
                    ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                    : 'bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300'
                }`}
              >
                {testResult.ok ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                )}
                {testResult.message}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={save}>Сохранить</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Каждое открытие диалога — новый экземпляр: форма стартует с сохранённых настроек без setState в эффекте. */
export function SettingsDialog(props: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  value: BackendConfig;
  onSave: (cfg: BackendConfig) => void;
}) {
  return <SettingsDialogInner key={props.open ? 'open' : 'closed'} {...props} />;
}
