import { useEffect, useRef, useState } from "react";
import { askStream } from "../api";
import type {
  AskRequest,
  Councilor,
  Forecast,
  OpinionPayload,
  Phase,
  QuestionType,
  ResearchEvent,
  StreamEvent,
} from "../types";
import { PhaseTimeline } from "../components/Phases";
import { OpinionCard } from "../components/OpinionCard";
import { ResultPanel } from "../components/ResultPanel";
import { ApiError } from "../components/ui";

type RunState = "idle" | "streaming" | "done" | "error";

const TYPE_OPTIONS: { key: QuestionType; label: string; hint: string }[] = [
  { key: "binary", label: "Binary", hint: "Yes / No" },
  { key: "timing", label: "Timing", hint: "When will it happen" },
  { key: "numeric", label: "Numeric", hint: "A number / range" },
  { key: "categorical", label: "Categorical", hint: "Which outcome" },
];

function defaultDeadline(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
}

function ListeningCard({ councilor }: { councilor: Councilor }) {
  const initial = (councilor.name || "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <div className="card op-card">
      <div className="op-head">
        <div className="avatar">{initial}</div>
        <div className="op-id">
          <h3>{councilor.name}</h3>
          <div className="tagline">{councilor.tagline}</div>
        </div>
        <div className="op-badges">
          <span className="provider-badge">{councilor.provider}</span>
        </div>
      </div>
      <div className="skeleton" style={{ height: 44, marginBottom: 10 }} />
      <div className="mono muted" style={{ fontSize: 12.5 }}>
        deliberating <span className="caret" />
      </div>
    </div>
  );
}

export function Ask() {
  const [question, setQuestion] = useState("");
  const [questionType, setQuestionType] = useState<QuestionType>("binary");
  const [deadline, setDeadline] = useState(defaultDeadline);
  const [resolutionCriteria, setResolutionCriteria] = useState("");
  const [context, setContext] = useState("");
  const [demoMode, setDemoMode] = useState(true);
  const [councilSize, setCouncilSize] = useState<3 | 4 | 5>(5);

  const [runState, setRunState] = useState<RunState>("idle");
  const [phase, setPhase] = useState<Phase | null>(null);
  const [councilors, setCouncilors] = useState<Councilor[]>([]);
  const [researches, setResearches] = useState<ResearchEvent[]>([]);
  const [opinions, setOpinions] = useState<OpinionPayload[]>([]);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const handleEvent = (e: StreamEvent) => {
    switch (e.type) {
      case "started":
        setCouncilors(e.councilors);
        break;
      case "phase":
        setPhase(e.phase);
        if (e.phase === "done") setRunState("done");
        break;
      case "research":
        setResearches((prev) => [...prev, { type: "research", query: e.query, results: e.results }]);
        break;
      case "opinion": {
        const { type: _t, ...op } = e;
        setOpinions((prev) => {
          const idx = prev.findIndex(
            (o) => o.councilorId === op.councilorId && o.round === op.round
          );
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = op;
            return next;
          }
          return [...prev, op];
        });
        break;
      }
      case "result":
        setForecast(e.forecast);
        setPhase("done");
        setRunState("done");
        break;
      case "error":
        setError(e.message || "The council hit an error.");
        setRunState("error");
        break;
    }
  };

  const convene = async () => {
    if (!question.trim()) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setRunState("streaming");
    setPhase(null);
    setCouncilors([]);
    setResearches([]);
    setOpinions([]);
    setForecast(null);
    setError(null);

    const body: AskRequest = {
      question: question.trim(),
      questionType,
      deadline,
      demoMode,
      councilSize,
    };
    if (resolutionCriteria.trim()) body.resolutionCriteria = resolutionCriteria.trim();
    if (context.trim()) body.context = context.trim();

    try {
      await askStream(body, handleEvent, ctrl.signal);
      setRunState((s) => (s === "streaming" ? "done" : s));
    } catch (err: unknown) {
      if (ctrl.signal.aborted) {
        setRunState("idle");
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
      setRunState("error");
    }
  };

  const stop = () => abortRef.current?.abort();

  const reset = () => {
    setRunState("idle");
    setPhase(null);
    setCouncilors([]);
    setResearches([]);
    setOpinions([]);
    setForecast(null);
    setError(null);
  };

  useEffect(() => {
    if (runState === "done" && forecast) {
      resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [runState, forecast]);

  // latest opinion per councilor for the cards
  const latestByCouncilor = new Map<string, OpinionPayload>();
  for (const o of opinions) {
    const cur = latestByCouncilor.get(o.councilorId);
    if (!cur || o.round >= cur.round) latestByCouncilor.set(o.councilorId, o);
  }

  const streaming = runState === "streaming";

  return (
    <div className="page">
      <div className="page-head">
        <h1>
          Ask the <span className="accent">Council</span>
        </h1>
        <p>
          Pose a question. Delphi researches it live, convenes {councilSize} councilors for two
          rounds of deliberation with critic review, then aggregates via logarithmic opinion pool.
        </p>
      </div>

      <div className="ask-grid">
        <div className="card ask-form-card">
          <div className="field">
            <label htmlFor="q">Question</label>
            <textarea
              id="q"
              className="textarea ask-q"
              placeholder="e.g. Will the Fed cut rates at the December 2026 FOMC meeting?"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              disabled={streaming}
            />
          </div>

          <div className="field">
            <label>Question type</label>
            <div className="pills">
              {TYPE_OPTIONS.map((t) => (
                <button
                  key={t.key}
                  className={`pill${questionType === t.key ? " active" : ""}`}
                  onClick={() => setQuestionType(t.key)}
                  disabled={streaming}
                  type="button"
                >
                  {t.label}
                  <small>{t.hint}</small>
                </button>
              ))}
            </div>
          </div>

          <div className="form-row">
            <div className="field">
              <label htmlFor="dl">Deadline</label>
              <input
                id="dl"
                type="date"
                className="input"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                disabled={streaming}
              />
            </div>
            <div className="field">
              <label>Council size</label>
              <div className="seg">
                {([3, 4, 5] as const).map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={councilSize === n ? "active" : ""}
                    onClick={() => setCouncilSize(n)}
                    disabled={streaming}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div className="form-hint">More councilors = more perspectives, slower run.</div>
            </div>
          </div>

          <details className="advanced">
            <summary>Advanced: resolution criteria &amp; context</summary>
            <div className="adv-body">
              <div className="field">
                <label htmlFor="rc">Resolution criteria</label>
                <textarea
                  id="rc"
                  className="textarea"
                  placeholder="How will this be judged? e.g. Official FOMC statement on Dec 16, 2026."
                  value={resolutionCriteria}
                  onChange={(e) => setResolutionCriteria(e.target.value)}
                  disabled={streaming}
                  style={{ minHeight: 70 }}
                />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="ctx">Background context</label>
                <textarea
                  id="ctx"
                  className="textarea"
                  placeholder="Anything the council should know that research might miss…"
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  disabled={streaming}
                  style={{ minHeight: 70 }}
                />
              </div>
            </div>
          </details>

          <div className="field">
            <div className="toggle-row">
              <button
                type="button"
                className={`toggle${demoMode ? " on" : ""}`}
                onClick={() => setDemoMode((d) => !d)}
                disabled={streaming}
                aria-pressed={demoMode}
                aria-label="Demo mode"
              />
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>Demo mode</div>
                <div className="form-hint" style={{ marginTop: 2 }}>
                  Simulated councilors — works with zero API credentials. Turn off for live providers.
                </div>
              </div>
            </div>
          </div>

          <div className="convene-row">
            <button
              className="btn btn-primary"
              onClick={streaming ? stop : convene}
              disabled={!streaming && !question.trim()}
            >
              {streaming ? "■ Stop" : "Δ Convene the Council"}
            </button>
            {runState === "done" && (
              <button className="btn btn-ghost" onClick={reset}>
                Ask another
              </button>
            )}
          </div>
        </div>

        {(streaming || councilors.length > 0 || forecast) && (
          <div>
            {phase && <PhaseTimeline phase={phase} />}

            {researches.length > 0 && (
              <div className="research-feed">
                <p className="section-title">Live research</p>
                {researches.map((r, i) => (
                  <div className="card research-item" key={i}>
                    <div className="rq">⌕ {r.query}</div>
                    <ul>
                      {(r.results ?? []).slice(0, 4).map((res, j) => (
                        <li key={j}>
                          <a href={res.url} target="_blank" rel="noreferrer">
                            {res.title}
                          </a>
                          {res.snippet && <span className="snip">{res.snippet}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}

            {councilors.length > 0 && (
              <>
                <p className="section-title">Council opinions</p>
                <div className="council-grid">
                  {councilors.map((c) => {
                    const op = latestByCouncilor.get(c.id);
                    return op ? (
                      <OpinionCard key={c.id} opinion={op} />
                    ) : (
                      <ListeningCard key={c.id} councilor={c} />
                    );
                  })}
                </div>
              </>
            )}

            {runState === "error" && error && (
              <div style={{ marginTop: 18 }}>
                <ApiError message={error} onRetry={convene} />
              </div>
            )}

            {forecast && (
              <div ref={resultRef} style={{ scrollMarginTop: 80 }}>
                <ResultPanel forecast={forecast} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
