---
"@objectstack/rest": patch
"@objectstack/runtime": patch
---

fix(rest): make the API-exposure gate's metadata fail-open observable (#3545, #3391 follow-up)

The object API-exposure gate (`apiEnabled` / `apiMethods`) fails OPEN when object
metadata can't be resolved, so a transient metadata outage doesn't 405 every
request. #3545 evaluated the residual risk of that path and confirmed it is
acceptable — the gate is a **surface-area control, not the authorization
boundary**: every request still passes auth and the ObjectQL security middleware
(CRUD / FLS / RLS) on the data call regardless of the gate's outcome, so a
fail-open can never bypass data authorization.

The one gap was that the fail-open was **silent** — a persistent metadata fault
(store down / corrupt schema doc), during which the gate allows every operation
unchecked, looked identical to healthy operation.

- **rest** `loadObjectItems` now LOGS a *thrown* metadata read (a real fault)
  while leaving a legitimately-empty registry (a cold-start `[]`) silent — so a
  genuine outage is diagnosable without false alarms during normal startup. The
  behavior is unchanged (still returns `[]` → gate abstains → data path + security
  enforce).
- **runtime** `api-exposure.ts` records the #3545 tiered decision in its
  contract doc: keep fail-open when the whole metadata service is unavailable
  (failing closed would break the cold-start window for no security gain); the
  narrow "object resolvable but its `enable` policy is present-yet-unreadable"
  widen (unreachable through Zod-validated registration) is deferred to the
  exposure-semantics window (#3543).

No contract or behavior change to the gate itself — observability + decision
record only.
