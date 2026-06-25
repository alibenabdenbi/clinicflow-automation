# PhantomBuster LinkedIn Outreach Setup

Two-phase workflow: (1) find LinkedIn profile URLs, (2) send connection requests + follow-ups.

---

## Phase 1 — LinkedIn Search Export (find profile URLs)

**Phantom:** LinkedIn Search Export  
**Input file:** `data/linkedin/phantombuster-search.csv`

### Columns
| Column | Purpose |
|--------|---------|
| `searchQuery` | Search string PhantomBuster enters into LinkedIn search |
| `expectedName` | The name you expect to find (for your reference) |
| `clinicName` | Clinic name (for your reference) |
| `city` | City (for your reference) |

### Steps
1. Go to [phantombuster.com](https://phantombuster.com) → New Phantom → **LinkedIn Search Export**
2. Connect your LinkedIn session cookie (Settings → LinkedIn Session Cookie)
3. Under "Spreadsheet URL or CSV", upload `phantombuster-search.csv`
4. Set "Column name" to `searchQuery`
5. Set max results per search: **1**
6. Run the phantom
7. Download the result CSV — it will contain a `profileUrl` column
8. Copy the `profileUrl` values back into `data/linkedin/prospects.json`:
   ```json
   [
     {
       "name": "Dr. John Smith",
       "profileUrl": "https://www.linkedin.com/in/johnsmith-dds/",
       "clinicName": "Smith Dental",
       "city": "Toronto",
       "connectionSent": false
     }
   ]
   ```
9. Run `npm run linkedin:export` to regenerate `phantombuster-messages.csv`

---

## Phase 2 — LinkedIn Message Sender (send connection + follow-ups)

**Phantom:** LinkedIn Message Sender  
**Input file:** `data/linkedin/phantombuster-messages.csv`

### Columns
| Column | Purpose |
|--------|---------|
| `linkedinUrl` | Profile URL from Phase 1 |
| `firstName` | First name for personalization |
| `clinicName` | Clinic name |
| `city` | City |
| `connectionMessage` | Connection request message (≤300 chars) |
| `followUpMessage` | Follow-up after accepting (≤300 chars) |

### Steps
1. New Phantom → **LinkedIn Message Sender**
2. Connect LinkedIn session (same cookie as Phase 1)
3. Upload `phantombuster-messages.csv`
4. Set action: **Send connection request** with message from `connectionMessage` column
5. Set daily cap: **20 requests/day** (LinkedIn limits ~100/week)
6. Schedule: run daily Mon-Fri at 9am

### Follow-up Phase
1. After 3-5 days, check accepted connections
2. New phantom run using `followUpMessage` column
3. Only send to profiles where connection was accepted

---

## Connection Message Template (≤300 chars)
```
Hi [firstName], I help dental clinics in [city] recover missed call revenue — found something specific to your area. Free audit, no commitment. Would love to connect. — Mohamed
```

## Follow-Up Message Template (≤300 chars)
```
Thanks for connecting [firstName]! Quick question — when a patient calls [clinicName] and no one answers, what usually happens? Found a specific gap most [city] clinics have. Worth 2 minutes?
```

---

## Safety Guidelines

- **Daily cap:** Max 20 connection requests/day (LinkedIn detects automation above ~25/day)
- **Hours:** Only run during business hours (9am-5pm) to mimic human behaviour
- **Profile:** Make sure your LinkedIn profile is complete before starting
- **Cookie refresh:** Session cookies expire — re-copy from browser every 2-4 weeks
- **Warm-up:** Start with 5/day for the first week, ramp up slowly

---

## Tracking Results

After running, mark sent prospects in `prospects.json`:
```json
{ "connectionSent": true, "connectionSentAt": "2026-04-19" }
```

Or use `npm run linkedin:export --all` to see all prospects including sent ones.
