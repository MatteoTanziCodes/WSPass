"use client";

import { useEffect, useState } from "react";

function tailText(text: string, maxLines = 80) {
  return text.split(/\r?\n/).slice(-maxLines).join("\n").trim();
}

export function AgentLogTail(props: {
  runId: string;
  logName: string;
  initialTail: string;
  live: boolean;
}) {
  const { runId, logName, initialTail, live } = props;
  const [tail, setTail] = useState(initialTail);
  const [status, setStatus] = useState<"idle" | "polling" | "waiting" | "error">(
    live ? "polling" : "idle"
  );

  useEffect(() => {
    setTail(initialTail);
    setStatus(live ? "polling" : "idle");
  }, [initialTail, live, logName, runId]);

  useEffect(() => {
    if (!live) {
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(
          `/api/runs/${encodeURIComponent(runId)}/logs/${encodeURIComponent(logName)}`,
          {
            cache: "no-store",
          }
        );

        if (cancelled) {
          return;
        }

        if (response.status === 404) {
          setStatus("waiting");
          return;
        }

        if (!response.ok) {
          setStatus("error");
          return;
        }

        const text = await response.text();
        if (cancelled) {
          return;
        }

        setTail(tailText(text) || "No log output available yet.");
        setStatus("polling");
      } catch {
        if (!cancelled) {
          setStatus("error");
        }
      }
    };

    void load();
    const interval = window.setInterval(() => {
      void load();
    }, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [live, logName, runId]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--muted)]">
          {live
            ? status === "waiting"
              ? "Waiting for log output..."
              : status === "error"
                ? "Live tail unavailable"
                : "Live tail active"
            : "Static log tail"}
        </span>
        {live ? (
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--accent)]">
            Refreshing every 2.5s
          </span>
        ) : null}
      </div>
      <pre className="max-h-[540px] overflow-auto border border-[color:var(--line)] bg-[color:var(--panel-soft)] p-4 font-mono text-xs leading-6 text-[color:var(--ink-strong)]">
        {tail || (status === "waiting" ? "Waiting for log output..." : "No log output available.")}
      </pre>
    </div>
  );
}
