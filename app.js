const form = document.querySelector("#question-form");
const questionInput = document.querySelector("#question");
const askButton = document.querySelector("#ask-button");
const welcome = document.querySelector("#welcome");
const conversation = document.querySelector("#conversation");
const thinking = document.querySelector("#thinking");
const thinkingLabel = thinking.querySelector(".thinking-bubble span");
const errorPanel = document.querySelector("#error-panel");
const errorMessage = document.querySelector("#error-message");
const userTemplate = document.querySelector("#user-message-template");
const assistantTemplate = document.querySelector("#assistant-message-template");
const logoutButton = document.querySelector("#logout-button");

// Identity now comes from the JWT issued at login (see login.js), verified
// against Azure SQL server-side - not a client-generated id the server was
// just asked to trust. getToken()/clearSession() come from auth.js.
const threadId = "default";

// Show who is signed in (email saved by setSession() at login).
const signedInEmail = getEmail() || "";
document.querySelector("#user-email").textContent = signedInEmail;
document.querySelector("#user-avatar").textContent = (signedInEmail[0] || "?").toUpperCase();
if (!signedInEmail) document.querySelector(".user-chip").hidden = true;

logoutButton.addEventListener("click", () => {
  clearSession();
  window.location.replace("login.html");
});

// Wraps fetch() with the Authorization header and API_BASE_URL, and sends
// an expired/revoked session straight to the login page instead of showing
// a confusing pipeline error.
async function authFetch(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${getToken()}`,
    },
  });
  if (response.status === 401) {
    clearSession();
    window.location.replace("login.html");
    throw new Error("Your session has expired. Redirecting to sign in…");
  }
  return response;
}

// Shown in the "thinking" bubble before any text has started streaming in,
// so the wait before writing begins still reads as progress, not a freeze.
const STAGE_LABELS = {
  planning: "Understanding the question…",
  searching: "Searching the knowledge base…",
  reviewing: "Reviewing the evidence…",
  writing: "Writing the answer…",
};

function setThinkingLabel(text) {
  thinkingLabel.textContent = text;
}

function textNode(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  return node;
}

function appendUserQuestion(question) {
  const fragment = userTemplate.content.cloneNode(true);
  fragment.querySelector(".user-bubble").textContent = question;
  conversation.append(fragment);
}

function cleanAnswer(answer) {
  return String(answer || "").replace(/\s*\[(?:E\d+)(?:\s*,\s*E\d+)*\]/g, "").trim();
}

function normalizeCitations(citations) {
  const unique = new Map();
  (citations || []).forEach((citation) => {
    const fileName = citation.file_name || `${citation.title || "Source document"}.pdf`;
    const organization = citation.organization || citation.issuer || "Organization unavailable";
    const heading = citation.heading || citation.heading_path || "Heading unavailable";
    const page = citation.page || (citation.page_start ? `Page ${citation.page_start}` : "Page unavailable");
    const normalized = { file_name: fileName, organization, heading, page };
    const key = `${fileName}|${organization}|${heading}|${page}`.toLowerCase();
    if (!unique.has(key)) unique.set(key, normalized);
  });
  return [...unique.values()];
}

function sourceCopy(citation) {
  return `${citation.file_name} | ${citation.organization} | ${citation.heading} | ${citation.page}`;
}

// Creates the assistant turn's DOM immediately, with an empty body that
// createAssistantTurn's caller fills in as text streams, or all at once for
// the non-streaming path. Returns handles used by both that and
// finalizeAssistantAnswer once the complete response is known.
function createAssistantTurn() {
  const fragment = assistantTemplate.content.cloneNode(true);
  const turn = fragment.querySelector(".assistant-turn");
  const refs = {
    turn,
    status: fragment.querySelector(".answer-status"),
    body: fragment.querySelector(".answer-body"),
    copyButton: fragment.querySelector(".copy-button"),
    warnings: fragment.querySelector(".warning-list"),
    sources: fragment.querySelector(".sources"),
    sourceList: fragment.querySelector(".source-list"),
    sourceCount: fragment.querySelector(".source-count"),
    sourceToggle: fragment.querySelector(".sources-toggle"),
  };
  conversation.append(turn);
  return refs;
}

// Fills in everything that needs the complete response: status, warnings,
// sources, and the copy button (copying mid-stream text would be confusing,
// so it's only wired up once the final answer is in).
function finalizeAssistantAnswer(refs, data) {
  const answerText = cleanAnswer(data.answer);
  const citations = normalizeCitations(data.citations);

  refs.status.textContent = data.status;
  refs.status.classList.add(data.status.toLowerCase());
  refs.body.innerHTML = data.answer_html || answerText;

  const warningItems = Array.isArray(data.warnings)
    ? data.warnings
    : data.warnings
      ? [data.warnings]
      : [];
  if (warningItems.length) {
    warningItems.forEach((warning) => refs.warnings.append(textNode("p", "", String(warning))));
    refs.warnings.hidden = false;
  }

  if (citations.length) {
    refs.sources.hidden = false;
    refs.sourceCount.textContent = citations.length;
    citations.forEach((citation) => {
      const card = document.createElement("article");
      card.className = "source-card";
      const list = document.createElement("dl");
      const fields = [
        ["File", citation.file_name],
        ["Organization", citation.organization],
        ["Heading", citation.heading],
        ["Page", citation.page],
      ];
      fields.forEach(([label, value]) => {
        list.append(textNode("dt", "", label), textNode("dd", "", value));
      });
      card.append(list);
      refs.sourceList.append(card);
    });
  }

  refs.sourceToggle.addEventListener("click", () => {
    const collapsed = refs.sources.classList.toggle("collapsed");
    refs.sourceToggle.setAttribute("aria-expanded", String(!collapsed));
  });

  const copyLabel = refs.copyButton.querySelector("span");
  refs.copyButton.addEventListener("click", async () => {
    const sourceText = citations.length
      ? `\n\nSources:\n${citations.map(sourceCopy).join("\n")}`
      : "";
    await navigator.clipboard.writeText(`${answerText}${sourceText}`);
    copyLabel.textContent = "Copied";
    window.setTimeout(() => { copyLabel.textContent = "Copy"; }, 1600);
  });
}

function resizeComposer() {
  questionInput.style.height = "auto";
  questionInput.style.height = `${Math.min(questionInput.scrollHeight, 180)}px`;
}

async function submitQuestion(event) {
  event.preventDefault();
  const question = questionInput.value.trim();
  if (!question) return;

  welcome.hidden = true;
  errorPanel.hidden = true;
  appendUserQuestion(question);
  questionInput.value = "";
  resizeComposer();
  askButton.disabled = true;
  setThinkingLabel(STAGE_LABELS.planning);
  thinking.hidden = false;
  thinking.scrollIntoView({ behavior: "smooth", block: "center" });

  let refs = null;
  let finalized = false;
  try {
    const response = await authFetch("/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: question, thread_id: threadId }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.detail || "The server returned an error.");
    }

    // The response is newline-delimited JSON (one event per line), not a
    // single JSON body, so it's read incrementally instead of via
    // response.json() - that's what lets text appear as it's written
    // instead of only once the whole answer is finished.
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        if (!line.trim()) continue;
        const streamEvent = JSON.parse(line);

        if (streamEvent.type === "stage") {
          setThinkingLabel(STAGE_LABELS[streamEvent.stage] || "Working…");
        } else if (streamEvent.type === "delta") {
          if (!refs) {
            thinking.hidden = true;
            refs = createAssistantTurn();
          }
          refs.body.innerHTML = streamEvent.html;
          refs.turn.scrollIntoView({ behavior: "smooth", block: "nearest" });
        } else if (streamEvent.type === "final") {
          if (!refs) {
            thinking.hidden = true;
            refs = createAssistantTurn();
          }
          finalizeAssistantAnswer(refs, streamEvent);
          finalized = true;
        } else if (streamEvent.type === "error") {
          throw new Error(streamEvent.detail || "The server returned an error.");
        }
      }
    }
    if (!finalized) {
      throw new Error("The connection was interrupted before the answer finished.");
    }
  } catch (error) {
    errorMessage.textContent = error.message;
    errorPanel.hidden = false;
    errorPanel.scrollIntoView({ behavior: "smooth", block: "center" });
  } finally {
    thinking.hidden = true;
    askButton.disabled = false;
    questionInput.focus();
  }
}

form.addEventListener("submit", submitQuestion);
questionInput.addEventListener("input", resizeComposer);
questionInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});