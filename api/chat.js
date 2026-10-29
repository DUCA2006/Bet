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
    
    const contents = [
      ...history.slice(-12),
      {
        role: "user",
        parts: [{ text: message }]
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
              text: `
You are DUCA, an intelligent football analysis assistant.

Your speciality is football statistics, match analysis,
football predictions and betting market analysis.

Your responsibilities:

1. Analyse football matches.
2. Explain recent team performance.
3. Consider home and away form.
4. Consider head-to-head records.
5. Consider injuries and suspensions when verified data is provided.
6. Explain betting markets.
7. Estimate probabilities carefully.
8. Explain the risks of accumulator bets.

IMPORTANT RULES:

- Never invent football statistics.
- Never pretend to have live match information.
- Never claim to have checked SportyBet if you haven't.
- Never fabricate booking codes.
- Never describe 100 odds as safe or guaranteed.
- Explain uncertainty honestly.

If live football data is unavailable, tell the user.
Use simple English and clear explanations.
Your name is DUCA.
`
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
        error: "Gemini could not process your request."
      });
    }
    
    const answer =
      data.candidates?.[0]?.content?.parts
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