"use client";

import Link from "next/link";
import { useState } from "react";
import { deleteProjectAction, dispatchWorkflowAction } from "../actions";
import { StatusBadge } from "./StatusBadge";

type MaintenanceBucket = "green" | "yellow" | "red";

type MaintenanceProjectItem = {
  key: string;
  label: string;
  latestRunId: string;
  latestUpdatedAt: string;
  runsCount: number;
  latestStatusLabel: string;
  latestStatusTone: "default" | "accent" | "danger" | "success";
  bucket: MaintenanceBucket;
  bucketLabel: string;
  rerunWorkflowName: string | null;
  rerunnable: boolean;
  runIds: string[];
};

function polarToCartesian(cx: number, cy: number, radius: number, angleDegrees: number) {
  const angleRadians = ((angleDegrees - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(angleRadians),
    y: cy + radius * Math.sin(angleRadians),
  };
}

function describeArc(
  cx: number,
  cy: number,
  outerRadius: number,
  innerRadius: number,
  startAngle: number,
  endAngle: number
) {
  const startOuter = polarToCartesian(cx, cy, outerRadius, endAngle);
  const endOuter = polarToCartesian(cx, cy, outerRadius, startAngle);
  const startInner = polarToCartesian(cx, cy, innerRadius, endAngle);
  const endInner = polarToCartesian(cx, cy, innerRadius, startAngle);
  const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;

  return [
    `M ${startOuter.x} ${startOuter.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 0 ${endOuter.x} ${endOuter.y}`,
    `L ${endInner.x} ${endInner.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 1 ${startInner.x} ${startInner.y}`,
    "Z",
  ].join(" ");
}

function percentage(value: number, total: number) {
  if (total <= 0) {
    return "0%";
  }
  return `${Math.round((value / total) * 100)}%`;
}

function bucketMeta(bucket: MaintenanceBucket) {
  if (bucket === "green") {
    return {
      label: "Completed",
      color: "#35db95",
      background: "rgba(53, 219, 149, 0.12)",
      text: "#b7ffd7",
    };
  }

  if (bucket === "red") {
    return {
      label: "Blocked / Failed",
      color: "#ff7676",
      background: "rgba(255, 118, 118, 0.12)",
      text: "#ffc5c5",
    };
  }

  return {
    label: "Pending / In Progress",
    color: "#ffb347",
    background: "rgba(255, 179, 71, 0.12)",
    text: "#ffe3bb",
  };
}

function DonutChart(props: {
  counts: Record<MaintenanceBucket, number>;
  selected: MaintenanceBucket | "all";
  onSelect: (bucket: MaintenanceBucket | "all") => void;
}) {
  const { counts, selected, onSelect } = props;
  const total = counts.green + counts.yellow + counts.red;
  const entries: Array<{ bucket: MaintenanceBucket; value: number }> = [
    { bucket: "green", value: counts.green },
    { bucket: "yellow", value: counts.yellow },
    { bucket: "red", value: counts.red },
  ];

  let runningAngle = 0;
  const slices = entries.map((entry) => {
    const share = total > 0 ? (entry.value / total) * 360 : 0;
    const startAngle = runningAngle;
    const endAngle = runningAngle + share;
    runningAngle = endAngle;
    return {
      ...entry,
      startAngle,
      endAngle,
      meta: bucketMeta(entry.bucket),
    };
  });

  return (
    <div className="grid gap-6 xl:grid-cols-[260px_minmax(0,1fr)] xl:items-center">
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => onSelect("all")}
          className={`flex w-full items-center gap-3 border px-3 py-3 text-left transition ${
            selected === "all"
              ? "border-[color:var(--accent)] bg-[color:var(--panel-strong)]"
              : "border-[color:var(--line)] bg-[color:var(--panel)] hover:border-[color:var(--line-strong)]"
          }`}
        >
          <span className="h-4 w-4 border border-[color:var(--line-strong)] bg-[color:var(--panel-soft)]" />
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-strong)]">
              All projects
            </p>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--muted)]">
              {total} total
            </p>
          </div>
        </button>

        {slices.map((slice) => (
          <button
            key={slice.bucket}
            type="button"
            onClick={() => onSelect(selected === slice.bucket ? "all" : slice.bucket)}
            className={`flex w-full items-center gap-3 border px-3 py-3 text-left transition ${
              selected === slice.bucket
                ? "border-[color:var(--accent)] bg-[color:var(--panel-strong)]"
                : "border-[color:var(--line)] bg-[color:var(--panel)] hover:border-[color:var(--line-strong)]"
            }`}
          >
            <span
              className="h-4 w-4"
              style={{
                backgroundColor: slice.meta.color,
                boxShadow: `inset 0 0 0 1px ${slice.meta.color}`,
              }}
            />
            <div className="min-w-0">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-strong)]">
                {slice.meta.label}
              </p>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--muted)]">
                {slice.value} projects // {percentage(slice.value, total)}
              </p>
            </div>
          </button>
        ))}
      </div>

      <div className="flex justify-center xl:justify-end">
        <svg viewBox="0 0 260 260" className="h-[280px] w-[280px] overflow-visible">
          <circle cx="130" cy="130" r="95" fill="transparent" stroke="rgba(255,255,255,0.08)" strokeWidth="34" />
          {slices.map((slice) => {
            const midAngle = slice.startAngle + (slice.endAngle - slice.startAngle) / 2;
            const textPoint = polarToCartesian(130, 130, 78, midAngle);
            const active = selected === "all" || selected === slice.bucket;

            if (slice.value <= 0) {
              return null;
            }

            return (
              <g key={slice.bucket} onClick={() => onSelect(selected === slice.bucket ? "all" : slice.bucket)} className="cursor-pointer">
                <path
                  d={describeArc(130, 130, 112, 78, slice.startAngle, slice.endAngle)}
                  fill={slice.meta.color}
                  opacity={active ? 1 : 0.35}
                />
                <text
                  x={textPoint.x}
                  y={textPoint.y}
                  fill="white"
                  fontSize="14"
                  fontFamily="var(--font-ibm-plex-mono)"
                  textAnchor="middle"
                  dominantBaseline="middle"
                >
                  {percentage(slice.value, total)}
                </text>
              </g>
            );
          })}
          <circle cx="130" cy="130" r="58" fill="rgba(0,0,0,0.55)" />
          <text
            x="130"
            y="120"
            fill="white"
            fontSize="14"
            fontFamily="var(--font-ibm-plex-mono)"
            textAnchor="middle"
          >
            Projects
          </text>
          <text
            x="130"
            y="146"
            fill="white"
            fontSize="28"
            fontFamily="var(--font-space-grotesk)"
            fontWeight="700"
            textAnchor="middle"
          >
            {total}
          </text>
        </svg>
      </div>
    </div>
  );
}

export function MaintenanceProjectSelector(props: { projects: MaintenanceProjectItem[] }) {
  const { projects } = props;
  const [selectedBucket, setSelectedBucket] = useState<MaintenanceBucket | "all">("all");
  const [search, setSearch] = useState("");
  const [manualStatus, setManualStatus] = useState<MaintenanceBucket | "all">("all");

  const effectiveBucket =
    selectedBucket !== "all" ? selectedBucket : manualStatus !== "all" ? manualStatus : "all";

  const counts = {
    green: projects.filter((project) => project.bucket === "green").length,
    yellow: projects.filter((project) => project.bucket === "yellow").length,
    red: projects.filter((project) => project.bucket === "red").length,
  };

  const filteredProjects = projects.filter((project) => {
    const bucketMatches = effectiveBucket === "all" ? true : project.bucket === effectiveBucket;
    const searchMatches = project.label.toLowerCase().includes(search.trim().toLowerCase());
    return bucketMatches && searchMatches;
  });

  return (
    <div className="space-y-8">
      <section className="border border-[color:var(--line)] bg-[color:var(--panel)] p-6">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-[color:var(--accent)]">
          Project state breakdown
        </p>
        <p className="mt-4 max-w-[72ch] font-mono text-sm leading-7 text-[color:var(--muted)]">
          Click any chart segment to filter the project list by overall maintenance state. Green is completed,
          yellow is pending or in progress, and red is blocked or failed.
        </p>
        <div className="mt-6">
          <DonutChart counts={counts} selected={effectiveBucket} onSelect={setSelectedBucket} />
        </div>
      </section>

      <section className="border border-[color:var(--line)] bg-[color:var(--panel)] p-4">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
          <label className="block">
            <span className="block font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
              Search project name
            </span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by project or repo name"
              className="mt-2 w-full border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-4 py-3 text-sm leading-7 outline-none transition focus:border-[color:var(--accent)]"
            />
          </label>

          <div className="space-y-2">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
              Manual status filter
            </p>
            <div className="flex flex-wrap gap-2">
              {(["all", "green", "yellow", "red"] as const).map((bucket) => {
                const meta =
                  bucket === "all"
                    ? {
                        label: "All",
                        border: "var(--line)",
                        color: "var(--ink)",
                        background: "transparent",
                      }
                    : {
                        label: bucketMeta(bucket).label,
                        border: bucketMeta(bucket).color,
                        color: bucketMeta(bucket).text,
                        background: bucketMeta(bucket).background,
                      };

                const active = manualStatus === bucket;

                return (
                  <button
                    key={bucket}
                    type="button"
                    onClick={() => {
                      setManualStatus(bucket);
                      setSelectedBucket("all");
                    }}
                    className="border px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em] transition"
                    style={{
                      borderColor: active ? meta.border : "var(--line)",
                      color: active ? meta.color : "var(--muted)",
                      backgroundColor: active ? meta.background : "transparent",
                    }}
                  >
                    {meta.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="border border-[color:var(--line)] bg-[color:var(--panel)]">
        <div className="grid grid-cols-[minmax(0,1.2fr)_90px_150px_180px] gap-4 border-b border-[color:var(--line)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)] md:grid-cols-[minmax(0,1.3fr)_120px_180px_220px]">
          <span>Project</span>
          <span>Runs</span>
          <span>Latest status</span>
          <span>Actions</span>
        </div>

        {filteredProjects.map((project) => (
          <div
            key={project.key}
            className="grid grid-cols-[minmax(0,1.2fr)_90px_150px_180px] items-center gap-4 border-b border-[color:var(--line)] px-4 py-4 md:grid-cols-[minmax(0,1.3fr)_120px_180px_220px]"
          >
            <Link
              href={`/projects/${project.latestRunId}/maintenance`}
              className="min-w-0 transition hover:text-[color:var(--accent)]"
            >
              <p className="break-words text-lg font-semibold text-[color:var(--ink-strong)]">
                {project.label}
              </p>
              <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--muted)]">
                latest {project.latestUpdatedAt}
              </p>
            </Link>
            <div className="font-mono text-sm text-[color:var(--ink)]">{project.runsCount}</div>
            <div className="flex items-center justify-start">
              <StatusBadge label={project.latestStatusLabel} tone={project.latestStatusTone} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {project.rerunnable && project.rerunWorkflowName ? (
                <form action={dispatchWorkflowAction}>
                  <input type="hidden" name="run_id" value={project.latestRunId} />
                  <input type="hidden" name="workflow_name" value={project.rerunWorkflowName} />
                  <input type="hidden" name="return_to" value="/maintenance" />
                  <button
                    type="submit"
                    className="border border-[color:var(--accent)] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--accent)] transition hover:bg-[color:var(--accent)] hover:text-white"
                  >
                    Re-run
                  </button>
                </form>
              ) : null}
              <form action={deleteProjectAction}>
                <input type="hidden" name="return_to" value="/maintenance" />
                <input type="hidden" name="run_ids" value={project.runIds.join(",")} />
                <button
                  type="submit"
                  className="border border-[#aa3d3d] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[#ff7d7d] transition hover:bg-[#aa3d3d]/10"
                >
                  Delete
                </button>
              </form>
            </div>
          </div>
        ))}

        {filteredProjects.length === 0 ? (
          <div className="px-4 py-10 font-mono text-sm uppercase tracking-[0.16em] text-[color:var(--muted)]">
            No projects match the current filters.
          </div>
        ) : null}
      </section>
    </div>
  );
}
