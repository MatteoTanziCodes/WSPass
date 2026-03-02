"use client";
import { useEffect, useState } from "react";

export function DarkModeToggle() {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem("wspass-dark");
    const nextDark = saved !== "0";
    document.documentElement.classList.toggle("dark", nextDark);
    setDark(nextDark);
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("wspass-dark", next ? "1" : "0");
  }

  return (
    <button
      onClick={toggle}
      className="border border-[color:var(--line-strong)] bg-[color:var(--panel-soft)] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)] transition hover:border-[color:var(--accent)] hover:text-[color:var(--accent-ink)]"
    >
      {dark ? "Light Mode" : "Dark Mode"}
    </button>
  );
}
