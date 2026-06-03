# Patient Intake booking-flow redesign

Frontend-only. `/api/book` + `/api/cancel` already do everything; no backend change.

## Booking state machine (Intake results area)
Three mutually-exclusive phases replace the current intent-summary + cards + calendar:
- **RESULTS** — recommendation cards + the calendar (now patient-view). Clicking "book"
  (card or calendar slot) NO LONGER books; it captures the slot → REVIEW. Still requires a
  valid name + 10-digit phone first (else focus the bar).
- **REVIEW** — replaces cards+calendar: "Book {Thu Jun 11 · 3:30 PM · Dr. Jones · cleaning}?"
  with `[✓ Confirm booking] [↺ Start over]`. Nothing committed.
- **BOOKED** — Confirm calls `postBook(slot, {name, phone})` → confirmed panel.

Confirm-first: the appointment + confirmation number are created only at Confirm. This also
fixes the "calendar doesn't react after booking" bug — once booked the calendar is gone.

## Confirmed panel ("nice little area")
"✓ You're booked! {Thursday, June 11 at 3:30 PM} with {Dr. Jones} for a {cleaning}.
Confirmation {DDS-####}. 📱 We'll text you a reminder one hour before."
`[↺ Cancel this booking & start over]` → `postCancel(appointmentId, patientId)` (frees the
slot for real) → reset to a clean search.

## Patient-view calendar
New `patientView?: boolean` prop on `Calendar`. On Intake = true, Admin = false (unchanged).
When true: every booked/blocked/off cell renders as a plain red "unavailable" (no type, no
"lunch", no provider procedure); open cells stay green "book"/"★ book"; dentist column headers
stay. All clinical detail stays Admin-only.

## Phone mask
`formatPhone(input)` → formats as typed to "(949) 555 - 0143" (strip non-digits, cap 10).
`canBook` now requires name + exactly 10 phone digits.

## Keep
Recommendation cards keep provider/type/score/factor breakdown (the patient's own options +
the assignment's "explainable recommendations"). On a 409 at Confirm (slot just taken): show
"that slot was just taken" and return to RESULTS with refreshed availability.

## Components
- New `BookingPanel.tsx` exporting `BookingReview` + `BookingConfirmed` (small, presentational).
- Touched: `Intake.tsx` (state machine + phone mask), `Calendar.tsx` (+patientView), `App.css`.

## Testing
Backend unchanged (existing /api/book + /api/cancel tests cover it). Frontend has no test
runner → verify the full flow in the browser: search → book → review → confirm → booked →
cancel & start over; patient-view calendar shows only unavailable/book; phone mask formats.
