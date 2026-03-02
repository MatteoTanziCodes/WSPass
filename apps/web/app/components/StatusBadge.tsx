export function StatusBadge(props: { label: string; tone?: "default" | "accent" | "danger" | "success" }) {
  const { label, tone = "default" } = props;

  const toneClass =
    tone === "accent"
      ? "border-[color:var(--accent)] text-[color:var(--accent)]"
      : tone === "danger"
      ? "border-[#aa3d3d] text-[#ff7d7d]"
      : tone === "success"
      ? "border-[#2a8b56] text-[#7cf0a2]"
      : "border-[color:var(--line)] text-[color:var(--ink)]";

  return (
    <span
      className={`inline-flex border px-2 py-1 font-mono text-[11px] uppercase tracking-[0.18em] ${toneClass}`}
    >
      {label.replaceAll("_", " ")}
    </span>
  );
}
