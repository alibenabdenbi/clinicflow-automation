# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ORE-Engine (Opportunities Recognition Engine) is a B2B lead discovery and outreach automation system targeting small service businesses (primarily dental clinics). It scrapes 7 web sources for pain signals, scores and clusters them, generates qualified leads, discovers local businesses via OpenStreetMap, finds contact emails, builds offers, and orchestrates outreach campaigns.

## Commands

```bash
npm start              # Full discovery pipeline: scrape → process → leads → offers
npm run dev            # Nodemon watch mode for main.js
npm run pipeline       # Local business sub-pipeline: discover → merge → enrich → send
npm run dashboard      # Start Express dashboard API (CRM + queue management)
npm run api            # Start API server (confirm routes)
npm run site           # Serve public dashboard on port 3000
npm run outreach       # Execute outreach (comments + DMs)
npm run discover       # Scrape local dentists via OSM (localBusinesses.js)
npm run merge          # Merge discovered businesses into outreach queue
npm run enrich         # Enrich businesses with emails from websites
npm run send:batch     # Send emails via SMTP (respects MAX_EMAILS_PER_DAY)
npm run send:followups # Send scheduled follow-ups
npm run sps            # ScopePayShield generator: --in <convo.txt> --client "Name" --you "Name"
```

No test framework is configured. No linter is configured.

## Architecture

**Runtime:** Node.js ES Modules (`"type": "module"` in package.json). All imports use ESM syntax.

### Primary Pipeline (`src/main.js`)

The main pipeline runs sequentially in stages:

1. **Collect** — 6 scrapers run in parallel (HN, IndieHackers, ProductHunt, GitHub Issues, Chrome Web Store, WordPress plugins). Results saved to `data/raw.*.json`.
2. **Process** — `painExtractor` → `scorer` → `cluster` (5 themes) → `filters` → `normalize` (fingerprint dedup).
3. **Analyze** — rank top 20, summarize themes, extract problem map, enrich with buyer profiles/angles.
4. **Generate Leads** — `generateLeadsAdvanced()` from the top theme, structured into CRM format, merged with history via `mergeCrmLeads()`.
5. **Build Offers** — 3 tiered offers per problem, one-pager markdown, outreach message queue.
6. **Local Dentist Path (parallel)** — OSM/Overpass scrape → score → email enrichment → CSV + outreach JSON.

### Key Data Files

All runtime data lives in `data/`:
- `crm.leads.json` — master CRM, never overwritten (merged with history)
- `outreach.localDentists.json` — email send queue with status (`todo` / `sent`)
- `data/sendlog.json` — email send audit log
- `data/plans/*.md` — per-clinic one-page growth plans
- `data/outputs/` — ScopePayShield output directories

### Lead Scoring & Tiers

Scores are computed as `log10(scoreBase) × sourceWeight`. Tier thresholds:
- **Tier A** (score ≥ 11): `comment_then_dm`
- **Tier B** (score ≥ 8): `comment`
- **Tier C** (< 8): `skip`

Source weights: Reddit (1.0) > GitHub (0.95) > IndieHackers (0.9) > ProductHunt (0.85) > HN (0.75) > Chrome (0.7) > WordPress (0.65).

### Module Layout

| Directory | Role |
|-----------|------|
| `src/scrapers/` | One file per data source. `indiehackers.js` uses Playwright (headful); others use `node-fetch` or Crawlee. |
| `src/processors/` | Stateless transform functions. Each exports named functions consumed by `main.js`. |
| `src/cli/` | Standalone scripts invoked by npm scripts. |
| `src/execution/` | Orchestrators for outreach and the dashboard API server. |
| `src/product/` | `scopePayShield.js` — freelancer scope/invoice/milestone pack generator. |
| `src/storage/files.js` | Shared `readJsonSafe()` / `writeJson()` helpers used throughout. |
| `src/api/` | Express routes for confirmation endpoint + rate limiting. |

### Environment (`.env`)

Critical variables:
- `SMTP_*` — Zoho Mail credentials for outreach email
- `MAX_EMAILS_PER_DAY` — enforced by `sendBatch.js`
- `FOLLOWUP_DELAY_DAYS` — follow-up cadence
- `ADMIN_KEY` / `ADMIN_BASIC_USER` / `ADMIN_BASIC_PASS` — dashboard auth
- `PUBLIC_BASE_URL` — used in email links and confirmation routes

### Defensive Patterns

The codebase consistently uses:
- `readJsonSafe(path, fallback)` — never throws on missing files
- `safeRun(fn)` wrappers around async scraper calls so one failure doesn't abort the pipeline
- URL validation before fetching + HTML entity escaping in generated content
- Email blocklist + regex validation in `emailFinder.js`
