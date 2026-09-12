import { useState } from "react";
import { getProviders, setProviderModel } from "../api";
import { useApi } from "../hooks";
import { EmptyState, ApiError, LoadingCard } from "../components/ui";
import type { ProviderInfo } from "../types";

function ProviderCard({ provider, onSaved }: { provider: ProviderInfo; onSaved: () => void }) {
  const [model, setModel] = useState(provider.model);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const dirty = model !== provider.model;

  async function save() {
    setSaving(true);
    setMsg("");
    try {
      await setProviderModel(provider.id, model);
      setMsg("Saved.");
      onSaved();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card card-pad">
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            display: "inline-block",
            background: provider.connected ? "#34d399" : "#f87171",
          }}
        />
        <strong>{provider.name}</strong>
        <span className="muted" style={{ marginLeft: "auto", fontSize: 12 }}>
          {provider.id}
        </span>
      </div>
      <p className="muted" style={{ fontSize: 13, margin: "0 0 12px" }}>
        {provider.endpoint}
      </p>
      {provider.availableModels.length > 0 ? (
        <div style={{ display: "flex", gap: 8 }}>
          <select
            className="input"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            style={{ flex: 1 }}
          >
            {!provider.availableModels.includes(model) && <option value="">Select a model…</option>}
            {provider.availableModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <button className="btn btn-primary btn-sm" disabled={!dirty || saving || !model} onClick={save}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      ) : (
        <p className="muted" style={{ fontSize: 13 }}>
          {provider.connected
            ? "Connected, but no model catalog was returned."
            : "Offline — set its API key / start the server, then refresh."}
        </p>
      )}
      {msg && (
        <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
          {msg}
        </p>
      )}
    </div>
  );
}

export function Providers() {
  const { data, loading, error, retry } = useApi(getProviders);
  const providers = data?.providers ?? [];

  return (
    <div className="page">
      <div className="page-head">
        <h1>
          Model <span className="accent">Providers</span>
        </h1>
        <p>
          Model lists are pulled live from each provider&apos;s <code>/models</code> API — nothing is
          hardcoded. Pick a model per provider; Delphi remembers your choice.
        </p>
      </div>

      {loading && <LoadingCard rows={6} />}
      {error && <ApiError message={error} onRetry={retry} />}

      {!loading && !error && providers.length === 0 && (
        <EmptyState glyph="🔌" title="No providers" body="Something went wrong loading providers." />
      )}

      {!loading && !error && providers.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
            gap: 16,
          }}
        >
          {providers.map((p) => (
            <ProviderCard key={p.id} provider={p} onSaved={retry} />
          ))}
        </div>
      )}
    </div>
  );
}
