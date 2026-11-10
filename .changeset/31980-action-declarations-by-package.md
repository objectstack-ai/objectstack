---
'@objectstack/runtime': patch
---

fix(runtime): a package's action bound to another package's object is reachable by its qualified address

Clause-②: yes
Metadata-protocol: none

Measured: no bare answer changes. The bare REST `/actions/:object/:action` door does not read the collector (it serves the object's own declaration first), and a bare MCP `run_action` on an object-bound pair still answers the object's own declaration. What widens: the qualified address and `run_action` with a `namespace` reach the second package's declaration, and `list_actions` lists it (and `resume_run` may admit through it). First-party count of such pairs: 0.

`collectActionDeclarations` kept one declaration per `object:name`, whichever package shipped it, so an object-embedded action shadowed another package's standalone action bound to the same object. With crm's `lead` embedding `convert` and hr shipping a standalone `convert` bound to `lead`, `POST /api/v1/actions/hr/lead/convert` and `run_action(convert, { namespace: 'hr', objectName: 'lead' })` answered `404` (or reached hr's object-less `convert`, if it had one). Phase 1's one-holder rule covers object-less action names only, and a same-object pair is reported at boot, not refused, so such a pair can be installed today.

The collector now keys its dedupe by package as well. Each holder's declaration of `object:name` is its own row, so each package's qualified address reaches its own declaration and its own handler, as ADR-0150 ("Covered and uncovered types") says. Within one package, the object-embedded declaration still wins over its own standalone duplicate, which is not listed twice.

A bare call on such a pair keeps today's answer, the object's own declaration. The no-package refusal of an object-bound pair (`409` naming every holder) belongs to the action family's own change (ADR-0150 child B), not this one.
