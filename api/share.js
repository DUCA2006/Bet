import { fetchEventDetail, submitShareCode, allow, clientKey } from "./sportybet.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (!allow(clientKey(req), 10, 60_000)) {
      return res.status(429).json({ ok: false, error: "Too many code requests. Please wait a minute and try again." });
    }

    const payload = req.body || {};
    const incoming = Array.isArray(payload?.selections) ? payload.selections : [];
    
    if (!incoming.length || incoming.length > 30) {
      return res.status(400).json({ ok: false, error: "Between 1 and 30 confirmed selections are required." });
    }

    const legs = incoming.map((item) => ({
      eventId: String(item?.eventId || "").trim(),
      marketId: String(item?.marketId || "").trim(),
      specifier: String(item?.specifier || "").trim(),
      outcomeId: String(item?.outcomeId || "").trim(),
    }));

    // Re-check fixtures to ensure they haven't kicked off or suspended markets
    const uniqueIds = [...new Set(legs.map((leg) => leg.eventId))];
    const details = new Map();
    const queue = [...uniqueIds];
    
    while (queue.length) {
      const batch = queue.splice(0, 6);
      const settled = await Promise.allSettled(
        batch.map(async (eventId) => ({ eventId, detail: await fetchEventDetail(eventId) }))
      );
      for (const entry of settled) {
        if (entry.status === "fulfilled") {
          details.set(entry.value.eventId, entry.value.detail);
        }
      }
    }

    const now = Date.now();
    const problems = [];
    const verified = legs.map((leg, index) => {
      const detail = details.get(leg.eventId);
      if (!detail || !detail.ok) {
        problems.push({ index, reason: "This fixture could not be re-checked on SportyBet." });
        return null;
      }
      if (detail.event.startTime && detail.event.startTime <= now) {
        problems.push({ index, reason: "This match has already kicked off." });
        return null;
      }
      
      const targetMarket = detail.markets.find((m) => m.id === leg.marketId);
      const targetOutcome = targetMarket?.outcomes.find((o) => o.id === leg.outcomeId && o.isActive === 1);
      
      if (!targetMarket || !targetOutcome) {
        problems.push({ index, reason: "This market or outcome is no longer active on SportyBet." });
        return null;
      }

      return {
        eventId: leg.eventId,
        homeTeam: detail.event.homeTeam,
        awayTeam: detail.event.awayTeam,
        market: targetMarket.desc,
        outcome: targetOutcome.desc,
        odds: targetOutcome.odds,
      };
    });

    if (problems.length) {
      return res.status(400).json({
        ok: false,
        error: "SportyBet no longer accepts some of these selections, so no code was created.",
        problems,
      });
    }

    // Call SportyBet to generate the actual share code
    const share = await submitShareCode(
      legs.map((leg) => ({
        eventId: leg.eventId,
        marketId: leg.marketId,
        specifier: leg.specifier,
        outcomeId: leg.outcomeId,
      }))
    );

    if (!share.ok) {
      return res.status(502).json({
        ok: false,
        error: share.diagnostics?.errors?.[0] || "SportyBet did not confirm a booking code.",
        diagnostics: share.diagnostics,
      });
    }

    return res.status(200).json({
      ok: true,
      code: share.code,
      shareUrl: share.shareUrl,
      deadline: share.deadline,
      legs: verified,
    });

  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "The code could not be generated." });
  }
}
