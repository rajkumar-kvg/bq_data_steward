import { useState, useEffect } from "react";
import { toast } from "react-toastify";
import { getTableMeta, upsertTableMeta, syncTableSchema, generateColumnDefs, updateColumnAiDefinition, generateTableMetrics, updateMetrics, generateCubeModel, updateCubeModel } from "../api";

// ── Icons ─────────────────────────────────────────────────────────────────────
function SyncIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <polyline points="23 4 23 10 17 10"/>
      <polyline points="1 20 1 14 7 14"/>
      <path d="M3.51 9a9 9 0 0114.13-3.36L23 10M1 14l5.36 5.36A9 9 0 0020.49 15"/>
    </svg>
  );
}

function BookIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 19.5A2.5 2.5 0 016.5 17H20"/>
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/>
    </svg>
  );
}

function SchemaIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <path d="M3 9h18M3 15h18M9 3v18"/>
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M18 6L6 18M6 6l12 12"/>
    </svg>
  );
}

function SparklesIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3L14.5 8.5L20 11L14.5 13.5L12 19L9.5 13.5L4 11L9.5 8.5L12 3Z"/>
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 20V10M12 20V4M6 20v-4"/>
    </svg>
  );
}

function CubeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}


// ── Mode badge colours ────────────────────────────────────────────────────────
const MODE_COLORS = {
  NULLABLE: { bg: "#172554", color: "#93c5fd", border: "#1e3a8a" },
  REQUIRED: { bg: "#3d1f00", color: "#fb923c", border: "#7c2d12" },
  REPEATED: { bg: "#1a1a3b", color: "#a78bfa", border: "#3730a3" },
};

const TYPE_COLORS = {
  STRING: "#4ade80", INTEGER: "#60a5fa", INT64: "#60a5fa",
  FLOAT: "#f472b6", FLOAT64: "#f472b6", NUMERIC: "#f472b6",
  BOOLEAN: "#fb923c", BOOL: "#fb923c",
  TIMESTAMP: "#fbbf24", DATE: "#fbbf24", DATETIME: "#fbbf24", TIME: "#fbbf24",
  RECORD: "#a78bfa", STRUCT: "#a78bfa",
  BYTES: "#94a3b8",
};

function TypePill({ type }) {
  const color = TYPE_COLORS[type] || "#94a3b8";
  return (
    <span style={{
      fontFamily: "monospace", fontSize: 11, fontWeight: 600,
      color, background: `${color}18`, border: `1px solid ${color}44`,
      padding: "2px 8px", borderRadius: 99, whiteSpace: "nowrap",
    }}>
      {type}
    </span>
  );
}

function ModePill({ mode }) {
  const s = MODE_COLORS[mode] || { bg: "#111", color: "#aaa", border: "#333" };
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, color: s.color,
      background: s.bg, border: `1px solid ${s.border}`,
      padding: "2px 7px", borderRadius: 99, whiteSpace: "nowrap",
      textTransform: "uppercase", letterSpacing: "0.4px",
    }}>
      {mode}
    </span>
  );
}

// ── Schema table ──────────────────────────────────────────────────────────────
function SchemaTable({ fields, onUpdateAiDesc }) {
  const [filter, setFilter] = useState("");
  const [editingCol, setEditingCol] = useState(null);
  const [draftDesc, setDraftDesc] = useState("");
  const [savingCol, setSavingCol] = useState(null);

  const visible = filter
    ? fields.filter((f) => f.name.toLowerCase().includes(filter.toLowerCase()))
    : fields;

  const handleEditClick = (colName, currentDesc) => {
    setEditingCol(colName);
    setDraftDesc(currentDesc || "");
  };

  const handleSaveClick = async (colName) => {
    setSavingCol(colName);
    await onUpdateAiDesc(colName, draftDesc);
    setSavingCol(null);
    setEditingCol(null);
  };

  return (
    <div>
      <div style={{ marginBottom: 10 }}>
        <input
          className="input"
          placeholder="Filter columns…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ fontSize: 13, padding: "7px 12px" }}
        />
      </div>
      <div className="schema-scroll">
        <table className="schema-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Column</th>
              <th>Type</th>
              <th>Mode</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((f, i) => (
              <tr key={f.name}>
                <td className="schema-idx">{i + 1}</td>
                <td className="schema-col-name">{f.name}</td>
                <td><TypePill type={f.field_type} /></td>
                <td><ModePill mode={f.mode} /></td>
                <td className="schema-col-desc">
                  {f.description && <div style={{ marginBottom: f.ai_description || editingCol === f.name ? 6 : 0 }}>{f.description}</div>}
                  
                  {editingCol === f.name ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingLeft: 6, borderLeft: "2px solid #a78bfa" }}>
                      <textarea 
                        className="input textarea"
                        value={draftDesc}
                        onChange={(e) => setDraftDesc(e.target.value)}
                        style={{ fontSize: 13, minHeight: 50, padding: 6 }}
                        autoFocus
                      />
                      <div style={{ display: "flex", gap: 6 }}>
                        <button className="btn btn-primary btn-sm" style={{ height: 24, minHeight: 24, fontSize: 11 }} onClick={() => handleSaveClick(f.name)} disabled={savingCol === f.name}>
                          {savingCol === f.name ? "Saving..." : "Save"}
                        </button>
                        <button className="btn btn-ghost btn-sm" style={{ height: 24, minHeight: 24, fontSize: 11 }} onClick={() => setEditingCol(null)} disabled={savingCol === f.name}>Cancel</button>
                      </div>
                    </div>
                  ) : f.ai_description ? (
                    <div style={{ paddingLeft: 6, borderLeft: "2px solid #a78bfa", color: "var(--text-primary)" }}>
                      <span style={{ fontSize: 13, marginRight: 4 }}>✨</span>
                      {f.ai_description}
                      <button 
                        className="btn btn-ghost btn-sm" 
                        style={{ padding: "0 4px", height: 20, minHeight: 20, marginLeft: 8, opacity: 0.6 }}
                        onClick={() => handleEditClick(f.name, f.ai_description)}
                        title="Edit AI definition"
                      >
                        <EditIcon />
                      </button>
                    </div>
                  ) : null}

                  {!f.description && !f.ai_description && editingCol !== f.name && (
                    <div>
                      <span style={{ color: "var(--text-muted)" }}>—</span>
                      <button 
                        className="btn btn-ghost btn-sm" 
                        style={{ padding: "0 4px", height: 20, minHeight: 20, marginLeft: 8, opacity: 0.4 }}
                        onClick={() => handleEditClick(f.name, "")}
                        title="Add AI definition manually"
                      >
                        <EditIcon />
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--text-muted)", padding: "20px 0" }}>No columns match</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>
        {visible.length} of {fields.length} column{fields.length !== 1 ? "s" : ""}
      </div>
    </div>
  );
}

// ── Metrics table ─────────────────────────────────────────────────────────────
function MetricsTable({ metrics, onSaveMetrics }) {
  const [localMetrics, setLocalMetrics] = useState([...(metrics || [])]);
  const [editingIdx, setEditingIdx] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editingIdx === null) setLocalMetrics([...(metrics || [])]);
  }, [metrics, editingIdx]);

  const METRIC_TYPES = ["count", "countDistinct", "sum", "average", "min", "max", "number"];

  const handleEdit = (idx) => {
    setEditingIdx(idx);
    setDraft({ ...localMetrics[idx] });
  };

  const handleAdd = () => {
    const newMetrics = [...localMetrics, { name: "", type: "count", column: "", definition: "" }];
    setLocalMetrics(newMetrics);
    setEditingIdx(newMetrics.length - 1);
    setDraft({ name: "", type: "count", column: "", definition: "" });
  };

  const handleDelete = async (idx) => {
    if (!confirm("Delete this metric?")) return;
    const newMetrics = localMetrics.filter((_, i) => i !== idx);
    setLocalMetrics(newMetrics);
    setSaving(true);
    await onSaveMetrics(newMetrics);
    setSaving(false);
  };

  const handleSave = async (idx) => {
    const newMetrics = [...localMetrics];
    newMetrics[idx] = draft;
    setLocalMetrics(newMetrics);
    setSaving(true);
    await onSaveMetrics(newMetrics);
    setSaving(false);
    setEditingIdx(null);
  };

  const handleCancel = (idx) => {
    setEditingIdx(null);
    if (!localMetrics[idx].name && !localMetrics[idx].definition) {
      setLocalMetrics(localMetrics.filter((_, i) => i !== idx));
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {localMetrics.length === 0 ? (
        <div style={{
          textAlign: "center", padding: "32px 16px",
          color: "var(--text-muted)", fontSize: 13,
        }}>
          <div style={{ fontSize: 32, marginBottom: 10, opacity: 0.4 }}>📊</div>
          No metrics yet. Click <strong>Auto-generate Metrics</strong> or <strong>Add Metric</strong> to create one.
        </div>
      ) : (
        <div className="schema-scroll">
          <table className="schema-table">
            <thead>
              <tr>
                <th>#</th>
                <th style={{ width: "25%" }}>Metric Name</th>
                <th style={{ width: "15%" }}>Type</th>
                <th style={{ width: "25%" }}>Column (SQL)</th>
                <th style={{ width: "25%" }}>Definition</th>
                <th style={{ width: 80, textAlign: "center" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {localMetrics.map((m, i) => (
                <tr key={i}>
                  <td className="schema-idx">{i + 1}</td>
                  {editingIdx === i ? (
                    <>
                      <td><input className="input" style={{ width: "100%", fontSize: 13, padding: "4px 8px" }} value={draft.name} onChange={(e) => setDraft({...draft, name: e.target.value})} placeholder="e.g. total_revenue" autoFocus/></td>
                      <td>
                        <select className="input" style={{ width: "100%", fontSize: 13, padding: "4px 8px" }} value={draft.type} onChange={(e) => setDraft({...draft, type: e.target.value})}>
                          {METRIC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </td>
                      <td><input className="input" style={{ width: "100%", fontFamily: "monospace", fontSize: 13, padding: "4px 8px" }} value={draft.column || ""} onChange={(e) => setDraft({...draft, column: e.target.value})} placeholder="e.g. amount * rate"/></td>
                      <td><input className="input" style={{ width: "100%", fontSize: 13, padding: "4px 8px" }} value={draft.definition || ""} onChange={(e) => setDraft({...draft, definition: e.target.value})} placeholder="Description..."/></td>
                      <td style={{ whiteSpace: "nowrap", textAlign: "center" }}>
                         <button className="btn btn-primary btn-sm btn-icon" onClick={() => handleSave(i)} disabled={saving} title="Save" style={{ marginRight: 4 }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg></button>
                         <button className="btn btn-ghost btn-sm btn-icon" onClick={() => handleCancel(i)} disabled={saving} title="Cancel"><CloseIcon /></button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="schema-col-name" style={{ color: "var(--text-primary)" }}>{m.name}</td>
                      <td><TypePill type={(m.type || "").toUpperCase()} /></td>
                      <td>
                        <span style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-secondary)" }}>
                          {m.column || "—"}
                        </span>
                      </td>
                      <td className="schema-col-desc">{m.definition}</td>
                      <td style={{ whiteSpace: "nowrap", textAlign: "center" }}>
                         <button className="btn btn-ghost btn-sm btn-icon" style={{ opacity: 0.6, marginRight: 4 }} onClick={() => handleEdit(i)} disabled={editingIdx !== null} title="Edit"><EditIcon /></button>
                         <button className="btn btn-ghost btn-sm btn-icon" style={{ opacity: 0.6, color: "var(--red-500)" }} onClick={() => handleDelete(i)} disabled={editingIdx !== null} title="Delete"><CloseIcon /></button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button className="btn btn-secondary btn-sm" onClick={handleAdd} disabled={editingIdx !== null || saving}>
          + Add Metric
        </button>
      </div>
    </div>
  );
}

// ── Main TableDetail component ────────────────────────────────────────────────
export default function TableDetail({ connId, datasetId, table, onClose }) {
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);

  // Definition edit state
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  // Schema sync state
  const [syncing, setSyncing] = useState(false);
  
  // AI Generate state
  const [generatingCols, setGeneratingCols] = useState(false);
  const [generatingMetrics, setGeneratingMetrics] = useState(false);
  const [generatingCubeModel, setGeneratingCubeModel] = useState(false);

  // Cube model state
  const [cubeModelEditing, setCubeModelEditing] = useState(false);
  const [cubeModelDraft, setCubeModelDraft] = useState("");
  const [cubeModelSaving, setCubeModelSaving] = useState(false);

  // Load meta on mount / table change
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setEditing(false);
    setCubeModelEditing(false);
    getTableMeta(connId, datasetId, table.table_id)
      .then((res) => {
        if (cancelled) return;
        setMeta(res.data);
        setDraft(res.data.definition || "");
        setCubeModelDraft(res.data.cube_model || "");
      })
      .catch((err) => {
        if (cancelled) return;
        toast.error(`Failed to load table metadata: ${err.response?.data?.detail || err.message}`);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [connId, datasetId, table.table_id]);

  const handleSaveDefinition = async () => {
    setSaving(true);
    try {
      const res = await upsertTableMeta(connId, datasetId, table.table_id, {
        definition: draft.trim() || null,
      });
      setMeta(res.data);
      setDraft(res.data.definition || "");
      toast.success("Table definition saved.");
      setEditing(false);
    } catch (err) {
      toast.error(`Save failed: ${err.response?.data?.detail || err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleSyncSchema = async () => {
    setSyncing(true);
    try {
      const res = await syncTableSchema(connId, datasetId, table.table_id);
      setMeta(res.data);
      toast.success(`Schema synced — ${res.data.bq_schema?.fields?.length ?? 0} column(s) loaded.`);
    } catch (err) {
      toast.error(`Schema sync failed: ${err.response?.data?.detail || err.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleGenerateColumns = async () => {
    if (!meta?.definition) {
      toast.warning("Please add a table definition to use the auto-generate option.");
      return;
    }
    setGeneratingCols(true);
    try {
      const res = await generateColumnDefs(connId, datasetId, table.table_id);
      setMeta(res.data);
      toast.success("AI generated column definitions successfully.");
    } catch (err) {
      toast.error(`Auto-generate failed: ${err.response?.data?.detail || err.message}`);
    } finally {
      setGeneratingCols(false);
    }
  };

  const handleUpdateAiDesc = async (colName, aiDesc) => {
    try {
      const res = await updateColumnAiDefinition(connId, datasetId, table.table_id, colName, aiDesc);
      setMeta(res.data);
      toast.success("AI description updated.");
    } catch (err) {
      toast.error(`Update failed: ${err.response?.data?.detail || err.message}`);
    }
  };

  const handleGenerateMetrics = async () => {
    if (!meta?.definition) {
      toast.warning("Please add a table definition to use the auto-generate option.");
      return;
    }
    setGeneratingMetrics(true);
    try {
      const res = await generateTableMetrics(connId, datasetId, table.table_id);
      setMeta(res.data);
      toast.success("AI generated metrics successfully.");
    } catch (err) {
      toast.error(`Auto-generate metrics failed: ${err.response?.data?.detail || err.message}`);
    } finally {
      setGeneratingMetrics(false);
    }
  };

  const handleSaveMetrics = async (newMetrics) => {
    try {
      const res = await updateMetrics(connId, datasetId, table.table_id, newMetrics);
      setMeta(res.data);
      toast.success("Metrics updated");
    } catch (err) {
      toast.error(`Metrics update failed: ${err.response?.data?.detail || err.message}`);
      throw err;
    }
  };

  const handleGenerateCubeModel = async () => {
    if (!meta?.definition) {
      toast.warning("Please add a table definition to use the auto-generate option.");
      return;
    }
    setGeneratingCubeModel(true);
    try {
      const res = await generateCubeModel(connId, datasetId, table.table_id);
      setMeta(res.data);
      setCubeModelDraft(res.data.cube_model || "");
      toast.success("AI generated Cube Model successfully.");
    } catch (err) {
      toast.error(`Auto-generate Cube Model failed: ${err.response?.data?.detail || err.message}`);
    } finally {
      setGeneratingCubeModel(false);
    }
  };

  const handleSaveCubeModel = async () => {
    setCubeModelSaving(true);
    try {
      const res = await updateCubeModel(connId, datasetId, table.table_id, cubeModelDraft);
      setMeta(res.data);
      setCubeModelDraft(res.data.cube_model || "");
      toast.success("Cube model saved.");
      setCubeModelEditing(false);
    } catch (err) {
      toast.error(`Cube model save failed: ${err.response?.data?.detail || err.message}`);
    } finally {
      setCubeModelSaving(false);
    }
  };

  const fields = meta?.bq_schema?.fields ?? [];
  const syncedAt = meta?.schema_synced_at
    ? new Date(meta.schema_synced_at).toLocaleString()
    : null;

  return (
    <div className="table-detail-panel">
      {/* ── Header ── */}
      <div className="table-detail-header">
        <div className="table-detail-title-row">
          <div className="table-detail-name">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--red-500)" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <path d="M3 9h18M3 15h18M9 3v18"/>
            </svg>
            {table.table_id}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {table.table_type && table.table_type !== "TABLE" && (
              <span className="table-type-badge">{table.table_type}</span>
            )}
            <button
              id="sync-schema-btn"
              className="btn btn-secondary btn-sm"
              onClick={handleSyncSchema}
              disabled={syncing}
              title="Pull schema from BigQuery and cache it"
            >
              {syncing ? <span className="spinner" style={{ width: 13, height: 13 }} /> : <SyncIcon />}
              {syncing ? "Syncing…" : "Sync Schema"}
            </button>
            <button
              id="close-table-detail-btn"
              className="btn btn-ghost btn-sm btn-icon"
              onClick={onClose}
              title="Close"
            >
              <CloseIcon />
            </button>
          </div>
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
          {datasetId} &nbsp;·&nbsp; {table.full_name || `${datasetId}.${table.table_id}`}
        </div>
      </div>

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
          <span className="spinner" />
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

          {/* ── Table Definition ── */}
          <div className="card">
            <div className="section-header">
              <div className="section-title">
                <BookIcon />
                Table Definition
              </div>
              {!editing && (
                <button
                  id="edit-table-definition-btn"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setEditing(true)}
                >
                  <EditIcon /> Edit
                </button>
              )}
            </div>

            {editing ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <textarea
                  id="table-definition-textarea"
                  className="input textarea"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Describe this table — e.g. what it stores, how it's populated, who uses it…"
                  rows={5}
                  style={{ resize: "vertical", minHeight: 100, fontFamily: "inherit", fontSize: 14 }}
                  autoFocus
                />
                <div style={{ display: "flex", gap: 8 }}>
                  <button id="save-table-def-btn" className="btn btn-primary btn-sm" onClick={handleSaveDefinition} disabled={saving}>
                    {saving ? <span className="spinner" style={{ width: 13, height: 13 }} /> : null}
                    {saving ? "Saving…" : "Save"}
                  </button>
                  <button id="cancel-table-def-btn" className="btn btn-ghost btn-sm" onClick={() => { setDraft(meta?.definition || ""); setEditing(false); }} disabled={saving}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div style={{
                fontSize: 14, lineHeight: 1.7, whiteSpace: "pre-wrap",
                color: meta?.definition ? "var(--text-primary)" : "var(--text-secondary)",
                minHeight: 36,
              }}>
                {meta?.definition || (
                  <span style={{ fontStyle: "italic" }}>
                    No definition yet. Click <strong>Edit</strong> to add one.
                  </span>
                )}
              </div>
            )}
          </div>

          {/* ── Schema ── */}
          <div className="card">
            <div className="section-header">
              <div className="section-title">
                <SchemaIcon />
                Schema
                {fields.length > 0 && (
                  <span className="badge badge-info">{fields.length} columns</span>
                )}
              </div>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <div
                  onClick={() => {
                    if (!meta?.definition) {
                      toast.warning("Please add a table definition to use the auto-generate option.");
                    }
                  }}
                  title={!meta?.definition ? "Please add a table definition to use the auto-generate option." : "Auto-generate column definitions"}
                >
                  <button
                    id="auto-generate-columns-btn"
                    className="btn btn-secondary btn-sm"
                    onClick={handleGenerateColumns}
                    disabled={!meta?.definition || generatingCols}
                    style={{ pointerEvents: !meta?.definition ? "none" : "auto" }}
                  >
                    {generatingCols ? <span className="spinner" style={{ width: 13, height: 13 }} /> : <SparklesIcon />}
                    {generatingCols ? "Generating…" : "Auto-generate column definitions"}
                  </button>
                </div>
                {syncedAt && (
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    Synced {syncedAt}
                  </span>
                )}
              </div>
            </div>

            {fields.length > 0 ? (
              <SchemaTable fields={fields} onUpdateAiDesc={handleUpdateAiDesc} />
            ) : (
              <div style={{
                textAlign: "center", padding: "32px 16px",
                color: "var(--text-muted)", fontSize: 13,
              }}>
                <div style={{ fontSize: 32, marginBottom: 10, opacity: 0.4 }}>🗂️</div>
                No schema cached yet.<br />
                Click <strong>Sync Schema</strong> to pull column definitions from BigQuery.
              </div>
            )}
          </div>

          {/* ── Metrics ── */}
          <div className="card">
            <div className="section-header">
              <div className="section-title">
                <ChartIcon />
                Metrics Recommendations
                {meta?.metrics && meta.metrics.length > 0 && (
                  <span className="badge badge-info">{meta.metrics.length} metrics</span>
                )}
              </div>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <div
                  onClick={() => {
                    if (!meta?.definition) {
                      toast.warning("Please add a table definition to use the auto-generate option.");
                    } else if (!fields || fields.length === 0) {
                      toast.warning("Please sync schema first.");
                    }
                  }}
                  title={!meta?.definition ? "Please add a table definition" : (!fields || fields.length === 0) ? "Please sync schema first" : "Auto-generate table metrics"}
                >
                  <button
                    id="auto-generate-metrics-btn"
                    className="btn btn-secondary btn-sm"
                    onClick={handleGenerateMetrics}
                    disabled={!meta?.definition || fields.length === 0 || generatingMetrics}
                    style={{ pointerEvents: (!meta?.definition || fields.length === 0) ? "none" : "auto" }}
                  >
                    {generatingMetrics ? <span className="spinner" style={{ width: 13, height: 13 }} /> : <SparklesIcon />}
                    {generatingMetrics ? "Generating…" : "Auto-generate Metrics"}
                  </button>
                </div>
              </div>
            </div>

            <MetricsTable metrics={meta?.metrics || []} onSaveMetrics={handleSaveMetrics} />
          </div>

          {/* ── Cube Model ── */}
          <div className="card">
            <div className="section-header">
              <div className="section-title">
                <CubeIcon />
                Cube.js Semantic Model
              </div>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                {!cubeModelEditing && meta?.cube_model && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setCubeModelEditing(true)}
                  >
                    <EditIcon /> Edit Model
                  </button>
                )}
                <div
                  onClick={() => {
                    if (!meta?.definition) {
                      toast.warning("Please add a table definition to use the auto-generate option.");
                    } else if (!fields || fields.length === 0) {
                      toast.warning("Please sync schema first.");
                    }
                  }}
                  title={!meta?.definition ? "Please add a table definition" : (!fields || fields.length === 0) ? "Please sync schema first" : "Auto-generate cube model"}
                >
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={handleGenerateCubeModel}
                    disabled={!meta?.definition || fields.length === 0 || generatingCubeModel}
                    style={{ pointerEvents: (!meta?.definition || fields.length === 0) ? "none" : "auto" }}
                  >
                    {generatingCubeModel ? <span className="spinner" style={{ width: 13, height: 13 }} /> : <SparklesIcon />}
                    {generatingCubeModel ? "Generating…" : "Auto-generate Cube Model"}
                  </button>
                </div>
              </div>
            </div>

            {cubeModelEditing ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
                <textarea
                  className="input textarea"
                  value={cubeModelDraft}
                  onChange={(e) => setCubeModelDraft(e.target.value)}
                  placeholder="cube(`users`, {
  sql_table: `users`,
  ...
})"
                  rows={20}
                  style={{ resize: "vertical", minHeight: 200, fontFamily: "monospace", fontSize: 13, lineHeight: 1.5, tabSize: 2 }}
                />
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-primary btn-sm" onClick={handleSaveCubeModel} disabled={cubeModelSaving}>
                    {cubeModelSaving ? <span className="spinner" style={{ width: 13, height: 13 }} /> : null}
                    {cubeModelSaving ? "Saving…" : "Save"}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => { setCubeModelDraft(meta?.cube_model || ""); setCubeModelEditing(false); }} disabled={cubeModelSaving}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : meta?.cube_model ? (
              <pre style={{
                fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap", overflowX: "auto",
                background: "var(--bg-card)", padding: 16, borderRadius: 6, border: "1px solid var(--border)",
                color: "var(--text-primary)", marginTop: 10, fontFamily: "monospace"
              }}>
                {meta?.cube_model}
              </pre>
            ) : (
              <div style={{
                textAlign: "center", padding: "32px 16px",
                color: "var(--text-muted)", fontSize: 13, marginTop: 10
              }}>
                <div style={{ fontSize: 32, marginBottom: 10, opacity: 0.4 }}>🧊</div>
                No Cube.js model generated yet.<br />
                Click <strong>Auto-generate Cube Model</strong> to build one.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
