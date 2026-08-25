---
'@objectstack/client': minor
---

Bind the SDK's erased return types to the `@objectstack/spec` contracts the package already depends on

**This is a NARROWING of published return types.** 41 methods that resolved to `any` (or to an
envelope carrying an `any[]`) now resolve to the contract type the route actually answers, and 12
fixed-shape `automation.*` methods gain a constrained generic in place of `<T = any>`. Nothing
changes at runtime — no request, response, unwrapping or error path is touched — but code that
compiles today against these methods can stop compiling. `any` is assignable to everything and
admits every property read, so the previous declaration accepted assignments, property reads and
parameter forwarding that a precise type refuses.

What a consumer could stop compiling against, per family:

- **`automation`** — `get`/`getFlow` are `FlowParsed`; `runs.get`/`getRun` are `ExecutionLog`;
  `runs.list`/`listRuns` are `{ runs: ExecutionLog[]; hasMore: boolean }`; `execute` and `resume`
  are `AutomationResult`; `getScreen` is `{ runId: string; screen: ScreenSpec }`; `listActions` and
  `listConnectors` carry `ActionDescriptor[]` / `ConnectorDescriptor[]` instead of `any[]`. ⚠️ The
  biggest practical break is `AutomationResult.screen`, `.runId`, `.status` and `.summary` being
  **optional**: a completed run carries no screen, so `result.screen.nodeId` must become
  `result.screen?.nodeId`. The six flat aliases and their `ScopedProjectClient` mirrors move
  together. ⚠️ `<T = any>` became `<T extends X = X>` on those twelve: an explicit type argument
  still works when it narrows the platform shape (`getFlow<FlowParsed & { name: 'onboarding' }>`),
  but one naming an unrelated type is now refused — including where TypeScript used to infer it
  from the assignment's own annotation.
- **`approvals`** — `recall` / `revise` / `resubmit` are `ApprovalRecallResult` /
  `ApprovalSendBackResult` / `ApprovalResubmitResult`; `remind` is
  `{ request: ApprovalRequestRow; notified: number }`; `requestInfo` and `comment` are
  `{ request: ApprovalRequestRow }`. These join `reassign` and `listActions`, which were already
  typed this way beside them.
- **`shares` / `shareLinks`** — `shares.list` is `RecordShare[]`, `shares.grant` is `RecordShare`;
  `shares.rules.list` / `save` / `get` are `SharingRuleRow`(`[]`) and `rules.evaluate` is
  `SharingRuleEvaluationResult`; `shareLinks.create` / `list` are `ShareLink`(`[]`).
- **`reports`** — `list` / `save` / `get` are `SavedReport`(`[]`), `run` is `ReportRunResult`,
  `schedule` / `listSchedules` are `ReportSchedule`(`[]`).
- **`security`** — `describeDelegableScope` is `DelegableScope`; `explain` is `ExplainDecision` (the
  `z.input` form `ISecurityService.explain` declares and the route relays verbatim — **not** the
  post-parse `ExplainDecisionParsed`, since no parse runs on that path); the three
  `suggestedBindings` methods carry their `{ suggestion, … }` / `{ suggestions, synced }` envelopes.
  The suggestion ROW stays `Record<string, unknown>` by contract, but `bindingCreated` and
  `synced.{created,confirmedObserved,pruned}` stop being erased.
- **`email` / `datasources.external`** — `email.send` is `SendEmailResult` (branch on `status`).
  ⚠️ The four federation methods are **envelope-wrapped** and the obvious binding is the wrong one:
  `listTables` answers `{ tables: RemoteTable[] }`, not `RemoteTable[]`; likewise
  `{ draft: ObjectDraft }`, `{ object: ImportObjectResult }`, `{ catalog: ExternalCatalog }`.
  `validate` is a bare `SchemaValidationReport`.
- **`ScopedProjectClient.packages.list`** — `{ packages: InstalledPackage[]; total: number }`.

Four methods deliberately keep `Promise<any>` and say so in their docblocks: `automation.create` /
`automation.update` echo an unvalidated request body, and `search` / `data.clone` answer shapes
declared inline in the implementation rather than in `@objectstack/spec`. Those are missing
*contracts*, not missing annotations, and authoring them belongs to the spec package. The
caller-supplied generics on `data.*` and `actions.*` are unchanged — there the payload really is
the caller's.
