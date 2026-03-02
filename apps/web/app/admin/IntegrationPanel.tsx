"use client";

import { useState } from "react";
import { connectIntegration, disconnectIntegration, revalidateIntegration } from "./actions";

type Connection = {
  provider: string;
  status: "connected" | "disconnected" | "invalid";
  display_name?: string;
  token_hint?: string;
  validated_at?: string;
  validation_error?: string;
};

const PROVIDER_LABELS: Record<string, string> = {
  github: "GitHub",
  anthropic: "Anthropic",
  vercel: "Vercel",
  stripe: "Stripe",
};

const PROVIDER_HINTS: Record<string, string> = {
  github: "Personal access token with repo + workflow scopes",
  anthropic: "sk-ant-... API key",
  vercel: "Vercel personal access token",
  stripe: "Secret key (sk_live_... or sk_test_...)",
};

function StatusDot({ status }: { status: Connection["status"] }) {
  const color =
    status === "connected"
      ? "bg-green-500"
      : status === "invalid"
        ? "bg-red-500"
        : "bg-[color:var(--muted)]";
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

function IntegrationCard({ connection, onUpdate }: { connection: Connection; onUpdate: (c: Connection) => void }) {
  const [tokenInput, setTokenInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConnect() {
    if (!tokenInput.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await connectIntegration(connection.provider, tokenInput.trim());
      setTokenInput("");
      onUpdate(result.connection);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDisconnect() {
    setLoading(true);
    setError(null);
    try {
      await disconnectIntegration(connection.provider);
      onUpdate({ ...connection, status: "disconnected", display_name: undefined, token_hint: undefined });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleRevalidate() {
    setLoading(true);
    setError(null);
    try {
      const result = await revalidateIntegration(connection.provider);
      onUpdate(result.connection);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="border border-[color:var(--line)] bg-[color:var(--panel)] p-6">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--accent)]">
          {PROVIDER_LABELS[connection.provider] ?? connection.provider}
        </p>
        <StatusDot status={connection.status} />
      </div>

      {connection.status === "connected" && connection.display_name && (
        <p className="mt-3 font-mono text-xs text-[color:var(--ink)]">
          Connected as <span className="text-[color:var(--ink-strong)]">{connection.display_name}</span>
          {connection.token_hint && (
            <span className="ml-2 text-[color:var(--muted)]">({connection.token_hint})</span>
          )}
        </p>
      )}

      {connection.status === "invalid" && connection.validation_error && (
        <p className="mt-3 font-mono text-xs text-red-500">{connection.validation_error}</p>
      )}

      {connection.status !== "connected" && (
        <div className="mt-4 space-y-2">
          <p className="font-mono text-[10px] text-[color:var(--muted)]">{PROVIDER_HINTS[connection.provider]}</p>
          <input
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="Paste token..."
            className="w-full border border-[color:var(--line)] bg-[color:var(--bg)] px-3 py-2 font-mono text-xs text-[color:var(--ink)] placeholder:text-[color:var(--muted)] focus:border-[color:var(--accent)] focus:outline-none"
          />
        </div>
      )}

      {error && <p className="mt-2 font-mono text-[10px] text-red-500">{error}</p>}

      <div className="mt-4 flex gap-2">
        {connection.status !== "connected" ? (
          <button
            type="button"
            onClick={handleConnect}
            disabled={loading || !tokenInput.trim()}
            className="flex-1 border border-[color:var(--line-strong)] px-4 py-2 font-mono text-xs uppercase tracking-[0.18em] text-[color:var(--ink-strong)] transition hover:border-[color:var(--accent)] hover:text-[color:var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? "Connecting…" : "Connect"}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={handleRevalidate}
              disabled={loading}
              className="flex-1 border border-[color:var(--line)] px-3 py-2 font-mono text-xs uppercase tracking-[0.18em] text-[color:var(--muted)] transition hover:border-[color:var(--line-strong)] hover:text-[color:var(--ink)] disabled:opacity-40"
            >
              {loading ? "…" : "Revalidate"}
            </button>
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={loading}
              className="border border-[color:var(--line)] px-3 py-2 font-mono text-xs uppercase tracking-[0.18em] text-[color:var(--muted)] transition hover:border-red-500 hover:text-red-500 disabled:opacity-40"
            >
              Disconnect
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function IntegrationPanel({ integrations }: { integrations: Connection[] }) {
  const [connections, setConnections] = useState<Connection[]>(integrations);

  function handleUpdate(updated: Connection) {
    setConnections((prev) =>
      prev.map((c) => (c.provider === updated.provider ? updated : c))
    );
  }

  return (
    <section>
      <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
        Integrations
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        {connections.map((c) => (
          <IntegrationCard key={c.provider} connection={c} onUpdate={handleUpdate} />
        ))}
      </div>
    </section>
  );
}