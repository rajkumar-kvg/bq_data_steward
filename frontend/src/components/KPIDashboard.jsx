import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { getModels } from "../api";
import { toast } from "react-toastify";

const CUBE_API_URL = "/cube-api/v1";
const CUBE_TOKEN = "bq_steward_secret_key";

// ── Direct Cube REST call ─────────────────────────────────────────────────────
async function cubeQuery(connId, body) {
  const res = await fetch(`${CUBE_API_URL}/load`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${CUBE_TOKEN}`,
      "x-cube-conn-id": String(connId),
    },
    body: JSON.stringify({ query: body }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text);
  }
  return res.json();
}

// ── Parse measure names from a Cube.js model string ──────────────────────────
function parseMeasuresFromModel(cubeModelJs) {
  if (!cubeModelJs) return { cubeName: null, measures: [] };

  // Extract cube name more robustly (handle $ if it's a template literal which it shouldn't be here, but still)
  const cubeNameMatch = cubeModelJs.match(/cube\s*\(\s*[`'"]([\w-]+)[`'"]/);
  const cubeName = cubeNameMatch ? cubeNameMatch[1] : null;
  if (!cubeName) return { cubeName: null, measures: [] };

  // Improved measure extraction: look for top-level keys in the measures: { ... } block
  const measuresStart = cubeModelJs.search(/\bmeasures\s*:\s*\{/);
  if (measuresStart === -1) return { cubeName, measures: [] };

  const blockStart = cubeModelJs.indexOf("{", measuresStart);
  if (blockStart === -1) return { cubeName, measures: [] };

  // Walk forward counting braces to find the end of the measures block
  let depth = 0;
  let blockEnd = -1;
  for (let i = blockStart; i < cubeModelJs.length; i++) {
    if (cubeModelJs[i] === "{") depth++;
    else if (cubeModelJs[i] === "}") {
      depth--;
      if (depth === 0) { blockEnd = i; break; }
    }
  }
  if (blockEnd === -1) return { cubeName, measures: [] };

  const measuresBlock = cubeModelJs.slice(blockStart + 1, blockEnd);

  // Use a regex to find keys at the top level of the measures block.
  // We look for "key: {" or "key: {" but NOT keys that are inside nested objects.
  const measureNames = [];
  let currentDepth = 0;
  
  // Split into logical tokens or lines to find keys at depth 0
  const lines = measuresBlock.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    // Check for "key: {" pattern at depth 0
    // This regex looks for an identifier followed by a colon and an opening brace
    const keyMatch = trimmed.match(/^(\w+)\s*:\s*\{/);
    if (keyMatch && currentDepth === 0) {
      measureNames.push(keyMatch[1]);
    }
    
    // Update depth
    for (let i = 0; i < trimmed.length; i++) {
        if (trimmed[i] === '{') currentDepth++;
        else if (trimmed[i] === '}') currentDepth--;
    }
  }

  return { cubeName, measures: measureNames };
}

// ── Error Boundary ────────────────────────────────────────────────────────────
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error("KPIDashboard error:", error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 20, color: "var(--red-500)", fontSize: 13 }}>
          <strong>Dashboard error:</strong> {this.state.error?.message}
          <div style={{ marginTop: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => this.setState({ hasError: false, error: null })}>
              Retry
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Single KPI Card ───────────────────────────────────────────────────────────
function KpiCard({ measureKey, cubeName, connId }) {
  const [value, setValue] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    cubeQuery(connId, { measures: [`${cubeName}.${measureKey}`] })
      .then((data) => {
        if (cancelled) return;
        const row = data?.data?.[0];
        const val = row ? row[`${cubeName}.${measureKey}`] : null;
        setValue(val);
      })
      .catch((err) => {
        if (cancelled) return;
        // Extract human-readable error from Cube's error JSON
        let msg = err.message;
        try {
          const parsed = JSON.parse(msg);
          msg = parsed.error || msg;
        } catch {}
        setError(msg);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [cubeName, measureKey, connId]);

  const formattedValue = useMemo(() => {
    if (value === null || value === undefined) return "—";
    const num = parseFloat(value);
    if (!isNaN(num)) {
      return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(num);
    }
    return String(value);
  }, [value]);

  const displayTitle = measureKey
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .trim();

  return (
    <div
      className="card"
      style={{
        padding: "20px 24px",
        minHeight: 120,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        borderLeft: "4px solid var(--red-500)",
        position: "relative",
        overflow: "hidden",
        transition: "transform 0.15s, box-shadow 0.15s",
      }}
    >
      <div style={{
        position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)",
        fontSize: 52, opacity: 0.04, fontWeight: 900, pointerEvents: "none",
        color: "var(--text-primary)", fontFamily: "monospace",
      }}>
        #
      </div>

      <div style={{
        fontSize: 11, color: "var(--text-muted)", marginBottom: 8,
        textTransform: "uppercase", letterSpacing: "0.8px", fontWeight: 600,
      }}>
        {displayTitle}
      </div>

      {loading ? (
        <span className="spinner" style={{ width: 18, height: 18 }} />
      ) : error ? (
        <div title={error} style={{ color: "var(--red-500)", fontSize: 12, lineHeight: 1.4 }}>
          ⚠ Failed to load
          <div style={{ fontSize: 10, opacity: 0.6, marginTop: 2, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {error.slice(0, 80)}{error.length > 80 ? "…" : ""}
          </div>
        </div>
      ) : (
        <div style={{
          fontSize: 34, fontWeight: 700, letterSpacing: "-0.5px",
          color: "var(--text-primary)", lineHeight: 1,
        }}>
          {formattedValue}
        </div>
      )}

      <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 6, opacity: 0.5, fontFamily: "monospace" }}>
        {cubeName}.{measureKey}
      </div>
    </div>
  );
}

// ── Dashboard content area ────────────────────────────────────────────────────
function DashboardContent({ selectedModel, connId }) {
  const { cubeName, measures } = useMemo(
    () => parseMeasuresFromModel(selectedModel?.cube_model),
    [selectedModel]
  );

  if (!selectedModel) {
    return (
      <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--text-muted)" }}>
        <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>📈</div>
        <div style={{ fontSize: 16 }}>Select a model from the list to view its KPIs</div>
      </div>
    );
  }

  if (!cubeName || measures.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--text-muted)" }}>
        <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>🤷</div>
        <div style={{ fontSize: 16 }}>No measures found in this model.</div>
        <div style={{ fontSize: 13, marginTop: 8, opacity: 0.7 }}>
          Try regenerating the Cube model from the Schema &amp; Data tab.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4, letterSpacing: -0.5 }}>
          {selectedModel.table_id}
          <span style={{ marginLeft: 10, fontSize: 13, fontWeight: 400, color: "var(--text-muted)" }}>
            — {selectedModel.dataset_id}
          </span>
        </h2>
        <p style={{ color: "var(--text-secondary)", fontSize: 13 }}>
          {measures.length} metric{measures.length !== 1 ? "s" : ""} ·{" "}
          <span style={{ color: "var(--red-400)", fontWeight: 600 }}>Cube.js</span> pre-aggregated
        </p>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
        gap: 16,
      }}>
        {measures.map((m) => (
          <ErrorBoundary key={m}>
            <KpiCard measureKey={m} cubeName={cubeName} connId={connId} />
          </ErrorBoundary>
        ))}
      </div>
    </div>
  );
}

// ── Main KPIDashboard component ───────────────────────────────────────────────
export default function KPIDashboard({ connId }) {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedModel, setSelectedModel] = useState(null);

  useEffect(() => {
    setLoading(true);
    setSelectedModel(null);
    setModels([]);
    getModels(connId)
      .then((res) => {
        setModels(res.data);
        if (res.data.length > 0) setSelectedModel(res.data[0]);
      })
      .catch((err) => toast.error(`Failed to load models: ${err.message}`))
      .finally(() => setLoading(false));
  }, [connId]);

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <span className="spinner" />
        <div style={{ marginTop: 12, fontSize: 13, color: "var(--text-muted)" }}>Loading models…</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: 24 }}>
      {/* ── Model Selector ── */}
      <div style={{ width: 240, flexShrink: 0 }}>
        <div style={{
          fontSize: 11, fontWeight: 600, textTransform: "uppercase",
          letterSpacing: "0.6px", color: "var(--text-muted)", marginBottom: 12,
        }}>
          Available Models
        </div>

        {models.length === 0 ? (
          <div style={{
            color: "var(--text-secondary)", fontSize: 13,
            background: "var(--bg-card)", padding: 16, borderRadius: 6,
            border: "1px solid var(--border)", lineHeight: 1.6,
          }}>
            No models generated yet.
            <br />
            <span style={{ opacity: 0.7 }}>Go to a table → generate a Cube model first.</span>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {models.map((m) => {
              const isActive = selectedModel?.id === m.id;
              const { measures } = parseMeasuresFromModel(m.cube_model);
              return (
                <div
                  key={m.id}
                  id={`model-item-${m.id}`}
                  onClick={() => setSelectedModel(m)}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 6,
                    background: isActive ? "var(--red-500)" : "var(--bg-card)",
                    color: isActive ? "#fff" : "var(--text-primary)",
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: isActive ? 600 : 400,
                    transition: "all 0.15s",
                    border: `1px solid ${isActive ? "var(--red-500)" : "var(--border)"}`,
                  }}
                >
                  <div style={{ marginBottom: 2 }}>{m.table_id}</div>
                  <div style={{ fontSize: 11, color: isActive ? "rgba(255,255,255,0.65)" : "var(--text-muted)" }}>
                    {m.dataset_id} · {measures.length} metric{measures.length !== 1 ? "s" : ""}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Dashboard Area ── */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <ErrorBoundary>
          <DashboardContent selectedModel={selectedModel} connId={connId} />
        </ErrorBoundary>
      </div>
    </div>
  );
}
