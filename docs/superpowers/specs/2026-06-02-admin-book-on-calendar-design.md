# Admin-side booking on the day calendar — design

## Problem
On the Admin page, the day-detail calendar is read-only: it shows booked
appointments but its open slots aren't bookable. When staff are on a callback
("ok, schedule me"), they have to switch to the Patient Intake page to book.
They should be able to book directly from the Admin calendar.

## Approach (frontend-only)
The backend already does everything:
- `GET /api/availability?from&to&type` lists open slots (same candidate
  generator → eligibility, X-ray rooms, hours, lunch all hold).
- `POST /api/book` books a slot, re-checks conflicts (409), and reuses an
  existing patient by name/phone instead of forking a duplicate.

So this is wiring on the Admin view + a small booking dialog. No server change.

## UI / interaction
1. **Type selector** on the day-detail toolbar (data-driven from
   `state.appointmentTypes`), default `cleaning`. It sets which open slots are
   fetched, so duration/eligibility stay correct per type.
2. **Open slots become bookable.** Admin fetches availability for
   `{ from: day, to: day, type }`, builds a `highlights` set of
   `` `${providerId}@${start}` `` keys, and passes `highlights` + `onBookSlot`
   into the existing `<Calendar>` (the same machinery Intake uses). Open times
   render as green "book" buttons; no ★ (there is no recommendation context on
   Admin). Booked times stay red.
3. **Booking dialog** (`BookSlotDialog`). Clicking an open slot opens a centered
   dialog whose header shows the slot context (`Dr. Smith · Tue 2:00 PM ·
   cleaning`), with Name + Phone fields and Cancel / Confirm. Confirm requires a
   name (phone optional, matching Intake). Esc or backdrop click cancels.
4. On confirm → `postBook({ slot, name, phone })`; on success refetch state +
   availability so the slot flips to a red booked block and a transient
   "✓ Booked · DDS-####" confirmation shows. On 409 the dialog shows
   "That slot was just taken" and the grid refreshes.

## State (Admin.tsx)
Adds `bookType`, `daySlots` (open slots for the shown day), `pending`
(the `CandidateSlot` being booked), `booking`/`bookError`/`bookConfirm`. An
effect refetches availability when `day` or `bookType` changes.

## Components
- `BookSlotDialog` (new, small): pure presentation — given a slot + providerName,
  collects name/phone and calls back. No data access of its own.
- `Calendar`: unchanged — it already supports `highlights` + `onBookSlot`.

## Scope (YAGNI)
No batch booking, no editing existing appointments from the grid (that's
reschedule), no patient search/create beyond name+phone.

## Testing
The booking path (`/api/book`, incl. conflict + patient reuse) is already covered
by backend tests. The new code is frontend wiring; the stack has no React test
runner, so verification is in the browser: book a slot → it turns red, drops from
open slots, no duplicate patient created; booking a taken slot shows the 409.
