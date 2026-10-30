import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AgentProvider } from "../../src/index.js";
import "./app.css";

const THEME_KEY = "demo:theme";
type Theme = "light" | "dark";

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
  return (
    <AgentProvider
      endpoint="/agent"
      mode="sidebar"
      defaultOpen
      theme={theme}
      title="Docs assistant"
      context={() => ({ page: "invoicing guide" })}
    >
      <main className="page">
        <header className="page-head">
          <h1>Invoicing guide</h1>
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            title="Toggle dark mode"
          >
            {theme === "dark" ? "☀ Light" : "☾ Dark"}
          </button>
        </header>
        <p>Try: “what is your refund policy?” or “how long do I have to dispute an invoice?”</p>
      </main>
    </AgentProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
