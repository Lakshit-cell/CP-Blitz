import { useEffect, useMemo, useState } from "react";
import { socket } from "./socket";
import Room from "./Room";
import Game from "./Game";

const SESSION_KEY = "cfblitz:session";

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSession(next) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

export default function App() {
  const [stage, setStage] = useState("home"); // home | room | game
  const [roomCodeInput, setRoomCodeInput] = useState("");
  const [room, setRoom] = useState(null);
  const [toast, setToast] = useState(null);
  const [myId, setMyId] = useState(socket.id);
  const [myToken, setMyToken] = useState(() => loadSession()?.token || null);
  const [myHandle, setMyHandle] = useState(() => loadSession()?.handle || "");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onConnect = () => {
      setMyId(socket.id);
      const s = loadSession();
      if (s?.code && s?.token) {
        socket.emit("room:reconnect", { code: s.code, token: s.token, handle: s.handle || "" });
      }
    };
    const onState = (state) => {
      setRoom(state);
      if (state.status === "in_progress" || state.status === "finished") setStage("game");
      else setStage("room");
    };
    const onError = (e) => {
      setToast(e?.message || "Something went wrong.");
      window.setTimeout(() => setToast(null), 4000);
    };

    socket.on("connect", onConnect);
    socket.on("room:created", ({ code, token }) => {
      setMyToken(token);
      saveSession({ code, token, handle: "" });
    });
    socket.on("room:joined", ({ code, token }) => {
      setMyToken(token);
      saveSession({ code, token, handle: "" });
    });
    socket.on("room:state", onState);
    socket.on("game:start", onState);
    socket.on("game:end", onState);
    socket.on("game:over", onState);
    socket.on("error", onError);

    return () => {
      socket.off("connect", onConnect);
      socket.off("room:created");
      socket.off("room:joined");
      socket.off("room:state", onState);
      socket.off("game:start", onState);
      socket.off("game:end", onState);
      socket.off("game:over", onState);
      socket.off("error", onError);
    };
  }, []);

  const canJoin = useMemo(() => roomCodeInput.trim().length >= 4, [roomCodeInput]);

  const createRoom = () => {
    socket.emit("room:create");
  };

  const joinRoom = () => {
    socket.emit("room:join", { code: roomCodeInput.trim().toUpperCase() });
  };

  const setHandle = (handle) => {
    socket.emit("player:setHandle", { code: room.code, handle });
    const s = loadSession();
    if (s?.code && s?.token) {
      const next = { ...s, handle };
      saveSession(next);
      setMyHandle(handle);
    }
  };

  const leave = () => {
    if (room?.code) socket.emit("room:leave", { code: room.code });
    setRoom(null);
    setStage("home");
    setMyToken(null);
    setMyHandle("");
    clearSession();
  };

  const copyRoomCode = async () => {
    if (!room?.code) return;
    try {
      await navigator.clipboard.writeText(room.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  };

  return (
    <div className="min-h-full text-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <div className="flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-black/40 text-cyan-200 shadow-sm ring-1 ring-white/10 arcade-glow">
              <span className="text-sm font-extrabold tracking-wide">CF</span>
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-400">CF Blitz</div>
              <div className="mt-0.5 text-3xl font-extrabold text-slate-50 arcade-title">Arcade Blitz Duel</div>
              <div className="mt-1 text-sm text-slate-300">
                Two players. One room. Three problems. First accepted wins each card.
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {room?.code && (
              <button
                onClick={copyRoomCode}
                className="rounded-xl bg-black/30 px-3 py-2 text-xs font-semibold text-slate-100 shadow-sm ring-1 ring-white/10 hover:bg-black/40 neon-pill"
              >
                {copied ? "Copied!" : `Copy code: ${room.code}`}
              </button>
            )}
            {myToken && (
              <div className="rounded-xl bg-black/30 px-3 py-2 text-xs font-semibold text-slate-200 shadow-sm ring-1 ring-white/10">
                Session saved
              </div>
            )}
          </div>
        </div>

        {toast && (
          <div className="mt-6 rounded-2xl bg-rose-500/10 p-4 text-rose-100 ring-1 ring-rose-500/30 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-semibold">Error</div>
                <div className="mt-1 text-sm text-rose-100/90">{toast}</div>
              </div>
              <button
                onClick={() => setToast(null)}
                className="rounded-xl bg-rose-500/20 px-3 py-2 text-xs font-semibold text-rose-100 hover:bg-rose-500/30"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {stage === "home" && (
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            <div className="arcade-panel rounded-3xl p-7">
              <div className="text-lg font-extrabold text-slate-50">Create a room</div>
              <div className="mt-2 text-sm text-slate-300">Start a duel and share the room code with your opponent.</div>
              <button
                onClick={createRoom}
                className="mt-6 rounded-2xl bg-cyan-400/15 px-5 py-3 text-sm font-semibold text-cyan-100 shadow-sm ring-1 ring-cyan-400/30 hover:bg-cyan-400/20 arcade-glow"
              >
                Create room
              </button>
              <div className="mt-4 text-xs text-slate-400">Tip: refresh-safe session is enabled.</div>
            </div>

            <div className="arcade-panel rounded-3xl p-7">
              <div className="text-lg font-extrabold text-slate-50">Join a room</div>
              <div className="mt-2 text-sm text-slate-300">Enter a room code to join your opponent.</div>
              <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                <input
                  value={roomCodeInput}
                  onChange={(e) => setRoomCodeInput(e.target.value)}
                  placeholder="ABC123"
                  className="w-full flex-1 rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-slate-100 shadow-sm outline-none placeholder:text-slate-400 focus:border-cyan-400/40 focus:ring-4 focus:ring-cyan-400/10"
                />
                <button
                  disabled={!canJoin}
                  onClick={joinRoom}
                  className="rounded-2xl bg-fuchsia-400/15 px-5 py-3 text-sm font-semibold text-fuchsia-100 shadow-sm ring-1 ring-fuchsia-400/30 hover:bg-fuchsia-400/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Join
                </button>
              </div>
              <div className="mt-4 text-xs text-slate-400"></div>
            </div>
          </div>
        )}

        {stage === "room" && room && (
          <div className="mt-10">
            <Room room={room} myId={myId} onSetHandle={setHandle} onLeave={leave} defaultHandle={myHandle} />
          </div>
        )}
        {stage === "game" && room && <div className="mt-10"><Game room={room} onLeave={leave} /></div>}

        <div className="mt-14 text-center text-xs text-slate-400">

        </div>
      </div>
    </div>
  );
}
