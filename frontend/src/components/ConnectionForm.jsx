import { useState, useCallback } from "react";
import { toast } from "react-toastify";
import { createConnection } from "../api";

const PLACEHOLDER = `{
  "type": "service_account",
  "project_id": "your-project-id",
  "private_key_id": "...",
  "private_key": "-----BEGIN RSA PRIVATE KEY-----\\n...\\n-----END RSA PRIVATE KEY-----\\n",
  "client_email": "...",
  ...
}`;

export default function ConnectionForm({ onCreated }) {
  const [name, setName] = useState("");
  const [businessDefinition, setBusinessDefinition] = useState("");
  const [jsonText, setJsonText] = useState("");
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);

  const parseAndSetJson = (text) => {
    setJsonText(text);
  };

  const handleFile = useCallback((file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => parseAndSetJson(e.target.result);
    reader.readAsText(file);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    handleFile(file);
  }, [handleFile]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) { toast.error("Please enter a connection name."); return; }
    if (!jsonText.trim()) { toast.error("Please provide the service account JSON."); return; }

    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      toast.error("Invalid JSON — please check your service account file.");
      return;
    }

    setLoading(true);
    try {
      const res = await createConnection({
        name: name.trim(),
        credentials: parsed,
        business_definition: businessDefinition.trim() || null,
      });
      toast.success(`Connection "${res.data.name}" saved!`);
      setName("");
      setBusinessDefinition("");
      setJsonText("");
      onCreated(res.data);
    } catch (err) {
      const msg = err.response?.data?.detail || err.message;
      toast.error(`Error: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card" style={{ maxWidth: 680 }}>
      <div className="card-title">New BigQuery Connection</div>
      <div className="card-subtitle">
        Paste your service account JSON key or upload the file to connect to BigQuery.
      </div>

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="label">Connection Name</label>
          <input
            id="conn-name"
            className="input"
            placeholder="e.g. Production Analytics"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label className="label">Business Definition <span style={{ color: "var(--text-muted, #888)", fontWeight: 400, fontSize: 12 }}>(optional)</span></label>
          <textarea
            id="business-definition-input"
            className="input textarea"
            placeholder="Describe the business context for this connection — e.g. what data it contains, who uses it and for what purpose…"
            value={businessDefinition}
            onChange={(e) => setBusinessDefinition(e.target.value)}
            rows={4}
            style={{ resize: "vertical" }}
          />
        </div>

        {/* Drop zone */}
        <div
          className={`drop-zone${dragging ? " dragging" : ""}`}
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onClick={() => document.getElementById("file-input").click()}
        >
          <input
            id="file-input"
            type="file"
            accept=".json,application/json"
            onChange={(e) => handleFile(e.target.files[0])}
          />
          <div className="drop-zone-icon">📁</div>
          <div className="drop-zone-text">
            Drag & drop your <span>.json key file</span> here, or <span>click to browse</span>
          </div>
        </div>

        <div className="divider">or paste JSON below</div>

        <div className="form-group">
          <label className="label">Service Account JSON</label>
          <textarea
            id="json-input"
            className="input textarea"
            placeholder={PLACEHOLDER}
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            spellCheck={false}
          />
        </div>

        <button id="create-conn-btn" className="btn btn-primary" type="submit" disabled={loading}>
          {loading ? <span className="spinner" /> : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          )}
          {loading ? "Saving…" : "Save Connection"}
        </button>
      </form>
    </div>
  );
}
