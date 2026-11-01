import { fetchUpcomingEvents, fetchEventDetail, submitShareCode } from "./sportybet.js";

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

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: "Gemini API key is not configured."
      });
    }

    let liveFixturesContext = "";
    const lowerMsg = message.toLowerCase();
         
    if (lowerMsg.includes("today") || lowerMsg.includes("matches") || lowerMsg.includes("fixtures") || lowerMsg.includes("prediction")) {
      const fixtureRes = await fetchUpcomingEvents({ maxPages: 2 });
      if (fixtureRes.ok && fixtureRes.events.length > 0) {
        const sampleEvents = fixtureRes.events.slice(0, 15).map(e => 
           `- [ID: ${e.eventId}] ${e.homeTeam} vs ${e.awayTeam} (${e.competition}) at ${new Date(e.startTime).toLocaleString()}`
        ).join("\n");
                 
        liveFixturesContext = `\n\n[LIVE SPORTYBET FIXTURES RETRIEVED]:\n${sampleEvents}`;
      }
    }

    const contents = [
      ...history.slice(-12),
      {
        role: "user",
        parts: [{ text: message + liveFixturesContext }]
      }
    ];

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text: `You are DUCA, an intelligent football analysis assistant integrated with SportyBet Nigeria. Your speciality is football statistics, match analysis, live odds evaluation, and generating valid betting booking share codes. Your responsibilities: 1. Analyse football matches using real fixture data when available. 2. Explain recent team performance, home/away form, and head-to-head records. 3. Reference live SportyBet fixture data provided in the prompt context to ground your predictions. 4. If asked to generate a booking code or slip, explain the selections clearly. 5. Never invent false fixture details if real data is missing; explain uncertainty honestly. Use simple English and clear explanations. Your name is DUCA.`
            }]
          },
          contents,
          generationConfig: {
            temperature: 0.5,
            maxOutputTokens: 1500
          }
        })
      }
    );

    const data = await response.json();
    if (!response.ok) {
      console.error("Gemini error:", data);
      return res.status(502).json({
        error: data.error?.message || "Gemini API request failed.",
        status: data.error?.status || "UNKNOWN"
      });
    }

    const answer = data.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "")
      .join("")
      .trim();

    if (!answer) {
      return res.status(502).json({
        error: "DUCA received an empty response."
      });
    }

    return res.status(200).json({
      reply: answer
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({
      error: "Something went wrong. Try again."
    });
  }
}
