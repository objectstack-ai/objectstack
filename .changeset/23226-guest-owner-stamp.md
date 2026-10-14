---
'@objectstack/plugin-security': minor
---

feat(security)!: an anonymous caller never owns a record and never sets its owner — the owner-anchor stamp's guest branch (ADR-0138 E3, D1)

Clause-②: no (narrowing) — a guest-supplied owner is refused at the endpoints and the owner column never holds the guest or the system principal. That tightens what a guest write may carry and admits nothing refused today.

<!-- adr-0087: not-required (no-migration-prescription) No authorable key, accept set of a metadata schema or stored shape moves: no spec schema, metadata type, stored row or published response field is added, removed, renamed or re-shaped. What narrows is a value an anonymous caller may send in a write, judged by the security middleware at run time; no metadata names it, so there is nothing for `objectstack migrate meta` to rewrite, and the record's own row for this card states the disposition "none: no new key, and nothing moves". The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this and this diff adds none (not registered or already-registered); no exported TypeScript declaration changes (not runtime-interface-only or type-surface-only); no export is removed (not runtime-export-retired). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

ADR-0138 D1 rules that the guest is a principal, never an owner. The owner-anchor stamp in `SecurityPlugin` (the step that stamps an absent `owner_id` with the acting user and refuses a forged one) now carries the guest branch the record names as D1's enforcement point. It applies to the guest envelope, an anonymous request served by an `authRequired: false` endpoint:

- **Nothing is stamped for a guest.** An absent owner stays unset: never the guest, never the system principal. An empty `owner_id` (an empty string) is left unset too, where it used to be stored as an empty string.
- **A guest-supplied owner is refused**, on create and on update, with `PERMISSION_DENIED` (`403`), whatever the guest is granted. The transfer grant is never consulted for a guest. Before this change a guest whose bound permission set carried the transfer bit could create a row owned by any user, the system principal included. The anchor tier already refuses that bit on a guest binding, so no binding a deployment can make today reached it, and this branch does not depend on the tier. Without the transfer bit the refusal already happened before this change; its message now says that no grant admits a guest's owner, instead of naming the transfer grant as the remedy.
- **An owner the scenario sets stands.** A `beforeInsert` hook runs after the stamp, inside the engine's operation, and a record-change flow writes as itself, so neither is mistaken for a value the guest sent.

Unchanged: the public form doors, which strip a submitted owner and leave it unset (`PUBLIC_FORM_SERVER_MANAGED_FIELDS`); every signed-in caller, whose absent owner is still stamped with its own id and whose foreign owner still needs the transfer grant; and system writes.

What a guest client does: leave `owner_id` out of an anonymous write. The object's own hooks or record-change flows decide who owns the row, and the row stays unowned when none does.
