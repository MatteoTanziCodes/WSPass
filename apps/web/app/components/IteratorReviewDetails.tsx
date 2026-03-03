import {
  type DecompositionClarifyingQuestion,
  type DecompositionGap,
} from "@pass/shared";
import { StatusBadge } from "./StatusBadge";

function channelLabel(channel: DecompositionGap["recommended_inputs"][number]["channel"]) {
  switch (channel) {
    case "answer":
      return "Answer here";
    case "prd_update":
      return "Add PRD update";
    case "org_constraints_update":
      return "Add org constraints update";
    case "design_guidelines_update":
      return "Add design guidelines update";
  }
}

export function IteratorGapCard(props: {
  gap: DecompositionGap;
  compact?: boolean;
}) {
  const { gap, compact = false } = props;

  return (
    <div className="border border-[color:var(--line)] bg-[color:var(--panel)] p-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--danger)]">
          {gap.id}
        </p>
        <StatusBadge
          label={gap.severity}
          tone={
            gap.severity === "high"
              ? "danger"
              : gap.severity === "medium"
                ? "accent"
                : "default"
          }
        />
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
          {gap.type.replaceAll("_", " ")}
        </span>
      </div>

      <p className="mt-3 text-sm leading-7 text-[color:var(--ink-strong)]">{gap.summary}</p>

      {gap.why_blocked ? (
        <div className="mt-4 border border-[color:var(--line)] bg-[color:var(--panel-soft)] p-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--warning)]">
            Why Claude blocked
          </p>
          <p className="mt-2 text-sm leading-7 text-[color:var(--ink)]">{gap.why_blocked}</p>
        </div>
      ) : null}

      <div className={`mt-4 grid gap-4 ${compact ? "lg:grid-cols-2" : "xl:grid-cols-2"}`}>
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
            Missing information
          </p>
          {gap.missing_information.length > 0 ? (
            <ul className="mt-2 space-y-2 text-sm leading-7 text-[color:var(--ink)]">
              {gap.missing_information.map((item) => (
                <li key={item}>- {item}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm leading-7 text-[color:var(--muted)]">No specific missing information persisted.</p>
          )}
        </div>

        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
            Evidence Claude used
          </p>
          {gap.evidence.length > 0 ? (
            <ul className="mt-2 space-y-2 text-sm leading-7 text-[color:var(--ink)]">
              {gap.evidence.map((item) => (
                <li key={item}>- {item}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm leading-7 text-[color:var(--muted)]">No evidence details persisted.</p>
          )}
        </div>
      </div>

      {!compact ? (
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
              If answered, Claude will create / update
            </p>
            {gap.expected_issue_outcomes.length > 0 ? (
              <ul className="mt-2 space-y-2 text-sm leading-7 text-[color:var(--ink)]">
                {gap.expected_issue_outcomes.map((item) => (
                  <li key={`${item.component}:${item.title}`}>
                    <span className="font-semibold text-[color:var(--ink-strong)]">{item.title}</span>
                    {" // "}
                    <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[color:var(--muted)]">
                      {item.component} / {item.category}
                    </span>
                    <div className="text-sm leading-7 text-[color:var(--ink)]">{item.reason}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm leading-7 text-[color:var(--muted)]">Claude did not persist expected issue outcomes.</p>
            )}
          </div>

          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
              Recommended input channels
            </p>
            {gap.recommended_inputs.length > 0 ? (
              <div className="mt-2 space-y-2">
                {gap.recommended_inputs.map((item) => (
                  <div key={`${item.channel}:${item.prompt}`} className="border border-[color:var(--line)] bg-[color:var(--panel-soft)] p-3">
                    <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--accent)]">
                      {item.label || channelLabel(item.channel)}
                    </p>
                    <p className="mt-2 text-sm leading-7 text-[color:var(--ink)]">{item.prompt}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm leading-7 text-[color:var(--muted)]">No recommended inputs persisted.</p>
            )}
          </div>
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
            Affected requirements
          </p>
          <p className="mt-2 break-words font-mono text-xs uppercase tracking-[0.14em] text-[color:var(--ink)]">
            {gap.affected_requirement_ids.length > 0
              ? gap.affected_requirement_ids.join(", ")
              : "none"}
          </p>
        </div>
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
            Affected components
          </p>
          <p className="mt-2 break-words font-mono text-xs uppercase tracking-[0.14em] text-[color:var(--ink)]">
            {gap.affected_components.length > 0 ? gap.affected_components.join(", ") : "none"}
          </p>
        </div>
      </div>
    </div>
  );
}

export function IteratorQuestionContext(props: {
  question: DecompositionClarifyingQuestion;
}) {
  const { question } = props;

  return (
    <div className="space-y-4">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--warning)]">
        {question.id}
      </p>
      <p className="text-base font-semibold text-[color:var(--ink-strong)]">{question.prompt}</p>
      <p className="text-sm leading-7 text-[color:var(--ink)]">{question.rationale}</p>

      <div className="grid gap-4 xl:grid-cols-2">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
            Missing information
          </p>
          {question.missing_information.length > 0 ? (
            <ul className="mt-2 space-y-2 text-sm leading-7 text-[color:var(--ink)]">
              {question.missing_information.map((item) => (
                <li key={item}>- {item}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm leading-7 text-[color:var(--muted)]">No specific missing information persisted.</p>
          )}
        </div>
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
            Evidence Claude used
          </p>
          {question.evidence.length > 0 ? (
            <ul className="mt-2 space-y-2 text-sm leading-7 text-[color:var(--ink)]">
              {question.evidence.map((item) => (
                <li key={item}>- {item}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm leading-7 text-[color:var(--muted)]">No evidence details persisted.</p>
          )}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
            If answered, Claude will create / update
          </p>
          {question.expected_issue_outcomes.length > 0 ? (
            <ul className="mt-2 space-y-2 text-sm leading-7 text-[color:var(--ink)]">
              {question.expected_issue_outcomes.map((item) => (
                <li key={`${item.component}:${item.title}`}>
                  <span className="font-semibold text-[color:var(--ink-strong)]">{item.title}</span>
                  {" // "}
                  <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[color:var(--muted)]">
                    {item.component} / {item.category}
                  </span>
                  <div className="text-sm leading-7 text-[color:var(--ink)]">{item.reason}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm leading-7 text-[color:var(--muted)]">Claude did not persist expected issue outcomes.</p>
          )}
        </div>

        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted)]">
            Recommended input channels
          </p>
          {question.recommended_inputs.length > 0 ? (
            <div className="mt-2 space-y-2">
              {question.recommended_inputs.map((item) => (
                <div key={`${item.channel}:${item.prompt}`} className="border border-[color:var(--line)] bg-[color:var(--panel)] p-3">
                  <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--accent)]">
                    {item.label || channelLabel(item.channel)}
                  </p>
                  <p className="mt-2 text-sm leading-7 text-[color:var(--ink)]">{item.prompt}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm leading-7 text-[color:var(--muted)]">No recommended inputs persisted.</p>
          )}
        </div>
      </div>
    </div>
  );
}
