"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DarkModeToggle } from "./DarkModeToggle";

function navItemClass(active: boolean, disabled = false) {
  return [
    "flex h-11 min-w-[104px] items-center justify-center border px-4 font-mono text-[11px] uppercase tracking-[0.12em] transition sm:min-w-[128px]",
    disabled
      ? "cursor-not-allowed border-[color:var(--line)] bg-transparent text-[color:var(--muted)] opacity-45"
      : active
        ? "border-[color:var(--accent)] bg-[color:var(--panel-strong)] text-[color:var(--ink-strong)]"
        : "border-[color:var(--line)] bg-transparent text-[color:var(--muted)] hover:border-[color:var(--line-strong)] hover:text-[color:var(--ink)]",
  ].join(" ");
}

export function AppShell(props: { children: React.ReactNode }) {
  const { children } = props;
  const pathname = usePathname();
  const homeActive = pathname === "/projects" || pathname === "/" || pathname === "/projects/new";
  const maintenanceActive =
    pathname === "/maintenance" || pathname.startsWith("/projects/") && pathname.endsWith("/maintenance");
  const adminActive = pathname === "/admin";

  return (
    <>
      <div className="sticky top-0 z-50 border-b border-[color:var(--line)] bg-[color:var(--panel)] backdrop-blur">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-end gap-2 px-4 py-3 lg:px-8">
          <Link href="/projects" className={navItemClass(homeActive)}>
            Home
          </Link>
          <Link href="/maintenance" className={navItemClass(maintenanceActive)}>
            Maintenance
          </Link>
          <Link href="/admin" className={navItemClass(adminActive)}>
            Admin
          </Link>
          <DarkModeToggle />
        </div>
      </div>

      {children}
    </>
  );
}
