import { getLeaderboard } from "../api";
import { useApi } from "../hooks";
import { EmptyState, ApiError, LoadingCard } from "../components/ui";

export function Leaderboard() {
  const { data, loading, error, retry } = useApi(getLeaderboard);

  const councilors = [...(data?.councilors ?? [])].sort((a, b) => a.brier - b.brier);
  const providers = [...(data?.providers ?? [])].sort((a, b) => a.brier - b.brier);
  const maxBrierC = Math.max(0.25, ...councilors.map((c) => c.brier));
  const maxBrierP = Math.max(0.25, ...providers.map((p) => p.brier));

  return (
    <div className="page">
      <div className="page-head">
        <h1>
          Council <span className="accent">Leaderboard</span>
        </h1>
        <p>Ranked by Brier score over graded forecasts — lower is better. A Brier of 0.25 is coin-flip; below 0.20 is sharp.</p>
      </div>

      {loading && <LoadingCard rows={8} />}
      {error && <ApiError message={error} onRetry={retry} />}

      {!loading && !error && councilors.length === 0 && (
        <EmptyState
          glyph="🏆"
          title="No graded forecasts yet"
          body="Resolve some questions and the councilors will start earning their ranks here."
        />
      )}

      {!loading && !error && councilors.length > 0 && (
        <div className="lb-grid two">
          <div className="card card-pad">
            <p className="section-title">Councilors</p>
            <table className="lb-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Councilor</th>
                  <th style={{ textAlign: "right" }}>Graded</th>
                  <th>Brier</th>
                  <th style={{ textAlign: "right" }}>Log score</th>
                </tr>
              </thead>
              <tbody>
                {councilors.map((c, i) => (
                  <tr key={c.id}>
                    <td className={`rank${i < 3 ? " top" : ""}`}>{i + 1}</td>
                    <td>
                      <div className="lb-name">{c.name}</div>
                      <div className="lb-tag">{c.tagline}</div>
                    </td>
                    <td className="mono muted" style={{ textAlign: "right" }}>{c.n}</td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div className="brier-bar" style={{ flex: 1 }}>
                          <div style={{ width: `${Math.min(100, (c.brier / maxBrierC) * 100)}%` }} />
                        </div>
                        <span className="brier-val">{c.brier.toFixed(3)}</span>
                      </div>
                    </td>
                    <td className="mono muted" style={{ textAlign: "right" }}>
                      {c.logScore.toFixed(3)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card card-pad">
            <p className="section-title">Providers</p>
            {providers.length === 0 ? (
              <p className="muted" style={{ fontSize: 14 }}>No provider data yet.</p>
            ) : (
              <table className="lb-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Provider</th>
                    <th style={{ textAlign: "right" }}>n</th>
                    <th>Brier</th>
                  </tr>
                </thead>
                <tbody>
                  {providers.map((p, i) => (
                    <tr key={p.id}>
                      <td className={`rank${i < 3 ? " top" : ""}`}>{i + 1}</td>
                      <td className="lb-name">{p.name}</td>
                      <td className="mono muted" style={{ textAlign: "right" }}>{p.n}</td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div className="brier-bar" style={{ flex: 1 }}>
                            <div style={{ width: `${Math.min(100, (p.brier / maxBrierP) * 100)}%` }} />
                          </div>
                          <span className="brier-val">{p.brier.toFixed(3)}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="muted" style={{ fontSize: 12.5, marginTop: 16, lineHeight: 1.6 }}>
              Brier = mean squared error of probabilistic forecasts. Lower means sharper, better-calibrated predictions.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
