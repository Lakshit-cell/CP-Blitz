const http = require("http");
const path = require("path");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");

const {
        createRoom,
        createNormalRoom,
        getRoom,
        joinRoom,
        reconnectPlayer,
        markDisconnectedForSocket,
        setHandle,
        leaveAllRoomsForSocket,
        roomToPublicState,
} = require("./rooms");
const { pickRandomProblemsByRatings, pickRandomProblemsByRatingRange, fetchUserStatus } = require("./codeforces");
const { fetchProblemStatementHtml } = require("./statement");

const PORT = process.env.PORT || 3000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";
const SERVE_CLIENT = String(process.env.SERVE_CLIENT || "false").toLowerCase() === "true";

const app = express();
if (!SERVE_CLIENT) {
        app.use(cors({ origin: CLIENT_ORIGIN }));
}
app.get("/health", (_req, res) => res.json({ ok: true }));

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

const SCORE_WEIGHTS = [2, 3, 4];
const DEFAULT_SCORE_WEIGHT = 1;
const DUEL_PROBLEM_RATINGS = [800, 1000, 1200];
const DUEL_DURATION_MINUTES = 15;
const POLL_INTERVAL_MS = 60_000;
const FINAL_CHECK_COUNT = 30;

const NORMAL_LIMITS = {
        questions: { min: 1, max: 20 },
        minutes: { min: 5, max: 180 },
        rating: { min: 800, max: 3500 },
};

function validateNormalConfig(config = {}) {
        const questionCount = Number(config.questionCount);
        if (
                !Number.isInteger(questionCount) ||
                questionCount < NORMAL_LIMITS.questions.min ||
                questionCount > NORMAL_LIMITS.questions.max
        ) {
                return {
                        ok: false,
                        error: `Choose between ${NORMAL_LIMITS.questions.min}–${NORMAL_LIMITS.questions.max} questions.`,
                };
        }

        const durationMinutes = Number(config.durationMinutes);
        if (
                !Number.isInteger(durationMinutes) ||
                durationMinutes < NORMAL_LIMITS.minutes.min ||
                durationMinutes > NORMAL_LIMITS.minutes.max
        ) {
                return {
                        ok: false,
                        error: `Time must be between ${NORMAL_LIMITS.minutes.min}–${NORMAL_LIMITS.minutes.max} minutes.`,
                };
        }

        const minRating = Number(config.minRating);
        const maxRating = Number(config.maxRating);
        if (
                !Number.isInteger(minRating) ||
                minRating < NORMAL_LIMITS.rating.min ||
                minRating > NORMAL_LIMITS.rating.max
        ) {
                return {
                        ok: false,
                        error: `Minimum rating must be between ${NORMAL_LIMITS.rating.min}–${NORMAL_LIMITS.rating.max}.`,
                };
        }
        if (
                !Number.isInteger(maxRating) ||
                maxRating < NORMAL_LIMITS.rating.min ||
                maxRating > NORMAL_LIMITS.rating.max
        ) {
                return {
                        ok: false,
                        error: `Maximum rating must be between ${NORMAL_LIMITS.rating.min}–${NORMAL_LIMITS.rating.max}.`,
                };
        }
        if (minRating > maxRating) {
                return { ok: false, error: "Minimum rating cannot exceed maximum rating." };
        }

        return {
                ok: true,
                value: {
                        questionCount,
                        minRating,
                        maxRating,
                        durationMinutes,
                },
        };
}

function computeScores(room) {
        const scoresById = {};
        for (const player of room.players) scoresById[player.id] = 0;

        const weightByKey = new Map();
        if (Array.isArray(room.problems)) {
                room.problems.forEach((problem) => {
                        const key = `${problem.contestId}-${problem.index}`;
                        const weight = problem.weight ?? DEFAULT_SCORE_WEIGHT;
                        weightByKey.set(key, weight);
                });
        }

        for (const [key, conquest] of Object.entries(room.conquered)) {
                if (conquest?.byPlayerId && scoresById[conquest.byPlayerId] != null) {
                        const weight = weightByKey.get(key) ?? DEFAULT_SCORE_WEIGHT;
                        scoresById[conquest.byPlayerId] += weight;
                }
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

async function startConfiguredGame(room, { problems, durationMs }) {
        room.status = "in_progress";
        room.conquered = {};
        room.startTime = Date.now();
        room.endTime = room.startTime + durationMs;
        room.problems = problems;

        emitRoomState(room);
        io.to(room.code).emit("game:start", roomSummary(room));

        room.pollInterval = setInterval(() => {
                checkSolves(room.code).catch((err) => {
                        io.to(room.code).emit("error", { message: `Polling error: ${err.message}` });
                });
        }, POLL_INTERVAL_MS);

        room.timerTimeout = setTimeout(async () => {
                const r = getRoom(room.code);
                if (!r || r.status !== "in_progress") return;

                if (r.pollInterval) clearInterval(r.pollInterval);
                r.pollInterval = null;
                r.timerTimeout = null;

                try {
                        await checkSolves(r.code, { count: FINAL_CHECK_COUNT });
                } catch (e) {
                        io.to(r.code).emit("error", { message: `Final check error: ${e.message}` });
                }

                const rFinal = getRoom(room.code);
                if (!rFinal || rFinal.status !== "in_progress") return;

                rFinal.status = "finished";
                emitRoomState(rFinal);
                io.to(rFinal.code).emit("game:over", roomSummary(rFinal));
        }, durationMs);

        await checkSolves(room.code);
}

async function startGameIfReady(code) {
        const room = getRoom(code);
        if (!room) return;
        if (room.mode !== "duel") return;
        if (room.status !== "waiting") return;
        if (room.players.length !== room.maxPlayers) return;
        if (!room.players.every((p) => p.handle)) return;

        try {
                const problems = await pickRandomProblemsByRatings(DUEL_PROBLEM_RATINGS);
                const weighted = problems.map((problem, index) => ({
                        ...problem,
                        weight: SCORE_WEIGHTS[index] ?? DEFAULT_SCORE_WEIGHT,
                }));
                await startConfiguredGame(room, { problems: weighted, durationMs: DUEL_DURATION_MINUTES * 60 * 1000 });
        } catch (e) {
                room.status = "waiting";
                room.startTime = null;
                room.endTime = null;
                io.to(room.code).emit("error", { message: `Failed to fetch problems: ${e.message}` });
        }
}

function allProblemsSolved(room) {
        if (!room.problems) return false;
        return room.problems.every((p) => room.conquered[`${p.contestId}-${p.index}`]);
}

async function checkSolves(code, { count = 5 } = {}) {
        const room = getRoom(code);
        if (!room) return;
        if (room.status !== "in_progress") return;
        if (!room.problems || room.players.length === 0) return;
        if (!room.players.every((p) => p.handle)) return;

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

        socket.on("normal:start", async ({ handle, config }) => {
                const trimmedHandle = String(handle || "").trim();
                if (!trimmedHandle) {
                        socket.emit("error", { message: "Handle cannot be empty." });
                        return;
                }

                const validation = validateNormalConfig(config);
                if (!validation.ok) {
                        socket.emit("error", { message: validation.error });
                        return;
                }

                let problems;
                try {
                        problems = await pickRandomProblemsByRatingRange({
                                minRating: validation.value.minRating,
                                maxRating: validation.value.maxRating,
                                count: validation.value.questionCount,
                        });
                } catch (e) {
                        socket.emit("error", { message: `Failed to fetch problems: ${e.message}` });
                        return;
                }

                const { room, token } = createNormalRoom(socket.id, trimmedHandle, validation.value);
                socket.join(room.code);
                socket.emit("room:created", { code: room.code, token, handle: trimmedHandle });

                const weighted = problems.map((problem) => ({ ...problem, weight: DEFAULT_SCORE_WEIGHT }));
                await startConfiguredGame(room, {
                        problems: weighted,
                        durationMs: validation.value.durationMinutes * 60 * 1000,
                });
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
        console.log(`CP Blitz server listening on http://localhost:${PORT}`);
});
