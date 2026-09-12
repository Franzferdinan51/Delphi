import type { Forecast } from "../types";
import { formatDateTime, toPct } from "../hooks";
import { Gauge } from "./Gauge";
import { ConfidenceChip, TypeChip, Chip } from "./ui";

function ListCard({ title, items, className = "" }: { title: string; items: string[]; className?: string }) {
  if (!items || items.length === 0) return null;
  return (
    <div className={`card rb-card ${className}`}>
      <h4>{title}</h4>
      <ul>
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}

export function ResultPanel({ forecast }: { forecast: Forecast }) {
  const r = forecast.readout;
  const [lo, hi] = forecast.confidenceRange ?? [0, 0];
  const weights = Object.entries(forecast.weights ?? {});
  const maxW = Math.max(1, ...weights.map(([, w]) => w));
  const opinions = [...(forecast.opinions ?? [])].sort(
    (a, b) => (b.weight ?? 0) - (a.weight ?? 0)
  );

  return (
    <div className="card result-panel" id="result">
      <div className="result-hero">
        <p className="section-title">Council forecast</p>
        <h2 className="result-q">{forecast.question}</h2>
        <div className="result-meta">
          <TypeChip type={forecast.questionType} />
          <ConfidenceChip level={forecast.confidence} />
          {typeof forecast.confidenceScore === "number" && (
            <Chip>Score {Math.round(forecast.confidenceScore)}/100</Chip>
          )}
          <Chip>Run #{forecast.runNumber}</Chip>
          <Chip>{formatDateTime(forecast.createdAt)}</Chip>
          {forecast.deadline && <Chip>Deadline {formatDateTime(forecast.deadline)}</Chip>}
        </div>

        <div className="result-figure">
          <Gauge value={toPct(forecast.probability)} size={170} />
          <div className="result-answer-block">
            <div className="result-answer-label">Council answer</div>
            <div className="result-answer">{forecast.answer}</div>
            <div className="range-bar">
              <div className="range-track">
                <div
                  className="range-fill"
                  style={{ left: `${toPct(lo)}%`, width: `${Math.max(1, toPct(hi) - toPct(lo))}%` }}
                />
                <div className="range-tick" style={{ left: `calc(${toPct(forecast.probability)}% - 1px)` }} />
              </div>
              <div className="range-labels">
                <span>Heuristic range: {Math.round(toPct(lo))}% – {Math.round(toPct(hi))}%</span>
              </div>
            </div>
          </div>
        </div>

        {forecast.summary && <p className="result-summary">{forecast.summary}</p>}
        <p className="muted">Confidence is a heuristic evidence/agreement score, not a calibrated probability. The range has no guaranteed coverage.</p>
      </div>

      <div className="readout-body">
        {r?.thesis && (
          <div className="card thesis-card">
            <p className="section-title">Thesis</p>
            <p>{r.thesis}</p>
          </div>
        )}

        <div className="readout-grid">
          <ListCard title="Key drivers" items={r?.drivers} className="drivers" />
          <ListCard title="Counter-signals" items={r?.counterSignals} className="counters" />
          <ListCard title="Update triggers" items={r?.updateTriggers} className="triggers" />
          <ListCard title="Assumptions" items={r?.assumptions} className="assume" />
        </div>

        <div className="scenarios">
          {forecast.bestCase && (
            <div className="card scenario best">
              <h4>▲ Best case</h4>
              <p>{forecast.bestCase}</p>
            </div>
          )}
          {forecast.worstCase && (
            <div className="card scenario worst">
              <h4>▼ Worst case</h4>
              <p>{forecast.worstCase}</p>
            </div>
          )}
        </div>

        {forecast.timeline && (
          <div className="card timeline-card">
            <p className="section-title">Timeline</p>
            <p>{forecast.timeline}</p>
          </div>
        )}

        {r?.indicators && r.indicators.length > 0 && (
          <div className="card indicators-card">
            <p className="section-title">Indicators to watch</p>
            <div className="ind-list">
              {r.indicators.map((ind, i) => (
                <span key={i} className="ind-pill">
                  {ind}
                </span>
              ))}
            </div>
          </div>
        )}

        {(forecast.priors?.baseRate || forecast.priors?.market || (forecast.decomposition?.length ?? 0) > 0) && (
          <div className="card priors-card">
            <p className="section-title">Bayesian anchors & decomposition</p>
            <ul>
              {forecast.priors?.baseRate && (
                <li>
                  Base rate <strong>{forecast.priors.baseRate.value}%</strong> —{" "}
                  {forecast.priors.baseRate.referenceClass}{" "}
                  <span className="muted">({forecast.priors.baseRate.source})</span>
                </li>
              )}
              {forecast.priors?.market && (
                <li>
                  Market <strong>{forecast.priors.market.value}%</strong> — {forecast.priors.market.market}{" "}
                  <span className="muted">
                    ({forecast.priors.market.source}
                    {forecast.priors.market.volumeUsd > 0 &&
                      `, ~$${forecast.priors.market.volumeUsd.toLocaleString("en-US")} vol`})
                  </span>
                </li>
              )}
              {(forecast.decomposition ?? []).map((d, i) => (
                <li key={i}>
                  <strong>{i + 1}.</strong> {d.sub}
                  {d.estimate && <span className="muted"> — {d.estimate}</span>}
                </li>
              ))}
            </ul>
            {typeof forecast.questionQuality === "number" && forecast.questionQuality > 0 && (
              <p className="muted">Question quality: {Math.round(forecast.questionQuality)}/100</p>
            )}
            {forecast.confidenceBreakdown && (
              <p className="muted">
                Score breakdown — agreement {Math.round(forecast.confidenceBreakdown.agreement)}, prior
                convergence {Math.round(forecast.confidenceBreakdown.priorConvergence)}, evidence{" "}
                {Math.round(forecast.confidenceBreakdown.evidence)}, track record{" "}
                {Math.round(forecast.confidenceBreakdown.trackRecord)}
              </p>
            )}
          </div>
        )}

        {weights.length > 0 && (
          <div className="card weights-card">
            <p className="section-title">Aggregation weights</p>
            {weights
              .sort((a, b) => b[1] - a[1])
              .map(([id, w]) => {
                const op = opinions.find((o) => o.councilorId === id);
                return (
                  <div className="weight-row" key={id}>
                    <span className="wname">{op?.councilorName ?? id}</span>
                    <span className="wtrack">
                      <span className="wfill" style={{ width: `${(w / maxW) * 100}%` }} />
                    </span>
                    <span className="wval">{w.toFixed(3)}</span>
                  </div>
                );
              })}
          </div>
        )}

        <div className="method-note">
          method: {forecast.method || "logarithmic-opinion-pool"} · {opinions.length} opinions aggregated
        </div>
      </div>
    </div>
  );
}
