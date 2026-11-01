// SportyBet Nigeria API client — fixtures, event markets, share (booking) codes.
const BASE = "https://www.sportybet.com/api/ng";
const FOOTBALL = "sr:sport:1";
const PAGE_SIZE = 100;
const CACHE_TTL = 90_000;
const MAX_PAGES = 18;
const HEADERS = {
  Accept: "application/json",
  "Accept-Language": "en-NG,en;q=0.9",
  "User-Agent": "BetSnapAI/1.0 (bet slip matching utility)",
};

let cache = null;
const buckets = new Map();

function errMessage(e) {
  return e && e.message ? String(e.message) : String(e);
}

/** Client IP used for the simple in-memory rate limiter. */
export function clientKey(req) {
  const fwd = req.headers.get("x-forwarded-for") || "";
  const ip = fwd.split(",")[0].trim() || req.headers.get("x-real-ip") || "";
  return ip || "anonymous";
}

/** Fixed-window rate limiter. */
export function allow(key, limit = 20, windowMs = 60_000) {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now > bucket.reset) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

async function request(path, init = {}, timeoutMs = 15000) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { ...HEADERS, ...(init.headers || {}) },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, text, contentType: res.headers.get("content-type") || "" };
}

function compactEvent(raw, tournament) {
  if (!raw || !raw.eventId) return null;
  return {
    eventId: String(raw.eventId),
    homeTeam: String(raw.homeTeamName || "").trim(),
    awayTeam: String(raw.awayTeamName || "").trim(),
    competition: String(tournament?.name || raw?.sport?.category?.tournament?.name || "").trim(),
    category: String(tournament?.categoryName || raw?.sport?.category?.name || "").trim(),
    startTime: Number(raw.estimateStartTime || 0),
    marketStatus: String(raw.matchStatus || ""),
    matchStatus: String(raw.matchStatus || ""),
    marketCount: Array.isArray(raw.markets) ? raw.markets.length : 0,
  };
}

/** All upcoming football fixtures (paginated, deduped, 90s cache). */
export async function fetchUpcomingEvents(opts = {}) {
  const maxPages = Math.max(1, Math.min(Number(opts.maxPages) || MAX_PAGES, MAX_PAGES));

  if (!opts.force && cache && Date.now() - cache.at < CACHE_TTL) {
    return {
      ok: true,
      cached: true,
      events: cache.events,
      diagnostics: {
        ...cache.diagnostics,
        cached: true,
        ageSeconds: Math.round((Date.now() - cache.at) / 1000),
      },
    };
  }

  const started = Date.now();
  const diagnostics = {
    service: "SportyBet Nigeria — factsCenter/pcUpcomingEvents",
    reachable: false,
    httpStatus: null,
    bizCode: null,
    apiMessage: null,
    pagesChecked: 0,
    eventsReceived: 0,
    upcomingEvents: 0,
    eventsWithMarkets: 0,
    totalAvailable: 0,
    lastRefreshed: new Date().toISOString(),
    durationMs: 0,
    cached: false,
    errors: [],
  };

  const pageUrl = (page) =>
    `/factsCenter/pcUpcomingEvents?sportId=${encodeURIComponent(FOOTBALL)}&marketId=1&pageSize=${PAGE_SIZE}&pageNum=${page}`;

  let first;
  try {
    first = await request(pageUrl(1));
  } catch (e) {
    diagnostics.errors.push(`Fixture service unreachable: ${errMessage(e)}`);
    diagnostics.durationMs = Date.now() - started;
    return { ok: false, cached: false, events: [], diagnostics };
  }

  diagnostics.httpStatus = first.status;
  if (!first.json) {
    diagnostics.responsePreview = String(first.text || "").replace(/\s+/g, " ").slice(0, 240);
    diagnostics.contentType = first.contentType || null;
    diagnostics.errors.push(
      `Fixture service returned a non-JSON response (HTTP ${first.status}). It is likely blocking server requests right now.`,
    );
    diagnostics.durationMs = Date.now() - started;
    return { ok: false, cached: false, events: [], diagnostics };
  }

  diagnostics.bizCode = first.json.bizCode ?? null;
  diagnostics.apiMessage = first.json.message ?? null;

  if (first.status !== 200 || Number(first.json.bizCode) !== 10000) {
    diagnostics.errors.push(
      `Fixture service rejected the request (HTTP ${first.status}, code ${
        first.json.bizCode ?? "none"
      }: ${first.json.message || first.json.innerMsg || "no message"}).`,
    );
    diagnostics.durationMs = Date.now() - started;
    return { ok: false, cached: false, events: [], diagnostics };
  }

  diagnostics.reachable = true;
  const total = Number(first.json?.data?.totalNum || 0);
  diagnostics.totalAvailable = total;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pagesToFetch = Math.min(totalPages, maxPages);

  const collected = [];
  const addPage = (json) => {
    const tours = Array.isArray(json?.data?.tournaments) ? json.data.tournaments : [];
    for (const tour of tours) {
      const events = Array.isArray(tour?.events) ? tour.events : [];
      for (const raw of events) {
        const compact = compactEvent(raw, tour);
        if (compact) collected.push(compact);
      }
    }
  };

  addPage(first.json);
  diagnostics.pagesChecked = 1;

  const pending = [];
  for (let page = 2; page <= pagesToFetch; page += 1) pending.push(page);

  while (pending.length) {
    const batch = pending.splice(0, 6);
    const settled = await Promise.allSettled(
      batch.map(async (page) => ({ page, result: await request(pageUrl(page)) })),
    );
    for (const entry of settled) {
      if (entry.status !== "fulfilled") {
        diagnostics.errors.push(`A fixture page failed: ${errMessage(entry.reason)}`);
        continue;
      }
      const { page, result } = entry.value;
      diagnostics.pagesChecked += 1;
      if (result.status !== 200 || !result.json || Number(result.json.bizCode) !== 10000) {
        diagnostics.errors.push(`Fixture page ${page} failed (HTTP ${result.status}).`);
        continue;
      }
      addPage(result.json);
    }
  }

  const now = Date.now();
  const seen = new Set();
  const events = collected.filter((event) => {
    if (!event.eventId || seen.has(event.eventId)) return false;
    if (!event.homeTeam || !event.awayTeam) return false;
    if (event.startTime && event.startTime < now) return false;
    seen.add(event.eventId);
    return true;
  });

  diagnostics.eventsReceived = collected.length;
  diagnostics.upcomingEvents = events.length;
  diagnostics.eventsWithMarkets = events.filter((event) => event.marketCount > 0).length;
  diagnostics.pagesAvailable = totalPages;
  diagnostics.durationMs = Date.now() - started;

  cache = { at: Date.now(), events, diagnostics: { ...diagnostics } };
  return { ok: true, cached: false, events, diagnostics };
}

/** All markets + outcomes for one fixture. */
export async function fetchEventDetail(eventId) {
  const diagnostics = {
    service: `SportyBet Nigeria — factsCenter/event (${eventId})`,
    reachable: false,
    httpStatus: null,
    bizCode: null,
    apiMessage: null,
    marketCount: 0,
    errors: [],
  };

  try {
    const result = await request(`/factsCenter/event?productId=3&eventId=${encodeURIComponent(eventId)}`);
    diagnostics.httpStatus = result.status;
    diagnostics.bizCode = result.json?.bizCode ?? null;
    diagnostics.apiMessage = result.json?.message ?? null;

    if (result.status !== 200 || !result.json || Number(result.json.bizCode) !== 10000 || !result.json.data) {
      diagnostics.errors.push(
        `SportyBet returned no event detail (HTTP ${result.status}, code ${result.json?.bizCode ?? "none"}).`,
      );
      return { ok: false, event: null, markets: [], diagnostics };
    }

    diagnostics.reachable = true;
    const raw = result.json.data;
    const markets = (Array.isArray(raw.markets) ? raw.markets : []).map((market) => ({
      id: String(market.id),
      desc: String(market.desc || market.name || ""),
      specifier: String(market.specifier || ""),
      title: String(market.title || ""),
      status: Number(market.status ?? 0),
      outcomes: (Array.isArray(market.outcomes) ? market.outcomes : []).map((outcome) => ({
        id: String(outcome.id),
        desc: String(outcome.desc || ""),
        odds: String(outcome.odds || ""),
        isActive: Number(outcome.isActive ?? 0),
      })),
    }));

    const event = {
      eventId: String(raw.eventId || eventId),
      homeTeam: String(raw.homeTeamName || ""),
      awayTeam: String(raw.awayTeamName || ""),
      competition: String(raw?.sport?.category?.tournament?.name || ""),
      category: String(raw?.sport?.category?.name || ""),
      startTime: Number(raw.estimateStartTime || 0),
      matchStatus: String(raw.matchStatus || ""),
    };

    diagnostics.marketCount = markets.length;
    return { ok: true, event, markets, diagnostics };
  } catch (e) {
    diagnostics.errors.push(`Event detail request failed: ${errMessage(e)}`);
    return { ok: false, event: null, markets: [], diagnostics };
  }
}

/** Creates a real SportyBet booking (share) code from selections. */
export async function submitShareCode(selections) {
  const diagnostics = {
    service: "SportyBet Nigeria — orders/share",
    httpStatus: null,
    bizCode: null,
    apiMessage: null,
    errors: [],
  };

  try {
    const result = await request(
      "/orders/share",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selections }),
      },
      20000,
    );

    diagnostics.httpStatus = result.status;
    const json = result.json;
    diagnostics.bizCode = json?.bizCode ?? null;
    diagnostics.apiMessage = json?.message ?? null;

    if (!json) {
      diagnostics.errors.push(`SportyBet returned a non-JSON share response (HTTP ${result.status}).`);
      return { ok: false, diagnostics };
    }
    if (result.status !== 200) {
      diagnostics.errors.push(`SportyBet share endpoint failed with HTTP ${result.status}.`);
      return { ok: false, diagnostics };
    }
    if (Number(json.bizCode) !== 10000) {
      diagnostics.errors.push(
        `SportyBet refused to create the code: ${json.message || json.innerMsg || "unknown reason"}.`,
      );
      return { ok: false, diagnostics };
    }

    const code = String(json?.data?.shareCode || "").trim();
    if (!/^[A-Za-z0-9]{4,12}$/.test(code)) {
      diagnostics.errors.push("SportyBet did not return a valid share code.");
      return { ok: false, diagnostics };
    }

    return {
      ok: true,
      diagnostics,
      code: code.toUpperCase(),
      shareUrl: String(json?.data?.shareURL || `https://www.sportybet.com/ng/?shareCode=${code}`),
      deadline: json?.data?.deadline ? Number(json.data.deadline) : null,
      legs: Array.isArray(json?.data?.outcomes) ? json.data.outcomes.length : null,
    };
  } catch (e) {
    diagnostics.errors.push(`Share request failed: ${errMessage(e)}`);
    return { ok: false, diagnostics };
  }
}
