# Escalation takeover screen + "Understood as" on confirmation screens

Frontend-only. Callback endpoints (/api/schedule capture + /api/callbacks/contact)
and their tests already exist.

## EscalationScreen (full-page takeover)
When a search returns `escalation.callbackRequired` (emergency OR callback), the
page takes over completely (request box, patient bar, cards, calendar hidden) —
parallel to the "You're booked!" screen. No self-booking; the callback is the
resolution. Contents:
- Headline + message, styled by level (emergency = red, callback = amber).
- Contact capture: if a number was already captured (stated in the request or in
  the bar at search time → `callbackDone`), show "✓ the office will call you at
  {phone}". Otherwise inline name + masked phone + "Send my number to the office"
  → `sendCallbackContact` (attaches to the queued callback via callbackId).
- 🧠 Understood as (demo area, below).
- ↺ Start over → resetToSearch().

## "Understood as" on the terminal screens
Reuse `IntentSummary` with a new `demo` flag that adds a small caption
("demo view — how the assistant read this · hidden in production"). Rendered under
BOTH the booked screen and the escalation screen.

## Wiring
- New `EscalationScreen` in `BookingPanel.tsx`; reuses Intake's callback state
  (callbackDone/callbackBusy/patientName/patientPhone) + sendCallbackContact as props.
- Intake render precedence: booked (confirmed) → escalation → normal review/results.
- Remove the old inline escalation banner (now a full screen). Keep all callback
  state/handlers. `resetToSearch()` also clears `callbackDone`.

## Verify
Browser: emergency with no number → takeover prompts for it → send → "we'll call
you" + Understood-as; booked screen now shows Understood-as too. No backend/test
changes.
