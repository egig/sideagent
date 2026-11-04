// Dark mode: the .dark class on <html> swaps the color tokens in index.css. The choice lives in
// localStorage ("theme": "light" | "dark"); no entry means "system", and the OS setting decides.
// An explicit light choice also puts .light on <html>, so the sideagent widget (theme="auto") stays light
// when the OS is dark. The system choice follows OS changes live.
import { useEffect, useState } from "react";

export type Theme = "system" | "light" | "dark";
export const THEMES: Theme[] = ["system", "light", "dark"];

function readTheme(): Theme {
  try {
    const t = localStorage.getItem("theme");
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

function applyTheme(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.classList.toggle("light", theme === "light");
}

export function useTheme(): [Theme, (next: Theme) => void] {
  // The server cannot know the theme; start at "system" until hydrated.
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => setTheme(readTheme()), []);
  useEffect(() => {
    if (theme !== "system") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const sync = () => applyTheme("system");
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [theme]);
  const choose = (next: Theme) => {
    applyTheme(next);
    try {
      if (next === "system") localStorage.removeItem("theme");
      else localStorage.setItem("theme", next);
    } catch {}
    setTheme(next);
  };
  return [theme, choose];
}
