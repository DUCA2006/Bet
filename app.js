const chatArea = document.getElementById("chatArea");
const userInput = document.getElementById("userInput");
let chatHistory = [];
let isSending = false;
// CREATE MESSAGE
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
    textElement.textContent = text;
    content.appendChild(textElement);
    message.appendChild(content);
    chatArea.appendChild(message);
    chatArea.scrollTop = chatArea.scrollHeight;
    return textElement;
}
// SEND MESSAGE TO GEMINI
async function sendMessage() {
    const text = userInput.value.trim();
    if (!text || isSending) return;
    const welcome = document.getElementById("welcome");
    if (welcome) {
        welcome.remove();
    }
    addMessage(text, "user");
    userInput.value = "";
    isSending = true;
    const sendBtn = document.getElementById("sendBtn");
    if (sendBtn) {
        sendBtn.disabled = true;
    }
    const loading = addMessage(
        "Analysing your request...",
        "ai"
    );
    try {
        const response = await fetch("/api/chat", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                message: text,
                history: chatHistory
            })
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(
                data.error || "Unable to connect to DUCA."
            );
        }
        if (!data.reply) {
            throw new Error("DUCA returned an empty response.");
        }
        // DISPLAY GEMINI RESPONSE
        loading.textContent = data.reply;
        // SAVE CONVERSATION HISTORY
        chatHistory.push(
            {
                role: "user",
                parts: [{ text: text }]
            },
            {
                role: "model",
                parts: [{ text: data.reply }]
            }
        );
    } catch (error) {
        loading.textContent =
            "Connection error: " + error.message;
        console.error("DUCA Error:", error);
    } finally {
        isSending = false;
        if (sendBtn) {
            sendBtn.disabled = false;
        }
        chatArea.scrollTop = chatArea.scrollHeight;
    }
}
// SUGGESTION BUTTONS
function sendSuggestion(text) {
    userInput.value = text;
    sendMessage();
}
// NEW CHAT
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
            <button onclick="sendSuggestion('Analyse today’s football matches')">
                ⚽ Analyse today's matches
            </button>
            <button onclick="sendSuggestion('Find the best supported football predictions today')">
                🎯 Today's predictions
            </button>
            <button onclick="sendSuggestion('Analyse Arsenal next match')">
                📊 Match analysis
            </button>
            <button onclick="sendSuggestion('Explain how to build a 100 odds accumulator')">
                🔥 Accumulator analysis
            </button>
        </div>
    `;
    chatArea.appendChild(section);
}
// ENTER TO SEND
userInput.addEventListener("keydown", function(event) {
    if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
});