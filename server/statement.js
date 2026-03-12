const cheerio = require("cheerio");
const sanitizeHtml = require("sanitize-html");

const statementCache = new Map(); // key -> { html, fetchedAt }
const TTL_MS = Number(process.env.CF_STATEMENT_TTL_MS || 6 * 60 * 60 * 1000);

function absolutizeUrls(html) {
  return html
    .replaceAll('src="//', 'src="https://')
    .replaceAll('href="//', 'href="https://')
    .replaceAll('src="/', 'src="https://codeforces.com/')
    .replaceAll('href="/', 'href="https://codeforces.com/');
}

function requestHeaders() {
  // Use a realistic browser UA; some networks get 403 with custom UAs.
  return {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://codeforces.com/",
  };
}

async function fetchStatementPageWithFallback(urls) {
  let lastErr = null;
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: requestHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      return { url, text };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("Failed to fetch statement.");
}

function cleanStatementHtml(rawHtml) {
  const absolute = absolutizeUrls(rawHtml);
  return sanitizeHtml(absolute, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      "img",
      "h1",
      "h2",
      "span",
      "div",
      "pre",
      "code",
      "sup",
      "sub",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
    ]),
    allowedAttributes: {
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt", "title"],
      "*": ["class", "style"],
    },
    allowedSchemes: ["http", "https", "data"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noreferrer" }),
    },
  });
}

async function fetchProblemStatementHtml({ contestId, index }) {
  const key = `${contestId}-${index}`;
  const now = Date.now();
  const cached = statementCache.get(key);
  if (cached && now - cached.fetchedAt < TTL_MS) return { key, html: cached.html, cached: true };

  // Prefer official mirror first (often avoids 403 in locked-down networks).
  const urls = [
    `https://mirror.codeforces.com/problemset/problem/${contestId}/${index}`,
    `https://codeforces.com/problemset/problem/${contestId}/${index}`,
    `https://mirror.codeforces.com/contest/${contestId}/problem/${index}`,
    `https://codeforces.com/contest/${contestId}/problem/${index}`,
  ];
  const { text: page } = await fetchStatementPageWithFallback(urls);

  const $ = cheerio.load(page);
  const node = $(".problem-statement").first();
  if (!node || node.length === 0) throw new Error("Could not locate statement on Codeforces page.");

  // Remove script tags etc by taking only the statement block.
  const rawHtml = node.html() || "";
  const cleaned = cleanStatementHtml(rawHtml);

  statementCache.set(key, { html: cleaned, fetchedAt: now });
  return { key, html: cleaned, cached: false };
}

module.exports = { fetchProblemStatementHtml };

