---
'@objectstack/runtime': patch
---

fix(runtime)!: the action activation door answers a name two packages hold with `409` naming both, as the execution door does, instead of `404` "has no declaration"

Clause-②: yes (narrowing)
Metadata-protocol: none

BREAKING, for `POST /api/v1/actions/_activation/OBJECT/NAME` (body `{ "enabled": true | false }`) where two packages each declare an action `NAME` on that route's key — both object-less (`OBJECT` = `global`), or both bound to `OBJECT`:

- FROM: `404 RESOURCE_NOT_FOUND`, "Action 'NAME' on 'OBJECT' has no declaration — there is nothing to switch off" (or "on").
- TO: `409 RESOURCE_CONFLICT`, the declaration reading's refusal, naming every holder in the message and in `error.details.candidates` (each with its `packageId`). The execution door `POST /api/v1/actions/OBJECT/NAME` already answers this name with the same refusal.

In both directions nothing is written to the activation ledger, as before. The declaration reading refused the name, and the activation door read that refusal as "no declaration", so it reported an ambiguity as an absence (ADR-0150 D3: ambiguity is reported, never answered as absence).

Unchanged: a name one package declares switches off and on with its ledger row naming that package; a name nothing declares answers `404` "has no declaration"; one package's action bound to two objects answers the activation door's own `409` naming both objects.

The fix for a caller: read the `409` as "two packages hold this name", not as a missing action. The ledger addresses an action by its name, so this door switches the name again once one package holds it; before this change the same request answered `404` and switched nothing either.

<!-- adr-0087: not-required (no-migration-prescription) no key, export, field or stored body changes; the change is the status of a refusal the activation door already made, now answered as the execution door answers the same name; a caller holding two packages' action of one name must choose which package's action to switch, which no conversion can choose for them -->
