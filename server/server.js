const http = require("http");
const path = require("path");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");

const {
        createRoom,
        getRoom,
        joinRoom,
        reconnectPlayer,
        markDisconnectedForSocket,
        setHandle,
        leaveAllRoomsForSocket,
        roomToPublicState,
} = require("./rooms");
const { pickRandomProblemsByRatings, fetchUserStatus, fetchUserInfo } = require("./codeforces");
const { fetchProblemStatementHtml } = require("./statement");

const PORT = process.env.PORT || 3000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";
const SERVE_CLIENT = String(process.env.SERVE_CLIENT || "false").toLowerCase() === "true";

const app = express();
if (!SERVE_CLIENT) {
        app.use(cors({ origin: CLIENT_ORIGIN }));
}
app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/api/check-handle", async (req, res) => {
        try {
                const handle = String(req.query.handle || "").trim();
                if (!handle) return res.status(400).json({ ok: false, error: "handle is required." });

                const user = await fetchUserInfo(handle);
                return res.json({ ok: true, handle: user.handle, rating: user.rating ?? null });
        } catch (e) {
                const msg = e.message || "";
                const isNotFound = msg.toLowerCase().includes("not found") || msg.toLowerCase().includes("handles: not found");
                return res.status(isNotFound ? 404 : 500).json({ ok: false, error: msg || "Handle not found." });
        }
});

app.get("/api/problem-statement", async (req, res) => {
        try {
                const contestId = Number(req.query.contestId);
                const index = String(req.query.index || "").trim();
                if (!contestId || !index) return res.status(400).json({ ok: false, error: "contestId and index are required." });

                const result = await fetchProblemStatementHtml({ contestId, index });
                return res.json({ ok: true, contestId, index, html: result.html, cached: result.cached });
        } catch (e) {
                return res.status(500).json({ ok: false, error: e.message || "Failed to fetch statement." });
        }
});

if (SERVE_CLIENT) {
        const distPath = path.join(__dirname, "..", "client", "dist");
        app.use(express.static(distPath));
        // SPA fallback (Express v5-safe).
        app.get(/.*/, (_req, res) => res.sendFile(path.join(distPath, "index.html")));
}

const server = http.createServer(app);
const io = new Server(server, { cors: SERVE_CLIENT ? undefined : { origin: CLIENT_ORIGIN } });

function computeScores(room) {
        const scoresById = {};
        for (const p of room.players) scoresById[p.id] = 0;

        for (const v of Object.values(room.conquered)) {
                if (v?.byPlayerId && scoresById[v.byPlayerId] != null) scoresById[v.byPlayerId] += 1;
        }

        return scoresById;
}

function roomSummary(room) {
        const state = roomToPublicState(room);
        const scoresById = computeScores(room);
        const playersWithScore = state.players.map((p) => ({ ...p, score: scoresById[p.id] || 0 }));

        let winnerId = null;
        if (room.status === "finished") {
                const [a, b] = playersWithScore;
                if (a && b) {
                        if (a.score > b.score) winnerId = a.id;
                        else if (b.score > a.score) winnerId = b.id;
                }
        }

        return { ...state, players: playersWithScore, winnerId };
}

function emitRoomState(room) {
        io.to(room.code).emit("room:state", roomSummary(room));
}

async function startGameIfReady(code) {
        const room = getRoom(code);
        if (!room) return;
        if (room.status !== "waiting") return;
        if (room.players.length !== 2) return;
        if (!room.players.every((p) => p.handle)) return;
        // changes
        room.status = "in_progress";
        room.conquered = {};
        room.startTime = Date.now();
        room.endTime = room.startTime + 15 * 60 * 1000;

        try {
                room.problems = await pickRandomProblemsByRatings([800, 1000, 1200]);
        } catch (e) {
                room.status = "waiting";
                room.startTime = null;
                room.endTime = null;
                io.to(room.code).emit("error", { message: `Failed to fetch problems: ${e.message}` });
                return;
        }

        emitRoomState(room);
        io.to(room.code).emit("game:start", roomSummary(room));

        room.pollInterval = setInterval(() => {
                checkSolves(room.code).catch((err) => {
                        io.to(room.code).emit("error", { message: `Polling error: ${err.message}` });
                });
        }, 60_000);

        // Server-side 15-minute game timer.
        room.timerTimeout = setTimeout(async () => {
                const r = getRoom(code);
                if (!r || r.status !== "in_progress") return;

                // Stop backup polling before final check.
                if (r.pollInterval) clearInterval(r.pollInterval);
                r.pollInterval = null;
                r.timerTimeout = null;

                // Final verification pass: fetch last 30 submissions for both handles.
                try {
                        await checkSolves(r.code, { count: 30 });
                } catch (e) {
                        io.to(r.code).emit("error", { message: `Final check error: ${e.message}` });
                }

                // checkSolves may have already finished the game if all problems were solved.
                const rFinal = getRoom(code);
                if (!rFinal || rFinal.status !== "in_progress") return;

                rFinal.status = "finished";
                emitRoomState(rFinal);
                io.to(rFinal.code).emit("game:over", roomSummary(rFinal));
        }, 15 * 60 * 1000);

        // Run once immediately so the UI updates fast.
        await checkSolves(room.code);
}

function allProblemsSolved(room) {
        if (!room.problems) return false;
        return room.problems.every((p) => room.conquered[`${p.contestId}-${p.index}`]);
}

async function checkSolves(code, { count = 5 } = {}) {
        const room = getRoom(code);
        if (!room) return;
        if (room.status !== "in_progress") return;
        if (!room.problems || room.players.length !== 2) return;

        const problemsByKey = {};
        for (const p of room.problems) problemsByKey[`${p.contestId}-${p.index}`] = p;

        const players = room.players.map((p) => ({ ...p }));

        const statuses = await Promise.all(
                players.map(async (p) => {
                        try {
                                return { ok: true, handle: p.handle, submissions: await fetchUserStatus(p.handle, { count }) };
                        } catch (e) {
                                return { ok: false, handle: p.handle, error: e.message, submissions: [] };
                        }
                }),
        );

        for (const s of statuses) {
                if (!s.ok) io.to(room.code).emit("error", { message: `CF handle "${s.handle}": ${s.error}` });
        }

        // Build best (earliest) OK submission per player per target problem.
        const earliestOk = new Map(); // key -> [{playerId, handle, t}]
        for (let i = 0; i < players.length; i++) {
                const p = players[i];
                const subs = statuses[i].submissions || [];

                for (const sub of subs) {
                        if (sub.verdict !== "OK") continue;
                        const pr = sub.problem;
                        if (!pr?.contestId || !pr?.index) continue;
                        const key = `${pr.contestId}-${pr.index}`;
                        if (!problemsByKey[key]) continue;

                        const t = sub.creationTimeSeconds || 0;
                        const list = earliestOk.get(key) || [];

                        const existingIdx = list.findIndex((x) => x.playerId === p.id);
                        if (existingIdx === -1) list.push({ playerId: p.id, handle: p.handle, t });
                        else if (t && t < list[existingIdx].t) list[existingIdx] = { playerId: p.id, handle: p.handle, t };

                        earliestOk.set(key, list);
                }
        }

        let changed = false;
        for (const key of Object.keys(problemsByKey)) {
                if (room.conquered[key]) continue;
                const candidates = earliestOk.get(key) || [];
                if (candidates.length === 0) continue;
                candidates.sort((a, b) => (a.t || 0) - (b.t || 0));
                const winner = candidates[0];
                room.conquered[key] = {
                        byPlayerId: winner.playerId,
                        byHandle: winner.handle,
                        atCreationTimeSeconds: winner.t || null,
                };
                changed = true;
        }

        if (changed) emitRoomState(room);

        if (allProblemsSolved(room)) {
                room.status = "finished";
                if (room.pollInterval) clearInterval(room.pollInterval);
                room.pollInterval = null;
                if (room.timerTimeout) clearTimeout(room.timerTimeout);
                room.timerTimeout = null;
                emitRoomState(room);
                io.to(room.code).emit("game:end", roomSummary(room));
        }
}

io.on("connection", (socket) => {
        socket.on("room:create", () => {
                const { room, token } = createRoom(socket.id);
                socket.join(room.code);
                socket.emit("room:created", { code: room.code, token });
                emitRoomState(room);
        });

        socket.on("room:join", ({ code }) => {
                const res = joinRoom(code, socket.id);
                if (!res.ok) {
                        socket.emit("error", { message: res.error });
                        return;
                }
                socket.join(res.room.code);
                socket.emit("room:joined", { code: res.room.code, token: res.token });
                emitRoomState(res.room);
        });

        socket.on("room:reconnect", async ({ code, token, handle }) => {
                const res = reconnectPlayer(code, token, socket.id, handle);
                if (!res.ok) {
                        socket.emit("error", { message: res.error });
                        return;
                }
                socket.join(res.room.code);
                emitRoomState(res.room);
                await startGameIfReady(res.room.code);
        });

        socket.on("player:setHandle", async ({ code, handle }) => {
                const res = setHandle(code, socket.id, handle);
                if (!res.ok) {
                        socket.emit("error", { message: res.error });
                        return;
                }
                emitRoomState(res.room);
                await startGameIfReady(res.room.code);
        });

        socket.on("room:check", async ({ code }) => {
                const room = getRoom(code);
                if (!room) return;
                if (!socket.rooms.has(room.code)) return;
                if (room.status !== "in_progress") return;

                const COOLDOWN_MS = 5000;
                const now = Date.now();
                if (now - room.lastManualCheckAt < COOLDOWN_MS) return;

                room.lastManualCheckAt = now;
                // Broadcast cooldown end time so both clients disable the button in sync.
                io.to(room.code).emit("room:check:cooldown", { disabledUntil: now + COOLDOWN_MS });

                try {
                        await checkSolves(room.code);
                } catch (e) {
                        io.to(room.code).emit("error", { message: `Manual check failed: ${e.message}` });
                }
        });

        socket.on("room:leave", ({ code }) => {
                const room = getRoom(code);
                if (room) {
                        socket.leave(room.code);
                        const touched = leaveAllRoomsForSocket(socket.id);
                        for (const c of touched) {
                                const r = getRoom(c);
                                if (r) emitRoomState(r);
                        }
                }
        });

        socket.on("disconnect", () => {
                // On refresh / transient disconnect, keep the player slot and allow reconnect via token.
                const touched = markDisconnectedForSocket(socket.id);
                for (const c of touched) {
                        const r = getRoom(c);
                        if (r) emitRoomState(r);
                }
        });
});

server.listen(PORT, () => {
        // eslint-disable-next-line no-console
        console.log(`CF Blitz server listening on http://localhost:${PORT}`);
});

