const CF_API = "https://codeforces.com/api";

// Codeforces API is rate-limited per IP. We serialize requests with a small delay
// to keep many parallel rooms from spamming the API.
let lastCfCall = Promise.resolve();
const MIN_INTERVAL_MS = Number(process.env.CF_MIN_INTERVAL_MS || 210); // ~<= 5 req/sec

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function rateLimitedFetchJson(url, { timeoutMs = 8000 } = {}) {
  const run = async () => {
    await sleep(MIN_INTERVAL_MS);
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  };

  // Ensure FIFO order globally across all rooms.
  const p = lastCfCall.then(run, run);
  lastCfCall = p.catch(() => {});
  return p;
}

async function fetchJson(url, opts) {
  return rateLimitedFetchJson(url, opts);
}

let cachedProblemset = null;
let cachedProblemsetAt = 0;
const PROBLEMSET_TTL_MS = Number(process.env.CF_PROBLEMSET_TTL_MS || 60 * 60 * 1000);

async function getProblemsetCached() {
  const now = Date.now();
  if (cachedProblemset && now - cachedProblemsetAt < PROBLEMSET_TTL_MS) return cachedProblemset;
  const data = await fetchJson(`${CF_API}/problemset.problems`);
  if (data.status !== "OK") throw new Error(data.comment || "Codeforces API error");
  cachedProblemset = data.result.problems || [];
  cachedProblemsetAt = now;
  return cachedProblemset;
}

async function fetchProblemset() {
  return await getProblemsetCached();
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function pickRandomProblemsByRatings(ratings) {
  const problems = await fetchProblemset();

  const picked = [];
  for (const rating of ratings) {
    const candidates = problems.filter((p) => p.rating === rating && p.contestId && p.index && p.name);
    if (candidates.length === 0) throw new Error(`No problems found for rating ${rating}.`);
    const p = pickRandom(candidates);
    picked.push({
      rating,
      contestId: p.contestId,
      index: p.index,
      name: p.name,
    });
  }

  return picked;
}

async function pickRandomProblemsByRatingRange({ minRating, maxRating, count }) {
  const problems = await fetchProblemset();
  const candidates = problems.filter(
    (p) => Number.isFinite(p.rating) && p.rating >= minRating && p.rating <= maxRating && p.contestId && p.index && p.name,
  );

  if (candidates.length < count) {
    throw new Error(`Only ${candidates.length} problems available between ${minRating}-${maxRating}.`);
  }

  const shuffled = shuffle([...candidates]);
  return shuffled.slice(0, count).map((p) => ({
    rating: p.rating,
    contestId: p.contestId,
    index: p.index,
    name: p.name,
  }));
}

async function fetchUserStatus(handle, { count = 100 } = {}) {
  const url = `${CF_API}/user.status?handle=${encodeURIComponent(handle)}&from=1&count=${count}`;
  const data = await rateLimitedFetchJson(url);
  if (data.status !== "OK") throw new Error(data.comment || "Codeforces API error");
  return data.result || [];
}

module.exports = {
  pickRandomProblemsByRatings,
  pickRandomProblemsByRatingRange,
  fetchUserStatus,
};
