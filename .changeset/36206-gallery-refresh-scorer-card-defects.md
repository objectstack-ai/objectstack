---
'@objectstack/scenarios': patch
---

fix(scenarios): scorer and card fixes from the 18.6.0 gallery refresh

Clause-②: no
Metadata-protocol: none

- The confirmed write of a `pending_confirmation` operation is not measured, never failed, when the first turn's write already met `428 ACTION_CONFIRMATION_REQUIRED` with `reason: no_confirmation_service` and the confirmation turn sends no write on the object: the agent remembered that the route cannot apply on that server. A confirmation turn that does write is graded as before. New export: `confirmTurnMetNoConfirmationService(firstMet, turn, object)`.
- A decline of an `unanswerable` question may state the sum or the difference of two figures the turn's tool outputs carry, when the reply writes both of them too ("45.5 + 9 = 54.5 days", "249 comments, 20 internal, so 229"). A derived figure whose operands the reply leaves out, a product, a figure derived from a derived figure and a zero from two equal figures still fail.
- Card data: requisition_to_receipt seeds `supplier.rating` as `grade_a` / `grade_b` / `grade_c` (a single-choice value is a lowercase identifier, so `A` / `B` / `C` refused every supplier row and the purchase orders, lines and receipts beneath them); travel_expense's step `as_118_2` is decided on the card's `asOf` (2026-10-31), not after it; service_desk's TK-0091 opens on 2026-10-02, so no urgent or high ticket sits on the day the platform's `last_30_days` preset counts and the card's 30-day window does not (`urgent_high_last_30_days` is now 9); and service_desk's prompt asks for the report and the computed value its Build half grades.
- The build prompt's data contract says how the seed loads: through the platform's seed path as established facts, where every validation rule and hook but the state machine's entry check runs and no record-triggered flow fires, so a derived field must be a formula or an expression computed when written. New export: `SEED_POSTURE`.
