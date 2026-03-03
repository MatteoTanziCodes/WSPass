export function StatusBadge(props: { label: string; tone?: "default" | "accent" | "danger" | "success" }) {
  const { label, tone = "default" } = props;

  const toneClass =
    tone === "accent"
      ? "border-[color:var(--warning)] text-[color:var(--warning-ink)] bg-[color:var(--warning-soft)]"
      : tone === "danger"
      ? "border-[color:var(--danger)] text-[color:var(--danger-ink)] bg-[color:var(--danger-soft)]"
      : tone === "success"
      ? "border-[color:var(--success)] text-[color:var(--success-ink)] bg-[color:var(--success-soft)]"
      : "border-[color:var(--line)] text-[color:var(--ink)]";

  return (
    <span
      className={`inline-flex border px-2 py-1 font-mono text-[11px] uppercase tracking-[0.18em] ${toneClass}`}
    >
      {label.replaceAll("_", " ")}
    </span>
  );
}
