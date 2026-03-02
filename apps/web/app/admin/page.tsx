import Link from "next/link";
import { readServerEnv } from "../lib/env";
import { IntegrationPanel } from "./IntegrationPanel"
import { BrandAssetsPanel } from "./BrandAssetsPanel";

async function getIntegrations() {
  try {
    const base = readServerEnv("PASS_API_BASE_URL").replace(/\/+$/, "");
    const res = await fetch(`${base}/admin/integrations`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    return data.connections ?? [];
  } catch {
    return [];
  }
}

async function getBrandAssets() {
  try {
    const base = readServerEnv("PASS_API_BASE_URL").replace(/\/+$/, "");
    const res = await fetch(`${base}/admin/brand-assets`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    return data.assets ?? [];
  } catch {
    return [];
  }
}

export default async function AdminPage() {
  const [integrations, brandAssets] = await Promise.all([
    getIntegrations(),
    getBrandAssets(),
  ]);

  return (
    <div className="min-h-screen bg-[color:var(--bg)] text-[color:var(--ink)]">
      <header className="border-b border-[color:var(--line)] bg-[color:var(--panel)]">
        <div className="mx-auto max-w-[1800px] px-4 py-4 lg:px-8">
          <div className="font-mono text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">
            <span className="text-[color:var(--accent)]">WSPass // admin</span> // integrations + brand assets
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1800px] px-4 py-8 lg:px-8 space-y-10">
        <div className="grid gap-8 xl:grid-cols-[360px_minmax(0,1fr)]">
          <section className="border border-[color:var(--line)] bg-[color:var(--panel)] p-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--accent)]">
              Admin
            </p>
            <h1 className="mt-6 text-4xl font-semibold tracking-[-0.05em] text-[color:var(--ink-strong)]">
              Global settings
            </h1>
            <p className="mt-4 font-mono text-sm leading-7 text-[color:var(--muted)]">
              Connect your integrations and upload brand assets that agents can reference in generated outputs.
            </p>
            <Link
              href="/projects"
              className="mt-8 inline-flex border border-[color:var(--line-strong)] px-4 py-3 font-mono text-xs uppercase tracking-[0.18em] text-[color:var(--ink-strong)] transition hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
            >
              Back to projects
            </Link>
          </section>

          <IntegrationPanel integrations={integrations} />
        </div>

        <BrandAssetsPanel assets={brandAssets} />
      </main>
    </div>
  );
}