// Already logged in? Skip straight to the chat page rather than making
// them log in again.
if (getToken()) {
  window.location.replace("index.html");
}

const form = document.querySelector("#login-form");
const emailInput = document.querySelector("#email");
const passwordInput = document.querySelector("#password");
const loginButton = document.querySelector("#login-button");
const loginError = document.querySelector("#login-error");

async function submitLogin(event) {
  event.preventDefault();
  loginError.hidden = true;
  loginButton.disabled = true;

  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: emailInput.value.trim(),
        password: passwordInput.value,
      }),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error("Incorrect email or password.");
      }
      if (response.status === 503) {
        throw new Error("The login service is temporarily unavailable. Please try again shortly.");
      }
      throw new Error(data.detail || "Sign-in failed. Please try again.");
    }

    setSession(data.access_token, data.email);
    window.location.replace("index.html");
  } catch (error) {
    loginError.textContent = error.message;
    loginError.hidden = false;
    passwordInput.value = "";
    passwordInput.focus();
  } finally {
    loginButton.disabled = false;
  }
}

form.addEventListener("submit", submitLogin);
