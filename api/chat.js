import { fetchUpcomingEvents, fetchEventDetail, submitShareCode } from "./sportybet.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { message, history = [] } = req.body;
    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Gemini API key is not configured." });
    }

    let liveFixturesContext = "";
    const lowerMsg = message.toLowerCase();
         
    if (lowerMsg.includes("today") || lowerMsg.includes("matches") || lowerMsg.includes("fixtures") || lowerMsg.includes("prediction")) {
      try {
        const fixtureRes = await fetchUpcomingEvents({ maxPages: 1 });
        if (fixtureRes.ok && fixtureRes.events.length > 0) {
          const sampleEvents = fixtureRes.events.slice(0, 10).map(e => 
             `- [ID: ${e.eventId}] ${e.homeTeam} vs ${e.awayTeam} (${e.competition})`
          ).join("\n");
                   
          liveFixturesContext = `\n\n[LIVE SPORTYBET FIXTURES]:\n${sampleEvents}`;
        }
      } catch (err) {
        console.error("SportyBet background fetch error:", err);
      }
    }

    const contents = [
      ...history.slice(-10),
      {
        role: "user",
        parts: [{ text: message + liveFixturesContext }]
      }
    ];

    // List of models to try in order if one is experiencing high demand
    const modelsToTry = [
      "gemini-3.8-flash",
      "gemini-2.5-flash",
      "gemini-1.5-flash"
    ];

    let data = null;
    let success = false;

    for (const modelName of modelsToTry) {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{
                text: `You are DUCA, an intelligent football analysis assistant integrated with SportyBet Nigeria. Your speciality is football statistics, match analysis, live odds evaluation, and generating valid betting booking share codes. Use simple English and clear explanations.`
              }]
            },
            contents,
            generationConfig: {
              temperature: 0.5,
              maxOutputTokens: 1000
            }
          })
        }
      );

      data = await response.json();
      if (response.ok) {
        success = true;
        break;
      } else {
        console.warn(`Model ${modelName} failed, trying next fallback...`, data);
      }
    }

    if (!success) {
      return res.status(502).json({
        error: data?.error?.message || "All AI models are currently busy due to high demand. Please try again in a moment.",
        status: data?.error?.status || "HIGH_DEMAND"
      });
    }

    const answer = data.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "")
      .join("")
      .trim();

    if (!answer) {
      return res.status(502).json({ error: "DUCA received an empty response." });
    }

    return res.status(200).json({ reply: answer });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Something went wrong. Try again." });
  }
}
