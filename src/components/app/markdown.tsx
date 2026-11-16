'use client';

import ReactMarkdown from 'react-markdown';
import { stripDecorativeEmojis } from '@/lib/emoji';

export function Markdown({ text }: { text: string }) {
  // Очистка от декоративных эмодзи — в том числе в старых сообщениях из БД
  const clean = stripDecorativeEmojis(text);
  return (
    <div className="text-[15px] leading-relaxed">
      <ReactMarkdown
        components={{
          p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
          h1: ({ children }) => (
            <h1 className="mb-2 mt-3 text-lg font-bold first:mt-0">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-2 mt-3 text-base font-bold first:mt-0">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-2 mt-3 text-[15px] font-semibold first:mt-0">{children}</h3>
          ),
          ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
          ol: ({ children }) => (
            <ol className="mb-3 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-red-600 underline decoration-red-300 underline-offset-2 hover:decoration-red-600 dark:text-red-400"
            >
              {children}
            </a>
          ),
          code: ({ children }) => (
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px]">{children}</code>
          ),
          blockquote: ({ children }) => (
            <blockquote className="mb-3 border-l-2 border-red-300 pl-3 text-muted-foreground last:mb-0">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-3 border-border" />,
        }}
      >
        {clean}
      </ReactMarkdown>
    </div>
  );
}
