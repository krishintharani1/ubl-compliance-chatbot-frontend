// Shared between login.html and index.html. The token lives in
// sessionStorage, not localStorage: it clears when the tab closes instead
// of persisting indefinitely, which matters more here than surviving a
// browser restart since this is a compliance tool, not a convenience app.
const AUTH_TOKEN_KEY = "ubl-compliance-token";
const AUTH_EMAIL_KEY = "ubl-compliance-email";

function getToken() {
  return sessionStorage.getItem(AUTH_TOKEN_KEY);
}

function getEmail() {
  return sessionStorage.getItem(AUTH_EMAIL_KEY);
}

function setSession(token, email) {
  sessionStorage.setItem(AUTH_TOKEN_KEY, token);
  sessionStorage.setItem(AUTH_EMAIL_KEY, email);
}

function clearSession() {
  sessionStorage.removeItem(AUTH_TOKEN_KEY);
  sessionStorage.removeItem(AUTH_EMAIL_KEY);
}

// Call at the top of any page that requires a logged-in user. This only
// checks that a token is present, not that it's still valid - an expired
// or revoked token is caught by the API's 401 response on the first real
// request (see requireAuthFetch in app.js), which also redirects to login.
function requireSession() {
  if (!getToken()) {
    window.location.replace("login.html");
  }
}
