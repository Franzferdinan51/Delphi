import { useMemo, useState } from "react";
import { getQuestions } from "../api";
import { formatDate, toPct, useApi, navigate } from "../hooks";
import { StatusChip, TypeChip, EmptyState, ApiError, LoadingCard } from "../components/ui";

export function Questions() {
  const { data, loading, error, retry } = useApi(getQuestions);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "resolved">("all");

  const questions = useMemo(() => {
    const list = data?.questions ?? [];
    return list
      .filter((q) =>
        query.trim() === "" ||
        q.question.toLowerCase().includes(query.trim().toLowerCase())
      )
      .filter((q) => statusFilter === "all" || q.status === statusFilter)
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  }, [data, query, statusFilter]);

  return (
    <div className="page">
      <div className="page-head">
        <h1>
          Question <span className="accent">Archive</span>
        </h1>
        <p>Every question the council has deliberated, with its latest aggregated probability.</p>
      </div>

      <div className="toolbar">
        <input
          className="input"
          style={{ maxWidth: 420 }}
          placeholder="Search questions…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="seg">
          {(["all", "open", "resolved"] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={statusFilter === s ? "active" : ""}
              onClick={() => setStatusFilter(s)}
              style={{ textTransform: "capitalize" }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {loading && <LoadingCard rows={5} />}
      {error && <ApiError message={error} onRetry={retry} />}
      {!loading && !error && questions.length === 0 && (
        <EmptyState
          glyph="Δ"
          title={data?.questions?.length ? "No matches" : "No questions yet"}
          body={
            data?.questions?.length
              ? "Nothing matches your search. Try a different keyword or status filter."
              : "The council hasn't deliberated anything yet. Head to the Ask console and convene the council."
          }
        />
      )}

      {!loading &&
        !error &&
        questions.map((q) => (
          <div className="card qrow" key={q.id} onClick={() => navigate(`/questions/${q.id}`)}>
            <div className="qrow-main">
              <p className="qrow-q">{q.question}</p>
              <div className="qrow-sub">
                <StatusChip status={q.status} />
                <TypeChip type={q.questionType} />
                <span>asked {formatDate(q.createdAt)}</span>
                <span>deadline {formatDate(q.deadline)}</span>
                {q.status === "resolved" && q.outcome && <span>→ {q.outcome}</span>}
              </div>
            </div>
            <div className="qrow-prob">
              <div className="pv">{Math.round(toPct(q.probability))}%</div>
              <div className="pl">prob</div>
            </div>
          </div>
        ))}
    </div>
  );
}
