import { useEffect, useMemo, useRef, useState } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import confetti from "canvas-confetti";
import { socket } from "./socket";

function GameTimer({ endTime, isFinished, soundOn }) {
  const [remaining, setRemaining] = useState(() => Math.max(0, endTime - Date.now()));
  const warnedRef = useRef({ fiveMin: false, oneMin: false });

  useEffect(() => {
    if (!endTime) return;
    warnedRef.current = { fiveMin: false, oneMin: false };
    const pendingTimeouts = [];
    const tick = () => {
      const r = Math.max(0, endTime - Date.now());
      setRemaining(r);
      if (soundOn && r > 0) {
        if (r <= 5 * 60_000 && !warnedRef.current.fiveMin) {
          warnedRef.current.fiveMin = true;
          beep({ frequency: 660, durationMs: 100 });
          pendingTimeouts.push(window.setTimeout(() => beep({ frequency: 660, durationMs: 100 }), 140));
        }
        if (r <= 60_000 && !warnedRef.current.oneMin) {
          warnedRef.current.oneMin = true;
          beep({ frequency: 880, durationMs: 120 });
          pendingTimeouts.push(window.setTimeout(() => beep({ frequency: 880, durationMs: 120 }), 160));
          pendingTimeouts.push(window.setTimeout(() => beep({ frequency: 660, durationMs: 200 }), 320));
        }
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => {
      clearInterval(id);
      for (const t of pendingTimeouts) clearTimeout(t);
    };
  }, [endTime, soundOn]);

  if (!endTime) return null;

  const totalSeconds = Math.floor(remaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const display = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  const isOver = remaining === 0 || isFinished;
  const isRed = remaining < 60_000 && !isOver;
  const isOrange = remaining < 5 * 60_000 && !isRed && !isOver;

  const colorClass = isOver
    ? "text-slate-400"
    : isRed
      ? "text-red-400"
      : isOrange
        ? "text-orange-400"
        : "text-cyan-200";

  return (
    <div
      className={[
        "rounded-2xl bg-black/30 px-4 py-2 text-sm font-semibold shadow-sm ring-1 ring-white/10 tabular-nums",
        colorClass,
      ].join(" ")}
      title="Match timer"
    >
      {isOver ? "Game Over" : `⏱ ${display}`}
    </div>
  );
}

function renderMathInHtml(html) {
  // Codeforces often uses $$$...$$$ for math in scraped/plain text.
  // We'll render both $$$...$$$ and $$...$$ (display) and $...$ (inline).
  let out = html;

  const render = (expr, displayMode) => {
    try {
      return katex.renderToString(expr, { displayMode, throwOnError: false });
    } catch {
      return expr;
    }
  };

  // Codeforces uses $$$ ... $$$ for *inline* math (variables, small numbers).
  out = out.replace(/\$\$\$([\s\S]+?)\$\$\$/g, (_m, expr) => render(String(expr).trim(), false));
  // Display math: $$ ... $$
  out = out.replace(/\$\$([\s\S]+?)\$\$/g, (_m, expr) => render(String(expr).trim(), true));
  // Inline math: $ ... $ (avoid $$ which is already handled)
  out = out.replace(/(^|[^$])\$([^$\n]+?)\$/g, (_m, pre, expr) => `${pre}${render(String(expr).trim(), false)}`);

  return out;
}

function beep({ volume = 0.06, durationMs = 90, frequency = 880 } = {}) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "square";
    osc.frequency.value = frequency;
    gain.gain.value = volume;

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();

    window.setTimeout(() => {
      osc.stop();
      ctx.close();
    }, durationMs);
  } catch {
    // ignore
  }
}

function burstConfetti({ big = false } = {}) {
  const base = { origin: { y: 0.75 } };
  if (big) {
    confetti({ ...base, particleCount: 220, spread: 80, startVelocity: 55 });
    confetti({ ...base, particleCount: 160, spread: 120, startVelocity: 35 });
  } else {
    confetti({ ...base, particleCount: 110, spread: 65, startVelocity: 45 });
  }
}

function StatementModal({ open, title, loading, error, html, onClose }) {
  if (!open) return null;

  const rendered = useMemo(() => (html ? renderMathInHtml(html) : ""), [html]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <div className="w-full max-w-4xl overflow-hidden rounded-3xl arcade-panel">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 p-4">
          <div>
            <div className="text-xs font-semibold text-slate-400">Problem</div>
            <div className="mt-1 text-base font-extrabold text-slate-50">{title}</div>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl bg-black/30 px-3 py-2 text-sm font-semibold text-slate-100 ring-1 ring-white/10 hover:bg-black/40"
          >
            Close
          </button>
        </div>

        <div className="max-h-[75vh] overflow-auto p-5">
          {loading && <div className="text-sm text-slate-300">Loading statement…</div>}
          {error && (
            <div className="rounded-xl bg-rose-500/10 p-4 text-sm text-rose-100 ring-1 ring-rose-500/30">
              {error}
            </div>
          )}
          {!loading && !error && (
            <div className="cf-statement text-slate-100" dangerouslySetInnerHTML={{ __html: rendered }} />
          )}
        </div>
      </div>
    </div>
  );
}

function ProblemCard({ problem, conquered, onViewStatement }) {
  const solved = Boolean(conquered);
  const solvedBy = conquered?.byHandle || null;

  return (
    <div
      className={[
        "rounded-3xl p-6 ring-1 transition arcade-panel",
        solved ? "ring-emerald-400/30 arcade-glow" : "ring-white/10 hover:shadow-md",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-semibold text-slate-400">Rating</div>
          <div
            className={[
              "mt-1 inline-flex rounded-xl bg-black/30 px-2.5 py-1 text-sm font-extrabold text-slate-100 ring-1",
              problem.rating === 800 ? "rating-800 ring-cyan-400/30" : "",
              problem.rating === 1000 ? "rating-1000 ring-emerald-400/30" : "",
              problem.rating === 1200 ? "rating-1200 ring-fuchsia-400/30" : "",
            ].join(" ")}
          >
            {problem.rating}
          </div>
        </div>
        <div
          className={[
            "rounded-xl px-3 py-1 text-xs font-semibold ring-1",
            solved ? "bg-emerald-400/10 text-emerald-200 ring-emerald-400/30" : "bg-white/5 text-slate-200 ring-white/10",
          ].join(" ")}
        >
          {solved ? "Conquered" : "Open"}
        </div>
      </div>

      <div className="mt-4 text-lg font-extrabold leading-snug text-slate-50">{problem.name}</div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={onViewStatement}
          className="rounded-2xl bg-cyan-400/15 px-3.5 py-2 text-xs font-semibold text-cyan-100 ring-1 ring-cyan-400/30 hover:bg-cyan-400/20"
        >
          View statement
        </button>
        <a
          href={problem.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex rounded-2xl bg-black/30 px-3.5 py-2 text-xs font-semibold text-slate-100 ring-1 ring-white/10 hover:bg-black/40"
        >
          Open on CF
        </a>
      </div>

      <div className="mt-4 text-sm">
        <div className="text-slate-400">Solved by</div>
        <div className="mt-1 font-semibold text-slate-100">{solvedBy || "—"}</div>
      </div>
    </div>
  );
}

export default function Game({ room, onLeave }) {
  const players = room.players || [];
  const [p1, p2] = players;
  const [modal, setModal] = useState({ open: false, title: "", key: null });
  const [statementByKey, setStatementByKey] = useState({});
  const [soundOn, setSoundOn] = useState(() => {
    try {
      return localStorage.getItem("cfblitz:sound") !== "off";
    } catch {
      return true;
    }
  });
  const [codeBox, setCodeBox] = useState("");
  const [lang, setLang] = useState("cpp");
  const [checkDisabled, setCheckDisabled] = useState(false);

  const lastConqueredKeysRef = useRef(new Set(Object.keys(room.conquered || {})));
  const lastStatusRef = useRef(room.status);

  const totalSolved = useMemo(() => Object.keys(room.conquered || {}).length, [room.conquered]);
  const allSolved = room.status === "finished";
  const progressPct = Math.round((totalSolved / 3) * 100);

  const winnerLabel = useMemo(() => {
    if (!allSolved) return null;
    if (!room.winnerId) return "Tie";
    const winner = players.find((p) => p.id === room.winnerId);
    return winner?.handle || "Winner";
  }, [allSolved, room.winnerId, players]);

  useEffect(() => {
    const onCooldown = ({ disabledUntil }) => {
      setCheckDisabled(true);
      const remaining = Math.max(0, disabledUntil - Date.now());
      setTimeout(() => setCheckDisabled(false), remaining);
    };
    socket.on("room:check:cooldown", onCooldown);
    return () => socket.off("room:check:cooldown", onCooldown);
  }, []);

  useEffect(() => {
    // Play effects when a new problem is conquered.
    const next = new Set(Object.keys(room.conquered || {}));
    const prev = lastConqueredKeysRef.current;

    let added = 0;
    for (const k of next) if (!prev.has(k)) added++;
    if (added > 0) {
      burstConfetti({ big: added >= 2 });
      if (soundOn) {
        beep({ frequency: 988 });
        window.setTimeout(() => beep({ frequency: 1319, durationMs: 70 }), 90);
      }
    }

    lastConqueredKeysRef.current = next;
  }, [room.conquered, soundOn]);

  useEffect(() => {
    // Big celebration at game end.
    if (lastStatusRef.current !== "finished" && room.status === "finished") {
      burstConfetti({ big: true });
      if (soundOn) {
        beep({ frequency: 659, durationMs: 80 });
        window.setTimeout(() => beep({ frequency: 988, durationMs: 80 }), 100);
        window.setTimeout(() => beep({ frequency: 1319, durationMs: 120 }), 200);
      }
    }
    lastStatusRef.current = room.status;
  }, [room.status, soundOn]);

  const onCheckSubmissions = () => {
    socket.emit("room:check", { code: room.code });
  };

  const toggleSound = () => {
    setSoundOn((v) => {
      const next = !v;
      try {
        localStorage.setItem("cfblitz:sound", next ? "on" : "off");
      } catch {
        // ignore
      }
      if (next) beep({ frequency: 880, durationMs: 60 });
      return next;
    });
  };

  const openStatement = async (prob) => {
    setModal({ open: true, title: `[${prob.rating}] ${prob.name}`, key: prob.key });

    if (statementByKey[prob.key]?.html || statementByKey[prob.key]?.loading) return;

    setStatementByKey((m) => ({ ...m, [prob.key]: { loading: true, error: null, html: "" } }));
    try {
      const url = `/api/problem-statement?contestId=${encodeURIComponent(prob.contestId)}&index=${encodeURIComponent(prob.index)}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to fetch statement.");
      setStatementByKey((m) => ({ ...m, [prob.key]: { loading: false, error: null, html: data.html } }));
    } catch (e) {
      setStatementByKey((m) => ({ ...m, [prob.key]: { loading: false, error: e.message, html: "" } }));
    }
  };

  const activeStatement = modal.key ? statementByKey[modal.key] : null;
  const activeProblem = useMemo(() => {
    if (!modal.key) return null;
    return (room.problems || []).find((p) => p.key === modal.key) || null;
  }, [modal.key, room.problems]);

  const openCfSubmit = () => {
    if (!activeProblem) return;
    const url = `https://codeforces.com/problemset/submit?contestId=${encodeURIComponent(activeProblem.contestId)}&problemIndex=${encodeURIComponent(activeProblem.index)}`;
    window.open(url, "_blank", "noreferrer");
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(codeBox);
      if (soundOn) beep({ frequency: 784, durationMs: 50 });
    } catch {
      // ignore
    }
  };

  return (
    <div className="w-full max-w-6xl">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-sm text-slate-400">Room</div>
          <div className="mt-1 text-2xl font-extrabold tracking-wider text-slate-50 arcade-title">{room.code}</div>
          <div className="mt-2 text-slate-200">
            <span className="font-extrabold">{p1?.handle || "Player 1"}</span>
            <span className="mx-3 vs-banner align-middle">
              <span>VS</span>
            </span>
            <span className="font-extrabold">{p2?.handle || "Player 2"}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <GameTimer endTime={room.endTime} isFinished={room.status === "finished"} soundOn={soundOn} />
          <div className="rounded-2xl bg-black/30 px-4 py-2 text-sm font-semibold text-slate-100 shadow-sm ring-1 ring-white/10">
            Solved: {totalSolved}/3
          </div>
          <button
            onClick={onCheckSubmissions}
            disabled={checkDisabled || room.status !== "in_progress"}
            className="rounded-2xl bg-emerald-400/15 px-4 py-2 text-sm font-semibold text-emerald-100 ring-1 ring-emerald-400/30 hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-50"
            title="Check latest submissions on Codeforces (5s cooldown)"
          >
            {checkDisabled ? "Checking…" : "Check submissions"}
          </button>
          <button
            onClick={toggleSound}
            className="rounded-2xl bg-black/30 px-4 py-2 text-sm font-semibold text-slate-100 shadow-sm ring-1 ring-white/10 hover:bg-black/40"
            title="Toggle sound"
          >
            Sound: {soundOn ? "On" : "Off"}
          </button>
          <button
            onClick={onLeave}
            className="rounded-2xl bg-rose-400/10 px-4 py-2 text-sm font-semibold text-rose-100 ring-1 ring-rose-400/30 hover:bg-rose-400/15"
          >
            Leave
          </button>
        </div>
      </div>

      <div className="mt-6 rounded-3xl p-5 arcade-panel">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-6">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Score</div>
              <div className="mt-1 text-sm font-extrabold text-slate-100">
                {p1?.handle || "P1"} <span className="text-cyan-200">{p1?.score ?? 0}</span>
                <span className="mx-2 text-slate-500">—</span>
                <span className="text-fuchsia-200">{p2?.score ?? 0}</span> {p2?.handle || "P2"}
              </div>
            </div>
          </div>

          <div className="w-full sm:w-64">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Progress</span>
              <span className="font-semibold text-slate-100">{progressPct}%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/30 ring-1 ring-white/10">
              <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-emerald-400 to-fuchsia-400" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
        </div>
      </div>

      {allSolved && (
        <div className="mt-6 rounded-3xl bg-amber-400/10 p-6 text-amber-100 ring-1 ring-amber-400/30 shadow-sm">
          <div className="text-sm font-semibold">Game finished</div>
          <div className="mt-1 text-xl font-extrabold arcade-title">{winnerLabel}</div>
          <div className="mt-2 text-sm text-amber-100/80">
            Final score:{" "}
            <span className="font-bold">
              {p1?.handle || "P1"} {p1?.score ?? 0}
            </span>{" "}
            -{" "}
            <span className="font-bold">
              {p2?.score ?? 0} {p2?.handle || "P2"}
            </span>
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-5 md:grid-cols-3">
        {(room.problems || []).map((prob) => (
          <ProblemCard
            key={prob.key}
            problem={prob}
            conquered={(room.conquered || {})[prob.key]}
            onViewStatement={() => openStatement(prob)}
          />
        ))}
      </div>

      <StatementModal
        open={modal.open}
        title={modal.title}
        loading={Boolean(activeStatement?.loading)}
        error={activeStatement?.error || null}
        html={activeStatement?.html || ""}
        onClose={() => setModal({ open: false, title: "", key: null })}
      />

      {/* Arcade editor + submit helper (manual submit on CF) */}
      <div className="mt-8 rounded-3xl p-6 arcade-panel">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Arena Console</div>
            <div className="mt-1 text-sm font-extrabold text-slate-100">Write code here, then open CF submit</div>
            <div className="mt-1 text-xs text-slate-300">
              Note: actual submission needs you to be logged in on Codeforces (we can't auto-submit without a login system).
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value)}
              className="rounded-2xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/40 focus:ring-4 focus:ring-cyan-400/10"
            >
              <option value="cpp">C++</option>
              <option value="py">Python</option>
              <option value="java">Java</option>
              <option value="js">JavaScript</option>
              <option value="c">C</option>
              <option value="cs">C#</option>
              <option value="go">Go</option>
              <option value="kt">Kotlin</option>
              <option value="rs">Rust</option>
            </select>
            <button
              onClick={copyCode}
              className="rounded-2xl bg-cyan-400/15 px-3.5 py-2 text-sm font-semibold text-cyan-100 ring-1 ring-cyan-400/30 hover:bg-cyan-400/20"
            >
              Copy code
            </button>
            <button
              onClick={openCfSubmit}
              disabled={!activeProblem}
              className="rounded-2xl bg-fuchsia-400/15 px-3.5 py-2 text-sm font-semibold text-fuchsia-100 ring-1 ring-fuchsia-400/30 hover:bg-fuchsia-400/20 disabled:cursor-not-allowed disabled:opacity-50"
              title={activeProblem ? "Opens Codeforces submit page in new tab" : "Open a statement first to pick the problem"}
            >
              Open CF submit
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <textarea
              value={codeBox}
              onChange={(e) => setCodeBox(e.target.value)}
              placeholder={`// ${lang.toUpperCase()} code here…\n`}
              className="h-72 w-full resize-none rounded-3xl border border-white/10 bg-black/25 p-4 font-mono text-sm text-slate-100 shadow-sm outline-none focus:border-cyan-400/40 focus:ring-4 focus:ring-cyan-400/10"
            />
          </div>
          <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Workflow</div>
            <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-slate-200">
              <li>Click a problem → <span className="font-semibold">View statement</span></li>
              <li>Write solution here</li>
              <li><span className="font-semibold">Copy code</span></li>
              <li><span className="font-semibold">Open CF submit</span> and paste</li>
            </ol>
            <div className="mt-4 text-xs text-slate-400">
              Tip: keep Codeforces logged in on each laptop for fastest submissions.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

