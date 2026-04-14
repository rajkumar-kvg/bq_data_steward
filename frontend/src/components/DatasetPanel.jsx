import { useState } from "react";
import { toast } from "react-toastify";
import { getTables } from "../api";

function TableIcon() {
  return (
    <svg className="table-item-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <path d="M3 9h18M3 15h18M9 3v18"/>
    </svg>
  );
}

function DatasetIcon() {
  return (
    <svg className="dataset-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <ellipse cx="12" cy="5" rx="9" ry="3"/>
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
    </svg>
  );
}

function ChevronIcon({ open }) {
  return (
    <svg className={`chevron${open ? " open" : ""}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M9 18l6-6-6-6"/>
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      style={{ marginLeft: "auto", flexShrink: 0, opacity: 0, transition: "opacity 0.15s" }}
      className="table-arrow"
    >
      <path d="M5 12h14M12 5l7 7-7 7"/>
    </svg>
  );
}

function DatasetRow({ connId, dataset, selectedTableId, onTableSelect }) {
  const [open, setOpen] = useState(false);
  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const handleToggle = async () => {
    if (!open && !loaded) {
      setLoading(true);
      try {
        const res = await getTables(connId, dataset.dataset_id);
        setTables(res.data);
        setLoaded(true);
      } catch (err) {
        toast.error(`Failed to load tables: ${err.response?.data?.detail || err.message}`);
      } finally {
        setLoading(false);
      }
    }
    setOpen((v) => !v);
  };

  return (
    <div className="dataset-item">
      <div className="dataset-header" onClick={handleToggle} id={`dataset-${dataset.dataset_id}`}>
        <div className="dataset-header-left">
          <DatasetIcon />
          <span className="dataset-name">{dataset.dataset_id}</span>
          {dataset.location && (
            <span className="dataset-location">({dataset.location})</span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {loading && <span className="spinner" style={{ width: 14, height: 14 }} />}
          {!loading && loaded && (
            <span className="badge badge-info" style={{ fontSize: 10 }}>
              {tables.length} table{tables.length !== 1 ? "s" : ""}
            </span>
          )}
          <ChevronIcon open={open} />
        </div>
      </div>

      {open && (
        <div className="table-list">
          {tables.length === 0 ? (
            <div className="text-muted text-sm" style={{ padding: "8px 10px" }}>No tables found</div>
          ) : (
            tables.map((tbl) => {
              const isSelected = selectedTableId === tbl.table_id;
              return (
                <div
                  className={`table-item clickable${isSelected ? " selected" : ""}`}
                  key={tbl.table_id}
                  id={`table-${tbl.table_id}`}
                  onClick={() => onTableSelect(dataset.dataset_id, tbl)}
                  title={`Open ${tbl.table_id}`}
                >
                  <TableIcon />
                  <span className="table-item-name">{tbl.table_id}</span>
                  {tbl.table_type && tbl.table_type !== "TABLE" && (
                    <span className="table-type-badge">{tbl.table_type}</span>
                  )}
                  <ArrowIcon />
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

export default function DatasetPanel({ connId, datasets, selectedTableId, onTableSelect }) {
  if (datasets.length === 0) {
    return (
      <div className="text-muted text-sm" style={{ padding: "12px 0" }}>
        No datasets found in this project.
      </div>
    );
  }

  return (
    <div className="dataset-list">
      {datasets.map((ds) => (
        <DatasetRow
          key={ds.dataset_id}
          connId={connId}
          dataset={ds}
          selectedTableId={selectedTableId}
          onTableSelect={onTableSelect}
        />
      ))}
    </div>
  );
}
