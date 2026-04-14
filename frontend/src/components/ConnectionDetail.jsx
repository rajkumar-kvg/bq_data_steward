import { useState, useEffect } from "react";
import { toast } from "react-toastify";
import { testConnection, testCubeConnection, getDatasets, syncDatasets, deleteConnection, updateDefinition } from "../api";
import DatasetPanel from "./DatasetPanel";
import TableDetail from "./TableDetail";
import KPIDashboard from "./KPIDashboard";

function BqIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
  );
}

function BookIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 19.5A2.5 2.5 0 016.5 17H20"/>
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/>
    </svg>
  );
}

// ── Connection-level business definition panel ────────────────────────────────
function BusinessDefinitionPanel({ conn }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(conn.business_definition || "");
  const [saving, setSaving] = useState(false);

  const [lastId, setLastId] = useState(conn.id);
  if (conn.id !== lastId) {
    setLastId(conn.id);
    setDraft(conn.business_definition || "");
    setEditing(false);
  }

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await updateDefinition(conn.id, draft.trim() || null);
      conn.business_definition = res.data.business_definition;
      setDraft(res.data.business_definition || "");
      toast.success("Business definition saved.");
      setEditing(false);
    } catch (err) {
      toast.error(`Save failed: ${err.response?.data?.detail || err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card">
      <div className="section-header">
        <div className="section-title">
          <BookIcon />
          Business Definition
        </div>
        {!editing && (
          <button id="edit-definition-btn" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
            <EditIcon /> Edit
          </button>
        )}
      </div>

      {editing ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <textarea
            id="definition-edit-textarea"
            className="input textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Describe the business context for this connection…"
            rows={6}
            style={{ resize: "vertical" }}
            autoFocus
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button id="save-definition-btn" className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
              {saving ? <span className="spinner" /> : null}
              {saving ? "Saving…" : "Save"}
            </button>
            <button id="cancel-definition-btn" className="btn btn-ghost btn-sm" onClick={() => { setDraft(conn.business_definition || ""); setEditing(false); }} disabled={saving}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div id="definition-display" style={{
          fontSize: 14, lineHeight: 1.7,
          color: conn.business_definition ? "var(--text-primary)" : "var(--text-secondary)",
          whiteSpace: "pre-wrap", minHeight: 40,
        }}>
          {conn.business_definition || (
            <span style={{ fontStyle: "italic" }}>No business definition yet. Click <strong>Edit</strong> to add one.</span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main ConnectionDetail ─────────────────────────────────────────────────────
export default function ConnectionDetail({ conn, onDeleted }) {
  const [testResult, setTestResult] = useState(null);
  const [testLoading, setTestLoading] = useState(false);
  const [cubeTestLoading, setCubeTestLoading] = useState(false);
  const [datasets, setDatasets] = useState([]);
  const [datasetsLoading, setDatasetsLoading] = useState(false);
  const [datasetsLoaded, setDatasetsLoaded] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("schema");

  // Selected table for TableDetail panel
  const [selectedDatasetId, setSelectedDatasetId] = useState(null);
  const [selectedTable, setSelectedTable] = useState(null);

  // Reset state when connection changes
  const [currentId, setCurrentId] = useState(conn.id);
  if (conn.id !== currentId) {
    setCurrentId(conn.id);
    setTestResult(null);
    setDatasets([]);
    setDatasetsLoaded(false);
    setSelectedTable(null);
    setSelectedDatasetId(null);
  }

  const handleTest = async () => {
    setTestLoading(true);
    setTestResult(null);
    try {
      const res = await testConnection(conn.id);
      setTestResult(res.data);
      if (res.data.success) toast.success("Connection verified ✓");
      else toast.error("Connection failed");
    } catch (err) {
      const msg = err.response?.data?.detail || err.message;
      setTestResult({ success: false, message: msg });
      toast.error(`Test failed: ${msg}`);
    } finally {
      setTestLoading(false);
    }
  };

  const handleCubeTest = async () => {
    setCubeTestLoading(true);
    setTestResult(null);
    try {
      const res = await testCubeConnection(conn.id);
      setTestResult(res.data);
      if (res.data.success) toast.success("Cube connection verified ✓");
      else toast.error("Cube connection failed");
    } catch (err) {
      const msg = err.response?.data?.detail || err.message;
      setTestResult({ success: false, message: msg });
      toast.error(`Cube test failed: ${msg}`);
    } finally {
      setCubeTestLoading(false);
    }
  };

  useEffect(() => {
    // Automatically load datasets when connection changes
    let mounted = true;
    const fetchDatasets = async () => {
      setDatasetsLoading(true);
      try {
        const res = await getDatasets(conn.id);
        if (mounted) {
          setDatasets(res.data);
          setDatasetsLoaded(true);
        }
      } catch (err) {
        if (mounted) {
          toast.error(`Failed to load datasets: ${err.response?.data?.detail || err.message}`);
        }
      } finally {
        if (mounted) {
          setDatasetsLoading(false);
        }
      }
    };
    fetchDatasets();
    return () => { mounted = false; };
  }, [conn.id]);

  const handleSyncDatasets = async () => {
    setDatasetsLoading(true);
    try {
      const res = await syncDatasets(conn.id);
      setDatasets(res.data);
      setDatasetsLoaded(true);
      toast.success(`Synced ${res.data.length} dataset(s)`);
    } catch (err) {
      toast.error(`Failed to sync datasets: ${err.response?.data?.detail || err.message}`);
    } finally {
      setDatasetsLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete connection "${conn.name}"?`)) return;
    setDeleteLoading(true);
    try {
      await deleteConnection(conn.id);
      toast.success(`Deleted "${conn.name}"`);
      onDeleted(conn.id);
    } catch (err) {
      toast.error(`Delete failed: ${err.response?.data?.detail || err.message}`);
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleTableSelect = (datasetId, table) => {
    if (selectedTable?.table_id === table.table_id && selectedDatasetId === datasetId) {
      // Clicking the same table closes the panel
      setSelectedTable(null);
      setSelectedDatasetId(null);
    } else {
      setSelectedDatasetId(datasetId);
      setSelectedTable(table);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Hero */}
      <div className="conn-hero">
        <div className="conn-hero-icon"><BqIcon /></div>
        <div>
          <div className="conn-hero-name">{conn.name}</div>
          <div className="conn-hero-project">{conn.project_id}</div>
          <div className="text-muted text-sm mt-4">
            Added {new Date(conn.created_at).toLocaleDateString("en-US", {
              year: "numeric", month: "short", day: "numeric",
            })}
          </div>
        </div>
        <div className="conn-hero-actions">
          <button id="test-conn-btn" className="btn btn-primary btn-sm" onClick={handleTest} disabled={testLoading}>
            {testLoading ? <span className="spinner" /> : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            )}
            {testLoading ? "Testing…" : "Test Connection"}
          </button>
          <button id="test-cube-btn" className="btn btn-secondary btn-sm" onClick={handleCubeTest} disabled={cubeTestLoading}>
            {cubeTestLoading ? <span className="spinner" /> : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
            )}
            {cubeTestLoading ? "Testing Cube…" : "Test Cube Service"}
          </button>
          <button id="list-datasets-btn" className="btn btn-secondary btn-sm" onClick={handleSyncDatasets} disabled={datasetsLoading}>
            {datasetsLoading ? <span className="spinner" /> : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M21 2v6h-6"/><path d="M3 12a9 9 0 101.49-4.96L2 9"/>
                <path d="M3 22v-6h6"/><path d="M21 12a9 9 0 10-1.49 4.96L22 15"/>
              </svg>
            )}
            {datasetsLoading ? "Syncing…" : "Sync Datasets"}
          </button>
          <button id="delete-conn-btn" className="btn btn-ghost btn-sm" onClick={handleDelete} disabled={deleteLoading}>
            {deleteLoading ? <span className="spinner" /> : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
                <path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
              </svg>
            )}
            Delete
          </button>
        </div>
      </div>

      {/* Test result */}
      {testResult && (
        <div className={`badge ${testResult.success ? "badge-success" : "badge-error"}`} style={{ width: "fit-content" }}>
          {testResult.success ? "✓" : "✗"} {testResult.message}
        </div>
      )}

      {/* Business Definition */}
      <BusinessDefinitionPanel conn={conn} />

      {/* Tabs */}
      <div style={{ display: "flex", gap: 16, borderBottom: "1px solid var(--border)", paddingBottom: 10 }}>
        <button 
          className={`btn btn-sm ${activeTab === "schema" ? "btn-primary" : "btn-ghost"}`} 
          onClick={() => setActiveTab("schema")}
        >
          Schema & Data
        </button>
        <button 
          className={`btn btn-sm ${activeTab === "dashboard" ? "btn-primary" : "btn-ghost"}`} 
          onClick={() => setActiveTab("dashboard")}
        >
          KPI Dashboards
        </button>
      </div>

      {/* Datasets + Table Detail — side-by-side when a table is selected */}
      {activeTab === "schema" && datasetsLoaded && (
        <div className={selectedTable ? "datasets-split" : ""}>

          {/* Left: Datasets accordion */}
          <div className="card datasets-left">
            <div className="section-header">
              <div className="section-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <ellipse cx="12" cy="5" rx="9" ry="3"/>
                  <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
                  <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
                </svg>
                Datasets
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="badge badge-info">{datasets.length}</span>
                {selectedTable && (
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    Click table to deselect
                  </span>
                )}
              </div>
            </div>
            <DatasetPanel
              connId={conn.id}
              datasets={datasets}
              selectedTableId={selectedTable?.table_id}
              onTableSelect={handleTableSelect}
            />
          </div>

          {/* Right: Table Detail panel — only shown when table selected */}
          {selectedTable && (
            <div className="table-detail-right">
              <TableDetail
                key={`${selectedDatasetId}.${selectedTable.table_id}`}
                connId={conn.id}
                datasetId={selectedDatasetId}
                table={selectedTable}
                onClose={() => { setSelectedTable(null); setSelectedDatasetId(null); }}
              />
            </div>
          )}
        </div>
      )}

      {/* KPI Dashboards */}
      {activeTab === "dashboard" && (
        <div className="card" style={{ padding: 24 }}>
          <KPIDashboard connId={conn.id} />
        </div>
      )}
    </div>
  );
}
