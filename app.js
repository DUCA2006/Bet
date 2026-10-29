const chatArea = document.getElementById("chatArea");
const userInput = document.getElementById("userInput");
const welcome = document.getElementById("welcome");

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

async function sendMessage() {
  
  const text = userInput.value.trim();
  
  if (!text) return;
  
  if (welcome) {
    welcome.style.display = "none";
  }
  
  addMessage(text, "user");
  
  userInput.value = "";
  
  const response = addMessage(
    "DUCA is getting ready. Gemini integration will be connected in the next development phase.",
    "ai"
  );
  
}

function sendSuggestion(text) {
  userInput.value = text;
  sendMessage();
}

function newChat() {
  
  chatArea.innerHTML = "";
  
  const section = document.createElement("section");
  section.className = "welcome";
  section.id = "welcome";
  
  section.innerHTML = `
        <div class="welcome-logo">D</div>
        <h1>Welcome to DUCA.</h1>
        <p>Your intelligent football analysis assistant.</p>
        <div class="suggestions">
            <button onclick="sendSuggestion('Analyse today’s football matches')">⚽ Analyse today's matches</button>
            <button onclick="sendSuggestion('Find the best supported football predictions today')">🎯 Today's predictions</button>
            <button onclick="sendSuggestion('Analyse Arsenal next match')">📊 Match analysis</button>
            <button onclick="sendSuggestion('Explain how to build a 100 odds accumulator')">🔥 Accumulator analysis</button>
        </div>
    `;
  
  chatArea.appendChild(section);
}

userInput.addEventListener("keydown", function(event) {
  
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
  
});