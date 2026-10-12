---
'@objectstack/verify': minor
'@objectstack/cli': minor
---

feat(verify): the parent-derived write reach family — a write on a `controlled_by_parent` detail is admitted exactly when the caller holds that verb on the detail and can edit its master, runnable as `os verify --parent-write-reach` (#15953)

Clause-②: yes

A sixth derived proof family beside `runCrudVerification`, `runRlsProofs`, `runReferenceShapeProofs`, `runDeleteBehaviorProofs` and `runUniqueScopeProofs`. It needs no hand-written test: from the app's own objects it takes every object the spec's own parse (`ObjectSchema`) declares `sharingModel: 'controlled_by_parent'` with exactly one `master_detail` field, walks the chain of masters above it to the first one that governs its own rows, and asks the engine what a detail write meets as a signed-in caller: the insert, update and delete by id the REST data route makes, with the caller's context, where a refusal keeps the object and the operation it names (the REST envelope names the route's object whatever was refused). The system door bypasses authorization and is not asked.

The promise is ADR-0055 §3 and its chain amendment: editing, deleting or creating a detail requires edit access to its master, and the detail's own object permission is the first door. So each write is expected admitted exactly when both halves hold:

- the caller holds the verb on the detail's object — read from the server's effective permissions for the caller (`GET /auth/me/permissions`), folded by `objectPermissionGrants`;
- the caller can edit the master — measured, never re-derived: an empty update of the master as the caller, which runs every write gate the master has, the gate above a master that is itself controlled by its parent included.

The writes are made by three verifier personas whose permission sets the family authors from the app's own objects — the root master by the all-records grant (`modifyAllRecords`) with every verb on the detail; the root master readable but not editable with every verb on the detail; the all-records grant with no delete on the detail — and by one persona per position the app declares, whose capability is what the app binds to the position. Each writes under a master chain another principal owns (so the all-records grant, not ownership, is exercised) and one it owns, on a detail another principal owns and one it owns. A refusal holds only as the platform's `403 PERMISSION_DENIED` naming the detail and the operation; any other refusal (a rule, a hook's own code, a refusal on another object) is `unattributed`. An object is `proven`, `contradicted` (a write met the other answer), `failed` (a door faulted), `inconclusive`, `excluded` (no one master: none, two, an undeclared one, a cycle, or a chain at the write gate's depth bound) or `not-derivable`. `contradicted + failed` objects, plus personas that could not be provisioned, are the report's `hardFailures`.

Today's engine refuses every write to a detail two levels below its root master, even where the caller edits the middle master, so on an app that declares such a chain the family reports a contradiction and the run fails.

**`@objectstack/verify` — new exports.**

- `runParentWriteReachProofs(stack, config)` → `ParentWriteReachReport`. Run it on a fresh stack of its own, booted with `parentWriteReachSecurity(config)`: it signs up personas and writes, deletes and creates details. On a stack booted without it the verifier personas are reported not run, with the reason, and counted.
- `parentWriteReachSecurity(config)` → the `SecurityPlugin` that registers the verifier personas' permission sets beside the app's declared default profile.
- `deriveParentWriteReachCases(config)`, `formatParentWriteReachReport(report)`.
- Types: `ParentWriteReachHop`, `ParentWriteReachCase`, `ParentWriteReachVerb`, `ParentWriteReachOwner`, `ParentWriteReachAnswer`, `ParentWriteReachProbeResult`, `ParentWriteReachReach`, `ParentWriteReachObjectStatus`, `ParentWriteReachObjectResult`, `ParentWriteReachPersona`, `ParentWriteReachReport`.

```ts
import { bootStack, runParentWriteReachProofs, formatParentWriteReachReport, parentWriteReachSecurity } from '@objectstack/verify';

const stack = await bootStack(myApp, { security: parentWriteReachSecurity(myApp) });
const report = await runParentWriteReachProofs(stack, myApp);
console.log(formatParentWriteReachReport(report)); // report.personas names who wrote
expect(report.summary.hardFailures).toBe(0);
await stack.stop();
```

**`@objectstack/cli` — `os verify --parent-write-reach`.** Opt-in, like `--delete-behaviors` and `--unique-scopes`, on a fresh boot of its own with the verifier personas' sets registered. A write whose answer disagrees, a door that faulted, or a persona that could not be provisioned counts in `hardFailures` and fails the run. The `--json` document carries the report as `parentWriteReach` when the flag is given; without the flag the run and its document are unchanged.
