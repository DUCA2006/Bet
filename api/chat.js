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
    // GROQ API KEY
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: "Groq API key is not configured."
      });
    }
    // SPORTYBET FIXTURES
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
        liveFixturesContext = `
[LIVE SPORTYBET FIXTURES RETRIEVED]:
${sampleEvents}`;
      }
    }
    // CONVERSATION HISTORY
    const messages = [
      {
        role: "system",
        content: `You are DUCA, an intelligent football analysis assistant integrated with SportyBet Nigeria.
Your speciality is:
- Football statistics
- Match analysis
- Football predictions
- Betting odds evaluation
- SportyBet fixtures
- Betting booking share codes
YOUR RESPONSIBILITIES:
1. Analyse football matches using real fixture data when available.
2. Explain recent team performance, home and away form, and head-to-head records.
3. Reference SportyBet fixture data and match IDs provided in the prompt context.
4. When users ask for predictions or accumulator slips, display the match details alongside their specific SportyBet fixture IDs (e.g., [ID: sr:match:XXXXX]) so they can map them to booking codes.
5. Explain predictions clearly and simply.
6. Never invent fixtures, odds, statistics, or fake booking codes.
7. Never claim a prediction is guaranteed.
8. If real data is unavailable, explain that honestly.
9. Use simple English.
10. Your name is DUCA.
IMPORTANT:
You are an AI football analysis assistant. Your predictions are estimates, not guaranteed outcomes.
`
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
    // GROQ AI REQUEST
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
    // HANDLE API ERRORS
    if (!response.ok) {
      console.error("Groq error:", data);
      return res.status(502).json({
        error:
          data.error?.message ||
          "Groq API request failed.",
        status:
          data.error?.type ||
          "UNKNOWN"
      });
    }
    // EXTRACT AI RESPONSE
    const answer = data.choices?.[0]?.message?.content
      ?.trim();
    if (!answer) {
      return res.status(502).json({
        error: "DUCA received an empty response."
      });
    }
    // SUCCESS
    return res.status(200).json({
      reply: answer
    });
  } catch (error) {
    console.error("DUCA server error:", error);
    return res.status(500).json({
      error:
        error.message ||
        "Something went wrong. Please try again."
    });
  }
}
