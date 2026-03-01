"use client";

import { startTransition, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const ACTIVE_STATUSES = new Set(["queued", "dispatched", "running"]);

export function LiveRefreshShell(props: {
  executionStatus?: string;
  workflowName?: string;
  children: React.ReactNode;
}) {
  const { executionStatus, workflowName, children } = props;
  const router = useRouter();
  const [pulse, setPulse] = useState(false);
  const shouldPoll = executionStatus ? ACTIVE_STATUSES.has(executionStatus) : false;

  useEffect(() => {
    if (!shouldPoll) {
      setPulse(false);
      return;
    }

    setPulse(true);
    const interval = window.setInterval(() => {
      startTransition(() => {
        router.refresh();
      });
    }, 2500);

    return () => {
      window.clearInterval(interval);
      setPulse(false);
    };
  }, [router, shouldPoll]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-[22px] border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-4 py-3 text-sm text-[color:var(--muted)]">
        <div className="flex items-center gap-3">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              pulse ? "animate-pulse bg-[color:var(--accent)]" : "bg-[color:var(--line-strong)]"
            }`}
          />
          <span>
            {shouldPoll
              ? `Live refresh enabled while ${workflowName ?? "workflow"} is ${executionStatus}.`
              : "Dashboard is showing the latest persisted state."}
          </span>
        </div>
      </div>
      {children}
    </div>
  );
}
