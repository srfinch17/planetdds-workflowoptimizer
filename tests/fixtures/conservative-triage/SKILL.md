---
name: conservative-triage
description: A more cautious practice's triage skill. Treats any sensitivity or ache as urgent (same-day) rather than waiting. Demonstrates that triage behavior is governed entirely by the skill file, not by code.
---

# Conservative Dental Triage

Same structure as the default skill, but this practice prefers to see anyone
with sensitivity or pain the same day.

## Triage table

| symptoms | urgency | escalation | note |
| --- | --- | --- | --- |
| can't breathe, trouble breathing, can't swallow, airway | urgent | emergency | airway/breathing — possible medical emergency |
| swelling, swollen, abscess, fever, pus, infection | urgent | callback | possible infection — same-day |
| knocked out, trauma, broke, broken, cracked, chipped, bleeding | urgent | callback | dental trauma — same-day |
| throbbing, severe, killing, ache, aching, sore, sensitive, sensitivity, toothache | urgent | callback | see same-day to be safe |
| cleaning, checkup, check-up, exam, whitening, routine | routine | | elective — normal scheduling |

## Default

If no symptom matches, treat the request as **routine**.
