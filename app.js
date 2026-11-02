const chatArea = document.getElementById("chatArea");
const userInput = document.getElementById("userInput");
let chatHistory = [];
let isSending = false;

function cleanText(text) {
    return String(text || "")
        .replace(/\[SPORTYBET_SLIP:[\s\S]*?\]/gi, "")
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/^#{1,6}\s*/gm, "")
        .trim();
}

function addMessage(text, sender) {
    const message = document.createElement("div");
    message.className = `message ${sender}-message`;
    const content = document.createElement("div");
    content.className = "message-content";
    if (sender === "ai") {
        const label = document.createElement("div");
        label.className = "ai-label";
        label.textContent = "DUCA AI";
        content.appendChild(label);
    }
    const textElement = document.createElement("div");
    textElement.className = "message-text";
    textElement.textContent = text;
    content.appendChild(textElement);
    message.appendChild(content);
    chatArea.appendChild(message);
    chatArea.scrollTop = chatArea.scrollHeight;
    return { content, textElement };
}

function addCodeCard(container, code) {
    const card = document.createElement("div");
    card.className = "code-card";

    const label = document.createElement("div");
    label.className = "code-label";
    label.textContent = "SportyBet booking code";
    card.appendChild(label);

    const value = document.createElement("div");
    value.className = "code-value";
    value.textContent = code.code;
    card.appendChild(value);

    const meta = document.createElement("div");
    meta.className = "code-meta";
    meta.textContent = `${(code.legs || []).length} games · ${code.totalOdds || "-"} total odds`;
    card.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "code-actions";

    const copy = document.createElement("button");
    copy.className = "code-btn";
    copy.textContent = "Copy code";
    copy.onclick = async () => {
        try {
            await navigator.clipboard.writeText(code.code);
            copy.textContent = "Copied ✓";
        } catch {
            copy.textContent = "Copy failed";
        }
    };
    actions.appendChild(copy);

    const open = document.createElement("a");
    open.className = "code-btn code-btn-alt";
    open.href = code.shareUrl;
    open.target = "_blank";
    open.rel = "noopener";
    open.textContent = "Open on SportyBet";
    actions.appendChild(open);
    card.appendChild(actions);

    if (Array.isArray(code.legs) && code.legs.length) {
        const list = document.createElement("div");
        list.className = "code-legs";
        code.legs.forEach((leg, i) => {
            const row = document.createElement("div");
            row.className = "code-leg";
            row.textContent = `${i + 1}. ${leg.homeTeam} vs ${leg.awayTeam} — ${leg.selection} @ ${leg.odds}`;
            list.appendChild(row);
        });
        card.appendChild(list);
    }

    container.appendChild(card);
    chatArea.scrollTop = chatArea.scrollHeight;
}

function extractSlipTag(text) {
    const match = String(text || "").match(/\[SPORTYBET_SLIP:\s*(\{[\s\S]*?\})\s*\]/i);
    if (!match) return null;
    try {
        const parsed = JSON.parse(match[1]);
        return parsed?.eventId ? parsed : null;
    } catch {
        return null;
    }
}

async function requestCode(selections) {
    const response = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selections }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
        throw new Error(data.error || "Could not create the booking code.");
    }
    return data;
}

async function sendMessage() {
    const text = userInput.value.trim();
    if (!text || isSending) return;

    const welcome = document.getElementById("welcome");
    if (welcome) welcome.remove();

    addMessage(text, "user");
    userInput.value = "";
    isSending = true;

    const sendBtn = document.getElementById("sendBtn");
    if (sendBtn) sendBtn.disabled = true;

    const bubble = addMessage("Analysing your request...", "ai");

    try {
        const response = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: text, history: chatHistory }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to connect to DUCA.");
        if (!data.reply) throw new Error("DUCA returned an empty response.");

        bubble.textElement.textContent = cleanText(data.reply) || "Here you go.";

        if (data.code?.code) {
            addCodeCard(bubble.content, data.code);
        } else {
            const tag = extractSlipTag(data.reply);
            if (tag) {
                try {
                    addCodeCard(bubble.content, await requestCode([tag]));
                } catch (error) {
                    bubble.textElement.textContent += `\n\n${error.message}`;
                }
            }
        }

        chatHistory.push(
            { role: "user", parts: [{ text }] },
            { role: "model", parts: [{ text: data.reply }] }
        );
    } catch (error) {
        bubble.textElement.textContent = "Connection error: " + error.message;
        console.error("DUCA Error:", error);
    } finally {
        isSending = false;
        if (sendBtn) sendBtn.disabled = false;
        chatArea.scrollTop = chatArea.scrollHeight;
    }
}

function sendSuggestion(text) {
    userInput.value = text;
    sendMessage();
}

function newChat() {
    chatArea.innerHTML = "";
    chatHistory = [];
    const section = document.createElement("section");
    section.className = "welcome";
    section.id = "welcome";
    section.innerHTML = `
        <div class="welcome-logo">D</div>
        <h1>Welcome to DUCA.</h1>
        <p>Your intelligent football analysis assistant.</p>
        <div class="suggestions">
            <button onclick="sendSuggestion('Safest game of today')">
                ⚽ Safest game today
            </button>
            <button onclick="sendSuggestion('Gimme safest 100 odd for today, 25 games')">
                🔥 100 odds, 25 games
            </button>
            <button onclick="sendSuggestion('Safe 5-game booking code')">
                🎯 Safe 5-game code
            </button>
            <button onclick="sendSuggestion('Analyse Arsenal next match')">
                📊 Match analysis
            </button>
        </div>
    `;
    chatArea.appendChild(section);
}

userInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
});
