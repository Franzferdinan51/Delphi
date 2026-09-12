import { useState } from "react";
import type { OpinionPayload } from "../types";

function confLabel(c: number | string): string {
  if (typeof c === "string") return c;
  return `${Math.round(c)}%`;
}

export function OpinionCard({ opinion }: { opinion: OpinionPayload }) {
  const [open, setOpen] = useState(false);
  const isR2 = opinion.round === 2;
  const initial = (opinion.councilorName || "?").trim().charAt(0).toUpperCase() || "?";
  const prob = Math.max(0, Math.min(100, opinion.probability));

  return (
    <div className={`card op-card${isR2 ? " r2" : ""}`}>
      <div className="op-head">
        <div className="avatar">{initial}</div>
        <div className="op-id">
          <h3>{opinion.councilorName}</h3>
          <div className="tagline">{opinion.tagline}</div>
        </div>
        <div className="op-badges">
          <span className="provider-badge">{opinion.providerName || opinion.provider}</span>
          {opinion.status === "demo" && <span className="chip status-demo">demo</span>}
          {opinion.status === "error" && <span className="chip status-error">error</span>}
        </div>
      </div>

      <div className="op-prob">
        <div className="prob-num">
          {Math.round(prob)}
          <span className="pct">%</span>
        </div>
        <div className="prob-bar">
          <div style={{ width: `${prob}%` }} />
        </div>
      </div>

      {opinion.answer && (
        <div className="op-answer">
          <b>Answer:</b> {opinion.answer}
        </div>
      )}

      <div className="mono muted" style={{ fontSize: 12, marginBottom: 8 }}>
        Confidence {confLabel(opinion.confidence)}
        {isR2 && (
          <span className="r2-flag" style={{ marginLeft: 10 }}>
            ↻ Round 2 · revised
          </span>
        )}
        {!isR2 && (
          <span className="muted" style={{ marginLeft: 10 }}>
            · Round 1
          </span>
        )}
      </div>

      {opinion.reasoning && (
        <>
          <button className="reasoning-toggle" onClick={() => setOpen((o) => !o)}>
            {open ? "▾ Hide reasoning" : "▸ Show reasoning"}
          </button>
          {open && <div className="reasoning">{opinion.reasoning}</div>}
        </>
      )}
    </div>
  );
}
