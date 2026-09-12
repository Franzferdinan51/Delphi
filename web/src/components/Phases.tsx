import type { Phase } from "../types";

const STEPS: { key: Phase | "final"; label: string }[] = [
  { key: "gate", label: "Question gate" },
  { key: "research", label: "Research" },
  { key: "priors", label: "Priors" },
  { key: "deliberation", label: "Deliberation" },
  { key: "critic", label: "Critic" },
  { key: "aggregation", label: "Aggregation" },
  { key: "final", label: "Result" },
];

const ORDER: Phase[] = ["gate", "research", "priors", "deliberation", "critic", "aggregation", "done"];

export function PhaseTimeline({ phase }: { phase: Phase | null }) {
  const idx = phase ? ORDER.indexOf(phase) : -1;
  return (
    <div className="card phase-timeline" aria-label="Deliberation phases">
      {STEPS.map((s, i) => {
        const stepIdx = s.key === "final" ? ORDER.length - 1 : ORDER.indexOf(s.key as Phase);
        const state = idx < 0 ? "todo" : stepIdx < idx ? "done" : stepIdx === idx ? "active" : "todo";
        return (
          <div className={`pstep ${state}`} key={s.key}>
            <div className="pstep-node">
              <div className="pstep-dot">
                {state === "done" ? "✓" : state === "active" ? "●" : i + 1}
              </div>
              <div className="pstep-label">{s.label}</div>
            </div>
            {i < STEPS.length - 1 && <div className="pstep-line" />}
          </div>
        );
      })}
    </div>
  );
}
