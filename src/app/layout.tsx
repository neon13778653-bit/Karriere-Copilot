import type { Metadata, Viewport } from "next";
import { ThemeProvider } from "next-themes";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "Karriere Copilot — ИИ-агент для поиска работы и Ausbildung в Германии",
  description:
    "ИИ-агент ищет вакансии и учебные места по немецким порталам и сайтам компаний, сравнивает их с твоим профилем и ранжирует: лучшие сверху. Работает на встроенном ИИ, локальной модели (Ollama) или своём сервере.",
  keywords: [
    "работа в Германии",
    "Ausbildung",
    "вакансии",
    "ИИ-агент",
    "поиск работы",
    "Chancenkarte",
  ],
  icons: {
    icon: "/logo.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#dc2626",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body
        className="antialiased bg-background text-foreground"
      >
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
