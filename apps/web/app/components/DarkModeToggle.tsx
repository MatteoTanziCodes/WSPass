"use client";
import { useEffect, useState } from "react";

export function DarkModeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("wspass-dark");
    if (saved === "1") {
      document.documentElement.classList.add("dark");
      setDark(true);
    }
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
      className="rounded-full border border-[color:var(--line)] px-3 py-1 text-xs font-semibold text-[color:var(--muted)] transition hover:border-[color:var(--accent)] hover:text-[color:var(--accent-ink)]"
    >
      {dark ? "☀ Light" : "◐ Dark"}
    </button>
  );
}