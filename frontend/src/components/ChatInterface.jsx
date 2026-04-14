import { useState, useRef, useEffect } from "react";
import { chatQuery } from "../api";

// ── Icons ─────────────────────────────────────────────────────────────────────

function SendIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function ChevronRightIcon({ open }) {
  return (
    <svg
      width="11" height="11" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5"
      style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s ease" }}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

// ── Data table for Cube.js result rows ───────────────────────────────────────

function ResultTable({ data }) {
  if (!data || data.length === 0) {
    return (
      <div style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic", marginTop: 8 }}>
        No rows returned.
      </div>
    );
  }

  const columns = Object.keys(data[0]);
  // Strip "CubeName." prefix from header labels
  const displayCols = columns.map((c) => (c.includes(".") ? c.split(".").pop() : c));
  const rows = data.slice(0, 20);

  return (
    <div style={{ marginTop: 10, overflowX: "auto", borderRadius: 6, border: "1px solid rgba(255,255,255,0.08)" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ background: "rgba(255,255,255,0.04)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            {displayCols.map((col, i) => (
              <th
                key={i}
                style={{
                  padding: "6px 12px", textAlign: "left",
                  fontSize: 10, fontWeight: 600,
                  textTransform: "uppercase", letterSpacing: "0.5px",
                  color: "var(--text-muted)", whiteSpace: "nowrap",
                }}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              {columns.map((col, ci) => (
                <td
                  key={ci}
                  style={{
                    padding: "6px 12px", fontSize: 12,
                    color: "var(--text-secondary)",
                    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                  }}
                >
                  {row[col] === null || row[col] === undefined ? (
                    <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>null</span>
                  ) : (
                    String(row[col])
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {data.length > 20 && (
        <div style={{
          padding: "5px 12px", fontSize: 11,
          color: "var(--text-muted)", borderTop: "1px solid rgba(255,255,255,0.05)",
        }}>
          Showing 20 of {data.length} rows
        </div>
      )}
    </div>
  );
}

// ── Collapsible generated Cube query ─────────────────────────────────────────

function CollapsibleQuery({ query }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 10 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          background: "none", border: "none",
          color: "var(--text-muted)", fontSize: 11,
          cursor: "pointer", display: "flex", alignItems: "center",
          gap: 4, padding: 0, fontFamily: "inherit",
        }}
      >
        <ChevronRightIcon open={open} />
        {open ? "Hide" : "View"} generated query
      </button>
      {open && (
        <pre style={{
          marginTop: 6, padding: 12,
          background: "rgba(0,0,0,0.3)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 6, fontSize: 11,
          overflowX: "auto", color: "var(--text-secondary)",
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          lineHeight: 1.6, whiteSpace: "pre-wrap",
        }}>
          {JSON.stringify(query, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ── Single message bubble ─────────────────────────────────────────────────────

function MessageBubble({ msg }) {
  const isUser = msg.role === "user";
  const isError = !!msg.isError;

  return (
    <div style={{
      display: "flex",
      justifyContent: isUser ? "flex-end" : "flex-start",
      marginBottom: 14,
      alignItems: "flex-end",
      gap: 8,
    }}>
      {/* Bot avatar dot */}
      {!isUser && (
        <div style={{
          width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
          background: isError
            ? "linear-gradient(135deg, #7f1d1d, #991b1b)"
            : "linear-gradient(135deg, var(--red-800), var(--red-900))",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 13, marginBottom: 2,
        }}>
          ✦
        </div>
      )}

      <div style={{
        maxWidth: "78%",
        padding: "12px 16px",
        borderRadius: isUser ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
        background: isUser
          ? "linear-gradient(135deg, var(--red-700, #b91c1c), var(--red-800, #991b1b))"
          : isError
          ? "rgba(127,29,29,0.25)"
          : "var(--bg-elevated, #1a1a1a)",
        border: `1px solid ${
          isUser
            ? "transparent"
            : isError
            ? "rgba(239,68,68,0.3)"
            : "var(--border, rgba(255,255,255,0.08))"
        }`,
        fontSize: 13,
        lineHeight: 1.65,
        color: isUser ? "#fff" : isError ? "#fca5a5" : "var(--text-primary, #f1f1f1)",
      }}>
        {/* Message text */}
        <div style={{ whiteSpace: "pre-wrap" }}>{msg.content}</div>

        {/* Data table — only for bot messages with result rows */}
        {!isUser && msg.cubeResult?.data?.length > 0 && (
          <ResultTable data={msg.cubeResult.data} />
        )}

        {/* Collapsible query — only for bot messages with a generated query */}
        {!isUser && msg.cubeQuery && (
          <CollapsibleQuery query={msg.cubeQuery} />
        )}
      </div>
    </div>
  );
}

// ── Loading indicator ─────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 14, alignItems: "flex-end", gap: 8 }}>
      <div style={{
        width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
        background: "linear-gradient(135deg, var(--red-800, #991b1b), var(--red-900, #7f1d1d))",
        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13,
      }}>
        ✦
      </div>
      <div style={{
        padding: "12px 16px",
        background: "var(--bg-elevated, #1a1a1a)",
        border: "1px solid var(--border, rgba(255,255,255,0.08))",
        borderRadius: "16px 16px 16px 4px",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span className="spinner" style={{ width: 13, height: 13 }} />
        <span style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
          Querying your data…
        </span>
      </div>
    </div>
  );
}

// ── Main ChatInterface component ──────────────────────────────────────────────

const WELCOME_MSG = {
  role: "assistant",
  content: "Hello! Ask me anything about your data — I'll translate your question into a query and answer in plain language.",
  isWelcome: true,
};

export default function ChatInterface({ connId }) {
  const [messages, setMessages] = useState([WELCOME_MSG]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  // Reset conversation when connection changes
  const prevConnIdRef = useRef(connId);
  useEffect(() => {
    if (connId !== prevConnIdRef.current) {
      prevConnIdRef.current = connId;
      setMessages([WELCOME_MSG]);
      setInput("");
    }
  }, [connId]);

  // Auto-scroll to bottom whenever messages or loading state changes
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Build history array for the API — exclude welcome message, strip UI-only fields
  const buildHistory = () =>
    messages
      .filter((m) => !m.isWelcome)
      .map((m) => ({ role: m.role, content: m.content }))
      .slice(-20); // cap to last 20 turns to stay within context limits

  const handleNewChat = () => {
    setMessages([WELCOME_MSG]);
    setInput("");
    textareaRef.current?.focus();
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    textareaRef.current?.focus();

    try {
      const res = await chatQuery(connId, text, buildHistory());
      const data = res.data;
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.answer,
          cubeQuery: data.cube_query || null,
          cubeResult: data.cube_result || null,
          isError: !!data.error,
        },
      ]);
    } catch (err) {
      const detail = err.response?.data?.detail || err.message || "Unknown error";
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Something went wrong: ${detail}`,
          isError: true,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "calc(100vh - 260px)",
      minHeight: 500,
    }}>
      <div style={{
        display: "flex",
        justifyContent: "flex-end",
        paddingBottom: 10,
      }}>
        <button
          type="button"
          onClick={handleNewChat}
          disabled={loading}
          className="btn btn-ghost btn-sm"
        >
          New chat
        </button>
      </div>

      {/* ── Message thread ── */}
      <div style={{
        flex: 1,
        overflowY: "auto",
        padding: "8px 2px 4px",
        display: "flex",
        flexDirection: "column",
      }}>
        {messages.map((msg, i) => (
          <MessageBubble key={i} msg={msg} />
        ))}

        {loading && <TypingIndicator />}

        <div ref={bottomRef} />
      </div>

      {/* ── Input row ── */}
      <div style={{
        borderTop: "1px solid var(--border, rgba(255,255,255,0.08))",
        paddingTop: 14,
        display: "flex",
        gap: 10,
        alignItems: "flex-end",
      }}>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask a question about your data… (Enter to send, Shift+Enter for new line)"
          disabled={loading}
          rows={2}
          style={{
            flex: 1,
            background: "var(--bg-elevated, #1a1a1a)",
            border: "1px solid var(--border, rgba(255,255,255,0.08))",
            borderRadius: "var(--radius, 8px)",
            padding: "10px 14px",
            color: "var(--text-primary, #f1f1f1)",
            fontFamily: "inherit",
            fontSize: 13,
            resize: "none",
            outline: "none",
            lineHeight: 1.5,
            transition: "border-color 0.18s",
          }}
          onFocus={(e) => (e.target.style.borderColor = "var(--red-600, #dc2626)")}
          onBlur={(e) => (e.target.style.borderColor = "var(--border, rgba(255,255,255,0.08))")}
        />
        <button
          onClick={handleSend}
          disabled={loading || !input.trim()}
          className="btn btn-primary btn-sm"
          style={{
            flexShrink: 0,
            alignSelf: "flex-end",
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "10px 16px",
          }}
        >
          <SendIcon />
          {loading ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}
