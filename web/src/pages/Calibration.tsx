import { getCalibration } from "../api";
import { formatDate, toPct, useApi } from "../hooks";
import { LineChart, CalibrationPlot } from "../components/Charts";
import { EmptyState, ApiError, LoadingCard } from "../components/ui";

export function Calibration() {
  const { data, loading, error, retry } = useApi(getCalibration);

  const buckets = (data?.buckets ?? []).map((b) => ({
    x: toPct(b.avgForecast),
    y: toPct(b.hitRate),
    n: b.n,
    label: b.label,
  }));
  const totalN = buckets.reduce((s, b) => s + b.n, 0);
  const brierPts = (data?.brierOverTime ?? []).map((p) => ({
    x: 0,
    y: p.brier,
    tip: `${formatDate(p.date)}: Brier ${p.brier.toFixed(3)} (n=${p.n})`,
  }));

  return (
    <div className="page">
      <div className="page-head">
        <h1>
          <span className="accent">Calibration</span>
        </h1>
        <p>
          When Delphi says 70%, does it happen ~70% of the time? Points on the diagonal = perfectly
          calibrated. Bubble size = number of forecasts in that bucket.
        </p>
      </div>

      {loading && <LoadingCard rows={6} />}
      {error && <ApiError message={error} onRetry={retry} />}

      {!loading && !error && totalN === 0 && (
        <EmptyState
          glyph="◎"
          title="Not enough resolved forecasts"
          body="Calibration needs resolved questions with graded outcomes. Resolve a few questions from the archive and the curve will appear here."
        />
      )}

      {!loading && !error && totalN > 0 && (
        <div className="lb-grid">
          <div className="card chart-card">
            <h3>Reliability curve</h3>
            <div className="sub">
              {totalN} resolved forecasts · dashed line is perfect calibration
            </div>
            <CalibrationPlot buckets={buckets} />
          </div>

          <div className="card chart-card">
            <h3>Brier score over time</h3>
            <div className="sub">Mean Brier per day — trending down means improving skill</div>
            {brierPts.length < 2 ? (
              <p className="muted" style={{ fontSize: 14 }}>
                Need at least two days of resolved forecasts to draw the trend.
              </p>
            ) : (
              <LineChart
                points={brierPts}
                xLabels={(data?.brierOverTime ?? []).map((p) => formatDate(p.date))}
                yFormat={(v) => v.toFixed(2)}
                color="#7dd3fc"
              />
            )}
          </div>

          {buckets.length > 0 && (
            <div className="card card-pad">
              <p className="section-title">Buckets</p>
              <table className="lb-table">
                <thead>
                  <tr>
                    <th>Bucket</th>
                    <th style={{ textAlign: "right" }}>Avg forecast</th>
                    <th style={{ textAlign: "right" }}>Hit rate</th>
                    <th style={{ textAlign: "right" }}>n</th>
                    <th style={{ textAlign: "right" }}>Gap</th>
                  </tr>
                </thead>
                <tbody>
                  {buckets.map((b, i) => {
                    const gap = b.y - b.x;
                    return (
                      <tr key={i}>
                        <td className="lb-name">{b.label}</td>
                        <td className="mono muted" style={{ textAlign: "right" }}>{b.x.toFixed(0)}%</td>
                        <td className="mono" style={{ textAlign: "right", color: "#34d399" }}>{b.y.toFixed(0)}%</td>
                        <td className="mono muted" style={{ textAlign: "right" }}>{b.n}</td>
                        <td
                          className="mono"
                          style={{
                            textAlign: "right",
                            color: gap > 0 ? "#7dd3fc" : gap < 0 ? "#fbbf24" : "#7d948a",
                          }}
                        >
                          {gap > 0 ? "+" : ""}{gap.toFixed(0)}pp
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="muted" style={{ fontSize: 12.5, marginTop: 14, lineHeight: 1.6 }}>
                Positive gap = events happened more often than forecast (underconfident). Negative gap = overconfident.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
