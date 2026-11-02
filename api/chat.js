import { fetchUpcomingEvents, fetchEventDetail, submitShareCode } from "./sportybet.js";

export const config = { maxDuration: 60 };

const MODEL = "openai/gpt-oss-20b";
const MAX_FIXTURES = 28;
const MAX_LEGS = 30;
const WINDOW_HOURS = 48;

const SYSTEM_PROMPT = `You are DUCA — a friendly football betting analyst for SportyBet Nigeria. You are warm and fun, and you calculate like a scientist: every pick is backed by statistics.

You receive LIVE FIXTURE DATA, one JSON object per line:
- e = eventId, t = kick-off (Africa/Lagos), h = home team, a = away team, c = competition
- m = markets: id, s (specifier), d (description), o = outcomes with id, d (selection), p (decimal odds)

Rules:
1. Only use teams, odds and ids from the data. Never invent fixtures, odds or ids.
2. Open with a friendly line ("Okay, let me check the safest games for you 📊"), then analyse statistically: convert each candidate's odds to implied probability (1/odds as a %), quote that number, and explain why the pick covers (short price, double-chance cover, goals line, market agreement).
3. Tag each pick [Banker], [Solid] or [Lean] with a short reason.
4. If the user gives a target (e.g. "100 odds, 25 games"), build exactly that: start from the safest picks, add games one by one until the multiplied odds reach the target, and state the final combined odds and the game count you used. Respect the number of games asked for (default 5, maximum 30).
5. Booking codes: set wantsCode true and put every pick in picks using the EXACT ids: eventId = e, marketId = m.id, specifier = m.s, outcomeId = o.id. Diversify across fixtures and markets; never take two outcomes from the same market of the same game.
6. If the message is not about football or betting, answer in one friendly line and steer back.
7. End every answer with two final lines: first a fun, feel-good line in the spirit of Ted Lasso (e.g. "Sometimes we just need a little more belief 🧡"), then exactly: "Always gamble with what you can afford to lose."
8. Return JSON only in this shape:
{"reply": string, "wantsCode": boolean, "picks": [{"eventId": string, "marketId": string, "specifier": string, "outcomeId": string}]}`;

function lagosLabel(ts) {
  const d = new Date(ts);
  return `${d.toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", weekday: "short", day: "numeric", month: "short" })} ${d.toLocaleTimeString("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit" })} WAT`;
}

function safeMarkets(markets) {
  const picked = [];
  const wanted = [
    { id: "1" },
    { id: "10" },
    { id: "11" },
    { id: "29" },
    { id: "18", specifier: "total=1.5" },
    { id: "18", specifier: "total=2.5" },
  ];
  for (const want of wanted) {
    const market = markets.find(
      (m) => m.id === want.id && (!want.specifier || m.specifier === want.specifier),
    );
    if (!market || market.status === 1) continue;
    const outcomes = market.outcomes.filter(
      (o) => o.isActive === 1 && Number(o.odds) > 1.01 && Number(o.odds) < 4,
    );
    if (outcomes.length) picked.push({ ...market, outcomes: outcomes.slice(0, 4) });
  }
  return picked;
}

function fixtureJson(f) {
  return JSON.stringify({
    e: f.eventId,
    t: lagosLabel(f.startTime),
    h: f.homeTeam,
    a: f.awayTeam,
    c: f.competition || "Football",
    m: f.markets.map((m) => ({
      id: m.id,
      s: m.specifier,
      d: m.desc,
      o: m.outcomes.map((o) => ({ id: o.id, d: o.desc, p: Number(o.odds).toFixed(2) })),
    })),
  });
}

function parseJson(text) {
  try { return JSON.parse(text); } catch {}
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch {}
  }
  return null;
}

function resolvePicks(picks, pool) {
  const byEvent = new Map(pool.map((f) => [f.eventId, f]));
  const seen = new Set();
  const legs = [];

  for (const pick of Array.isArray(picks) ? picks : []) {
    const fixture = byEvent.get(String(pick?.eventId || ""));
    if (!fixture) continue;
    const market = fixture.markets.find(
      (m) => m.id === String(pick?.marketId) && (m.specifier || "") === String(pick?.specifier || ""),
    );
    if (!market) continue;
    const outcome = market.outcomes.find((o) => o.id === String(pick?.outcomeId) && o.isActive === 1);
    if (!outcome) continue;

    const key = `${fixture.eventId}|${market.id}|${market.specifier}|${outcome.id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    legs.push({
      selection: {
        eventId: fixture.eventId,
        marketId: market.id,
        specifier: market.specifier,
        outcomeId: outcome.id,
      },
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      market: `${market.desc}${market.specifier ? ` (${market.specifier.replace(/\|/g, ", ")})` : ""}`,
      selection: outcome.desc,
      odds: Number(outcome.odds),
    });
    if (legs.length >= MAX_LEGS) break;
  }
  return legs;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { message, history = [] } = req.body || {};
    if (!message) return res.status(400).json({ error: "Message is required" });

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Groq API key is not configured." });

    const now = Date.now();
    const listing = await fetchUpcomingEvents({ maxPages: 6 });
    if (!listing.ok || !listing.events.length) {
      return res.status(502).json({
        error: listing.diagnostics?.errors?.[0] || "SportyBet fixtures are unavailable right now.",
      });
    }

    const playable = listing.events
      .filter((e) => e.startTime > now && e.startTime <= now + WINDOW_HOURS * 3600000)
      .sort((a, b) => a.startTime - b.startTime)
      .slice(0, MAX_FIXTURES);

    const pool = [];
    for (let i = 0; i < playable.length; i += 10) {
      const batch = playable.slice(i, i + 10);
      const settled = await Promise.allSettled(batch.map((e) => fetchEventDetail(e.eventId)));
      settled.forEach((entry) => {
        if (entry.status !== "fulfilled") return;
        const detail = entry.value;
        if (!detail.ok || !detail.event?.startTime || detail.event.startTime <= now) return;
        const markets = safeMarkets(detail.markets);
        if (!markets.length) return;
        pool.push({ ...detail.event, markets });
      });
    }

    if (!pool.length) {
      return res.status(502).json({ error: "No playable SportyBet games with open markets were found right now." });
    }

    const fixtureBlock =
      `LIVE SPORTYBET FIXTURES (next ${WINDOW_HOURS}h, Africa/Lagos):\n` +
      pool.map(fixtureJson).join("\n");

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history.slice(-6).map((item) => ({
        role: item.role === "model" || item.role === "assistant" ? "assistant" : "user",
        content: String(
          Array.isArray(item.parts) ? item.parts.map((p) => p.text || "").join("") : item.content || "",
        ).slice(0, 600),
      })),
      { role: "user", content: `${fixtureBlock}\n\nUSER: ${message}` },
    ];

    const groq = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: 0.4,
        max_tokens: 2400,
        response_format: { type: "json_object" },
      }),
    });

    const data = await groq.json();
    if (!groq.ok) {
      console.error("Groq error:", data);
      return res.status(502).json({
        error: data.error?.message || "Groq API request failed.",
        status: data.error?.type || "UNKNOWN",
      });
    }

    const raw = data.choices?.[0]?.message?.content || "";
    const parsed = parseJson(raw);
    if (!parsed?.reply) return res.status(502).json({ error: "DUCA received an empty response." });

    let reply = String(parsed.reply).trim();
    let code = null;

    if (parsed.wantsCode) {
      const legs = resolvePicks(parsed.picks, pool);
      if (!legs.length) {
        reply += "\n\nI couldn't map those picks to live SportyBet markets, so no booking code was created. Ask again and I'll rebuild it.";
      } else {
        const share = await submitShareCode(
          legs.map((l) => ({
            eventId: l.selection.eventId,
            marketId: l.selection.marketId,
            specifier: l.selection.specifier,
            outcomeId: l.selection.outcomeId,
          })),
        );
        if (share.ok) {
          const total = legs.reduce((acc, l) => acc * l.odds, 1);
          code = {
            code: share.code,
            shareUrl: share.shareUrl,
            deadline: share.deadline ? new Date(share.deadline).toISOString() : null,
            totalOdds: Math.round(total * 100) / 100,
            legs: legs.map((l) => ({
              homeTeam: l.homeTeam,
              awayTeam: l.awayTeam,
              market: l.market,
              selection: l.selection,
              odds: l.odds,
            })),
          };
        } else {
          reply += `\n\nI built the slip but SportyBet refused the code: ${
            share.diagnostics?.errors?.[0] || "unknown reason"
          }`;
        }
      }
    }

    return res.status(200).json({ ok: true, reply, code, gamesAnalysed: pool.length });
  } catch (error) {
    console.error("DUCA server error:", error);
    return res.status(500).json({ error: error?.message || "Something went wrong. Please try again." });
  }
}
