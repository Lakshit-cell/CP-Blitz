import { useMemo, useState } from "react";

export default function Room({ room, myId, onSetHandle, onLeave, defaultHandle = "" }) {
  const [handle, setHandle] = useState(defaultHandle);
  const [copied, setCopied] = useState(false);
  const [checkState, setCheckState] = useState(null); // null | "loading" | "valid" | "invalid"
  const [checkError, setCheckError] = useState("");

  const me = useMemo(() => room.players.find((p) => p.id === myId), [room.players, myId]);
  const other = useMemo(() => room.players.find((p) => p.id !== myId), [room.players, myId]);

  const canSubmit = handle.trim().length > 0;

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(room.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  };

  const onHandleChange = (e) => {
    setHandle(e.target.value);
    setCheckState(null);
    setCheckError("");
  };

  const checkHandle = async () => {
    const h = handle.trim();
    if (!h) return;
    setCheckState("loading");
    setCheckError("");
    try {
      const res = await fetch(`/api/check-handle?handle=${encodeURIComponent(h)}`);
      const data = await res.json();
      if (data.ok) {
        setCheckState("valid");
      } else {
        setCheckState("invalid");
        setCheckError(data.error || "Handle not found on Codeforces.");
      }
    } catch {
      setCheckState("invalid");
      setCheckError("Could not reach server. Please try again.");
    }
  };

  return (
    <div className="w-full max-w-4xl">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <div className="text-sm text-slate-400">Room code</div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-2 rounded-2xl bg-black/30 px-5 py-3 text-2xl font-extrabold tracking-wider shadow-sm ring-1 ring-white/10 neon-pill">
              {room.code}
            </div>
            <button
              onClick={copyCode}
              className="rounded-2xl bg-black/30 px-4 py-3 text-sm font-semibold text-slate-100 shadow-sm ring-1 ring-white/10 hover:bg-black/40"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <div className="mt-2 text-sm text-slate-300">
            Share this code with your opponent. Game starts automatically once both handles are set.
          </div>
        </div>
        <button
          onClick={onLeave}
          className="rounded-2xl bg-rose-400/10 px-4 py-3 text-sm font-semibold text-rose-100 ring-1 ring-rose-400/30 hover:bg-rose-400/15"
        >
          Leave
        </button>
      </div>

      <div className="mt-8 grid gap-4 rounded-3xl p-7 arcade-panel md:grid-cols-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">You</div>
          <div className="mt-2 text-lg font-extrabold text-slate-50 arcade-title">{me?.handle || "—"}</div>
          <div className="mt-1 text-xs text-slate-300">{me?.handle ? "Ready" : "Set your handle below"}</div>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Opponent</div>
          <div className="mt-2 text-lg font-extrabold text-slate-50 arcade-title">
            {other?.handle || (other ? "Waiting…" : "No one yet")}
          </div>
          <div className="mt-1 text-xs text-slate-300">
            {other ? (other.handle ? (other.disconnected ? "Disconnected (can rejoin)" : "Ready") : "Joined, setting handle…") : "Share the room code"}
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-3xl p-7 arcade-panel">
        <div className="text-sm font-semibold text-slate-200">Your Codeforces handle</div>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <input
            value={handle}
            onChange={onHandleChange}
            placeholder="e.g. tourist"
            className="w-full flex-1 rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-slate-100 shadow-sm outline-none placeholder:text-slate-400 focus:border-cyan-400/40 focus:ring-4 focus:ring-cyan-400/10"
          />
          <button
            disabled={!handle.trim() || checkState === "loading"}
            onClick={checkHandle}
            className="rounded-2xl bg-amber-400/15 px-5 py-3 text-sm font-semibold text-amber-100 shadow-sm ring-1 ring-amber-400/30 hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {checkState === "loading" ? "Checking…" : "Check handle"}
          </button>
          <button
            disabled={!canSubmit}
            onClick={() => onSetHandle(handle)}
            className="rounded-2xl bg-cyan-400/15 px-5 py-3 text-sm font-semibold text-cyan-100 shadow-sm ring-1 ring-cyan-400/30 hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-50 arcade-glow"
          >
            Confirm handle
          </button>
        </div>
        {checkState === "valid" && (
          <div className="mt-3 text-xs font-semibold text-emerald-400">✓ Valid Codeforces handle</div>
        )}
        {checkState === "invalid" && (
          <div className="mt-3 text-xs font-semibold text-rose-400">✗ {checkError}</div>
        )}
        {checkState === null && <div className="mt-3 text-xs text-slate-300"></div>}
      </div>
    </div>
  );
}

