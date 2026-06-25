# GMB + Instagram Outreach Generator — Design Spec
**Date:** 2026-05-13  
**Status:** Approved (spec provided by user)

---

## Overview

A daily outreach intelligence layer that:
1. Enriches clinic records with Google My Business data (rating, reviews, pain signals, Instagram handle, personalization hook)
2. Generates 10 GMB + 10 Instagram copy-paste messages each morning, personalized per clinic via Claude
3. Delivers those messages inside the existing morning brief email
4. Tracks which clinics have been GMB-contacted to prevent doubles

---

## New Files

| File | Role |
|------|------|
| `src/services/gmbEnricher.js` | Google Places API calls + Instagram scraping + Claude personalization |
| `src/cli/generateDailyTargets.js` | Picks top targets, calls Claude for messages, saves `data/daily-targets.json` |
| `src/cli/markGMBSent.js` | CLI to stamp `gmbContactedAt` after Mohamed sends a message manually |

## Modified Files

| File | Change |
|------|--------|
| `src/cli/sendMorningBrief.js` | Append GMB + Instagram sections after LinkedIn section |
| `src/scheduler.js` | Add two `scheduleDaily` entries: GMB enrichment @ 06:30, target generation @ 07:00 |

---

## Part 1 — `src/services/gmbEnricher.js`

### `enrichWithGMB(clinic)`

Calls Google Places API in two hops:
1. `findplacefromtext` → gets `place_id` from clinic name + city
2. `place/details` → gets `rating`, `user_ratings_total`, `reviews`, `formatted_phone_number`, `website`, `opening_hours`, `business_status`, `url`

Returns enriched record:
```js
{
  placeId,
  googleMapsUrl,      // details.url (canonical Maps URL)
  rating,
  reviewCount,
  hasMessaging,       // APPROXIMATION: business_status === 'OPERATIONAL'. 
                      // Places API does not expose GMB messaging status directly.
  phone,
  website,
  isOpen,             // opening_hours.open_now
  openingHours,       // opening_hours.weekday_text joined
  recentReviews,      // last 3 reviews: { rating, text, time }
  painSignals,        // phrases from PAIN_KEYWORDS matched in review text
  painScore,          // count of matched keywords, capped at 5
  instagramHandle,    // from findInstagram(clinic) — null if not found
  personalDetail,     // Claude-generated one-sentence hook
}
```

**Pain keywords** reuse the set from `reviewsScraper.js` (imported as shared constant or inlined).

**`personalDetail`** generation: call Claude `claude-haiku-4-5-20251001` with a short prompt summarizing the clinic's GMB data (name, city, rating, reviewCount, painSignals, specialties inferred from review text). Ask for one sentence under 80 characters. Cache result in the record — never re-call for already-enriched clinics.

### `enrichBatch(clinics, limit = 50)`

- Filters to `limit` clinics
- Calls `enrichWithGMB` for each, 300ms sleep between calls
- Merges results back into `outreach.localDentists.json` (matches by `clinicName + city`)
- Skips clinics already having `placeId` (idempotent)
- Logs progress to console with `⭐rating (N reviews)` summary

### `findInstagram(clinic)`

Fetches `clinic.website` with a 10s timeout, parses the HTML for:
- `instagram.com/` links in `<a href>` tags
- `instagram.com/` in any text node or meta tag
- Returns `@handle` string (strips trailing slashes/params) or `null`

Also checks for Facebook, Twitter/X as secondary social signals (stored in `socialLinks` array on the record, not the primary return).

---

## Part 2 — `src/cli/generateDailyTargets.js`

Runs at 07:00 daily (after enrichment at 06:30).

### GMB targets (10)

Selects from `outreach.localDentists.json` where:
- `placeId` is set (enriched)
- `gmbContactedAt` is null/undefined (never GMB-contacted)
- `status === 'todo'`

Sort priority:
1. `painScore` descending
2. `rating` descending  
3. `reviewCount` descending

For each: call Claude `claude-haiku-4-5-20251001` with the `personalDetail`, pain signals, clinic name, and city to generate a message under 160 chars that references one specific clinic fact.

### Instagram targets (10)

Selects from `outreach.localDentists.json` OR `outreach.salonBusinesses.json` where:
- `instagramHandle` is set
- `gmbContactedAt` is null

For each: call Claude for a short Instagram DM referencing something from the clinic/salon's profile.

### Output

Saves to `data/daily-targets.json`:
```json
{
  "date": "ISO",
  "gmb": [{ clinicName, city, mapsUrl, message, personalDetail, painSignal, rating, reviewCount }],
  "instagram": [{ clinicName, instagramUrl, message, personalDetail }]
}
```

---

## Part 3 — Morning Brief Update

Appends two new sections to `buildBrief()` in `sendMorningBrief.js` after the LinkedIn section:

```
=== TODAY'S GMB MESSAGES (tap link → click Message → paste text) ===

1. Clinic Name — City — ⭐4.2 (87 reviews)
   Maps: https://maps.google.com/...
   Message: "Hi [Name]..."
   Why: patient mentioned no callback in a 2-star review

=== TODAY'S INSTAGRAM DMs ===
1. Clinic Name
   Instagram: https://instagram.com/handle
   Message: "Hey [Name]..."
```

Reads from `data/daily-targets.json`. If file doesn't exist or date doesn't match today, shows "Run: node src/cli/generateDailyTargets.js".

---

## Part 4 — Scheduler Entries

Two new `scheduleDaily` calls in `src/scheduler.js`:

```js
// 06:30 — GMB enrichment (50 clinics, before morning brief)
scheduleDaily(6, 30, "GMB Enrichment (50 clinics)", async () => { ... });

// 07:00 — Daily target generation (runs after enrichment)
scheduleDaily(7, 0, "GMB + Instagram Daily Targets", async () => { ... });
```

The 07:00 slot already has other jobs (LinkedIn, weekly enrich, intelligence). Adding targets generation is safe — all are independent.

---

## Part 5 — `src/cli/markGMBSent.js`

CLI: `node src/cli/markGMBSent.js "Clinic Name"`

- Reads `data/outreach.localDentists.json`
- Finds clinic by name (case-insensitive substring match, warns if multiple)
- Sets `gmbContactedAt = new Date().toISOString()` and `gmbMessage = today's message from daily-targets.json`
- Writes back to file
- Prints confirmation

---

## Data Schema Changes

New fields on each clinic record in `outreach.localDentists.json`:

```
placeId             string | null
googleMapsUrl       string | null
rating              number | null
reviewCount         number | null
hasMessaging        boolean | null   (approximation — see note above)
googlePhone         string | null
isOpen              boolean | null
openingHours        string | null
recentReviews       array  | null
painSignals         array  | null
painScore           number          (default 0)
instagramHandle     string | null
socialLinks         array  | null
personalDetail      string | null
gmbEnrichedAt       string | null   (ISO timestamp)
gmbContactedAt      string | null   (ISO timestamp, set by markGMBSent)
gmbMessage          string | null   (the message that was sent)
```

---

## Technical Constraints

- **`hasMessaging`**: Google Places API v1 does not expose whether a business has GMB messaging enabled. We derive it from `business_status === 'OPERATIONAL'`. This will be a superset of messaging-enabled businesses — i.e., some flagged `hasMessaging: true` may not actually have the Message button. Mohamed should verify when clicking.
- **Claude model**: Use `claude-haiku-4-5-20251001` for message generation (fast + cheap, ~500 tokens per clinic)
- **API rate limits**: Places API free tier = 1,000 requests/day. 50 clinics × 2 calls = 100 requests/day. Well within limits.
- **TLS**: Set `NODE_TLS_REJECT_UNAUTHORIZED=0` in enricher (consistent with existing codebase pattern — see `sendBatch.js` mailer config using `rejectUnauthorized: false`)

---

## Success Criteria

After full build:
1. `enrichBatch` runs against 100 priority clinics and saves placeId + enriched data to `outreach.localDentists.json`
2. `generateDailyTargets.js` produces `data/daily-targets.json` with 10 GMB + 10 Instagram records, each with a real personalized message
3. Morning brief email includes the GMB + Instagram sections
4. Scheduler has both new jobs registered
5. `markGMBSent.js` successfully stamps a test clinic
