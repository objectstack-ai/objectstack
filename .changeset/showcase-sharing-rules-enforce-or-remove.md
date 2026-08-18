---
"@objectstack/example-showcase": patch
---

Retire the showcase sharing rules no gate could consult; re-home the position/compound demo (#9237)

Booting `examples/app-showcase` logged two WARNs per boot — `SharingServicePlugin: boot
rule backfill failed for rule` for `share_open_tasks_with_manager` and
`share_red_projects_with_execs`. Both sat on objects declaring
`sharingModel: 'public_read_write'`, where sharing has nothing left to widen, so
`assertNotInertGrant` (ADR-0111 D7) refused every grant they reconciled. A third rule,
`share_high_value_red_projects_with_managers`, was in exactly the same state and produced
no diagnostic at all: its compound condition matched no seeded row, so `reconcile` never
reached `grant` and never threw.

`showcase_project` and `showcase_task` are `public_read_write` by deliberate ADR-0090 D1
declaration and that OWD is load-bearing beyond the security demo, so no rule can ever take
effect there. ADR-0049 enforce-or-remove leaves one honest move, and all three are removed
rather than re-homed onto another public object — the shape the previous repair took, which
moved the inertness instead of removing it.

The two capabilities they carried are kept: a `position` recipient and a compound CEL
condition (ADR-0058 D3) now live on `share_key_account_qualified_contacts_with_managers`,
targeting `showcase_contact` (OWD `private`, and the `showcase_manager` set grants it
`allowRead` — the object-level bit a share row still needs). The seeded contacts
demonstrate the AND in both directions: rows satisfying either clause alone are not
shared.

`inert-wirings.test.ts` gains the guard that fails the build on the next such declaration,
in both of its shapes — a rule anchored where the OWD leaves nothing to widen, and a rule
whose audience holds no `allowRead` on the object it shares.
