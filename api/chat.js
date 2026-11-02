import { fetchUpcomingEvents } from "./sportybet.js";

export const config = { maxDuration: 60 };
const MODEL = "openai/gpt-oss-20b";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { message, history = [] } = req.body || {};
    if (!message) return res.status(400).json({ error: "Message is required" });

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Groq API key is not configured." });

    // Light fixture check only if specifically asked, keeping payload tiny
    let fixtureContext = "";
    const lower = message.toLowerCase();
    if (lower.includes("today") || lower.includes("match") || lower.includes("win") || lower.includes("odds")) {
      const listing = await fetchUpcomingEvents({ maxPages: 1 });
      if (listing.ok && listing.events.length > 0) {
        const snippet = listing.events.slice(0, 5).map(e => `- ${e.homeTeam} vs ${e.awayTeam} (${e.competition})`).join("\n");
        fixtureContext = `\n\n[Sample upcoming games available]:\n${snippet}`;
      }
    }

    const messages = [
      {
        role: "system",
        content: `You are DUCA, an intelligent football analysis assistant for SportyBet Nigeria. 
Be helpful, concise, and smart with football analysis. Keep your answers brief to stay within token limits.`
      },
      ...history.slice(-4).map((item) => ({
        role: item.role === "model" || item.role === "assistant" ? "assistant" : "user",
        content: String(Array.isArray(item.parts) ? item.parts.map((p) => p.text || "").join("") : item.content || "").slice(0, 300),
      })),
      { role: "user", content: message + fixtureContext }
    ];

    const groq = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: 0.5,
        max_tokens: 600, // Small token cap to never exceed TPM
      }),
    });

    const data = await groq.json();
    if (!groq.ok) {
      return res.status(502).json({
        error: data.error?.message || "Groq API request failed due to rate limits. Please wait 10 seconds."
      });
    }

    const reply = data.choices?.[0]?.message?.content?.trim() || "I'm here! What match are we looking at?";

    return res.status(200).json({ ok: true, reply, code: null });
  } catch (error) {
    console.error("DUCA server error:", error);
    return res.status(500).json({ error: error?.message || "Something went wrong." });
  }
}
