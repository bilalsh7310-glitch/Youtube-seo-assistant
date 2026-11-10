# TubeRank AI: YouTube SEO Assistant

A Flask web app that turns a video topic or full script into a complete YouTube publishing package: titles, description, keywords, tags, hashtags, thumbnail concepts, Shorts scripts and an SEO score. AI generation runs through [OpenRouter](https://openrouter.ai), and the API key stays on the server.

## Project files

| File | Purpose |
| --- | --- |
| `index.html` | Page structure and layout |
| `style.css` | Dashboard styling, light and dark themes, responsive rules |
| `script.js` | Form handling, API calls, result rendering, copy buttons, downloads |
| `config.json` | Models, languages, categories, limits, feature switches (no secrets) |
| `app.py` | Flask backend: validation, prompts, OpenRouter calls |
| `requirements.txt` | Python dependencies |
| `.env.example` | Template for environment variables |
| `.gitignore` | Keeps `.env` out of Git |

## Run locally

You need Python 3.9 or newer and an OpenRouter API key from <https://openrouter.ai/keys>.

```bash
# 1. Open a terminal in the project folder, then create a virtual environment
python -m venv venv

# 2. Activate it
#    Windows (PowerShell):  venv\Scripts\Activate.ps1
#    macOS / Linux:         source venv/bin/activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Create your environment file and add your key
#    Windows:       copy .env.example .env
#    macOS / Linux: cp .env.example .env
#    Then open .env and set OPENROUTER_API_KEY=your_key_here

# 5. Start the app
python app.py
```

Open <http://localhost:5000>.

If the key is missing, the dashboard shows a warning banner and the Generate button stays disabled.

## How it works

1. You enter a topic or script, pick a category, language and model, then select **Generate SEO**.
2. The browser sends six requests to `/api/generate/<section>` in parallel (titles, description, keywords, tags and hashtags, thumbnails, Shorts). Each section has its own prompt in `app.py`, and cards fill in as soon as their result arrives.
3. When those finish, the browser sends the results to `/api/analyze`. The AI scores six categories from 0 to 100, and the server calculates the weighted overall score so it always matches the breakdown.
4. Every card has a copy button. **TXT** and **JSON** in the top bar download the complete report.

### API routes

| Route | Method | Description |
| --- | --- | --- |
| `/api/health` | GET | Server status and whether an API key is configured |
| `/api/config` | GET | Public settings for the UI |
| `/api/generate/<section>` | POST | `titles`, `description`, `keywords`, `tags_hashtags`, `thumbnails`, `shorts` |
| `/api/analyze` | POST | SEO score, breakdown and suggestions |

Generate requests take `{ "topic", "category", "language", "model" }`. Responses look like `{ "ok": true, "data": {...} }` or `{ "ok": false, "error": { "code", "message" } }`.

## Configuration

Edit `config.json` to change:

- **Models**: the `openrouter.models` list fills the model dropdown. Browse current model IDs at <https://openrouter.ai/models> and copy the ID exactly. Model availability and pricing change over time, so replace any ID that no longer works.
- **Default model**: set `openrouter.default_model`, or set `OPENROUTER_MODEL` in your environment (this wins over the file).
- **Languages and categories**: edit the `languages` and `categories` lists.
- **Limits**: input length and requests per minute per IP.
- **Features**: set any entry in `features` to `false` to hide that card and its sidebar link.
- **Timeouts**: `timeout_seconds` and `max_retries` for OpenRouter calls.

Never put an API key in `config.json`.

## Deploy on Render

1. Push the project to a GitHub repository. The `.gitignore` keeps `.env` out of it.
2. In Render, choose **New** then **Web Service**, and connect the repository.
3. Use these settings:
   - **Runtime**: Python 3
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `gunicorn app:app --workers 1 --threads 8 --timeout 240`
4. Under **Environment**, add:
   - `OPENROUTER_API_KEY` = your key
   - `OPENROUTER_MODEL` = optional model override
   - `SITE_URL` = your Render URL (sent to OpenRouter as the referrer)
5. Select **Create Web Service**. Render builds the app and gives you a public URL.

Notes:

- The long `--timeout` is needed because several AI requests can take 10 to 40 seconds each.
- One worker with several threads keeps the in-memory rate limiter consistent. If you add workers, the per-IP limit applies to each worker separately.
- Render's free tier sleeps after inactivity, so the first request after a pause can take about a minute.

## Troubleshooting

| Message | What to do |
| --- | --- |
| API key banner on the dashboard | Set `OPENROUTER_API_KEY`, then restart the server |
| "OpenRouter rejected the API key" | The key is wrong or revoked. Create a new one |
| "out of credits" | Add credits on OpenRouter, or choose a lower-cost model |
| "model is not available" | The model ID changed. Update it in `config.json` |
| "took too long" | Try a faster model, or shorten the script |
| A single card shows an error | Select **Retry** on that card. The other results are kept |

## Privacy and security

- The API key is read from the environment on the server and never sent to the browser.
- Only `index.html`, `style.css` and `script.js` are served as static files. `config.json`, `.env` and `app.py` are not reachable by URL.
- Inputs are validated on the server (length, category, language, model allow-list), and results are inserted into the page as plain text.
- Video text is sent to OpenRouter and the model provider you select. Check their data policies if your scripts are confidential.
