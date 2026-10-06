# Deploying the UBL Compliance Assistant

Two independent pieces, two independent deployments:

- **`backend/`** → Azure App Service (FastAPI, Python)
- **`frontend/`** → Azure Static Web Apps (static HTML/JS, no build step)

They talk to each other only over HTTPS: the frontend calls the backend's
public URL, and CORS on the backend decides which frontend origins are
allowed to do that. Deploy the backend first, since the frontend needs its
URL.

## 0. Before you push anything to GitHub

Both `config.yaml` (in `backend/`) and `.gitignore` (repo root) are already
set up so secrets never get committed - `config.yaml` only ever holds
`PASTE_..._HERE` placeholders, and `.gitignore` excludes `config.local.yaml`
(where real local-dev secrets go) and `config_azure.yaml` (your separate
ingestion pipeline's own secrets file). Don't remove either of those from
`.gitignore`.

You've now pasted the real SQL password into this chat twice, and a real
user's email+password were visible in an earlier screenshot. Rotate the SQL
password and ask that user to change their password once this is live.

## 1. Backend → Azure App Service

**Create the App Service** (Linux, Python 3.12 runtime) in the Azure
Portal or via CLI:
```bash
az webapp up --name ubl-compliance-api --resource-group <your-rg> --runtime "PYTHON:3.12" --sku B1
```

**Set the startup command** (Configuration → General settings → Startup
Command), since App Service doesn't know to run uvicorn on its own:
```
uvicorn server:app --host 0.0.0.0 --port 8000
```

**Set Application Settings** (Configuration → Application settings) - this
is how secrets get into the deployed backend, instead of a config file:
| Name | Value |
|---|---|
| `SQL_PASSWORD` | your real SQL password |
| `JWT_SECRET` | generate with `python -c "import secrets; print(secrets.token_urlsafe(48))"` |
| `SCM_DO_BUILD_DURING_DEPLOYMENT` | `true` |

Also fill in the real (non-secret) values directly in `backend/config.yaml`
before deploying it - `azure.search.endpoint`, `azure.search.index_name`,
`azure.openai.endpoint`, and the deployment names, copied from the
config.yaml you've already been running locally. Leave `admin_key`,
`api_key`, `auth.sql.password`, and `auth.jwt.secret` as placeholders in
the file - the App Service settings above and `SQL_PASSWORD`/`JWT_SECRET`
cover `auth.sql.password`/`auth.jwt.secret`. The Search and OpenAI API keys
work the same way via `config.local.yaml` locally or the same
Application-Settings pattern in production (add `AZURE_SEARCH_ADMIN_KEY`
and `AZURE_OPENAI_API_KEY` as Application Settings too, matching the
`*_env` pattern already in `compliance_rag.py`).

**Deploy** by connecting the App Service to your GitHub repo (Deployment
Center → GitHub) and pointing it at the `backend/` folder - App Service's
GitHub Actions integration asks for the app's root folder during setup.

**Confirm it's actually up:**
```bash
curl https://ubl-compliance-api.azurewebsites.net/api/health
```
should return `{"status": "ok"}`. If it 500s, check the SQL connection
first (`mssql-python` needs no extra system driver on App Service's Linux
Python runtime, but it does need outbound network access to Azure SQL,
which is on by default) - then check Log Stream (Monitoring → Log stream)
for the actual error.

## 2. Frontend → Azure Static Web Apps

Edit **`frontend/config.js`** first - this is the one file that has to
change per environment:
```js
const API_BASE_URL = "https://ubl-compliance-api.azurewebsites.net";
```
(your actual App Service URL from step 1, no trailing slash).

**Create the Static Web App** in the Azure Portal: New → Static Web App,
connect your GitHub repo, set:
- **App location:** `/frontend`
- **Output location:** *(leave blank - no build step)*

This creates a GitHub Action in your repo that deploys on every push.

**Add the Static Web App's URL to the backend's CORS list** - go back to
`backend/config.yaml`'s `auth.cors_allowed_origins` and add the
`https://<your-app-name>.azurestaticapps.net` URL Azure just gave you, then
redeploy the backend. Until you do this, the browser will block every
request from the frontend to the backend - the backend works fine when
tested directly (e.g. via curl), but the browser enforces CORS, not the
server's correctness.

## 3. Test the whole thing

1. Open the Static Web App's URL. You should land on the login page.
2. Log in with a real row from `ID_pass_pak_compliance`.
3. Ask a compliance question and confirm you get a cited, streamed answer.
4. Click logout, confirm you're back at the login page and can't get back
   to the chat page without logging in again.

## Local development (optional, before you deploy)

Backend:
```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp config.local.yaml.example config.local.yaml   # then fill in real values
uvicorn server:app --reload --port 8000
```

Frontend - any static file server works, since there's no build step:
```bash
cd frontend
python -m http.server 3000
```
Set `API_BASE_URL = "http://localhost:8000"` in `frontend/config.js` and
add `http://localhost:3000` to `cors_allowed_origins` while doing this,
then open `http://localhost:3000/login.html`.
