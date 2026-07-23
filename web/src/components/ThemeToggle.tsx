import { useEffect, useState } from "react";

type Theme = "light" | "dark";

function getInitialTheme(): Theme {
  const stored = localStorage.getItem("qa_dashboard_theme");
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("qa_dashboard_theme", theme);
  }, [theme]);

  const isDark = theme === "dark";

  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      <svg className="theme-icon theme-icon-moon" viewBox="0 0 24 24" aria-hidden="true" hidden={isDark}>
        <path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9Z" />
      </svg>
      <svg className="theme-icon theme-icon-sun" viewBox="0 0 24 24" aria-hidden="true" hidden={!isDark}>
        <path d="M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Zm0 4a1 1 0 0 1-1-1v-1.1a1 1 0 1 1 2 0V21a1 1 0 0 1-1 1Zm0-18a1 1 0 0 1-1-1V1a1 1 0 1 1 2 0v1.1a1 1 0 0 1-1 1Zm10 9a1 1 0 0 1-1 1h-1.1a1 1 0 1 1 0-2H21a1 1 0 0 1 1 1ZM4.1 12a1 1 0 0 1-1 1H2a1 1 0 1 1 0-2h1.1a1 1 0 0 1 1 1Zm14.7 6.7a1 1 0 0 1 0 1.4l-.8.8a1 1 0 1 1-1.4-1.4l.8-.8a1 1 0 0 1 1.4 0ZM6.5 6.5a1 1 0 0 1 0 1.4l-.8.8A1 1 0 1 1 4.3 7.3l.8-.8a1 1 0 0 1 1.4 0Zm12 0 .8.8a1 1 0 0 1-1.4 1.4l-.8-.8a1 1 0 0 1 1.4-1.4ZM6.5 17.5l-.8.8a1 1 0 0 1-1.4-1.4l.8-.8a1 1 0 0 1 1.4 1.4Z" />
      </svg>
    </button>
  );
}
