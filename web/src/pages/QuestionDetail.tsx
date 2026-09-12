import { useState } from "react";
import { getQuestion, resolveQuestion } from "../api";
import type { CouncilorScore } from "../types";
import { formatDate, formatDateTime, toPct, useApi } from "../hooks";
import { LineChart } from "../components/Charts";
import { ResultPanel } from "../components/ResultPanel";
import { OpinionCard } from "../components/OpinionCard";
import {
  StatusChip,
  TypeChip,
  Chip,
  EmptyState,
  ApiError,
  LoadingCard,
} from "../components/ui";

function ScoreTable({ scores }: { scores: CouncilorScore[] }) {
  const sorted = [...scores].sort((a, b) => a.brier - b.brier);
  return (
    <table className="score-table">
      <thead>
        <tr>
          <th>Councilor</th>
          <th className="num">Brier</th>
          <th className="num">Log score</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((s) => (
          <tr key={s.councilorId}>
            <td>{s.councilorName ?? s.councilorId}</td>
            <td className="num" style={{ color: "#34d399" }}>
              {s.brier.toFixed(3)}
            </td>
            <td className="num">{s.logScore.toFixed(3)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ResolveForm({
  questionId,
  questionType,
  onResolved,
}: {
  questionId: string;
  questionType: string;
  onResolved: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const isBinary = questionType === "binary";

  const submit = async (outcome: string) => {
    setBusy(outcome);
    setErr(null);
    try {
      await resolveQuestion(questionId, outcome);
      onResolved();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card resolve-card">
      <h3>⚖ Resolve this question</h3>
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>
        {isBinary
          ? "Did the event happen? This grades every councilor with Brier & log scores."
          : "Was the council's forecast correct? This grades every councilor."}
      </p>
      <div className="resolve-btns">
        {isBinary ? (
          <>
            <button className="outcome-btn yes" disabled={!!busy} onClick={() => submit("yes")}>
              {busy === "yes" ? "…" : "Yes"}
            </button>
            <button className="outcome-btn no" disabled={!!busy} onClick={() => submit("no")}>
              {busy === "no" ? "…" : "No"}
            </button>
          </>
        ) : (
          <>
            <button className="outcome-btn correct" disabled={!!busy} onClick={() => submit("correct")}>
              {busy === "correct" ? "…" : "Correct"}
            </button>
            <button className="outcome-btn incorrect" disabled={!!busy} onClick={() => submit("incorrect")}>
              {busy === "incorrect" ? "…" : "Incorrect"}
            </button>
          </>
        )}
      </div>
      {err && (
        <p style={{ color: "#f87171", fontSize: 13.5, marginTop: 12 }}>{err}</p>
      )}
    </div>
  );
}

export function QuestionDetail({ id }: { id: string }) {
  const { data, loading, error, retry } = useApi(() => getQuestion(id), [id]);

  return (
    <div className="page">
      {loading && <LoadingCard rows={6} />}
      {error && <ApiError message={error} onRetry={retry} />}
      {!loading && !error && !data && (
        <EmptyState glyph="?" title="Question not found" body="This question doesn't exist or was removed." />
      )}

      {!loading && !error && data && (
        <>
          <div className="detail-head">
            <p className="section-title">Question detail</p>
            <h1 className="result-q">{data.question.question}</h1>
            <div className="result-meta">
              <StatusChip status={data.question.status} />
              <TypeChip type={data.question.questionType} />
              <Chip>asked {formatDate(data.question.createdAt)}</Chip>
              <Chip>deadline {formatDate(data.question.deadline)}</Chip>
              {data.question.resolutionCriteria && <Chip>criteria set</Chip>}
            </div>
            {data.question.resolutionCriteria && (
              <p className="muted" style={{ fontSize: 14, maxWidth: 720 }}>
                <b style={{ color: "#c3d4cc" }}>Resolution criteria:</b> {data.question.resolutionCriteria}
              </p>
            )}
          </div>

          <div className="detail-grid">
            {data.forecasts && data.forecasts.length > 0 && (
              <div className="card chart-card">
                <h3>Belief over time</h3>
                <div className="sub">Aggregated probability across forecast runs</div>
                <LineChart
                  points={[...data.forecasts]
                    .sort((a, b) => a.runNumber - b.runNumber)
                    .map((f) => ({
                      x: f.runNumber,
                      y: toPct(f.probability),
                      tip: `Run ${f.runNumber}: ${Math.round(toPct(f.probability))}% (${f.confidence}) — ${formatDateTime(f.createdAt)}`,
                    }))}
                  yMin={0}
                  yMax={100}
                  yTicks={[0, 25, 50, 75, 100]}
                  yFormat={(v) => `${v}%`}
                  xLabels={[...data.forecasts]
                    .sort((a, b) => a.runNumber - b.runNumber)
                    .map((f) => `Run ${f.runNumber}`)}
                />
              </div>
            )}

            {data.resolution ? (
              <div className="card resolution-card">
                <p className="section-title">Resolution</p>
                <h3 style={{ margin: "0 0 6px", fontFamily: "var(--display)" }}>
                  Outcome: <span style={{ color: "#34d399" }}>{data.resolution.outcome}</span>
                </h3>
                <p className="muted mono" style={{ fontSize: 12.5, margin: 0 }}>
                  resolved {formatDateTime(data.resolution.resolvedAt)} · lower Brier = better
                </p>
                <ScoreTable scores={data.resolution.scores} />
              </div>
            ) : (
              data.question.status === "open" && (
                <ResolveForm
                  questionId={id}
                  questionType={data.question.questionType}
                  onResolved={retry}
                />
              )
            )}

            {data.latest && <ResultPanel forecast={data.latest} />}

            {data.latest && data.latest.opinions && data.latest.opinions.length > 0 && (
              <>
                <div className="divider" />
                <p className="section-title">Latest council opinions (run #{data.latest.runNumber})</p>
                <div className="council-grid">
                  {data.latest.opinions.map((op) => (
                    <OpinionCard key={`${op.councilorId}#${op.round}`} opinion={op} />
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
