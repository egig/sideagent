// UI language (D-26): English and Indonesian. The dashboard takes the stored choice ("locale" in localStorage),
// else the browser's languages. Messages live in en.ts and id.ts;
// id.ts is typed against en.ts, so a missing or misshaped message is a type error.
import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { en, type Messages } from "./en";
import { id } from "./id";

export const LOCALES = ["en", "id"] as const;
export type Locale = (typeof LOCALES)[number];

/** Each language in its own words, for the switchers. */
export const LOCALE_NAME: Record<Locale, string> = { en: "English", id: "Bahasa Indonesia" };

const MESSAGES: Record<Locale, Messages> = { en, id };
export const messages = (locale: Locale) => MESSAGES[locale];

const isLocale = (v: unknown): v is Locale => LOCALES.includes(v as Locale);

// --- Stored choice (dashboard) ---

const KEY = "locale";
const listeners = new Set<() => void>();
// Used when localStorage is blocked: the choice lasts until the page reloads.
let memory: Locale | null = null;

function stored(): Locale | null {
  try {
    const v = localStorage.getItem(KEY);
    return isLocale(v) ? v : null;
  } catch {
    return null;
  }
}

function fromBrowser(): Locale {
  const langs = typeof navigator === "undefined" ? [] : (navigator.languages ?? [navigator.language]);
  for (const l of langs) {
    const base = l.toLowerCase().split("-")[0];
    // "in" is the old ISO code for Indonesian; some browsers still report it.
    if (base === "id" || base === "in") return "id";
    if (base === "en") return "en";
  }
  return "en";
}

export function storeLocale(locale: Locale) {
  try {
    localStorage.setItem(KEY, locale);
  } catch {
    memory = locale;
  }
  listeners.forEach((fn) => fn());
}

/** The dashboard language: stored choice, else the browser's. "en" on the server. */
export function usePreferredLocale(): Locale {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => stored() ?? memory ?? fromBrowser(),
    () => "en",
  );
}

// --- Context ---

const LocaleContext = createContext<Locale>("en");

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export const useLocale = () => useContext(LocaleContext);
export const useT = () => MESSAGES[useContext(LocaleContext)];

/** Date and time in the UI language. */
export function formatDate(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}

/** A number in the UI language (1,000 in English, 1.000 in Indonesian). */
export const formatNumber = (n: number, locale: Locale) => n.toLocaleString(locale);

export type { Messages };
