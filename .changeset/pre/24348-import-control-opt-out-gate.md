---
'@objectstack/rest': minor
---

fix(rest)!: the import doors honour `runAutomations: false` and `treatAsHistorical: true` only for the system principal, and refuse them `403 PERMISSION_DENIED` to every other caller

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) Nothing an author writes, and no stored shape, is added, removed, renamed or converted: the change is who may send two request flags on the two import doors. Both keys stay declared on `ImportRequestSchema` with their shape and defaults unchanged, the refused values arrive in a request body and are never stored, and no spec key, export or error code is added or removed (`PERMISSION_DENIED` is a standard code), so there is nothing for `objectstack migrate meta` to rewrite. The remedy is a request-time one, stated below: send the import without the two opt-outs. -->

**BREAKING** (the import doors accept fewer request values: `runAutomations: false` and `treatAsHistorical: true` are refused from every caller but the system principal, administrators included), shipped as `minor` under the launch-window convention for breaking changes. Two known consumers break visibly: objectui's Import Wizard, whose two options now answer `403` for every signed-in user (#24381), and hotcrm's dev-only demo script, which sent the opt-out as the dev administrator and now exits by its own submitter check.

Both flags take an app's declared business controls off every row an import writes. `runAutomations: false` writes with `skipAutomations`, so no metadata-bound hook and no record-change trigger runs (an approval flow and a closed-record freeze hook among them). `treatAsHistorical: true` writes with `skipStateMachine` and `preserveAudit`, so the object's `state_machine` rule is skipped and supplied audit and read-only values are kept. Until now, any caller who may import could send either.

**What changes.** `POST /api/v1/data/:object/import` and `POST /api/v1/data/:object/import/jobs` admit either opt-out only from the system principal (`ExecutionContext.isSystem`), the predicate the doors that start an elevated self-triggered flow already ask. Every other caller, every signed-in user and administrator included, gets `403 PERMISSION_DENIED` in the ADR-0112 envelope, with `error.details: { object, refused }` naming the opt-outs it sent. The doors ask before the body is parsed: a refused request writes no row and creates no import job, on a dry run too. A hidden object keeps its `404` ahead of the refusal.

**What stays as it was.** A request that omits both keys, or sends `runAutomations: true` / `treatAsHistorical: false`, imports exactly as before, with every control in force. `runImport` (`@objectstack/core`) is unchanged: in-process callers that run as the system principal, and the identity import in `@objectstack/plugin-auth`, keep their own settings.

**If an import now answers 403.** Send it without `runAutomations: false` and `treatAsHistorical: true`: the rows are written with the object's automations, hooks, `state_machine` rule and audit stamps in force. A bulk load that must skip them is a migration, and runs in-process as the system principal.
