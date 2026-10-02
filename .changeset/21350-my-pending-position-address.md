---
'@objectstack/plugin-approvals': patch
---

The approvals inbox's "My Pending" now lists a request routed to a position for the users who hold that position, whichever spelling of the position address the client asks for

Clause-②: no

A request whose approver position nobody held when it opened keeps the literal `position:<name>` slot. A user staffed into that position afterwards could already decide it, by naming `position:<name>` as the actor. `resolveActor` admits a holder under `position:<name>` and under `role:<name>` (the deprecated pre-rename spelling) as the caller's own identity, but the decision's slot test is literal: on that slot, `role:<name>` or no actor at all answers 403. The list read did not agree with either half.

- `GET /api/v1/approvals/requests?approverId=…` matched each value literally. The stock console sends `role:<name>` for every position the session carries, so the request never appeared in "My Pending". A position address now matches under both spellings `resolveActor` admits a holder under, and no others. A `team:`, `org_membership_level:` or bare-name value still matches only itself.
- The participant gate behind every approvals read counted a "current approver" by user id alone. A holder of the position who neither submitted the request nor holds admin standing got an empty list under both spellings and a `404` on `GET /api/v1/approvals/requests/:id`, though their approve call naming `position:<name>` succeeded. The gate now also counts the slot addresses of every position on the caller's server-resolved context. A request becomes visible only to someone who can decide it.
- The decision routes are unchanged. They admit exactly the identities they admitted before, and a pin compares them against the previous predicate.

A caller who sent the stored `position:<name>` spelling and was already the submitter or an admin sees no change.
