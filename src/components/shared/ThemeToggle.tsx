import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useI18n } from "@/i18n";

type Theme = "dark" | "light";

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("light", theme === "light");
  document.documentElement.classList.toggle("dark", theme === "dark");
}

function smoothToggle(theme: Theme) {
  document.documentElement.classList.add("theme-switching");
  applyTheme(theme);
  // Remove the class after transitions finish
  const t = setTimeout(() => {
    document.documentElement.classList.remove("theme-switching");
  }, 250);
  return t;
}

function getInitialTheme(): Theme {
  // 1. Respect stored preference
  const stored = localStorage.getItem("rackpad-theme") as Theme | null;
  if (stored === "light" || stored === "dark") return stored;
  // 2. Fall back to OS preference
  if (window.matchMedia("(prefers-color-scheme: light)").matches)
    return "light";
  // 3. Default: dark (homelab default)
  return "dark";
}

export function ThemeToggle() {
  const { t } = useI18n();
  const [theme, setTheme] = useState<Theme>("dark");

  // Apply stored/OS preference on mount (no flash)
  useEffect(() => {
    const initial = getInitialTheme();
    setTheme(initial);
    applyTheme(initial);
  }, []);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("rackpad-theme", next);
    smoothToggle(next);
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={t(
        theme === "dark" ? "Switch to light mode" : "Switch to dark mode",
      )}
    >
      {theme === "dark" ? <Sun /> : <Moon />}
    </Button>
  );
}
