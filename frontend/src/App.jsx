import { useState, useEffect } from "react";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import "./index.css";
import { listConnections } from "./api";
import ConnectionForm from "./components/ConnectionForm";
import ConnectionDetail from "./components/ConnectionDetail";
import ChatInterface from "./components/ChatInterface";

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M12 5v14M5 12h14"/>
    </svg>
  );
}

function LogoIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
      <path d="M10 11v6M14 11v6M9 6V4h6v2"/>
    </svg>
  );
}

function ChatBubbleIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function ViewTabs({ view, onChange }) {
  return (
    <div style={{
      display: "inline-flex",
      gap: 6,
      padding: 4,
      background: "var(--bg-card)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius)",
      alignSelf: "flex-start",
    }}>
      <button
        type="button"
        onClick={() => onChange("detail")}
        className={`btn btn-sm ${view === "detail" ? "btn-primary" : "btn-ghost"}`}
      >
        <InfoIcon />
        Details
      </button>
      <button
        type="button"
        onClick={() => onChange("chat")}
        className={`btn btn-sm ${view === "chat" ? "btn-primary" : "btn-ghost"}`}
      >
        <ChatBubbleIcon />
        Chat
      </button>
    </div>
  );
}

export default function App() {
  const [connections, setConnections] = useState([]);
  const [selected, setSelected] = useState(null); // selected connection or "new"
  const [view, setView] = useState("detail"); // "detail" | "chat"
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listConnections()
      .then((res) => {
        setConnections(res.data);
        if (res.data.length === 0) {
          setSelected("new");
        } else {
          setSelected((current) => current ?? res.data[0]);
        }
      })
      .catch(() => toast.error("Could not reach backend."))
      .finally(() => setLoading(false));
  }, []);

  const handleCreated = (newConn) => {
    setConnections((prev) => [newConn, ...prev]);
    setSelected(newConn);
    setView("detail");
  };

  const handleDeleted = (id) => {
    const remaining = connections.filter((c) => c.id !== id);
    setConnections(remaining);
    setSelected(remaining[0] ?? "new");
    setView("detail");
  };

  const handleSelectConn = (conn) => {
    setSelected(conn);
    setView("detail");
  };

  return (
    <div className="layout">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <LogoIcon />
          <div className="sidebar-logo-text">
            BQ <span>Steward</span>
          </div>
        </div>

        <div className="sidebar-header">
          <span className="sidebar-header-label">Connections</span>
          <button
            id="add-new-btn"
            className="btn btn-primary btn-sm btn-icon"
            onClick={() => setSelected("new")}
            title="Add new connection"
          >
            <PlusIcon />
          </button>
        </div>

        <div className="conn-list">
          {loading ? (
            <div className="conn-empty"><span className="spinner" /></div>
          ) : connections.length === 0 ? (
            <div className="conn-empty">No connections yet.<br />Click + to add one.</div>
          ) : (
            connections.map((c) => (
              <div
                key={c.id}
                id={`conn-item-${c.id}`}
                className={`conn-item${selected?.id === c.id ? " active" : ""}`}
                onClick={() => handleSelectConn(c)}
              >
                <div className="conn-dot" />
                <div className="conn-item-info">
                  <div className="conn-item-name">{c.name}</div>
                  <div className="conn-item-project">{c.project_id}</div>
                </div>
                <button
                  className="conn-delete-btn"
                  onClick={(e) => { e.stopPropagation(); }}
                  title="Delete connection"
                >
                  <TrashIcon />
                </button>
              </div>
            ))
          )}
        </div>

        {/* ── Per-connection navigation ── */}
        {selected && selected !== "new" && (
          <div style={{ borderTop: "1px solid var(--border)", padding: "10px 10px 4px" }}>
            <div className="sidebar-header-label" style={{ padding: "4px 4px 6px", fontSize: 10 }}>
              Navigate
            </div>
            <div
              className={`conn-item${view === "detail" ? " active" : ""}`}
              onClick={() => setView("detail")}
              style={{ cursor: "pointer", gap: 8 }}
            >
              <InfoIcon />
              <span style={{ fontSize: 12, fontWeight: 500 }}>Details</span>
            </div>
            <div
              className={`conn-item${view === "chat" ? " active" : ""}`}
              onClick={() => setView("chat")}
              style={{ cursor: "pointer", gap: 8 }}
            >
              <ChatBubbleIcon />
              <span style={{ fontSize: 12, fontWeight: 500 }}>Chat</span>
            </div>
          </div>
        )}
      </aside>

      {/* ── Main ── */}
      <main className="main">
        {selected === "new" || selected === null ? (
          <>
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: -0.5, marginBottom: 4 }}>
                Add Connection
              </h1>
              <p style={{ color: "var(--text-secondary)", fontSize: 14 }}>
                Connect to BigQuery using a Google Cloud service account key.
              </p>
            </div>
            <ConnectionForm onCreated={handleCreated} />
          </>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
              <div>
                <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: -0.5, marginBottom: 4 }}>
                  {view === "chat" ? "Chat with your Data" : "Connection Details"}
                </h1>
                <p style={{ color: "var(--text-secondary)", fontSize: 14 }}>
                  {view === "chat" ? (
                    <>
                      Ask questions in plain English about <strong>{selected.name}</strong> — powered by your Cube models.
                    </>
                  ) : (
                    "Test your connection and browse datasets and tables."
                  )}
                </p>
              </div>
              <ViewTabs view={view} onChange={setView} />
            </div>

            <div style={{ display: view === "chat" ? "none" : "block" }}>
              <ConnectionDetail
                key={selected.id}
                conn={selected}
                onDeleted={handleDeleted}
              />
            </div>

            <div className="card" style={{ padding: 24, display: view === "chat" ? "block" : "none" }}>
              <ChatInterface connId={selected.id} />
            </div>
          </>
        )}
      </main>

      <ToastContainer
        position="bottom-right"
        autoClose={4000}
        hideProgressBar={false}
        closeOnClick
        pauseOnHover
        theme="dark"
      />
    </div>
  );
}
