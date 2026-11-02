import {
  fetchUpcomingEvents,
  fetchEventDetail,
  submitShareCode
} from "./sportybet.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const { message, history = [] } = req.body;
    if (!message) {
      return res.status(400).json({
        error: "Message is required"
      });
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: "Groq API key is not configured."
      });
    }

    let liveFixturesContext = "";
    const lowerMsg = message.toLowerCase();
    if (
      lowerMsg.includes("today") ||
      lowerMsg.includes("matches") ||
      lowerMsg.includes("fixtures") ||
      lowerMsg.includes("prediction")
    ) {
      const fixtureRes = await fetchUpcomingEvents({
        maxPages: 2
      });
      if (fixtureRes.ok && fixtureRes.events.length > 0) {
        const sampleEvents = fixtureRes.events
          .slice(0, 15)
          .map(e =>
            `- [ID: ${e.eventId}] ${e.homeTeam} vs ${e.awayTeam} (${e.competition}) at ${new Date(e.startTime).toLocaleString()}`
          )
          .join("\n");
        liveFixturesContext = ` [LIVE SPORTYBET FIXTURES RETRIEVED]: ${sampleEvents}`;
      }
    }

    const messages = [
      {
        role: "system",
        content: `You are DUCA, an intelligent football analysis assistant integrated with SportyBet Nigeria. Your speciality is football statistics, match analysis, predictions, and SportyBet fixtures. 

YOUR RESPONSIBILITIES:
1. Analyse football matches using real fixture data when available.
2. When users ask for predictions or accumulator tips, recommend specific outcomes (Home Win, Away Win, Over 2.5, etc.) and include a special widget tag at the very end of your response in this exact format:
[SPORTYBET_SLIP: {"eventId":"sr:match:XXXXXXX", "marketId":"1", "specifier":"", "outcomeId":"1"}]
(Use marketId "1" for 1X2 match winner, outcomeId "1" for home team win, "2" for away team win, or "X" for draw).
3. Never invent fake fixture IDs. Only use IDs provided in the [LIVE SPORTYBET FIXTURES RETRIEVED] context.
4. Use simple English and clear explanations. Your name is DUCA.`
      },
      ...history.slice(-12).map(item => ({
        role: item.role === "model" || item.role === "assistant"
          ? "assistant"
          : "user",
        content: Array.isArray(item.parts)
          ? item.parts.map(part => part.text || "").join("")
          : item.content || ""
      })),
      {
        role: "user",
        content: message + liveFixturesContext
      }
    ];

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "openai/gpt-oss-20b",
          messages,
          temperature: 0.5,
          max_tokens: 1500
        })
      }
    );

    const data = await response.json();
    if (!response.ok) {
      console.error("Groq error:", data);
      return res.status(502).json({
        error: data.error?.message || "Groq API request failed.",
        status: data.error?.type || "UNKNOWN"
      });
    }

    const answer = data.choices?.[0]?.message?.content?.trim();
    if (!answer) {
      return res.status(502).json({
        error: "DUCA received an empty response."
      });
    }

    return res.status(200).json({
      reply: answer
    });

  } catch (error) {
    console.error("DUCA server error:", error);
    return res.status(500).json({
      error: error.message || "Something went wrong. Please try again."
    });
  }
}
