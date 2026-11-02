import {

  fetchUpcomingEvents,

  fetchEventDetail,

  submitShareCode

} from "./sportybet.js";

const GROQ_MODEL = "openai/gpt-oss-20b";

const MAX_FIXTURES = 10;

const MAX_MARKETS_PER_EVENT = 35;

const MAX_OUTCOMES_PER_MARKET = 3;

const MAX_SELECTIONS = 10;

function isBookingRequest(message) {

  const text = String(message || "").toLowerCase();

  const keywords = [

    "booking code",

    "booking-code",

    "share code",

    "share-code",

    "generate code",

    "create code",

    "bet slip",

    "betslip",

    "accumulator",

    "acca",

    "odds",

    "over 1.5",

    "over 2.5",

    "over 3.5",

    "under 1.5",

    "under 2.5",

    "under 3.5",

    "both teams to score",

    "btts",

    "double chance",

    "1x2",

    "predict matches",

    "safest"

  ];

  return keywords.some(keyword => text.includes(keyword));

}

function isFriendlyChat(message) {

  const text = String(message || "").trim().toLowerCase();

  return [

    "hi",

    "hello",

    "hey",

    "how are you",

    "good morning",

    "good afternoon",

    "good evening",

    "thanks",

    "thank you"

  ].some(greeting => text === greeting || text.startsWith(greeting + " "));

}

function cleanHistory(history = []) {

  return history

    .slice(-10)

    .map(item => ({

      role:

        item.role === "assistant" ||

        item.role === "model"

          ? "assistant"

          : "user",

      content: Array.isArray(item.parts)

        ? item.parts.map(part => part.text || "").join("")

        : String(item.content || "")

    }))

    .filter(item => item.content.trim());

}

function safeNumber(value) {

  const number = Number(value);

  return Number.isFinite(number) ? number : null;

}

function formatDate(timestamp) {

  if (!timestamp) return "Time unavailable";

  return new Date(timestamp).toLocaleString("en-NG", {

    dateStyle: "medium",

    timeStyle: "short",

    timeZone: "Africa/Lagos"

  });

}

function extractJson(text) {

  if (!text) return null;

  try {

    return JSON.parse(text);

  } catch {}

  const start = text.indexOf("{");

  const end = text.lastIndexOf("}");

  if (start >= 0 && end > start) {

    try {

      return JSON.parse(text.slice(start, end + 1));

    } catch {}

  }

  return null;

}

async function askGroq(apiKey, messages, options = {}) {

  const response = await fetch(

    "https://api.groq.com/openai/v1/chat/completions",

    {

      method: "POST",

      headers: {

        "Content-Type": "application/json",

        Authorization: `Bearer ${apiKey}`

      },

      body: JSON.stringify({

        model: GROQ_MODEL,

        messages,

        temperature: options.temperature ?? 0.5,

        max_tokens: options.max_tokens ?? 1600,

        ...(options.jsonMode

          ? { response_format: { type: "json_object" } }

          : {})

      })

    }

  );

  const data = await response.json();

  if (!response.ok) {

    console.error("Groq error:", data);

    throw new Error(

      data.error?.message || "DUCA could not reach the AI service."

    );

  }

  const content = data.choices?.[0]?.message?.content?.trim();

  if (!content) {

    throw new Error("DUCA received an empty AI response.");

  }

  return content;

}

async function getRealMarketCatalogue() {

  const fixtureResult = await fetchUpcomingEvents({

    maxPages: 2

  });

  if (!fixtureResult.ok || !fixtureResult.events?.length) {

    return {

      ok: false,

      message: "SportyBet fixtures are currently unavailable.",

      diagnostics: fixtureResult.diagnostics

    };

  }

  const now = Date.now();

  const fixtures = fixtureResult.events

    .filter(event => event.startTime > now)

    .sort((a, b) => a.startTime - b.startTime)

    .slice(0, MAX_FIXTURES);

  const catalogue = [];

  // Fetch event details in small batches to avoid overwhelming SportyBet.

  for (let i = 0; i < fixtures.length; i += 3) {

    const batch = fixtures.slice(i, i + 3);

    const results = await Promise.allSettled(

      batch.map(event => fetchEventDetail(event.eventId))

    );

    for (let index = 0; index < results.length; index++) {

      const result = results[index];

      const fixture = batch[index];

      if (result.status !== "fulfilled") continue;

      const detail = result.value;

      if (!detail.ok || !Array.isArray(detail.markets)) continue;

      const markets = detail.markets

        .filter(market => market && market.id)

        .slice(0, MAX_MARKETS_PER_EVENT)

        .map(market => {

          const outcomes = (market.outcomes || [])

            .filter(outcome => {

              const odds = safeNumber(outcome.odds);

              return (

                outcome.id &&

                outcome.isActive === 1 &&

                odds !== null &&

                odds > 1

              );

            })

            .slice(0, MAX_OUTCOMES_PER_MARKET)

            .map(outcome => ({

              outcomeId: String(outcome.id),

              name: String(outcome.desc || "Outcome"),

              odds: safeNumber(outcome.odds)

            }));

          return {

            eventId: String(fixture.eventId),

            homeTeam: fixture.homeTeam,

            awayTeam: fixture.awayTeam,

            competition: fixture.competition,

            startTime: fixture.startTime,

            marketId: String(market.id),

            marketName: String(

              market.title || market.desc || "Market"

            ),

            specifier: String(market.specifier || ""),

            outcomes

          };

        })

        .filter(market => market.outcomes.length > 0);

      catalogue.push(...markets);

    }

  }

  if (!catalogue.length) {

    return {

      ok: false,

      message:

        "SportyBet fixtures were found, but no active markets and odds were available."

    };

  }

  return {

    ok: true,

    catalogue

  };

}

function findRealSelection(selection, catalogue) {

  if (!selection) return null;

  const eventId = String(selection.eventId || "");

  const marketId = String(selection.marketId || "");

  const outcomeId = String(selection.outcomeId || "");

  const specifier = String(selection.specifier || "");

  return catalogue.find(item =>

    item.eventId === eventId &&

    item.marketId === marketId &&

    item.specifier === specifier &&

    item.outcomes.some(outcome => outcome.outcomeId === outcomeId)

  );

}

async function createRealBookingCode(apiKey, message, history) {

  const marketResult = await getRealMarketCatalogue();

  if (!marketResult.ok) {

    return {

      reply:

        `Bro, I couldn't get active SportyBet markets right now.\n\n` +

        `${marketResult.message}\n\n` +

        `I won't invent a booking code. Please try again shortly.`

    };

  }

  const catalogue = marketResult.catalogue;

  const systemPrompt = `

You are DUCA AI, a smart, friendly and helpful football analysis assistant

connected to SportyBet Nigeria.

PERSONALITY:

- Be friendly, natural, confident and conversational.

- Speak simple English. You may use light Nigerian expressions naturally.

- Be helpful, not robotic.

- Explain your football reasoning clearly.

- Never claim a bet is guaranteed or risk-free.

IMPORTANT SPORTYBET RULES:

- You are being given REAL SportyBet fixtures, markets, outcomes and odds.

- You must select ONLY outcomes that appear in the supplied catalogue.

- Never invent event IDs, market IDs, outcome IDs, market names or odds.

- The user may request markets such as Over 1.5, Over 2.5, Under 3.5,

  Both Teams to Score, 1X2, Double Chance, corners, cards or other options.

- Use the market names and outcome descriptions exactly as supplied.

- Do not assume a market exists if it is not in the catalogue.

- Do not select more than ${MAX_SELECTIONS} legs.

- Avoid duplicate selections from the same match unless the user specifically asks.

- If the user requests a target odd, try to get reasonably close without

  pretending the result is safe.

- If no suitable selections exist, return an empty selections array.

Return ONLY valid JSON in this format:

{

  "analysis": "Friendly explanation of your choices and risks",

  "selections": [

    {

      "eventId": "exact event ID from catalogue",

      "marketId": "exact market ID from catalogue",

      "specifier": "exact specifier from catalogue, or empty string",

      "outcomeId": "exact outcome ID from catalogue",

      "reason": "short reason for choosing it"

    }

  ]

}

`;

  const userPrompt = `

USER REQUEST:

${message}

REAL SPORTYBET MARKET CATALOGUE:

${JSON.stringify(catalogue)}

Choose suitable selections for the user's request.

Use only exact IDs and outcomes from this catalogue.

Return valid JSON only.

`;

  const raw = await askGroq(

    apiKey,

    [

      { role: "system", content: systemPrompt },

      ...cleanHistory(history),

      { role: "user", content: userPrompt }

    ],

    {

      temperature: 0.2,

      max_tokens: 2200,

      jsonMode: true

    }

  );

  const parsed = extractJson(raw);

  if (!parsed || !Array.isArray(parsed.selections)) {

    return {

      reply:

        "I analysed the request, but couldn't safely read the selections. " +

        "Please try again."

    };

  }

  const validatedSelections = [];

  const seenEvents = new Set();

  for (const selection of parsed.selections.slice(0, MAX_SELECTIONS)) {

    const realMarket = findRealSelection(selection, catalogue);

    if (!realMarket) continue;

    // Avoid accidentally selecting multiple outcomes from one match.

    if (seenEvents.has(realMarket.eventId)) continue;

    const realOutcome = realMarket.outcomes.find(

      outcome => outcome.outcomeId === String(selection.outcomeId)

    );

    if (!realOutcome) continue;

    validatedSelections.push({

      eventId: realMarket.eventId,

      marketId: realMarket.marketId,

      specifier: realMarket.specifier,

      outcomeId: realOutcome.outcomeId,

      eventName: `${realMarket.homeTeam} vs ${realMarket.awayTeam}`,

      marketName: realMarket.marketName,

      outcomeName: realOutcome.name,

      odds: realOutcome.odds,

      reason: String(selection.reason || "")

    });

    seenEvents.add(realMarket.eventId);

  }

  if (!validatedSelections.length) {

    return {

      reply:

        "I couldn't find valid active selections for that request in the " +

        "current SportyBet markets. Try asking for a different market or fewer matches."

    };

  }

  // Recheck every selected event immediately before submitting the slip.

  for (const selection of validatedSelections) {

    const latest = await fetchEventDetail(selection.eventId);

    if (!latest.ok) {

      return {

        reply:

          "SportyBet couldn't confirm one of the selected matches just now. " +

          "No booking code was created. Please try again."

      };

    }

    const marketStillActive = latest.markets.some(market =>

      String(market.id) === selection.marketId &&

      String(market.specifier || "") === selection.specifier &&

      (market.outcomes || []).some(outcome =>

        String(outcome.id) === selection.outcomeId &&

        Number(outcome.isActive) === 1

      )

    );

    if (!marketStillActive) {

      return {

        reply:

          `One selection (${selection.eventName}) is no longer active on ` +

          `SportyBet. No code was created. Please try again for updated odds.`

      };

    }

  }

  const shareResult = await submitShareCode(

    validatedSelections.map(selection => ({

      eventId: selection.eventId,

      marketId: selection.marketId,

      specifier: selection.specifier,

      outcomeId: selection.outcomeId

    }))

  );

  if (!shareResult.ok) {

    console.error("SportyBet share-code error:", shareResult.diagnostics);

    return {

      reply:

        "DUCA found real selections, but SportyBet refused to create the " +

        "booking code this time.\n\n" +

        "The odds or markets may have changed. Please try again."

    };

  }

  const combinedOdds = validatedSelections.reduce(

    (total, selection) => total * selection.odds,

    1

  );

  const slipText = validatedSelections

    .map((selection, index) =>

      `${index + 1}. ${selection.eventName}\n` +

      `   Market: ${selection.marketName}\n` +

      `   Pick: ${selection.outcomeName}\n` +

      `   Odds: ${selection.odds}\n` +

      `   Reason: ${selection.reason || "Selected from active SportyBet markets"}`

    )

    .join("\n\n");

  const analysis = String(

    parsed.analysis || "Here are the selections I found for you."

  );

  return {

    reply:

      `Hey bro! Here's the SportyBet slip I built from real active markets.\n\n` +

      `${analysis}\n\n` +

      `━━━━━━━━━━━━━━━━━━\n` +

      `DUCA AI SELECTIONS\n` +

      `━━━━━━━━━━━━━━━━━━\n\n` +

      `${slipText}\n\n` +

      `Combined odds: ${combinedOdds.toFixed(2)}\n` +

      `Selections: ${validatedSelections.length}\n\n` +

      `━━━━━━━━━━━━━━━━━━\n` +

      `REAL SPORTYBET BOOKING CODE\n` +

      `━━━━━━━━━━━━━━━━━━\n\n` +

      `🎟️ ${shareResult.code}\n\n` +

      `${shareResult.shareUrl}\n\n` +

      `Open SportyBet and enter the code to load the slip. Please check ` +

      `the selections and latest odds before placing any bet. No prediction is guaranteed.`

  };

}

export default async function handler(req, res) {

  if (req.method !== "POST") {

    return res.status(405).json({

      error: "Method not allowed"

    });

  }

  try {

    const { message, history = [] } = req.body || {};

    if (!message || typeof message !== "string") {

      return res.status(400).json({

        error: "Message is required."

      });

    }

    const apiKey = process.env.GROQ_API_KEY;

    if (!apiKey) {

      return res.status(500).json({

        error: "Groq API key is not configured in Vercel."

      });

    }

    // Booking-code mode: retrieve real SportyBet markets and create a real code.

    if (isBookingRequest(message)) {

      const result = await createRealBookingCode(

        apiKey,

        message,

        history

      );

      return res.status(200).json({

        reply: result.reply

      });

    }

    // Normal friendly DUCA chat.

    const systemPrompt = `

You are DUCA AI, a smart, friendly football assistant.

PERSONALITY:

- Be friendly, warm, natural and conversational.

- Keep answers clear and easy to understand.

- You can discuss football, clubs, players, tactics, football history,

  match analysis and SportyBet markets.

- Be helpful and explain your reasoning.

- Never claim that a prediction is guaranteed.

- Never invent live fixtures, current odds or booking codes.

- If the user asks for a real SportyBet booking code, explain that you can

  build one when they request a slip or accumulator.

- Your name is DUCA.

`;

    const answer = await askGroq(

      apiKey,

      [

        { role: "system", content: systemPrompt },

        ...cleanHistory(history),

        { role: "user", content: message }

      ],

      {

        temperature: 0.65,

        max_tokens: 1200

      }

    );

    return res.status(200).json({

      reply: answer

    });

  } catch (error) {

    console.error("DUCA server error:", error);

    return res.status(500).json({

      error:

        error.message ||

        "DUCA ran into a problem. Please try again."

    });

  }

}