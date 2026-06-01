---
name: dental-triage
description: Clinical urgency triage for dental appointment requests. Maps patient-described symptoms (pain, swelling, trauma, sensitivity) to an urgency level — urgent, soon, or routine — so scheduling can prioritize genuine emergencies. Use when a patient request describes how they feel rather than just when they want to come in.
---

# Dental Triage

This skill encodes **clinical judgment**: how soon a patient should be seen
based on the symptoms they describe. That judgment is fuzzy and practice-specific
by nature, which is exactly why it lives in a swappable skill file instead of in
code.

It is deliberately **separate from hard scheduling constraints** (provider
hours, lunch blocks, days off). Those are structured data the scheduler enforces
exactly, every time. This skill only influences *priority*, never whether a slot
is actually bookable. Do not conflate the two.

## Triage table

Each row maps symptom keywords to an **urgency** level and an **escalation**
level. Rows are evaluated top to bottom; the first row with a keyword present in
the request wins, so the most severe categories are listed first. Keywords match
on whole words. The escalation column is one of:

- `emergency` — a potential medical emergency (airway, breathing, swallowing, or
  uncontrolled bleeding). Advise emergency services AND alert the office to call
  back immediately.
- `callback` — an urgent same-day dental need. The office should call the patient
  back as soon as possible to arrange care.
- *(blank)* — no escalation; schedule normally.

| symptoms | urgency | escalation | note |
| --- | --- | --- | --- |
| can't breathe, cant breathe, trouble breathing, difficulty breathing, can't swallow, cant swallow, trouble swallowing, difficulty swallowing, airway, throat swelling | urgent | emergency | airway/breathing — possible medical emergency |
| won't stop bleeding, wont stop bleeding, uncontrolled bleeding, heavy bleeding, bleeding heavily | urgent | emergency | uncontrolled bleeding — possible medical emergency |
| swelling, swollen, abscess, fever, pus, infection | urgent | callback | possible infection — same-day callback |
| knocked out, avulsed, trauma, broke, broken, cracked, chipped, bleeding | urgent | callback | dental trauma — same-day callback |
| throbbing, severe, killing, unbearable, excruciating, cannot sleep | urgent | callback | acute pain — same-day callback |
| lost filling, lost crown, filling, crown, ache, aching, sore, sensitive, sensitivity, toothache | soon | | discomfort — within a few days |
| cleaning, checkup, check-up, exam, whitening, routine, consultation | routine | | elective — normal scheduling |

## Default

If no symptom matches, treat the request as **routine** with no escalation.

## How this is used

The scheduler loads this file and matches the patient's words against the table
to set urgency, which then feeds the deterministic slot scoring (urgent requests
score nearer-term slots higher). Because the knowledge is in this file, a
different practice can drop in their own SKILL.md — say, one that escalates
sensitivity to urgent — and the system's triage behavior changes with **zero
code changes**.
