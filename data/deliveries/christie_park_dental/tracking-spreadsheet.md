# Automation Tracking Guide — Christie Park Dental

## Setup (5 minutes)

1. Go to **sheets.google.com** → New spreadsheet
2. Name it: **Christie Park Dental — Automation Tracker**
3. Share with your front desk manager and practice owner (Editor access)
4. Create the tabs below

---

## Tab 1: Missed Call Recovery

| Date | Patient Name | Phone | Email Sent (Y/N) | Called Back (Y/N) | Appointment Booked (Y/N) | Notes |
|------|-------------|-------|-----------------|------------------|--------------------------|-------|

**Target:** 35–50% of missed calls should convert to booked appointments within 48 hours.

**Monthly check:** Count "Appointment Booked = Y" ÷ total rows = your recovery rate. If below 30%, check that the phone system is triggering correctly.

---

## Tab 2: Appointment Reminders

| Week of | Reminders Sent | Confirmed (YES) | Cancelled | No Response | Actual No-Shows |
|---------|---------------|-----------------|-----------|-------------|-----------------|

**Formula — confirmation rate:** `=COUNTIF(C:C,"YES")/B2` (adjust row reference)

**Target:** 65–75% confirmation rate. If lower, check that SMS numbers in your system are current.

**No-show tracking:** Compare "No Response" column with actual no-shows from your PMS to see how many unconfirmed patients still showed up.

---

## Tab 3: Reactivation Campaign *(Growth/Full)*

| Patient Name | Last Visit | Months Inactive | Email 1 Sent | Email 2 Sent | Reply Received | Rebooked (Y/N) |
|-------------|-----------|-----------------|-------------|-------------|----------------|----------------|

**Formula — months inactive:** `=DATEDIF(B2,TODAY(),"M")` (where B2 = last visit date)

**Target:** 15–25% rebook rate from reactivation sequences is strong. Below 10% usually means the patient list is too stale (2+ years inactive) — focus on the 12–18 month window first.

---

## Tab 4: Monthly Summary

| Month | Missed Calls Recovered | Reactivations Rebooked | Reviews Received | New Patients Welcomed |
|-------|----------------------|----------------------|------------------|-----------------------|

Fill this in on the first Monday of each month. It takes 10 minutes and gives you a clear trend line within 3 months.

---

## Conditional Formatting Rules

Apply via **Format → Conditional Formatting** on the "Last Visit" column in Tab 3:

- **Red fill:** `=AND(B2<>"",DATEDIF(B2,TODAY(),"M")>=12)` — reactivation candidates
- **Yellow fill:** `=AND(B2<>"",DATEDIF(B2,TODAY(),"M")>=6,DATEDIF(B2,TODAY(),"M")<12)` — recall due
- **Green fill:** `=AND(B2<>"",DATEDIF(B2,TODAY(),"M")<6)` — recently active

---

## Monthly Review Checklist (15 minutes, first Monday of each month)

- [ ] Fill in Tab 4 with last month's totals
- [ ] Check missed call recovery rate — trending up or down?
- [ ] Review Tab 3: any reactivation patients who replied but didn't book? Follow up personally.
- [ ] Check for automation replies in your inbox that need a human response
- [ ] If reactivation queue has 20+ patients, send the list to contact@clinicflowautomation.com for next batch