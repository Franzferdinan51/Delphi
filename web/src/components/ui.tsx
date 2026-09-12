import type { ReactNode } from "react";

export function Chip({ className = "", children }: { className?: string; children: ReactNode }) {
  return <span className={`chip ${className}`}>{children}</span>;
}

export function StatusChip({ status }: { status: "open" | "resolved" }) {
  return (
    <span className={`chip ${status}`}>
      {status === "open" ? "Open" : "Resolved"}
    </span>
  );
}

export function ConfidenceChip({ level }: { level: string }) {
  const norm =
    level === "High" || level === "Medium" || level === "Low" ? level : null;
  return <span className={norm ? `chip conf-${norm}` : "chip"}>{level}</span>;
}

export function TypeChip({ type }: { type: string }) {
  const label: Record<string, string> = {
    binary: "Binary",
    timing: "Timing",
    numeric: "Numeric",
    categorical: "Categorical",
  };
  return <span className="chip">{label[type] ?? type}</span>;
}

export function EmptyState({ glyph, title, body }: { glyph: string; title: string; body: string }) {
  return (
    <div className="empty">
      <span className="glyph">{glyph}</span>
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}

export function ApiError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const looksDown = /failed to fetch|network|econnrefused|load failed/i.test(message);
  return (
    <div className="error-box">
      <h3>{looksDown ? "Delphi backend unreachable" : "Something went wrong"}</h3>
      <p>
        {looksDown
          ? "The API at /api isn't responding. Make sure the Delphi backend is running on port 8790, then try again."
          : message}
      </p>
      {onRetry && (
        <button className="btn btn-ghost btn-sm" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function LoadingCard({ rows = 3 }: { rows?: number }) {
  return (
    <div className="card card-pad">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton" style={{ marginBottom: 12, height: 20 }} />
      ))}
    </div>
  );
}

export function MeterBar({ value, max = 100 }: { value: number; max?: number }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="prob-bar">
      <div style={{ width: `${pct}%` }} />
    </div>
  );
}
