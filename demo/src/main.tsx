import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AgentProvider } from "../../src/index.js";
import "./app.css";

const AUTH = { authorization: "Bearer demo-token" };
const THEME_KEY = "demo:theme";
type Theme = "light" | "dark";
type Invoice = { id: string; customer: string; amount: number };

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* private mode */
  }
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function useTheme() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* private mode */
    }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === "dark" ? "light" : "dark"))] as const;
}

function App() {
  const [theme, toggleTheme] = useTheme();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const load = useCallback(
    () =>
      fetch("/api/invoices", { headers: AUTH })
        .then((r) => r.json())
        .then(setInvoices),
    [],
  );
  useEffect(() => void load(), [load]);

  return (
    <AgentProvider
      endpoint="/agent"
      mode="sidebar"
      defaultOpen
      theme={theme}
      title="Invoice assistant"
      headers={AUTH}
      context={() => ({ page: "invoices", visibleCount: invoices.length })}
      hooks={{ onInvalidate: (tag) => tag === "invoices" && load() }}
    >
      <main className="page">
        <header className="page-head">
          <h1>Invoices</h1>
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            title="Toggle dark mode"
          >
            {theme === "dark" ? "☀ Light" : "☾ Dark"}
          </button>
        </header>
        <p>Try: “list my invoices” or “create an invoice”. The list below refreshes through a UI hook.</p>
        <ul>
          {invoices.map((i) => (
            <li key={i.id}>
              #{i.id} {i.customer}: ${i.amount}
            </li>
          ))}
        </ul>
      </main>
    </AgentProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
