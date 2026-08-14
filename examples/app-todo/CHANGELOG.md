# @objectstack/example-todo

## 4.0.92

### Patch Changes

- 7d21581: feat(spec)!: retire the six remaining `authorWarn` dead keys — book/group `translations`, `job.id`, `translation.validationMessages`, `app.homePageId`, `app.areas[].order` (#4667)

  The #4488 liveness audit marked as `authorWarn` the keys whose _declaration_
  actively misleads — not merely unread, but shaped so an author reasonably
  concludes they configure something. #4509 and #4583 cleared the rest; these six
  are what remained, and each shipped with its own reason for reading alive.

  **The retirement kit:**

  | FROM                             | TO          | Fix                                                                                          |
  | -------------------------------- | ----------- | -------------------------------------------------------------------------------------------- |
  | `book.translations`              | _(removed)_ | Delete the key. Localize the **docs** — `doc.translations` is live on every doc render path. |
  | `book.groups[].translations`     | _(removed)_ | Same. Tombstoned, since `BookGroupSchema` is not `.strict()`.                                |
  | `job.id`                         | _(removed)_ | Delete the key. `name` is the job's identity everywhere.                                     |
  | `translation.validationMessages` | _(removed)_ | Delete the key. Author the message on the rule: `object.validations[].message`.              |
  | `app.homePageId`                 | _(removed)_ | Delete the key. Reorder `navigation`; set `isDefault` for the root landing.                  |
  | `app.areas[].order`              | _(removed)_ | Delete the key. Reorder the `areas` array itself.                                            |

  Run `os migrate meta --from 16` to rewrite existing sources automatically.

  **Each read alive for a different reason, and the prescriptions say which:**

  - **book `translations`** — _proximity_. `doc.translations`, two files over, same
    name and shape, works on every read path. The book-level map was parsed,
    stored and round-tripped, and rendered in the authoring locale to every
    reader: the tree endpoint and the portal emit `label` / `description`
    verbatim.
  - **`job.id`** — _its own description_. "Defaults to `name` when omitted"
    advertises an identity override that does not exist. `name` is the scheduling
    key, the `sys_job` row key, and the `JobExecution.jobId` stamp — so two jobs
    differing only in `id` were one job declared twice.
  - **`translation.validationMessages`** — _the platform's own signposts, twice_.
    The schema example showed a concrete override, and #3778's legacy-key
    migration table steered retired `errors:` authors straight into it. **That
    guidance entry is rewritten here**: retiring one dead key by pointing at
    another is the defect, not the fix.
  - **`app.homePageId`** — _a second source for one fact_. Not unread: objectui's
    console consumed it in `resolveLandingRoute()` and it was the only thing
    deciding where an app opened. (This entry first shipped saying otherwise;
    corrected in #4709, which upheld the removal.) What condemns the key is its
    shape — an ID cross-reference into `navigation` with no referential integrity,
    falling back to the first item _silently_ when the id dangled. If "land
    somewhere other than first" is ever wanted again it belongs on the navigation
    item itself, not on a pointer that can miss.
  - **`app.areas[].order`** — _the sibling that works_. Nav-item `order` really is
    sorted; area-level order never was, and both renderers iterate the array as
    authored.

  **Routes differ, deliberately.** `book.groups[].translations` and
  `app.homePageId` are **tombstoned** (`retiredKey`: `never` at compile time, a
  prescription at parse time) — the group schema is a plain `z.object`, where a
  bare delete would have zod silently strip the key, trading one silent no-op for
  another. The other four are strict deletions carrying `guidance`. Retired alias
  spellings (`i18n`, `home`, `homepage`, `landingpage`, `sort`) route to the same
  prescriptions rather than renaming onto keys that are gone.

  Registered as three ADR-0087 D2 conversions (`book-translations-removed`,
  `job-id-removed`, `translation-validation-messages-removed`) plus an extension
  of `app-dead-authoring-keys-removed`, all wired into the protocol-17 D3 chain.

  **Also corrected, both found by the gates rather than by grep:** the published
  `objectstack-i18n` skill taught `validationMessages` in a copy-paste example
  (an AI reproduces that verbatim), and `examples/app-todo` authored the group in
  three locales — where the `en` entries merely duplicated the rule's own text and
  the zh-CN / ja-JP translations had never once been rendered.

  After this, the only `authorWarn` keys left in the ledger are the two fail-open
  area gates tracked in #4651, which need a decision rather than a patch.

- d449b0c: fix(cli): gate the two decision-routing shapes that can never work, and flag the inert `config.condition` (#4414)

  Two follow-ups to #4440, both about metadata that reads like a guard and is not
  one.

  ## Two rules promoted to `error`

  `flow-branch-label-unmatched` and `flow-default-edge-with-condition` now FAIL the
  build instead of warning. The bar for that — restated at the top of
  `lint-flow-patterns.ts`, because the old one no longer described the set — is
  **no reading of the author's metadata does what it says, deterministically, on
  every run**. Both qualify: a branch label no out-edge carries cannot route, and
  an edge that is both `isDefault` and conditional always lets the condition win,
  so the marker routes nothing. Neither _fails_; both are wrong every time and
  silently, which is worse.

  The other two stay advisory on purpose, and the policy now says why:
  `flow-decision-unconditional-branch` is usually a guard that does not guard, but
  one guarded plus one unconditional out-edge is also a legal "maybe notify,
  always continue" fan-out, and `flow-multiple-default-edges` can genuinely mean
  "when nothing matched, do both". The bar is about _provability_, not severity of
  consequence — failing a customer's build on a shape we cannot prove wrong is the
  worse trade.

  No wiring change was needed: `lintFlowPatterns` is already registered as
  `tier: 'gating'` across all three commands (#4409), which is exactly the seam
  `authoring-rule-wiring.test.ts` exists to guard.

  ## New rule: `flow-inert-node-condition`

  `config.condition` is the trigger gate on a `start` node and is read by **no
  other node type** — the engine parse-validates it everywhere (so a malformed one
  is caught) and then ignores it. On a `decision` the name makes it read as the
  branch predicate, which is exactly how it got authored.

  Three of the three bundled apps had one. `app-todo`'s `check_recurring` and
  `app-showcase`'s `needs_exec` both carried a predicate their out-edges were
  already enforcing — a third copy doing nothing. The showcase even had a comment
  next to it saying the node condition "is not evaluated by the engine", and kept
  it anyway; that is the residue this rule exists to stop accumulating. Both are
  now plain exclusive gateways.

  Advisory, not gating: the surrounding edges usually still route correctly, so
  this is dead weight rather than a provable misroute. The node-type list is a
  closed set of builtins we have actually read, not "everything that isn't
  `start`" — ADR-0018 keeps `node.type` open and a plugin executor may legitimately
  declare and read its own `config.condition`.

  ## Studio

  `objectstack-ai/objectui` carries the matching help-text fixes: the branch editor
  said a `true` branch **is** the default/else path (it is how you _ask_ for one —
  the marker goes on the out-edge), and the legacy single `Condition` field said
  "prefer Branches above", which reads as "this works, but the other is better".
  It does not work at all.

- c5c78bb: **[#3959] `app-todo`'s `defer_task` / `set_reminder` are `type: 'script'`, not `type: 'modal'`.**

  Both declared `type: 'modal'` with a `target` naming a modal page that does not
  exist (`defer_task_modal`, `set_reminder_modal`), while their handlers sat
  registered under `deferTask` / `setReminder` — keys no declaration could
  address. A `modal` action has no server dispatch (`headlessActionTypeError`
  rejects it over REST), so neither handler had ever executed: the example
  shipped business logic that could not run, and ADR-0110 D5's boot inventory
  flagged both on its first pass.

  Both already declared the `params` their handlers read, so they were always
  "collect input, then run server-side" actions — which is `type: 'script'` with
  `params`. The runner collects the same dialog and the handler now actually runs.

  The action-type table in `content/docs/ui/actions.mdx` said `modal` meant
  "collect input, then submit to a handler", contradicting the same page's own
  REST table (`modal` → 400, nothing for the server to run). Corrected.

- 3d89777: fix(example-todo): a normal user can mark a task complete again — `completed_date` is stamped by the hook instead of demanded from the caller (#7036)

  `examples/app-todo` shipped two declarations on `todo_task` that could not both hold on
  the update path, so the app's headline action was unsatisfiable by construction.

  **Before.** `completed_date` is `Field.datetime({ readonly: true })`, and `readonly` is a
  two-part contract: never editable in forms, **and** a non-system caller's write to it is
  stripped from the payload on the update path. The same object then declares a validation
  rule, `completed_date_required`, refusing any record whose `status` is `completed` while
  `completed_date` is blank. The strip runs first, so a payload carrying both keys lost
  `completed_date` and was then rejected for missing it. Measured against the real object on
  a real kernel:

  ```
  update status+completed_date (user ctx):  REJECTED -> Completed date is required when status is Completed
  update status only           (user ctx):  REJECTED -> Completed date is required when status is Completed
  update status+completed_date (isSystem):  OK
  insert already-completed:                 OK
  ```

  Both escapes are non-user paths — an elevated write bypasses the strip, and a create may
  legitimately seed a read-only column. Every ordinary user update was refused, which made
  the app's own `completeTask` and `massCompleteTasks` handlers fail every time they ran.

  **After.** The column is server-owned, so the server writes it. `task.hook.ts` gains a
  `beforeUpdate` leg that stamps `completed_date` on the transition into `completed` and
  clears it on the transition back out; `completeTask` and `massCompleteTasks` now send
  `status` alone. A one-key user-context update completes the task and persists the stamp.

  This works because the readonly strip is deliberately narrow rather than because it is
  bypassed: it runs _after_ the before-hooks and deletes a key only when the caller supplied
  it **and** it still holds the caller's own value (`stripReadonlyFields`, the
  `suppliedValues` snapshot plus the `Object.is` identity check). A value a hook wrote is a
  platform value and survives — including when the caller echoed the same key back, which is
  what a whole-record form PUT does. The stamp is therefore written unconditionally: leaving
  a caller-supplied value in place would leave the caller's own value on the key, and the
  strip would delete it.

  `completed_date_required` stays, and is now the assertion that the stamp actually
  happened — if the hook is ever unregistered or its transition guard breaks, the write is
  refused loudly instead of committing a completed task with no completion date.

  **Two related repairs the fix required.**

  - The hook was never registered. `task_logic` was not in `defineStack({ hooks })`, and
    `collectBundleHooks` reads that array and nothing else, so the whole file was dead
    metadata: it type-checked, it read as wired, and it never ran. Both sibling example apps
    already declare `hooks: allHooks`; `app-todo` now does too.
  - Both existing legs read the record off `ctx.input` rather than `ctx.input.data`.
    `HookContext.input` is an envelope — `{ data, options }` on insert, `{ id, data, options }`
    on update — so `ctx.input.priority = 'normal'` set a key no write path reads. The insert
    defaults and the after-update branches had never had any effect; they do now. The
    after-update logging also moved from `console` to the kernel logger reached through
    `ctx.ql`, so it honours the configured log level.

  Reopening a completed task clears `completed_date`, documented in the object and hook
  metadata: the field means "when this task was completed", so a task that is not completed
  must not carry a stale one. An edit that carries no `status` is not treated as a reopen.

- cc05304: fix(example-todo): `task_completion`'s recurrence branch computes a real next due date — it wrote a literal `DATEADD(...)` string the driver refused (#7037)

  `examples/app-todo`'s `TaskCompletionFlow` spawned the next occurrence of a recurring task
  with

  ```
  due_date: 'DATEADD({completedTask.due_date}, {completedTask.recurrence_interval}, "{completedTask.recurrence_type}")'
  ```

  **Two independent faults, stacked.** `DATEADD` exists nowhere in the platform — not a CEL
  builtin, not registered by `packages/formula` under any casing. And a `create_record`
  node's `fields` values are TEMPLATE-interpolated, never evaluated: the `{…}` holes are
  filled and the surrounding text passes through verbatim. So what reached the engine was
  the literal string `DATEADD(2026-08-10, 1, "daily")`, and the field's own coercion refused
  it with `Due Date must be a valid date (ISO-8601)`, failing the whole run.

  **Reachability changed with #6882; the defect did not.** While the flow was unbound the
  node never executed and the dead function text was inert. Armed, every completion of a
  _recurring_ task produced a failed run, so the recurrence feature the node exists for had
  never once worked.

  **Why the repair is a `script` node and not a better expression.** No flow node evaluates
  a value-producing expression. The builtin vocabulary's only expression slots are
  PREDICATES (`config.condition`, `edge.condition`, `decision.conditions[].expression`,
  `screen.fields[].visibleWhen`) and `flow-template` REFERENCES (`loop.collection`,
  `map.collection`) — the ledger is `FLOW_NODE_EXPRESSION_PATHS` in
  `@objectstack/spec/automation` — and an `assignment` node interpolates rather than
  evaluates. The next due date therefore has to be computed _before_ the create node runs.

  A `compute_next_due_date` `script` node now calls `computeNextTaskDueDate`, registered
  through `defineStack({ functions })` — the pure-function shape (#1870, #4396) that
  `showcase_task_completed` already uses: it takes `input`, returns the date, and
  `create_next_task` persists it by reading the whole-string token `{nextDueDate}`. The
  function handles all four authored cadences (daily / weekly / monthly / yearly × interval),
  clamps a monthly shift to the target month's last day exactly as `@objectstack/formula`'s
  `addMonths` does — so the app cannot teach a recurrence semantic that disagrees with the
  platform's own formula function — and refuses an unknown `recurrence_type` or an interval
  `min: 1` forbids instead of guessing a cadence.

  The non-recurring path is unchanged: the `check_recurring` gate still routes straight to
  `end`, skipping both nodes.

  New suite `test/task-recurrence.test.ts` drives the app's real metadata, real object and
  real function registry through a real kernel over sqlite: the spawned task's `due_date` is
  asserted for daily / weekly / monthly completions, and a reverse fixture rebuilt from the
  live flow shows the pre-fix shape — any function-call text left in a `create_record` field
  value — still failing inside `create_next_task` with the date refusal, and notably _not_
  with "no function named …", because nothing ever tried to call one. A class-level guard
  asserts no write node in any of the app's flows leaves function-call text in a field value.

- c11b699: fix(example-todo): remove the inert `is_completed` / `is_overdue` flags and repair every filter that read them (#7226)

  `examples/app-todo/src/objects/task.object.ts` declared `is_completed` and
  `is_overdue` as `readonly: true` booleans defaulting to `false`. Nothing in the
  app ever wrote either one — no hook leg, no flow node, no action handler, and
  the seed data set neither — so both were `false` on every row for the life of
  the app, while **twelve** view / dashboard / report / flow filters read them as
  if they were maintained.

  The consequence was not cosmetic. Every surface asking `is_completed: true` was
  permanently empty: the "Completed Today" tile, the "Weekly Task Completion"
  trend, and both the "Completed Tasks" and "Time Tracking" reports. So was the
  whole "Overdue Tasks" list view, which asked `is_overdue: true`. The eight
  surfaces asking `is_completed: false` were vacuously true instead — they matched
  completed tasks too. `task.hook.ts` also carried an `afterUpdate` branch gated
  on `data.is_overdue && previous && !previous.is_overdue`, which could never run.
  Since #7036 started stamping `completed_date` on the completion transition, the
  divergence was directly readable in the shipped app: a task could carry a
  completion date and `is_completed: false` at the same time.

  **Removed rather than derived as formula fields, for a measured reason.** A
  `Field.formula(...)` computes both correctly — including the temporal one
  (`date(record.due_date) < today()` evaluates per read, with a per-call `now`
  snapshot) — so deriving looks like the obvious repair. It is not: a `formula`
  field is virtual, no driver materialises a column for it, and so a _filter_
  naming one matches nothing. Measured on this app's own sqlite-wasm driver,
  `where { is_completed: false }` against a formula field returns **0 rows with no
  error**, where the stored boolean returned every row. Deriving would therefore
  have silently emptied the "Due Today" view, the daily reminder flow and both
  open-task reports — trading a wrong answer for an invisible one.

  `status` and `due_date` are stored, indexed columns that already carry the
  information, and both are declared dimensions on the `task_metrics` dataset, so
  every consumer now asks the semantic layer's own vocabulary directly:

  | was                     | is now                                                             |
  | ----------------------- | ------------------------------------------------------------------ |
  | `is_completed == true`  | `status equals 'completed'`                                        |
  | `is_completed == false` | `status not_equals 'completed'`                                    |
  | `is_overdue == true`    | `due_date less_than '{today}'` AND `status not_equals 'completed'` |

  Updated across `task.object.ts`, `task.hook.ts`, `task.view.ts`,
  `task.dashboard.ts`, `task.report.ts`, `task.flow.ts`, the three translation
  bundles and the README. The hook's dead overdue branch is removed rather than
  re-armed against `due_date`: becoming overdue is the passage of time, not a
  record write, so a record hook is structurally the wrong instrument — the
  clock-driven `overdue_escalation` scheduled flow already covers it.

  Pinned by `examples/app-todo/test/derived-flag-removal.test.ts`, which walks the
  app's real `defineStack` for any surviving reference, drives the replacement
  filters across **both** sides of the completion transition (so a filter cannot
  pass for the same reason the old flag did — everything being false), and records
  the formula-filter measurement that decided the route.

- 6dd3c25: fix(example-todo): `task_completion` is a real record-change flow again — it bound to nothing and gated on a key nothing reads (#6882)

  `examples/app-todo`'s `TaskCompletionFlow` declared `type: 'record_change'` and then
  declared neither key that arms one. It was 1 of the 34 authored flows across the three
  bundled apps, and the only dead one.

  **Two faults on one start node, both silent.**

  1. **No `triggerType` at all.** `AutomationEngine.resolveTriggerBinding` claims a
     record-change flow only when the authored token starts with `record-`. With the key
     absent every later branch missed too (`timeRelative`, `config.schedule`,
     `flow.type === 'schedule'`, `flow.type === 'api'`), the method returned `undefined`,
     and `activateFlowTrigger` returned without binding. The flow declared itself
     record-triggered and was, at runtime, a manual flow that never fired.
  2. **The predicate was written to `triggerCondition`.** The trigger gate is
     `config.condition` — the key the binding copies and `execute()` evaluates. A node
     `config` is an open slot by design (ADR-0018), so the misspelling parsed silently.
     Fixing (1) alone would have been _worse_ than dead: the flow would have fired on every
     update of every task.

  **Why no channel reported it.** `getTriggerBindingAudit` — the platform's own silent-miss
  surface, and the source for both the automation plugin's `kernel:bootstrapped` warn loop
  and the CLI startup summary's `unbound` list — opens with `if (!resolved) continue`,
  reading "no binding" as "manual/screen flow, nothing to bind". So the missing key did not
  _add_ a diagnostic; it removed the flow from every diagnostic channel there is. The only
  trace anywhere was the startup banner counting one more flow registered than bound, with
  no name and no reason.

  **The repair.** `triggerType: 'record-after-update'` plus the predicate moved to
  `config.condition` as `status == "completed" && previous.status != "completed"` — the
  shape `showcase_task_completed` already uses for this exact semantic. `-after-update`
  rather than `-after-write` on purpose: "marked as complete" is a transition, and the
  insert leg has no `previous` to transition from — `previous` binds to `null` there, and
  `previous.status` against `null` aborts the whole CEL predicate with `No such key:
status` rather than answering false.

  A third fault surfaced the moment the flow could run: `get_task` filtered on `{taskId}`,
  an `isInput` variable nothing ever bound (a record-change run seeds `params` from the
  triggering record, which carries `id`, not `taskId`), so the first armed run failed with
  "1 filter condition(s) resolved to nothing and were dropped from the query". It now reads
  `{record.id}`, the handle every other record-change flow in the corpus uses, and the dead
  declaration is gone.

  `@objectstack/example-todo` also runs its own vitest suite now (`vitest run`, as
  `app-crm` and `app-showcase` already do) instead of `objectstack test`, which is a
  Quality-Protocol runner that needs a live server and matched no `qa/*.test.json` here —
  so the package's test files had never executed in CI.

- Updated dependencies [50616d9]
- Updated dependencies [bc35e00]
- Updated dependencies [430dcc2]
- Updated dependencies [690ccf2]
- Updated dependencies [6a67d7a]
- Updated dependencies [333a374]
- Updated dependencies [6e141bc]
- Updated dependencies [9fe9c1d]
- Updated dependencies [da5d1b4]
- Updated dependencies [3d5c090]
- Updated dependencies [e5bd768]
- Updated dependencies [30536e3]
- Updated dependencies [08b5a3d]
- Updated dependencies [e027b3e]
- Updated dependencies [48fcf70]
- Updated dependencies [e6ac4bd]
- Updated dependencies [c2429b0]
- Updated dependencies [445a0c2]
- Updated dependencies [d99aeb3]
- Updated dependencies [f6609e6]
- Updated dependencies [4727eb8]
- Updated dependencies [a70358a]
- Updated dependencies [0ecc656]
- Updated dependencies [a4e2684]
- Updated dependencies [06772eb]
- Updated dependencies [d4e0809]
- Updated dependencies [739f496]
- Updated dependencies [80334c7]
- Updated dependencies [f63cd09]
- Updated dependencies [97e7e3c]
- Updated dependencies [0c90ece]
- Updated dependencies [195ad76]
- Updated dependencies [c2bbd97]
- Updated dependencies [ce5242c]
- Updated dependencies [a7163ea]
- Updated dependencies [e6e9379]
- Updated dependencies [257d97a]
- Updated dependencies [5823d59]
- Updated dependencies [3140f9c]
- Updated dependencies [9500ba4]
- Updated dependencies [3ec8186]
- Updated dependencies [6169615]
- Updated dependencies [fa3d0cf]
- Updated dependencies [698cbc2]
- Updated dependencies [af5a224]
- Updated dependencies [71f76e1]
- Updated dependencies [37b1346]
- Updated dependencies [a749273]
- Updated dependencies [99736a0]
- Updated dependencies [fe67e34]
- Updated dependencies [b1863a5]
- Updated dependencies [fdb4f50]
- Updated dependencies [270650f]
- Updated dependencies [956e7f9]
- Updated dependencies [3aef718]
- Updated dependencies [1bd5652]
- Updated dependencies [14252d3]
- Updated dependencies [7fb436c]
- Updated dependencies [879ea13]
- Updated dependencies [8828b9e]
- Updated dependencies [ffb003c]
- Updated dependencies [1ea6bce]
- Updated dependencies [c1dcacd]
- Updated dependencies [ad303ed]
- Updated dependencies [32ccb23]
- Updated dependencies [f5a4ef0]
- Updated dependencies [2d3e255]
- Updated dependencies [a8940e4]
- Updated dependencies [7d7521f]
- Updated dependencies [5dc4d02]
- Updated dependencies [f724f69]
- Updated dependencies [98877c9]
- Updated dependencies [98877c9]
- Updated dependencies [53068c1]
- Updated dependencies [ee58392]
- Updated dependencies [f16e54e]
- Updated dependencies [c44dd5e]
- Updated dependencies [06be54e]
- Updated dependencies [28ad90e]
- Updated dependencies [76d74ec]
- Updated dependencies [201b31f]
- Updated dependencies [e6b1b69]
- Updated dependencies [259459d]
- Updated dependencies [3f7f14e]
- Updated dependencies [e2616e0]
- Updated dependencies [6fa1827]
- Updated dependencies [6fdc5c6]
- Updated dependencies [0e79785]
- Updated dependencies [8b9d71e]
- Updated dependencies [7e7a605]
- Updated dependencies [05154a1]
- Updated dependencies [33f5e23]
- Updated dependencies [259af21]
- Updated dependencies [6877e9a]
- Updated dependencies [f8644c7]
- Updated dependencies [306ca50]
- Updated dependencies [0f12193]
- Updated dependencies [0bab8bb]
- Updated dependencies [840ee4b]
- Updated dependencies [978fed2]
- Updated dependencies [cfc293f]
- Updated dependencies [587fc91]
- Updated dependencies [de70b42]
- Updated dependencies [9b6fe7c]
- Updated dependencies [64cd010]
- Updated dependencies [fb3d99b]
- Updated dependencies [1986594]
- Updated dependencies [6968885]
- Updated dependencies [eaed61f]
- Updated dependencies [3c8cfd1]
- Updated dependencies [cdfbee2]
- Updated dependencies [ad4af62]
- Updated dependencies [debe2f6]
- Updated dependencies [d44dbfa]
- Updated dependencies [29c6c9d]
- Updated dependencies [d21c001]
- Updated dependencies [ad047d2]
- Updated dependencies [8c711fb]
- Updated dependencies [f1cc3a3]
- Updated dependencies [09e4547]
- Updated dependencies [97b0798]
- Updated dependencies [474fe39]
- Updated dependencies [0bc685a]
- Updated dependencies [b949059]
- Updated dependencies [2826d1e]
- Updated dependencies [be1c52c]
- Updated dependencies [c5ff96d]
- Updated dependencies [5a84d41]
- Updated dependencies [84e7be9]
- Updated dependencies [91f4c78]
- Updated dependencies [ddc2527]
- Updated dependencies [820eff9]
- Updated dependencies [a6c3f38]
- Updated dependencies [debc23a]
- Updated dependencies [0f8ad09]
- Updated dependencies [ad878e7]
- Updated dependencies [553a47f]
- Updated dependencies [43a7a8d]
- Updated dependencies [116c0d9]
- Updated dependencies [a98085f]
- Updated dependencies [20b1a9e]
- Updated dependencies [344a22a]
- Updated dependencies [4827e91]
- Updated dependencies [8d895ff]
- Updated dependencies [86f7a20]
- Updated dependencies [984396b]
- Updated dependencies [9f747ee]
- Updated dependencies [a3a884d]
- Updated dependencies [cfed092]
- Updated dependencies [203a449]
- Updated dependencies [8f9689f]
- Updated dependencies [73f69dc]
- Updated dependencies [04c56aa]
- Updated dependencies [3028326]
- Updated dependencies [f6472d7]
- Updated dependencies [0cdb57a]
- Updated dependencies [c546c89]
- Updated dependencies [57a3bb3]
- Updated dependencies [627e65a]
- Updated dependencies [4c5df00]
- Updated dependencies [b16dcb4]
- Updated dependencies [22df871]
- Updated dependencies [b3efeb7]
- Updated dependencies [ddd075a]
- Updated dependencies [88154be]
- Updated dependencies [fe2dfa1]
- Updated dependencies [c497d26]
- Updated dependencies [6f6fec7]
- Updated dependencies [e8dc61e]
- Updated dependencies [9c82146]
- Updated dependencies [5f9a987]
- Updated dependencies [744b8f5]
- Updated dependencies [ac37fc6]
- Updated dependencies [9f060e5]
- Updated dependencies [2f3e793]
- Updated dependencies [4820f55]
- Updated dependencies [462d9c4]
- Updated dependencies [78caf51]
- Updated dependencies [7d21581]
- Updated dependencies [bbdbf28]
- Updated dependencies [37785ed]
- Updated dependencies [62a789b]
- Updated dependencies [2e284b2]
- Updated dependencies [d8e8d9c]
- Updated dependencies [789ad63]
- Updated dependencies [f2445c9]
- Updated dependencies [94e749b]
- Updated dependencies [ea1d916]
- Updated dependencies [3905c00]
- Updated dependencies [4335497]
- Updated dependencies [2af1988]
- Updated dependencies [0af50a3]
- Updated dependencies [f7d80f4]
- Updated dependencies [fce14ab]
- Updated dependencies [43ca399]
- Updated dependencies [1b49eaf]
- Updated dependencies [ae31a19]
- Updated dependencies [db31402]
- Updated dependencies [2e836de]
- Updated dependencies [e0f300b]
- Updated dependencies [0161c7f]
- Updated dependencies [e900015]
- Updated dependencies [db02d47]
- Updated dependencies [b5bdf48]
- Updated dependencies [23338c3]
- Updated dependencies [7309c81]
- Updated dependencies [d3f2ff6]
- Updated dependencies [aa25a81]
- Updated dependencies [cbc08eb]
- Updated dependencies [ec3dfd7]
- Updated dependencies [466c503]
- Updated dependencies [b7550d6]
- Updated dependencies [0164f40]
- Updated dependencies [3a18e24]
- Updated dependencies [e295ad1]
- Updated dependencies [84b4a3a]
- Updated dependencies [0c4f5b2]
- Updated dependencies [1b717e5]
- Updated dependencies [1003125]
- Updated dependencies [12a19a8]
- Updated dependencies [6e62a93]
- Updated dependencies [ecda20c]
- Updated dependencies [6e62a93]
- Updated dependencies [fc968af]
- Updated dependencies [533a0a4]
- Updated dependencies [5b843fb]
- Updated dependencies [10c4ea9]
- Updated dependencies [62b6a2f]
- Updated dependencies [7e5af5c]
- Updated dependencies [5b4780b]
- Updated dependencies [a933452]
- Updated dependencies [9d1d9c7]
- Updated dependencies [8140915]
- Updated dependencies [a019e52]
- Updated dependencies [e8f8f6c]
- Updated dependencies [41dcda3]
- Updated dependencies [7b48cf9]
- Updated dependencies [b5404f4]
- Updated dependencies [64fc6d5]
- Updated dependencies [b4487aa]
- Updated dependencies [1007379]
- Updated dependencies [65ca83a]
- Updated dependencies [0bfdf46]
- Updated dependencies [947d4f9]
- Updated dependencies [f764691]
- Updated dependencies [e120a5a]
- Updated dependencies [4ff8abf]
- Updated dependencies [e5bd2f6]
- Updated dependencies [e650d67]
- Updated dependencies [121852d]
- Updated dependencies [d8f65fe]
- Updated dependencies [58ffcab]
- Updated dependencies [04476e7]
- Updated dependencies [67bf2e2]
- Updated dependencies [eaaf03c]
- Updated dependencies [d17df80]
- Updated dependencies [7d0e7b5]
- Updated dependencies [c6d1cb4]
- Updated dependencies [6513c17]
- Updated dependencies [462b713]
- Updated dependencies [36030ff]
- Updated dependencies [e38db3d]
- Updated dependencies [a225ef5]
- Updated dependencies [79228cd]
- Updated dependencies [c4ab50b]
- Updated dependencies [3133cda]
- Updated dependencies [6117f7b]
- Updated dependencies [48c110e]
- Updated dependencies [87aca93]
- Updated dependencies [e533b0b]
- Updated dependencies [cdf4d9a]
- Updated dependencies [aee1806]
- Updated dependencies [c13350b]
- Updated dependencies [c13350b]
- Updated dependencies [63b33e6]
- Updated dependencies [2c1988c]
- Updated dependencies [9ca2d85]
- Updated dependencies [c13350b]
- Updated dependencies [c9d254a]
- Updated dependencies [891d345]
- Updated dependencies [c8124e5]
- Updated dependencies [a52e2ef]
- Updated dependencies [5293114]
- Updated dependencies [376a061]
- Updated dependencies [ff17642]
- Updated dependencies [c142ced]
- Updated dependencies [211abdb]
- Updated dependencies [b3363e9]
- Updated dependencies [c3bcb42]
- Updated dependencies [19e3e6e]
- Updated dependencies [eda599e]
- Updated dependencies [a1a4140]
- Updated dependencies [c20b875]
- Updated dependencies [c794f78]
- Updated dependencies [7c7e246]
- Updated dependencies [8e17759]
- Updated dependencies [7bf3d1c]
- Updated dependencies [2ef1807]
- Updated dependencies [c519533]
- Updated dependencies [f35cdc5]
- Updated dependencies [d03fe25]
- Updated dependencies [217e2e6]
- Updated dependencies [2672f85]
- Updated dependencies [b3de0dd]
- Updated dependencies [20bc357]
- Updated dependencies [0373d52]
- Updated dependencies [11066f6]
- Updated dependencies [916af17]
- Updated dependencies [84c86fb]
- Updated dependencies [2a2a9fb]
- Updated dependencies [4f30943]
- Updated dependencies [db9c331]
- Updated dependencies [86a71d1]
- Updated dependencies [c001422]
- Updated dependencies [77022a9]
- Updated dependencies [d5c75e2]
- Updated dependencies [03d26f7]
- Updated dependencies [217b791]
- Updated dependencies [bb192c4]
- Updated dependencies [fd8521f]
- Updated dependencies [35b36f2]
- Updated dependencies [86e6f6c]
- Updated dependencies [cbedd62]
- Updated dependencies [19aaf4b]
- Updated dependencies [0e4a7fb]
- Updated dependencies [98e7cc7]
- Updated dependencies [5966c2a]
- Updated dependencies [2382580]
- Updated dependencies [9ea2bc5]
- Updated dependencies [a2e157c]
- Updated dependencies [95c4227]
- Updated dependencies [2a61116]
- Updated dependencies [52760bf]
- Updated dependencies [5543020]
- Updated dependencies [880d343]
- Updated dependencies [6e82972]
- Updated dependencies [d4df105]
- Updated dependencies [4615a18]
- Updated dependencies [4cf7c61]
- Updated dependencies [f505689]
- Updated dependencies [76682cb]
- Updated dependencies [d9fa683]
- Updated dependencies [9881074]
- Updated dependencies [32d3800]
- Updated dependencies [2b63a00]
- Updated dependencies [606d577]
- Updated dependencies [4384921]
- Updated dependencies [55da611]
- Updated dependencies [d367f03]
- Updated dependencies [e2798fa]
- Updated dependencies [e2798fa]
- Updated dependencies [06ba036]
- Updated dependencies [094fa34]
- Updated dependencies [5e55739]
- Updated dependencies [3c628ce]
- Updated dependencies [347f460]
- Updated dependencies [c2d9098]
- Updated dependencies [0fd8556]
- Updated dependencies [3c7bcc0]
- Updated dependencies [4b6cac7]
- Updated dependencies [7631964]
- Updated dependencies [4c45be1]
- Updated dependencies [18b8eaa]
- Updated dependencies [ac471a0]
- Updated dependencies [6fde910]
- Updated dependencies [60ae58e]
- Updated dependencies [9c82b89]
- Updated dependencies [7f62706]
- Updated dependencies [60cbf9d]
- Updated dependencies [667fa44]
- Updated dependencies [37e38d1]
- Updated dependencies [e906126]
- Updated dependencies [ce92674]
- Updated dependencies [08363a0]
- Updated dependencies [444de5b]
- Updated dependencies [8a341a4]
- Updated dependencies [78adc2e]
- Updated dependencies [a227ed7]
- Updated dependencies [7cb922e]
- Updated dependencies [1d22114]
- Updated dependencies [81e2744]
- Updated dependencies [277eb36]
- Updated dependencies [41e605e]
- Updated dependencies [ecc61ab]
- Updated dependencies [2649ccb]
- Updated dependencies [1eb13a0]
- Updated dependencies [a70cd0a]
- Updated dependencies [c52e608]
- Updated dependencies [9613396]
- Updated dependencies [3f7b4ff]
- Updated dependencies [74155c7]
- Updated dependencies [742a6a5]
- Updated dependencies [b5f9397]
- Updated dependencies [1b2eb1b]
- Updated dependencies [afa6aa5]
- Updated dependencies [ed77493]
- Updated dependencies [6908830]
- Updated dependencies [8b06bba]
- Updated dependencies [58a03d2]
- Updated dependencies [c39d713]
- Updated dependencies [b7d3be4]
- Updated dependencies [afb83d3]
- Updated dependencies [2a0d65e]
- Updated dependencies [2bacd1a]
- Updated dependencies [e47b342]
- Updated dependencies [4c54037]
- Updated dependencies [dc530b4]
- Updated dependencies [9f601e8]
- Updated dependencies [6a9dec6]
- Updated dependencies [0f7157b]
- Updated dependencies [4dc1c7d]
- Updated dependencies [d9bef45]
- Updated dependencies [4dfd002]
- Updated dependencies [f549a0d]
- Updated dependencies [51c5227]
- Updated dependencies [82da264]
- Updated dependencies [f586f1a]
- Updated dependencies [77be690]
- Updated dependencies [245d1dc]
- Updated dependencies [4ed7ed4]
- Updated dependencies [9b9b70f]
- Updated dependencies [f5a9bc2]
- Updated dependencies [e59786e]
- Updated dependencies [2fa4ca1]
- Updated dependencies [bcf1112]
- Updated dependencies [baeb4f0]
- Updated dependencies [29488cc]
- Updated dependencies [2ad1eba]
- Updated dependencies [881a3cc]
- Updated dependencies [199ec47]
- Updated dependencies [f5a2320]
- Updated dependencies [ad6317b]
- Updated dependencies [811c30c]
- Updated dependencies [a4a85c8]
- Updated dependencies [859cb83]
- Updated dependencies [07a4e26]
- Updated dependencies [9774b78]
- Updated dependencies [8a88885]
- Updated dependencies [deb538f]
- Updated dependencies [2b2175b]
- Updated dependencies [b49ccfd]
- Updated dependencies [c7406b0]
- Updated dependencies [5b89711]
- Updated dependencies [edff010]
- Updated dependencies [85d95e7]
- Updated dependencies [08cd163]
- Updated dependencies [9b43ee2]
- Updated dependencies [0c8a22f]
- Updated dependencies [5f7669e]
- Updated dependencies [becbe53]
- Updated dependencies [b127c8b]
- Updated dependencies [763931e]
- Updated dependencies [ec975f1]
- Updated dependencies [385c4b0]
- Updated dependencies [168f60f]
- Updated dependencies [b07d829]
- Updated dependencies [de9af8a]
- Updated dependencies [eb4204b]
- Updated dependencies [a80302a]
- Updated dependencies [a648e96]
- Updated dependencies [a47ac06]
- Updated dependencies [e4c61a7]
- Updated dependencies [cc60165]
- Updated dependencies [474f131]
- Updated dependencies [081aa6f]
- Updated dependencies [91f4c78]
- Updated dependencies [050cd82]
- Updated dependencies [4d552af]
- Updated dependencies [44d677c]
- Updated dependencies [c32944d]
- Updated dependencies [1dd780f]
- Updated dependencies [e8d0c21]
- Updated dependencies [244ca86]
- Updated dependencies [546ab3c]
- Updated dependencies [c4df271]
- Updated dependencies [729a43a]
- Updated dependencies [c8d6f6e]
- Updated dependencies [0b51bb6]
- Updated dependencies [d9971d3]
- Updated dependencies [7dc1067]
- Updated dependencies [4f13be2]
- Updated dependencies [a41ba5c]
- Updated dependencies [189854c]
- Updated dependencies [d9cac60]
- Updated dependencies [5d4de37]
- Updated dependencies [0e3a226]
- Updated dependencies [92a67f2]
- Updated dependencies [9136327]
- Updated dependencies [bf0ae99]
- Updated dependencies [edb4af0]
- Updated dependencies [f09a2e7]
- Updated dependencies [abeb375]
- Updated dependencies [cb3b6cd]
- Updated dependencies [73b7234]
- Updated dependencies [d2b97c3]
- Updated dependencies [61cc079]
- Updated dependencies [45dc446]
- Updated dependencies [0e96e46]
- Updated dependencies [7674859]
- Updated dependencies [c1d44f7]
- Updated dependencies [cb5a75e]
- Updated dependencies [84b6e58]
- Updated dependencies [f160ba4]
- Updated dependencies [59b794f]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [db59e9c]
- Updated dependencies [fc3a36a]
- Updated dependencies [ab9fb5c]
- Updated dependencies [69787f0]
- Updated dependencies [5d022a1]
- Updated dependencies [290d944]
- Updated dependencies [042b9ee]
- Updated dependencies [55011af]
- Updated dependencies [f985b3f]
- Updated dependencies [795b6e1]
- Updated dependencies [d52d4fe]
- Updated dependencies [742cebb]
- Updated dependencies [175d789]
- Updated dependencies [10575f3]
- Updated dependencies [f549a0d]
- Updated dependencies [127f091]
- Updated dependencies [427344c]
- Updated dependencies [8af76ae]
- Updated dependencies [1d4756e]
- Updated dependencies [720c5ad]
- Updated dependencies [a8d1e24]
- Updated dependencies [b85cc54]
- Updated dependencies [a36db28]
- Updated dependencies [7a8476f]
- Updated dependencies [518ca7a]
- Updated dependencies [41642b0]
- Updated dependencies [4cca74c]
- Updated dependencies [88ef03e]
- Updated dependencies [9a4932a]
- Updated dependencies [3f8817a]
- Updated dependencies [a2443e3]
- Updated dependencies [e1554b1]
- Updated dependencies [9e2caf3]
- Updated dependencies [53ef057]
- Updated dependencies [4856789]
- Updated dependencies [81ce41a]
- Updated dependencies [85e1e4e]
- Updated dependencies [c3f4916]
- Updated dependencies [55dbbba]
- Updated dependencies [33e0385]
- Updated dependencies [dac6a08]
- Updated dependencies [72c3c86]
- Updated dependencies [9fd9ae7]
- Updated dependencies [3670cf9]
- Updated dependencies [2d8dba3]
- Updated dependencies [7f1a635]
- Updated dependencies [2205363]
- Updated dependencies [09fe58d]
- Updated dependencies [f9fc874]
- Updated dependencies [d62f8eb]
- Updated dependencies [d0a5ceb]
- Updated dependencies [a7586cd]
- Updated dependencies [4c5e80e]
- Updated dependencies [fce8e49]
- Updated dependencies [4b5702a]
- Updated dependencies [7302c0b]
- Updated dependencies [011b386]
- Updated dependencies [e18a162]
- Updated dependencies [394b7a1]
- Updated dependencies [ce92674]
- Updated dependencies [5d3ced9]
- Updated dependencies [cf2c9b7]
- Updated dependencies [d127ff0]
- Updated dependencies [9881074]
- Updated dependencies [af05400]
- Updated dependencies [44106d9]
- Updated dependencies [36d90fc]
- Updated dependencies [1eadac0]
- Updated dependencies [7777e8f]
- Updated dependencies [c804f19]
- Updated dependencies [7c2f7dd]
- Updated dependencies [9b86cf6]
- Updated dependencies [9b26699]
- Updated dependencies [c51ffa5]
- Updated dependencies [d063a96]
- Updated dependencies [8825a06]
- Updated dependencies [5087ac6]
- Updated dependencies [677b591]
- Updated dependencies [fa48973]
- Updated dependencies [cf7c694]
- Updated dependencies [95b4f0d]
- Updated dependencies [ddd0f06]
- Updated dependencies [d77d1b7]
- Updated dependencies [0f9faa2]
- Updated dependencies [2d1ddf0]
- Updated dependencies [354b00f]
- Updated dependencies [3de535b]
- Updated dependencies [fe2e15a]
- Updated dependencies [5b79a34]
- Updated dependencies [502564d]
- Updated dependencies [603cab8]
- Updated dependencies [c757854]
- Updated dependencies [471839d]
- Updated dependencies [507b92a]
- Updated dependencies [b508244]
- Updated dependencies [dbe92a7]
- Updated dependencies [6146b67]
- Updated dependencies [df95346]
- Updated dependencies [3dede58]
- Updated dependencies [c6b6bb4]
- Updated dependencies [e1fa8d5]
- Updated dependencies [594508e]
- Updated dependencies [7cf42fe]
- Updated dependencies [5966c2a]
- Updated dependencies [402f534]
- Updated dependencies [3f7b4ff]
- Updated dependencies [4f3d232]
- Updated dependencies [99b4392]
- Updated dependencies [5c2716b]
- Updated dependencies [e437471]
- Updated dependencies [591f675]
- Updated dependencies [e472bbe]
- Updated dependencies [4810dd6]
- Updated dependencies [7182362]
- Updated dependencies [0045682]
- Updated dependencies [7309c81]
- Updated dependencies [2f59da0]
- Updated dependencies [114e727]
- Updated dependencies [7372d46]
- Updated dependencies [8aacf94]
- Updated dependencies [5e247fd]
- Updated dependencies [a6cd2c1]
- Updated dependencies [fc3a819]
- Updated dependencies [d56012f]
- Updated dependencies [1a53a02]
- Updated dependencies [75fd301]
- Updated dependencies [73648ba]
- Updated dependencies [f78dd83]
- Updated dependencies [a2cd18a]
- Updated dependencies [fdca3a1]
- Updated dependencies [1507ba3]
- Updated dependencies [9051802]
- Updated dependencies [20bc1ec]
- Updated dependencies [1c625ca]
- Updated dependencies [2f8328c]
- Updated dependencies [b5459bc]
- Updated dependencies [1624f4a]
- Updated dependencies [a954634]
- Updated dependencies [2a6c279]
- Updated dependencies [9319586]
- Updated dependencies [ac6c0be]
- Updated dependencies [8c8f0df]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [7c6261a]
- Updated dependencies [90c2b15]
- Updated dependencies [7180ed5]
- Updated dependencies [4638aaa]
- Updated dependencies [0222d3c]
- Updated dependencies [08863dd]
- Updated dependencies [33a5ff4]
- Updated dependencies [39eb01b]
- Updated dependencies [071d0dc]
- Updated dependencies [f293d45]
- Updated dependencies [1da39f5]
- Updated dependencies [56664f5]
- Updated dependencies [71f205d]
- Updated dependencies [f067930]
- Updated dependencies [414395b]
- Updated dependencies [42eeb7d]
- Updated dependencies [31cbe90]
- Updated dependencies [6b7129a]
- Updated dependencies [bf42e76]
- Updated dependencies [edbf873]
- Updated dependencies [beefe89]
- Updated dependencies [97ace2a]
- Updated dependencies [26e1029]
- Updated dependencies [0a936ea]
- Updated dependencies [90bbf25]
- Updated dependencies [023c00b]
- Updated dependencies [eb91eba]
- Updated dependencies [8fbed3b]
- Updated dependencies [083c414]
- Updated dependencies [42da73d]
- Updated dependencies [01e124d]
- Updated dependencies [1cae606]
- Updated dependencies [ef7b5ef]
- Updated dependencies [9514767]
- Updated dependencies [8f20201]
- Updated dependencies [155507e]
- Updated dependencies [e3c8ed0]
- Updated dependencies [643b7c7]
- Updated dependencies [fa6dd59]
- Updated dependencies [7bba90b]
- Updated dependencies [8813b90]
- Updated dependencies [108ba8d]
- Updated dependencies [2a5f04a]
- Updated dependencies [4f740b0]
- Updated dependencies [55bbefc]
- Updated dependencies [030125b]
- Updated dependencies [7ce02eb]
- Updated dependencies [f1da948]
- Updated dependencies [b9cc17d]
- Updated dependencies [255f2d7]
- Updated dependencies [b4ad984]
- Updated dependencies [bfe689b]
- Updated dependencies [a9f32df]
- Updated dependencies [aeb9b27]
- Updated dependencies [1203bb2]
- Updated dependencies [7d27da0]
- Updated dependencies [4e9e184]
- Updated dependencies [9960cd2]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [0d24078]
- Updated dependencies [7e05d8e]
- Updated dependencies [8f1851e]
- Updated dependencies [b4b2c7d]
- Updated dependencies [b295e4b]
- Updated dependencies [61ea810]
- Updated dependencies [2233a85]
- Updated dependencies [67452d1]
- Updated dependencies [089767f]
- Updated dependencies [a13827e]
- Updated dependencies [66d99ec]
- Updated dependencies [de43f94]
- Updated dependencies [5b8f95b]
- Updated dependencies [cb43296]
- Updated dependencies [91eddca]
- Updated dependencies [b61afc1]
- Updated dependencies [79021fc]
- Updated dependencies [7733604]
- Updated dependencies [40e420f]
- Updated dependencies [62dd69a]
- Updated dependencies [d13004a]
- Updated dependencies [be7360c]
- Updated dependencies [7dbf4c3]
- Updated dependencies [e15e679]
- Updated dependencies [2ddba89]
- Updated dependencies [2ab1257]
- Updated dependencies [4b0ebdb]
- Updated dependencies [0fc6219]
- Updated dependencies [061406d]
- Updated dependencies [e4c8b6c]
- Updated dependencies [acb10f6]
- Updated dependencies [605e190]
- Updated dependencies [c6c59f1]
- Updated dependencies [b0e78a8]
- Updated dependencies [f31cc8d]
- Updated dependencies [f343dc4]
- Updated dependencies [8269e32]
- Updated dependencies [74f7339]
- Updated dependencies [a6c35a2]
- Updated dependencies [c2f1002]
- Updated dependencies [ef7845a]
- Updated dependencies [4cc4fb7]
- Updated dependencies [cc2de0e]
- Updated dependencies [9b2d720]
- Updated dependencies [95ef5c0]
- Updated dependencies [97b6658]
- Updated dependencies [2c26040]
- Updated dependencies [f758cec]
- Updated dependencies [5b47ab5]
- Updated dependencies [b09d8d9]
- Updated dependencies [b09d8d9]
- Updated dependencies [8675db6]
- Updated dependencies [b09d8d9]
- Updated dependencies [1bb5a56]
- Updated dependencies [27358d5]
- Updated dependencies [1c3da1f]
- Updated dependencies [c1f344b]
- Updated dependencies [1fa224a]
- Updated dependencies [3eb1b2b]
- Updated dependencies [9c93465]
- Updated dependencies [a34fd2e]
- Updated dependencies [ebb209c]
- Updated dependencies [76bcb83]
- Updated dependencies [37a8f2b]
- Updated dependencies [e50e479]
- Updated dependencies [c41828d]
- Updated dependencies [3fb42d2]
- Updated dependencies [8e08bc3]
- Updated dependencies [441d79f]
- Updated dependencies [59b85c0]
- Updated dependencies [16adb3c]
- Updated dependencies [889ae47]
- Updated dependencies [4f4c3fb]
- Updated dependencies [78f0be8]
- Updated dependencies [6e357ed]
- Updated dependencies [d6938bf]
- Updated dependencies [35f7fb4]
- Updated dependencies [0410522]
- Updated dependencies [63b33e6]
- Updated dependencies [f163028]
- Updated dependencies [814db6d]
- Updated dependencies [a5302c7]
- Updated dependencies [82397b6]
- Updated dependencies [31e0be9]
- Updated dependencies [4bfd455]
- Updated dependencies [ffd2ce2]
- Updated dependencies [4df747c]
- Updated dependencies [2a44c1d]
- Updated dependencies [7084313]
- Updated dependencies [31fb03d]
- Updated dependencies [47a4e67]
- Updated dependencies [f07808c]
- Updated dependencies [91cefb8]
- Updated dependencies [7ffc3d3]
- Updated dependencies [a137bbc]
- Updated dependencies [88346ba]
- Updated dependencies [4631592]
- Updated dependencies [62f8017]
- Updated dependencies [32ff033]
- Updated dependencies [a831df1]
- Updated dependencies [f752ee3]
- Updated dependencies [a1b61e0]
- Updated dependencies [cd6b9f2]
- Updated dependencies [9bc846b]
- Updated dependencies [2cb6d3c]
- Updated dependencies [3ba8d77]
- Updated dependencies [af2a095]
- Updated dependencies [bf478e1]
- Updated dependencies [5ac93d4]
- Updated dependencies [3d5f726]
- Updated dependencies [695cfbd]
- Updated dependencies [0e043d8]
- Updated dependencies [70a1ce1]
- Updated dependencies [93f267f]
- Updated dependencies [aca68eb]
- Updated dependencies [7445149]
- Updated dependencies [ec796d5]
- Updated dependencies [071d0dc]
- Updated dependencies [0024abf]
- Updated dependencies [77fadbf]
- Updated dependencies [8dd98bf]
- Updated dependencies [4fedb11]
- Updated dependencies [a3cb9c8]
- Updated dependencies [e87fea1]
- Updated dependencies [4be9d99]
- Updated dependencies [c65e529]
- Updated dependencies [8dcc0f5]
- Updated dependencies [0848bea]
- Updated dependencies [d51bed2]
- Updated dependencies [dadd1ad]
- Updated dependencies [5b08389]
- Updated dependencies [acbf364]
- Updated dependencies [3ca34c1]
- Updated dependencies [7adc841]
- Updated dependencies [239c3a3]
- Updated dependencies [b8b3c64]
- Updated dependencies [2f2e63c]
- Updated dependencies [4845f85]
- Updated dependencies [486d526]
- Updated dependencies [94a0bbc]
- Updated dependencies [d6bfb3d]
- Updated dependencies [8a9c079]
- Updated dependencies [7b005b4]
- Updated dependencies [f1a8114]
- Updated dependencies [48d5a1c]
- Updated dependencies [cc3555e]
- Updated dependencies [f8fe47e]
- Updated dependencies [a2266a6]
- Updated dependencies [d25a0ec]
- Updated dependencies [5c13368]
- Updated dependencies [3216344]
- Updated dependencies [f5bfac8]
- Updated dependencies [6163393]
- Updated dependencies [688e9df]
- Updated dependencies [8f124a7]
- Updated dependencies [21ca1d5]
- Updated dependencies [03b11e8]
- Updated dependencies [89d7b35]
- Updated dependencies [0cd08d5]
- Updated dependencies [8891f93]
- Updated dependencies [6155c3c]
- Updated dependencies [1ee48bc]
- Updated dependencies [d729a31]
- Updated dependencies [b30963d]
- Updated dependencies [cb8322e]
- Updated dependencies [94f7b6a]
- Updated dependencies [1d5dc46]
- Updated dependencies [d13f627]
- Updated dependencies [5c94f83]
- Updated dependencies [ea936f3]
- Updated dependencies [0c0fbd9]
- Updated dependencies [667b83e]
- Updated dependencies [f3141d8]
- Updated dependencies [a841151]
- Updated dependencies [7687f7b]
- Updated dependencies [5a84d41]
- Updated dependencies [fd3013a]
- Updated dependencies [85ec26d]
- Updated dependencies [73e576f]
- Updated dependencies [f6476fc]
- Updated dependencies [69ac82c]
- Updated dependencies [4e74c18]
- Updated dependencies [8b90d68]
- Updated dependencies [4ac12ef]
- Updated dependencies [478f1fd]
- Updated dependencies [833ed84]
- Updated dependencies [a18abf3]
- Updated dependencies [86d2e5e]
- Updated dependencies [c6a4eeb]
- Updated dependencies [1659072]
- Updated dependencies [f450ae7]
- Updated dependencies [2680cd3]
- Updated dependencies [810a3a2]
- Updated dependencies [abceb0d]
- Updated dependencies [627b188]
- Updated dependencies [8d4eae7]
- Updated dependencies [c5a5996]
- Updated dependencies [9981c1d]
- Updated dependencies [d60968c]
- Updated dependencies [0c302a7]
- Updated dependencies [1788e19]
- Updated dependencies [b88f5e8]
- Updated dependencies [857a6cf]
- Updated dependencies [214eb30]
- Updated dependencies [1e38158]
- Updated dependencies [65a3a84]
- Updated dependencies [6633337]
- Updated dependencies [21676eb]
- Updated dependencies [e474853]
- Updated dependencies [e9cb9ab]
- Updated dependencies [42cc219]
- Updated dependencies [d7e0b42]
- Updated dependencies [0996899]
- Updated dependencies [de6daa5]
- Updated dependencies [378d8b1]
- Updated dependencies [3510e4a]
- Updated dependencies [f00d8d4]
- Updated dependencies [5326b36]
- Updated dependencies [aa4b90d]
- Updated dependencies [ccd9397]
- Updated dependencies [503be86]
- Updated dependencies [54299ca]
- Updated dependencies [1f6ed16]
- Updated dependencies [db2ea82]
- Updated dependencies [51a587d]
- Updated dependencies [ae490ef]
- Updated dependencies [e124711]
- Updated dependencies [dc61def]
- Updated dependencies [bca935b]
- Updated dependencies [d92c72d]
- Updated dependencies [c54c822]
- Updated dependencies [8dcc0f5]
- Updated dependencies [75b9e51]
- Updated dependencies [f61c8cf]
- Updated dependencies [e3ef52b]
- Updated dependencies [0a2f233]
- Updated dependencies [8621cdd]
- Updated dependencies [251e888]
- Updated dependencies [07f1822]
- Updated dependencies [e336549]
- Updated dependencies [3bb9340]
- Updated dependencies [1e604c4]
- Updated dependencies [04fab5e]
- Updated dependencies [183b4c4]
- Updated dependencies [7f713b6]
- Updated dependencies [d40f43a]
- Updated dependencies [2fdb36e]
- Updated dependencies [62159bd]
- Updated dependencies [f1544e2]
- Updated dependencies [5f0852f]
- Updated dependencies [c53aa53]
- Updated dependencies [3de535b]
- Updated dependencies [6f23667]
- Updated dependencies [cca11e9]
- Updated dependencies [cfb549d]
- Updated dependencies [77a77fd]
- Updated dependencies [d82f8c0]
- Updated dependencies [cde1975]
- Updated dependencies [026508b]
- Updated dependencies [20cb232]
- Updated dependencies [e231abb]
- Updated dependencies [0bc685a]
- Updated dependencies [20526f5]
- Updated dependencies [efedd28]
- Updated dependencies [5d21a48]
- Updated dependencies [5278e11]
- Updated dependencies [c5eef1d]
- Updated dependencies [e5e7ee0]
- Updated dependencies [23dba62]
- Updated dependencies [e0f300b]
- Updated dependencies [761a0ba]
- Updated dependencies [c960170]
- Updated dependencies [19365b7]
- Updated dependencies [ba98e26]
- Updated dependencies [b7ed26d]
- Updated dependencies [a2ebea2]
- Updated dependencies [800bdb0]
- Updated dependencies [9d4dfc4]
- Updated dependencies [1059965]
- Updated dependencies [def5919]
- Updated dependencies [ee264b2]
- Updated dependencies [d56bcdb]
- Updated dependencies [26bb053]
- Updated dependencies [ee3bde1]
- Updated dependencies [098b629]
- Updated dependencies [2053714]
- Updated dependencies [60b672e]
- Updated dependencies [d86815e]
- Updated dependencies [dca25e1]
- Updated dependencies [6b441a8]
- Updated dependencies [ce0cfe9]
- Updated dependencies [04f1182]
- Updated dependencies [be87153]
- Updated dependencies [dd0f681]
- Updated dependencies [60f0dd8]
- Updated dependencies [52d1a7d]
- Updated dependencies [a87c5cd]
- Updated dependencies [a47f338]
- Updated dependencies [b3a3d83]
- Updated dependencies [7a55913]
- Updated dependencies [35accbf]
- Updated dependencies [6038de7]
- Updated dependencies [fc5f536]
- Updated dependencies [bee5ffe]
- Updated dependencies [0a5dc29]
- Updated dependencies [e13fd91]
- Updated dependencies [5647006]
- Updated dependencies [e654bfd]
- Updated dependencies [01a7337]
- Updated dependencies [b45c71e]
- Updated dependencies [50185a8]
- Updated dependencies [7309c81]
- Updated dependencies [3172831]
- Updated dependencies [f8cfbb4]
- Updated dependencies [5aaa6fc]
- Updated dependencies [dca5bd3]
- Updated dependencies [d6bd5a1]
- Updated dependencies [6e6c872]
- Updated dependencies [2bd4e5e]
- Updated dependencies [2598216]
- Updated dependencies [11949fc]
- Updated dependencies [2c7e62d]
- Updated dependencies [eb95d97]
- Updated dependencies [b098b0e]
- Updated dependencies [4d00b13]
- Updated dependencies [1363084]
- Updated dependencies [488b66c]
- Updated dependencies [148d451]
- Updated dependencies [fa5758e]
- Updated dependencies [38f7e4f]
- Updated dependencies [eb7613c]
- Updated dependencies [c57f3cf]
- Updated dependencies [ecf0bef]
- Updated dependencies [68f5ecc]
- Updated dependencies [ecc9110]
- Updated dependencies [e4c2dc8]
- Updated dependencies [97faca3]
- Updated dependencies [57bab76]
- Updated dependencies [43fc039]
- Updated dependencies [c89d18c]
- Updated dependencies [1bd2795]
- Updated dependencies [f7bd4e2]
- Updated dependencies [361bd5b]
- Updated dependencies [aac90a5]
- Updated dependencies [bd5fc38]
- Updated dependencies [3da3da5]
- Updated dependencies [6ad13bb]
- Updated dependencies [1e6ab15]
- Updated dependencies [b90086a]
- Updated dependencies [8186a70]
- Updated dependencies [a329cca]
- Updated dependencies [c87ef70]
- Updated dependencies [3cb0618]
- Updated dependencies [32a0874]
- Updated dependencies [6eec18c]
- Updated dependencies [4d7bebf]
- Updated dependencies [821ac7a]
- Updated dependencies [8f81731]
- Updated dependencies [7055c22]
- Updated dependencies [785a748]
- Updated dependencies [3af0354]
- Updated dependencies [866ff16]
- Updated dependencies [5a85e67]
- Updated dependencies [8b50cb3]
- Updated dependencies [e92e2c3]
- Updated dependencies [551f899]
- Updated dependencies [a0fdc56]
- Updated dependencies [946a131]
- Updated dependencies [909895d]
- Updated dependencies [b95577a]
- Updated dependencies [0dcbc11]
- Updated dependencies [54f479a]
- Updated dependencies [d88f3e9]
- Updated dependencies [ad5fe25]
- Updated dependencies [c183a12]
- Updated dependencies [83c161f]
- Updated dependencies [d8c4957]
- Updated dependencies [b9f930b]
- Updated dependencies [f24cb83]
- Updated dependencies [5dbbb92]
- Updated dependencies [ea90179]
- Updated dependencies [1818998]
- Updated dependencies [ce92674]
- Updated dependencies [5ef0b5b]
- Updated dependencies [8c2db68]
- Updated dependencies [22b5e54]
- Updated dependencies [0166bd5]
- Updated dependencies [8064b07]
- Updated dependencies [09ee21c]
- Updated dependencies [4a56dbd]
- Updated dependencies [289d04a]
- Updated dependencies [f549a0d]
- Updated dependencies [48fbacb]
- Updated dependencies [06df4fa]
- Updated dependencies [3fc2e48]
- Updated dependencies [c9b809f]
- Updated dependencies [e8f435c]
- Updated dependencies [89be40c]
- Updated dependencies [32386f8]
- Updated dependencies [9b702dc]
- Updated dependencies [ab16331]
- Updated dependencies [41610f6]
- Updated dependencies [24915d2]
- Updated dependencies [69f1dfd]
- Updated dependencies [f46e987]
- Updated dependencies [bbe05de]
- Updated dependencies [355e951]
- Updated dependencies [e3a6f6e]
- Updated dependencies [c9bf940]
- Updated dependencies [a1dd1e4]
- Updated dependencies [a682670]
- Updated dependencies [dadb43f]
- Updated dependencies [2b52bc8]
- Updated dependencies [3556b67]
  - @objectstack/spec@17.0.0
  - @objectstack/runtime@17.0.0
  - @objectstack/objectql@17.0.0
  - @objectstack/client@17.0.0
  - @objectstack/mcp@17.0.0
  - @objectstack/metadata@17.0.0
  - @objectstack/service-knowledge@17.0.0
  - @objectstack/driver-sqlite-wasm@17.0.0
  - @objectstack/knowledge-memory@17.0.0

## 4.0.92-rc.5

### Patch Changes

- 3d89777: fix(example-todo): a normal user can mark a task complete again — `completed_date` is stamped by the hook instead of demanded from the caller (#7036)

  `examples/app-todo` shipped two declarations on `todo_task` that could not both hold on
  the update path, so the app's headline action was unsatisfiable by construction.

  **Before.** `completed_date` is `Field.datetime({ readonly: true })`, and `readonly` is a
  two-part contract: never editable in forms, **and** a non-system caller's write to it is
  stripped from the payload on the update path. The same object then declares a validation
  rule, `completed_date_required`, refusing any record whose `status` is `completed` while
  `completed_date` is blank. The strip runs first, so a payload carrying both keys lost
  `completed_date` and was then rejected for missing it. Measured against the real object on
  a real kernel:

  ```
  update status+completed_date (user ctx):  REJECTED -> Completed date is required when status is Completed
  update status only           (user ctx):  REJECTED -> Completed date is required when status is Completed
  update status+completed_date (isSystem):  OK
  insert already-completed:                 OK
  ```

  Both escapes are non-user paths — an elevated write bypasses the strip, and a create may
  legitimately seed a read-only column. Every ordinary user update was refused, which made
  the app's own `completeTask` and `massCompleteTasks` handlers fail every time they ran.

  **After.** The column is server-owned, so the server writes it. `task.hook.ts` gains a
  `beforeUpdate` leg that stamps `completed_date` on the transition into `completed` and
  clears it on the transition back out; `completeTask` and `massCompleteTasks` now send
  `status` alone. A one-key user-context update completes the task and persists the stamp.

  This works because the readonly strip is deliberately narrow rather than because it is
  bypassed: it runs _after_ the before-hooks and deletes a key only when the caller supplied
  it **and** it still holds the caller's own value (`stripReadonlyFields`, the
  `suppliedValues` snapshot plus the `Object.is` identity check). A value a hook wrote is a
  platform value and survives — including when the caller echoed the same key back, which is
  what a whole-record form PUT does. The stamp is therefore written unconditionally: leaving
  a caller-supplied value in place would leave the caller's own value on the key, and the
  strip would delete it.

  `completed_date_required` stays, and is now the assertion that the stamp actually
  happened — if the hook is ever unregistered or its transition guard breaks, the write is
  refused loudly instead of committing a completed task with no completion date.

  **Two related repairs the fix required.**

  - The hook was never registered. `task_logic` was not in `defineStack({ hooks })`, and
    `collectBundleHooks` reads that array and nothing else, so the whole file was dead
    metadata: it type-checked, it read as wired, and it never ran. Both sibling example apps
    already declare `hooks: allHooks`; `app-todo` now does too.
  - Both existing legs read the record off `ctx.input` rather than `ctx.input.data`.
    `HookContext.input` is an envelope — `{ data, options }` on insert, `{ id, data, options }`
    on update — so `ctx.input.priority = 'normal'` set a key no write path reads. The insert
    defaults and the after-update branches had never had any effect; they do now. The
    after-update logging also moved from `console` to the kernel logger reached through
    `ctx.ql`, so it honours the configured log level.

  Reopening a completed task clears `completed_date`, documented in the object and hook
  metadata: the field means "when this task was completed", so a task that is not completed
  must not carry a stale one. An edit that carries no `status` is not treated as a reopen.

- cc05304: fix(example-todo): `task_completion`'s recurrence branch computes a real next due date — it wrote a literal `DATEADD(...)` string the driver refused (#7037)

  `examples/app-todo`'s `TaskCompletionFlow` spawned the next occurrence of a recurring task
  with

  ```
  due_date: 'DATEADD({completedTask.due_date}, {completedTask.recurrence_interval}, "{completedTask.recurrence_type}")'
  ```

  **Two independent faults, stacked.** `DATEADD` exists nowhere in the platform — not a CEL
  builtin, not registered by `packages/formula` under any casing. And a `create_record`
  node's `fields` values are TEMPLATE-interpolated, never evaluated: the `{…}` holes are
  filled and the surrounding text passes through verbatim. So what reached the engine was
  the literal string `DATEADD(2026-08-10, 1, "daily")`, and the field's own coercion refused
  it with `Due Date must be a valid date (ISO-8601)`, failing the whole run.

  **Reachability changed with #6882; the defect did not.** While the flow was unbound the
  node never executed and the dead function text was inert. Armed, every completion of a
  _recurring_ task produced a failed run, so the recurrence feature the node exists for had
  never once worked.

  **Why the repair is a `script` node and not a better expression.** No flow node evaluates
  a value-producing expression. The builtin vocabulary's only expression slots are
  PREDICATES (`config.condition`, `edge.condition`, `decision.conditions[].expression`,
  `screen.fields[].visibleWhen`) and `flow-template` REFERENCES (`loop.collection`,
  `map.collection`) — the ledger is `FLOW_NODE_EXPRESSION_PATHS` in
  `@objectstack/spec/automation` — and an `assignment` node interpolates rather than
  evaluates. The next due date therefore has to be computed _before_ the create node runs.

  A `compute_next_due_date` `script` node now calls `computeNextTaskDueDate`, registered
  through `defineStack({ functions })` — the pure-function shape (#1870, #4396) that
  `showcase_task_completed` already uses: it takes `input`, returns the date, and
  `create_next_task` persists it by reading the whole-string token `{nextDueDate}`. The
  function handles all four authored cadences (daily / weekly / monthly / yearly × interval),
  clamps a monthly shift to the target month's last day exactly as `@objectstack/formula`'s
  `addMonths` does — so the app cannot teach a recurrence semantic that disagrees with the
  platform's own formula function — and refuses an unknown `recurrence_type` or an interval
  `min: 1` forbids instead of guessing a cadence.

  The non-recurring path is unchanged: the `check_recurring` gate still routes straight to
  `end`, skipping both nodes.

  New suite `test/task-recurrence.test.ts` drives the app's real metadata, real object and
  real function registry through a real kernel over sqlite: the spawned task's `due_date` is
  asserted for daily / weekly / monthly completions, and a reverse fixture rebuilt from the
  live flow shows the pre-fix shape — any function-call text left in a `create_record` field
  value — still failing inside `create_next_task` with the date refusal, and notably _not_
  with "no function named …", because nothing ever tried to call one. A class-level guard
  asserts no write node in any of the app's flows leaves function-call text in a field value.

- 6dd3c25: fix(example-todo): `task_completion` is a real record-change flow again — it bound to nothing and gated on a key nothing reads (#6882)

  `examples/app-todo`'s `TaskCompletionFlow` declared `type: 'record_change'` and then
  declared neither key that arms one. It was 1 of the 34 authored flows across the three
  bundled apps, and the only dead one.

  **Two faults on one start node, both silent.**

  1. **No `triggerType` at all.** `AutomationEngine.resolveTriggerBinding` claims a
     record-change flow only when the authored token starts with `record-`. With the key
     absent every later branch missed too (`timeRelative`, `config.schedule`,
     `flow.type === 'schedule'`, `flow.type === 'api'`), the method returned `undefined`,
     and `activateFlowTrigger` returned without binding. The flow declared itself
     record-triggered and was, at runtime, a manual flow that never fired.
  2. **The predicate was written to `triggerCondition`.** The trigger gate is
     `config.condition` — the key the binding copies and `execute()` evaluates. A node
     `config` is an open slot by design (ADR-0018), so the misspelling parsed silently.
     Fixing (1) alone would have been _worse_ than dead: the flow would have fired on every
     update of every task.

  **Why no channel reported it.** `getTriggerBindingAudit` — the platform's own silent-miss
  surface, and the source for both the automation plugin's `kernel:bootstrapped` warn loop
  and the CLI startup summary's `unbound` list — opens with `if (!resolved) continue`,
  reading "no binding" as "manual/screen flow, nothing to bind". So the missing key did not
  _add_ a diagnostic; it removed the flow from every diagnostic channel there is. The only
  trace anywhere was the startup banner counting one more flow registered than bound, with
  no name and no reason.

  **The repair.** `triggerType: 'record-after-update'` plus the predicate moved to
  `config.condition` as `status == "completed" && previous.status != "completed"` — the
  shape `showcase_task_completed` already uses for this exact semantic. `-after-update`
  rather than `-after-write` on purpose: "marked as complete" is a transition, and the
  insert leg has no `previous` to transition from — `previous` binds to `null` there, and
  `previous.status` against `null` aborts the whole CEL predicate with `No such key:
status` rather than answering false.

  A third fault surfaced the moment the flow could run: `get_task` filtered on `{taskId}`,
  an `isInput` variable nothing ever bound (a record-change run seeds `params` from the
  triggering record, which carries `id`, not `taskId`), so the first armed run failed with
  "1 filter condition(s) resolved to nothing and were dropped from the query". It now reads
  `{record.id}`, the handle every other record-change flow in the corpus uses, and the dead
  declaration is gone.

  `@objectstack/example-todo` also runs its own vitest suite now (`vitest run`, as
  `app-crm` and `app-showcase` already do) instead of `objectstack test`, which is a
  Quality-Protocol runner that needs a live server and matched no `qa/*.test.json` here —
  so the package's test files had never executed in CI.

- Updated dependencies [3d5c090]
- Updated dependencies [e5bd768]
- Updated dependencies [e027b3e]
- Updated dependencies [c2429b0]
- Updated dependencies [445a0c2]
- Updated dependencies [f6609e6]
- Updated dependencies [a70358a]
- Updated dependencies [97e7e3c]
- Updated dependencies [8828b9e]
- Updated dependencies [53068c1]
- Updated dependencies [ee58392]
- Updated dependencies [f16e54e]
- Updated dependencies [06be54e]
- Updated dependencies [259459d]
- Updated dependencies [3f7f14e]
- Updated dependencies [6968885]
- Updated dependencies [eaed61f]
- Updated dependencies [debe2f6]
- Updated dependencies [97b0798]
- Updated dependencies [ad878e7]
- Updated dependencies [43a7a8d]
- Updated dependencies [73f69dc]
- Updated dependencies [04c56aa]
- Updated dependencies [3028326]
- Updated dependencies [4c5df00]
- Updated dependencies [b3efeb7]
- Updated dependencies [ddd075a]
- Updated dependencies [88154be]
- Updated dependencies [fe2dfa1]
- Updated dependencies [6f6fec7]
- Updated dependencies [e8dc61e]
- Updated dependencies [2f3e793]
- Updated dependencies [d8e8d9c]
- Updated dependencies [94e749b]
- Updated dependencies [ea1d916]
- Updated dependencies [f7d80f4]
- Updated dependencies [ae31a19]
- Updated dependencies [e0f300b]
- Updated dependencies [ec3dfd7]
- Updated dependencies [466c503]
- Updated dependencies [10c4ea9]
- Updated dependencies [62b6a2f]
- Updated dependencies [5b4780b]
- Updated dependencies [a933452]
- Updated dependencies [8140915]
- Updated dependencies [7b48cf9]
- Updated dependencies [b5404f4]
- Updated dependencies [f764691]
- Updated dependencies [e120a5a]
- Updated dependencies [e650d67]
- Updated dependencies [121852d]
- Updated dependencies [04476e7]
- Updated dependencies [79228cd]
- Updated dependencies [b3363e9]
- Updated dependencies [2ef1807]
- Updated dependencies [d03fe25]
- Updated dependencies [2672f85]
- Updated dependencies [11066f6]
- Updated dependencies [916af17]
- Updated dependencies [84c86fb]
- Updated dependencies [2a2a9fb]
- Updated dependencies [86e6f6c]
- Updated dependencies [a2e157c]
- Updated dependencies [95c4227]
- Updated dependencies [2a61116]
- Updated dependencies [d4df105]
- Updated dependencies [55da611]
- Updated dependencies [d367f03]
- Updated dependencies [e2798fa]
- Updated dependencies [e2798fa]
- Updated dependencies [0fd8556]
- Updated dependencies [6fde910]
- Updated dependencies [9c82b89]
- Updated dependencies [74155c7]
- Updated dependencies [742a6a5]
- Updated dependencies [6908830]
- Updated dependencies [8b06bba]
- Updated dependencies [b7d3be4]
- Updated dependencies [2a0d65e]
- Updated dependencies [4c54037]
- Updated dependencies [0f7157b]
- Updated dependencies [d9bef45]
- Updated dependencies [f549a0d]
- Updated dependencies [82da264]
- Updated dependencies [f586f1a]
- Updated dependencies [9b9b70f]
- Updated dependencies [f5a9bc2]
- Updated dependencies [881a3cc]
- Updated dependencies [ad6317b]
- Updated dependencies [8a88885]
- Updated dependencies [5f7669e]
- Updated dependencies [becbe53]
- Updated dependencies [b127c8b]
- Updated dependencies [a80302a]
- Updated dependencies [474f131]
- Updated dependencies [050cd82]
- Updated dependencies [4d552af]
- Updated dependencies [44d677c]
- Updated dependencies [c32944d]
- Updated dependencies [1dd780f]
- Updated dependencies [c8d6f6e]
- Updated dependencies [92a67f2]
- Updated dependencies [9136327]
- Updated dependencies [bf0ae99]
- Updated dependencies [edb4af0]
- Updated dependencies [f09a2e7]
- Updated dependencies [cb3b6cd]
- Updated dependencies [73b7234]
- Updated dependencies [d2b97c3]
- Updated dependencies [59b794f]
- Updated dependencies [db59e9c]
- Updated dependencies [fc3a36a]
- Updated dependencies [69787f0]
- Updated dependencies [5d022a1]
- Updated dependencies [042b9ee]
- Updated dependencies [55011af]
- Updated dependencies [f549a0d]
- Updated dependencies [a36db28]
- Updated dependencies [3f8817a]
- Updated dependencies [a2443e3]
- Updated dependencies [e1554b1]
- Updated dependencies [53ef057]
- Updated dependencies [4856789]
- Updated dependencies [c3f4916]
- Updated dependencies [33e0385]
- Updated dependencies [2205363]
- Updated dependencies [09fe58d]
- Updated dependencies [d0a5ceb]
- Updated dependencies [e18a162]
- Updated dependencies [d127ff0]
- Updated dependencies [c804f19]
- Updated dependencies [9b86cf6]
- Updated dependencies [c51ffa5]
- Updated dependencies [8825a06]
- Updated dependencies [5087ac6]
- Updated dependencies [2d1ddf0]
- Updated dependencies [354b00f]
- Updated dependencies [3de535b]
- Updated dependencies [fe2e15a]
- Updated dependencies [dbe92a7]
- Updated dependencies [6146b67]
- Updated dependencies [c6b6bb4]
- Updated dependencies [4f3d232]
- Updated dependencies [5c2716b]
- Updated dependencies [2f59da0]
- Updated dependencies [114e727]
- Updated dependencies [5e247fd]
- Updated dependencies [1a53a02]
- Updated dependencies [73648ba]
- Updated dependencies [1507ba3]
- Updated dependencies [a954634]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [7c6261a]
- Updated dependencies [08863dd]
- Updated dependencies [1da39f5]
- Updated dependencies [56664f5]
- Updated dependencies [31cbe90]
- Updated dependencies [bf42e76]
- Updated dependencies [90bbf25]
- Updated dependencies [eb91eba]
- Updated dependencies [8fbed3b]
- Updated dependencies [42da73d]
- Updated dependencies [643b7c7]
- Updated dependencies [bfe689b]
- Updated dependencies [9960cd2]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [b295e4b]
- Updated dependencies [2233a85]
- Updated dependencies [de43f94]
- Updated dependencies [62dd69a]
- Updated dependencies [e15e679]
- Updated dependencies [2ab1257]
- Updated dependencies [4cc4fb7]
- Updated dependencies [2c26040]
- Updated dependencies [f758cec]
- Updated dependencies [1bb5a56]
- Updated dependencies [1fa224a]
- Updated dependencies [3fb42d2]
- Updated dependencies [78f0be8]
- Updated dependencies [35f7fb4]
- Updated dependencies [a5302c7]
- Updated dependencies [82397b6]
- Updated dependencies [4df747c]
- Updated dependencies [7084313]
- Updated dependencies [47a4e67]
- Updated dependencies [91cefb8]
- Updated dependencies [9bc846b]
- Updated dependencies [0e043d8]
- Updated dependencies [4fedb11]
- Updated dependencies [dadd1ad]
- Updated dependencies [2f2e63c]
- Updated dependencies [486d526]
- Updated dependencies [f8fe47e]
- Updated dependencies [89d7b35]
- Updated dependencies [6155c3c]
- Updated dependencies [d13f627]
- Updated dependencies [a841151]
- Updated dependencies [85ec26d]
- Updated dependencies [f6476fc]
- Updated dependencies [4ac12ef]
- Updated dependencies [1788e19]
- Updated dependencies [b88f5e8]
- Updated dependencies [42cc219]
- Updated dependencies [d7e0b42]
- Updated dependencies [0996899]
- Updated dependencies [378d8b1]
- Updated dependencies [3510e4a]
- Updated dependencies [aa4b90d]
- Updated dependencies [54299ca]
- Updated dependencies [1f6ed16]
- Updated dependencies [dc61def]
- Updated dependencies [251e888]
- Updated dependencies [183b4c4]
- Updated dependencies [2fdb36e]
- Updated dependencies [62159bd]
- Updated dependencies [3de535b]
- Updated dependencies [cca11e9]
- Updated dependencies [cfb549d]
- Updated dependencies [20526f5]
- Updated dependencies [c5eef1d]
- Updated dependencies [e0f300b]
- Updated dependencies [761a0ba]
- Updated dependencies [d86815e]
- Updated dependencies [be87153]
- Updated dependencies [60f0dd8]
- Updated dependencies [a87c5cd]
- Updated dependencies [a47f338]
- Updated dependencies [bee5ffe]
- Updated dependencies [e13fd91]
- Updated dependencies [3172831]
- Updated dependencies [2bd4e5e]
- Updated dependencies [2598216]
- Updated dependencies [2c7e62d]
- Updated dependencies [eb7613c]
- Updated dependencies [68f5ecc]
- Updated dependencies [ecc9110]
- Updated dependencies [f7bd4e2]
- Updated dependencies [361bd5b]
- Updated dependencies [bd5fc38]
- Updated dependencies [1818998]
- Updated dependencies [09ee21c]
- Updated dependencies [f549a0d]
- Updated dependencies [3fc2e48]
- Updated dependencies [e8f435c]
- Updated dependencies [41610f6]
- Updated dependencies [c9bf940]
- Updated dependencies [a682670]
  - @objectstack/spec@17.0.0-rc.6
  - @objectstack/objectql@17.0.0-rc.6
  - @objectstack/runtime@17.0.0-rc.6
  - @objectstack/client@17.0.0-rc.6
  - @objectstack/metadata@17.0.0-rc.6
  - @objectstack/driver-sqlite-wasm@17.0.0-rc.6
  - @objectstack/mcp@17.0.0-rc.6
  - @objectstack/knowledge-memory@17.0.0-rc.6
  - @objectstack/service-knowledge@17.0.0-rc.6

## 4.0.92-rc.4

### Patch Changes

- Updated dependencies [e8f8f6c]
- Updated dependencies [7f713b6]
- Updated dependencies [c960170]
- Updated dependencies [def5919]
- Updated dependencies [ee3bde1]
- Updated dependencies [ce0cfe9]
- Updated dependencies [1363084]
- Updated dependencies [148d451]
  - @objectstack/spec@17.0.0-rc.5
  - @objectstack/client@17.0.0-rc.5
  - @objectstack/objectql@17.0.0-rc.5
  - @objectstack/driver-sqlite-wasm@17.0.0-rc.5
  - @objectstack/mcp@17.0.0-rc.5
  - @objectstack/metadata@17.0.0-rc.5
  - @objectstack/knowledge-memory@17.0.0-rc.5
  - @objectstack/runtime@17.0.0-rc.5
  - @objectstack/service-knowledge@17.0.0-rc.5

## 4.0.92-rc.3

### Patch Changes

- Updated dependencies [9fe9c1d]
- Updated dependencies [da5d1b4]
- Updated dependencies [d4e0809]
- Updated dependencies [739f496]
- Updated dependencies [f724f69]
- Updated dependencies [28ad90e]
- Updated dependencies [f8644c7]
- Updated dependencies [306ca50]
- Updated dependencies [978fed2]
- Updated dependencies [cfc293f]
- Updated dependencies [de70b42]
- Updated dependencies [64cd010]
- Updated dependencies [fb3d99b]
- Updated dependencies [cdfbee2]
- Updated dependencies [29c6c9d]
- Updated dependencies [d21c001]
- Updated dependencies [f1cc3a3]
- Updated dependencies [ddc2527]
- Updated dependencies [553a47f]
- Updated dependencies [9f747ee]
- Updated dependencies [a3a884d]
- Updated dependencies [cfed092]
- Updated dependencies [c497d26]
- Updated dependencies [bbdbf28]
- Updated dependencies [2e284b2]
- Updated dependencies [3905c00]
- Updated dependencies [4335497]
- Updated dependencies [43ca399]
- Updated dependencies [1b49eaf]
- Updated dependencies [0161c7f]
- Updated dependencies [e900015]
- Updated dependencies [b5bdf48]
- Updated dependencies [aa25a81]
- Updated dependencies [3a18e24]
- Updated dependencies [533a0a4]
- Updated dependencies [a019e52]
- Updated dependencies [64fc6d5]
- Updated dependencies [947d4f9]
- Updated dependencies [d8f65fe]
- Updated dependencies [58ffcab]
- Updated dependencies [eaaf03c]
- Updated dependencies [d17df80]
- Updated dependencies [7d0e7b5]
- Updated dependencies [6513c17]
- Updated dependencies [3133cda]
- Updated dependencies [c142ced]
- Updated dependencies [eda599e]
- Updated dependencies [c794f78]
- Updated dependencies [7bf3d1c]
- Updated dependencies [db9c331]
- Updated dependencies [c001422]
- Updated dependencies [77022a9]
- Updated dependencies [217b791]
- Updated dependencies [fd8521f]
- Updated dependencies [52760bf]
- Updated dependencies [5543020]
- Updated dependencies [880d343]
- Updated dependencies [6e82972]
- Updated dependencies [4615a18]
- Updated dependencies [2b63a00]
- Updated dependencies [06ba036]
- Updated dependencies [18b8eaa]
- Updated dependencies [7f62706]
- Updated dependencies [667fa44]
- Updated dependencies [37e38d1]
- Updated dependencies [78adc2e]
- Updated dependencies [81e2744]
- Updated dependencies [277eb36]
- Updated dependencies [41e605e]
- Updated dependencies [ecc61ab]
- Updated dependencies [2649ccb]
- Updated dependencies [1eb13a0]
- Updated dependencies [a70cd0a]
- Updated dependencies [c52e608]
- Updated dependencies [afa6aa5]
- Updated dependencies [afb83d3]
- Updated dependencies [4dfd002]
- Updated dependencies [77be690]
- Updated dependencies [811c30c]
- Updated dependencies [2b2175b]
- Updated dependencies [b49ccfd]
- Updated dependencies [c7406b0]
- Updated dependencies [85d95e7]
- Updated dependencies [168f60f]
- Updated dependencies [244ca86]
- Updated dependencies [546ab3c]
- Updated dependencies [729a43a]
- Updated dependencies [0b51bb6]
- Updated dependencies [d9971d3]
- Updated dependencies [d9cac60]
- Updated dependencies [abeb375]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [290d944]
- Updated dependencies [795b6e1]
- Updated dependencies [175d789]
- Updated dependencies [55dbbba]
- Updated dependencies [72c3c86]
- Updated dependencies [7f1a635]
- Updated dependencies [5d3ced9]
- Updated dependencies [44106d9]
- Updated dependencies [1eadac0]
- Updated dependencies [7c2f7dd]
- Updated dependencies [9b26699]
- Updated dependencies [95b4f0d]
- Updated dependencies [502564d]
- Updated dependencies [471839d]
- Updated dependencies [b508244]
- Updated dependencies [594508e]
- Updated dependencies [1c625ca]
- Updated dependencies [b5459bc]
- Updated dependencies [1624f4a]
- Updated dependencies [71f205d]
- Updated dependencies [414395b]
- Updated dependencies [26e1029]
- Updated dependencies [1cae606]
- Updated dependencies [108ba8d]
- Updated dependencies [b9cc17d]
- Updated dependencies [b4ad984]
- Updated dependencies [a9f32df]
- Updated dependencies [aeb9b27]
- Updated dependencies [1203bb2]
- Updated dependencies [7d27da0]
- Updated dependencies [0d24078]
- Updated dependencies [089767f]
- Updated dependencies [5b8f95b]
- Updated dependencies [2ddba89]
- Updated dependencies [e4c8b6c]
- Updated dependencies [acb10f6]
- Updated dependencies [ef7845a]
- Updated dependencies [1c3da1f]
- Updated dependencies [a34fd2e]
- Updated dependencies [37a8f2b]
- Updated dependencies [441d79f]
- Updated dependencies [889ae47]
- Updated dependencies [4f4c3fb]
- Updated dependencies [7adc841]
- Updated dependencies [4845f85]
- Updated dependencies [7b005b4]
- Updated dependencies [0cd08d5]
- Updated dependencies [94f7b6a]
- Updated dependencies [5c94f83]
- Updated dependencies [73e576f]
- Updated dependencies [2680cd3]
- Updated dependencies [c5a5996]
- Updated dependencies [db2ea82]
- Updated dependencies [51a587d]
- Updated dependencies [ae490ef]
- Updated dependencies [f61c8cf]
- Updated dependencies [e3ef52b]
- Updated dependencies [07f1822]
- Updated dependencies [04fab5e]
- Updated dependencies [efedd28]
- Updated dependencies [5278e11]
- Updated dependencies [23dba62]
- Updated dependencies [ba98e26]
- Updated dependencies [d56bcdb]
- Updated dependencies [dca25e1]
- Updated dependencies [fc5f536]
- Updated dependencies [f8cfbb4]
- Updated dependencies [5aaa6fc]
- Updated dependencies [dca5bd3]
- Updated dependencies [488b66c]
- Updated dependencies [c89d18c]
- Updated dependencies [aac90a5]
- Updated dependencies [1e6ab15]
- Updated dependencies [c87ef70]
- Updated dependencies [3cb0618]
- Updated dependencies [32a0874]
- Updated dependencies [7055c22]
- Updated dependencies [785a748]
- Updated dependencies [3af0354]
- Updated dependencies [866ff16]
- Updated dependencies [5a85e67]
- Updated dependencies [e92e2c3]
- Updated dependencies [946a131]
- Updated dependencies [909895d]
- Updated dependencies [c183a12]
- Updated dependencies [8064b07]
- Updated dependencies [4a56dbd]
- Updated dependencies [06df4fa]
- Updated dependencies [2b52bc8]
  - @objectstack/spec@17.0.0-rc.4
  - @objectstack/runtime@17.0.0-rc.4
  - @objectstack/metadata@17.0.0-rc.4
  - @objectstack/objectql@17.0.0-rc.4
  - @objectstack/client@17.0.0-rc.4
  - @objectstack/driver-sqlite-wasm@17.0.0-rc.4
  - @objectstack/service-knowledge@17.0.0-rc.4
  - @objectstack/mcp@17.0.0-rc.4
  - @objectstack/knowledge-memory@17.0.0-rc.4

## 4.0.92-rc.2

### Patch Changes

- 7d21581: feat(spec)!: retire the six remaining `authorWarn` dead keys — book/group `translations`, `job.id`, `translation.validationMessages`, `app.homePageId`, `app.areas[].order` (#4667)

  The #4488 liveness audit marked as `authorWarn` the keys whose _declaration_
  actively misleads — not merely unread, but shaped so an author reasonably
  concludes they configure something. #4509 and #4583 cleared the rest; these six
  are what remained, and each shipped with its own reason for reading alive.

  **The retirement kit:**

  | FROM                             | TO          | Fix                                                                                          |
  | -------------------------------- | ----------- | -------------------------------------------------------------------------------------------- |
  | `book.translations`              | _(removed)_ | Delete the key. Localize the **docs** — `doc.translations` is live on every doc render path. |
  | `book.groups[].translations`     | _(removed)_ | Same. Tombstoned, since `BookGroupSchema` is not `.strict()`.                                |
  | `job.id`                         | _(removed)_ | Delete the key. `name` is the job's identity everywhere.                                     |
  | `translation.validationMessages` | _(removed)_ | Delete the key. Author the message on the rule: `object.validations[].message`.              |
  | `app.homePageId`                 | _(removed)_ | Delete the key. Reorder `navigation`; set `isDefault` for the root landing.                  |
  | `app.areas[].order`              | _(removed)_ | Delete the key. Reorder the `areas` array itself.                                            |

  Run `os migrate meta --from 16` to rewrite existing sources automatically.

  **Each read alive for a different reason, and the prescriptions say which:**

  - **book `translations`** — _proximity_. `doc.translations`, two files over, same
    name and shape, works on every read path. The book-level map was parsed,
    stored and round-tripped, and rendered in the authoring locale to every
    reader: the tree endpoint and the portal emit `label` / `description`
    verbatim.
  - **`job.id`** — _its own description_. "Defaults to `name` when omitted"
    advertises an identity override that does not exist. `name` is the scheduling
    key, the `sys_job` row key, and the `JobExecution.jobId` stamp — so two jobs
    differing only in `id` were one job declared twice.
  - **`translation.validationMessages`** — _the platform's own signposts, twice_.
    The schema example showed a concrete override, and #3778's legacy-key
    migration table steered retired `errors:` authors straight into it. **That
    guidance entry is rewritten here**: retiring one dead key by pointing at
    another is the defect, not the fix.
  - **`app.homePageId`** — _a second source for one fact_. Not unread: objectui's
    console consumed it in `resolveLandingRoute()` and it was the only thing
    deciding where an app opened. (This entry first shipped saying otherwise;
    corrected in #4709, which upheld the removal.) What condemns the key is its
    shape — an ID cross-reference into `navigation` with no referential integrity,
    falling back to the first item _silently_ when the id dangled. If "land
    somewhere other than first" is ever wanted again it belongs on the navigation
    item itself, not on a pointer that can miss.
  - **`app.areas[].order`** — _the sibling that works_. Nav-item `order` really is
    sorted; area-level order never was, and both renderers iterate the array as
    authored.

  **Routes differ, deliberately.** `book.groups[].translations` and
  `app.homePageId` are **tombstoned** (`retiredKey`: `never` at compile time, a
  prescription at parse time) — the group schema is a plain `z.object`, where a
  bare delete would have zod silently strip the key, trading one silent no-op for
  another. The other four are strict deletions carrying `guidance`. Retired alias
  spellings (`i18n`, `home`, `homepage`, `landingpage`, `sort`) route to the same
  prescriptions rather than renaming onto keys that are gone.

  Registered as three ADR-0087 D2 conversions (`book-translations-removed`,
  `job-id-removed`, `translation-validation-messages-removed`) plus an extension
  of `app-dead-authoring-keys-removed`, all wired into the protocol-17 D3 chain.

  **Also corrected, both found by the gates rather than by grep:** the published
  `objectstack-i18n` skill taught `validationMessages` in a copy-paste example
  (an AI reproduces that verbatim), and `examples/app-todo` authored the group in
  three locales — where the `en` entries merely duplicated the rule's own text and
  the zh-CN / ja-JP translations had never once been rendered.

  After this, the only `authorWarn` keys left in the ledger are the two fail-open
  area gates tracked in #4651, which need a decision rather than a patch.

- d449b0c: fix(cli): gate the two decision-routing shapes that can never work, and flag the inert `config.condition` (#4414)

  Two follow-ups to #4440, both about metadata that reads like a guard and is not
  one.

  ## Two rules promoted to `error`

  `flow-branch-label-unmatched` and `flow-default-edge-with-condition` now FAIL the
  build instead of warning. The bar for that — restated at the top of
  `lint-flow-patterns.ts`, because the old one no longer described the set — is
  **no reading of the author's metadata does what it says, deterministically, on
  every run**. Both qualify: a branch label no out-edge carries cannot route, and
  an edge that is both `isDefault` and conditional always lets the condition win,
  so the marker routes nothing. Neither _fails_; both are wrong every time and
  silently, which is worse.

  The other two stay advisory on purpose, and the policy now says why:
  `flow-decision-unconditional-branch` is usually a guard that does not guard, but
  one guarded plus one unconditional out-edge is also a legal "maybe notify,
  always continue" fan-out, and `flow-multiple-default-edges` can genuinely mean
  "when nothing matched, do both". The bar is about _provability_, not severity of
  consequence — failing a customer's build on a shape we cannot prove wrong is the
  worse trade.

  No wiring change was needed: `lintFlowPatterns` is already registered as
  `tier: 'gating'` across all three commands (#4409), which is exactly the seam
  `authoring-rule-wiring.test.ts` exists to guard.

  ## New rule: `flow-inert-node-condition`

  `config.condition` is the trigger gate on a `start` node and is read by **no
  other node type** — the engine parse-validates it everywhere (so a malformed one
  is caught) and then ignores it. On a `decision` the name makes it read as the
  branch predicate, which is exactly how it got authored.

  Three of the three bundled apps had one. `app-todo`'s `check_recurring` and
  `app-showcase`'s `needs_exec` both carried a predicate their out-edges were
  already enforcing — a third copy doing nothing. The showcase even had a comment
  next to it saying the node condition "is not evaluated by the engine", and kept
  it anyway; that is the residue this rule exists to stop accumulating. Both are
  now plain exclusive gateways.

  Advisory, not gating: the surrounding edges usually still route correctly, so
  this is dead weight rather than a provable misroute. The node-type list is a
  closed set of builtins we have actually read, not "everything that isn't
  `start`" — ADR-0018 keeps `node.type` open and a plugin executor may legitimately
  declare and read its own `config.condition`.

  ## Studio

  `objectstack-ai/objectui` carries the matching help-text fixes: the branch editor
  said a `true` branch **is** the default/else path (it is how you _ask_ for one —
  the marker goes on the out-edge), and the legacy single `Condition` field said
  "prefer Branches above", which reads as "this works, but the other is better".
  It does not work at all.

- Updated dependencies [430dcc2]
- Updated dependencies [e6ac4bd]
- Updated dependencies [80334c7]
- Updated dependencies [ce5242c]
- Updated dependencies [a7163ea]
- Updated dependencies [e6e9379]
- Updated dependencies [257d97a]
- Updated dependencies [98877c9]
- Updated dependencies [98877c9]
- Updated dependencies [c44dd5e]
- Updated dependencies [e6b1b69]
- Updated dependencies [7e7a605]
- Updated dependencies [ad047d2]
- Updated dependencies [2826d1e]
- Updated dependencies [5a84d41]
- Updated dependencies [20b1a9e]
- Updated dependencies [203a449]
- Updated dependencies [ac37fc6]
- Updated dependencies [4820f55]
- Updated dependencies [462d9c4]
- Updated dependencies [7d21581]
- Updated dependencies [f2445c9]
- Updated dependencies [23338c3]
- Updated dependencies [84b4a3a]
- Updated dependencies [5b843fb]
- Updated dependencies [b4487aa]
- Updated dependencies [65ca83a]
- Updated dependencies [67bf2e2]
- Updated dependencies [c6d1cb4]
- Updated dependencies [462b713]
- Updated dependencies [36030ff]
- Updated dependencies [c4ab50b]
- Updated dependencies [6117f7b]
- Updated dependencies [e533b0b]
- Updated dependencies [cdf4d9a]
- Updated dependencies [aee1806]
- Updated dependencies [c13350b]
- Updated dependencies [c13350b]
- Updated dependencies [63b33e6]
- Updated dependencies [9ca2d85]
- Updated dependencies [c13350b]
- Updated dependencies [891d345]
- Updated dependencies [a52e2ef]
- Updated dependencies [5293114]
- Updated dependencies [ff17642]
- Updated dependencies [20bc357]
- Updated dependencies [5966c2a]
- Updated dependencies [2382580]
- Updated dependencies [d9fa683]
- Updated dependencies [3c7bcc0]
- Updated dependencies [4b6cac7]
- Updated dependencies [7631964]
- Updated dependencies [4c45be1]
- Updated dependencies [ac471a0]
- Updated dependencies [60ae58e]
- Updated dependencies [ce92674]
- Updated dependencies [9f601e8]
- Updated dependencies [51c5227]
- Updated dependencies [a4a85c8]
- Updated dependencies [07a4e26]
- Updated dependencies [9b43ee2]
- Updated dependencies [ec975f1]
- Updated dependencies [eb4204b]
- Updated dependencies [4f13be2]
- Updated dependencies [61cc079]
- Updated dependencies [0e96e46]
- Updated dependencies [cb5a75e]
- Updated dependencies [84b6e58]
- Updated dependencies [f160ba4]
- Updated dependencies [d52d4fe]
- Updated dependencies [742cebb]
- Updated dependencies [127f091]
- Updated dependencies [9fd9ae7]
- Updated dependencies [ce92674]
- Updated dependencies [cf2c9b7]
- Updated dependencies [0f9faa2]
- Updated dependencies [7cf42fe]
- Updated dependencies [5966c2a]
- Updated dependencies [8aacf94]
- Updated dependencies [f78dd83]
- Updated dependencies [a2cd18a]
- Updated dependencies [4638aaa]
- Updated dependencies [0222d3c]
- Updated dependencies [071d0dc]
- Updated dependencies [beefe89]
- Updated dependencies [0a936ea]
- Updated dependencies [023c00b]
- Updated dependencies [155507e]
- Updated dependencies [7bba90b]
- Updated dependencies [7e05d8e]
- Updated dependencies [061406d]
- Updated dependencies [c1f344b]
- Updated dependencies [9c93465]
- Updated dependencies [ebb209c]
- Updated dependencies [63b33e6]
- Updated dependencies [2a44c1d]
- Updated dependencies [695cfbd]
- Updated dependencies [7445149]
- Updated dependencies [071d0dc]
- Updated dependencies [0848bea]
- Updated dependencies [d51bed2]
- Updated dependencies [b8b3c64]
- Updated dependencies [1ee48bc]
- Updated dependencies [0c0fbd9]
- Updated dependencies [f3141d8]
- Updated dependencies [5a84d41]
- Updated dependencies [fd3013a]
- Updated dependencies [21676eb]
- Updated dependencies [e336549]
- Updated dependencies [d40f43a]
- Updated dependencies [e5e7ee0]
- Updated dependencies [a2ebea2]
- Updated dependencies [800bdb0]
- Updated dependencies [26bb053]
- Updated dependencies [04f1182]
- Updated dependencies [5647006]
- Updated dependencies [50185a8]
- Updated dependencies [d6bd5a1]
- Updated dependencies [38f7e4f]
- Updated dependencies [c57f3cf]
- Updated dependencies [97faca3]
- Updated dependencies [ad5fe25]
- Updated dependencies [ea90179]
- Updated dependencies [ce92674]
- Updated dependencies [5ef0b5b]
- Updated dependencies [48fbacb]
- Updated dependencies [24915d2]
- Updated dependencies [355e951]
- Updated dependencies [dadb43f]
  - @objectstack/runtime@17.0.0-rc.2
  - @objectstack/spec@17.0.0-rc.2
  - @objectstack/objectql@17.0.0-rc.2
  - @objectstack/client@17.0.0-rc.2
  - @objectstack/service-knowledge@17.0.0-rc.2
  - @objectstack/metadata@17.0.0-rc.2
  - @objectstack/driver-sqlite-wasm@17.0.0-rc.2
  - @objectstack/mcp@17.0.0-rc.2
  - @objectstack/knowledge-memory@17.0.0-rc.2

## 4.0.92-rc.1

### Patch Changes

- c5c78bb: **[#3959] `app-todo`'s `defer_task` / `set_reminder` are `type: 'script'`, not `type: 'modal'`.**

  Both declared `type: 'modal'` with a `target` naming a modal page that does not
  exist (`defer_task_modal`, `set_reminder_modal`), while their handlers sat
  registered under `deferTask` / `setReminder` — keys no declaration could
  address. A `modal` action has no server dispatch (`headlessActionTypeError`
  rejects it over REST), so neither handler had ever executed: the example
  shipped business logic that could not run, and ADR-0110 D5's boot inventory
  flagged both on its first pass.

  Both already declared the `params` their handlers read, so they were always
  "collect input, then run server-side" actions — which is `type: 'script'` with
  `params`. The runner collects the same dialog and the handler now actually runs.

  The action-type table in `content/docs/ui/actions.mdx` said `modal` meant
  "collect input, then submit to a handler", contradicting the same page's own
  REST table (`modal` → 400, nothing for the server to run). Corrected.

- Updated dependencies [bc35e00]
- Updated dependencies [6a67d7a]
- Updated dependencies [6e141bc]
- Updated dependencies [48fcf70]
- Updated dependencies [0ecc656]
- Updated dependencies [a4e2684]
- Updated dependencies [06772eb]
- Updated dependencies [0c90ece]
- Updated dependencies [195ad76]
- Updated dependencies [c2bbd97]
- Updated dependencies [3ec8186]
- Updated dependencies [698cbc2]
- Updated dependencies [b1863a5]
- Updated dependencies [270650f]
- Updated dependencies [956e7f9]
- Updated dependencies [3aef718]
- Updated dependencies [ffb003c]
- Updated dependencies [1ea6bce]
- Updated dependencies [c1dcacd]
- Updated dependencies [ad303ed]
- Updated dependencies [32ccb23]
- Updated dependencies [f5a4ef0]
- Updated dependencies [2d3e255]
- Updated dependencies [7d7521f]
- Updated dependencies [5dc4d02]
- Updated dependencies [6fa1827]
- Updated dependencies [05154a1]
- Updated dependencies [0f12193]
- Updated dependencies [9b6fe7c]
- Updated dependencies [8c711fb]
- Updated dependencies [09e4547]
- Updated dependencies [91f4c78]
- Updated dependencies [820eff9]
- Updated dependencies [8d895ff]
- Updated dependencies [f6472d7]
- Updated dependencies [78caf51]
- Updated dependencies [62a789b]
- Updated dependencies [789ad63]
- Updated dependencies [2af1988]
- Updated dependencies [0af50a3]
- Updated dependencies [fce14ab]
- Updated dependencies [2e836de]
- Updated dependencies [7309c81]
- Updated dependencies [cbc08eb]
- Updated dependencies [0c4f5b2]
- Updated dependencies [12a19a8]
- Updated dependencies [41dcda3]
- Updated dependencies [a225ef5]
- Updated dependencies [c9d254a]
- Updated dependencies [c8124e5]
- Updated dependencies [c3bcb42]
- Updated dependencies [a1a4140]
- Updated dependencies [c20b875]
- Updated dependencies [217e2e6]
- Updated dependencies [0373d52]
- Updated dependencies [4f30943]
- Updated dependencies [86a71d1]
- Updated dependencies [d5c75e2]
- Updated dependencies [03d26f7]
- Updated dependencies [bb192c4]
- Updated dependencies [98e7cc7]
- Updated dependencies [4cf7c61]
- Updated dependencies [9881074]
- Updated dependencies [4384921]
- Updated dependencies [3c628ce]
- Updated dependencies [347f460]
- Updated dependencies [8a341a4]
- Updated dependencies [7cb922e]
- Updated dependencies [1d22114]
- Updated dependencies [b5f9397]
- Updated dependencies [ed77493]
- Updated dependencies [58a03d2]
- Updated dependencies [c39d713]
- Updated dependencies [dc530b4]
- Updated dependencies [e59786e]
- Updated dependencies [bcf1112]
- Updated dependencies [9774b78]
- Updated dependencies [385c4b0]
- Updated dependencies [b07d829]
- Updated dependencies [a648e96]
- Updated dependencies [a47ac06]
- Updated dependencies [e4c61a7]
- Updated dependencies [cc60165]
- Updated dependencies [081aa6f]
- Updated dependencies [91f4c78]
- Updated dependencies [e8d0c21]
- Updated dependencies [45dc446]
- Updated dependencies [c1d44f7]
- Updated dependencies [ab9fb5c]
- Updated dependencies [f985b3f]
- Updated dependencies [10575f3]
- Updated dependencies [9a4932a]
- Updated dependencies [f9fc874]
- Updated dependencies [011b386]
- Updated dependencies [9881074]
- Updated dependencies [7777e8f]
- Updated dependencies [507b92a]
- Updated dependencies [99b4392]
- Updated dependencies [7309c81]
- Updated dependencies [20bc1ec]
- Updated dependencies [ac6c0be]
- Updated dependencies [90c2b15]
- Updated dependencies [33a5ff4]
- Updated dependencies [39eb01b]
- Updated dependencies [42eeb7d]
- Updated dependencies [01e124d]
- Updated dependencies [55bbefc]
- Updated dependencies [7ce02eb]
- Updated dependencies [a13827e]
- Updated dependencies [7733604]
- Updated dependencies [40e420f]
- Updated dependencies [d13004a]
- Updated dependencies [be7360c]
- Updated dependencies [cc2de0e]
- Updated dependencies [5b47ab5]
- Updated dependencies [b09d8d9]
- Updated dependencies [b09d8d9]
- Updated dependencies [8675db6]
- Updated dependencies [b09d8d9]
- Updated dependencies [3eb1b2b]
- Updated dependencies [59b85c0]
- Updated dependencies [6e357ed]
- Updated dependencies [d6938bf]
- Updated dependencies [31e0be9]
- Updated dependencies [4bfd455]
- Updated dependencies [ffd2ce2]
- Updated dependencies [62f8017]
- Updated dependencies [a831df1]
- Updated dependencies [f752ee3]
- Updated dependencies [a1b61e0]
- Updated dependencies [cd6b9f2]
- Updated dependencies [2cb6d3c]
- Updated dependencies [3ba8d77]
- Updated dependencies [af2a095]
- Updated dependencies [bf478e1]
- Updated dependencies [ec796d5]
- Updated dependencies [77fadbf]
- Updated dependencies [a3cb9c8]
- Updated dependencies [e87fea1]
- Updated dependencies [4be9d99]
- Updated dependencies [c65e529]
- Updated dependencies [8dcc0f5]
- Updated dependencies [5b08389]
- Updated dependencies [3ca34c1]
- Updated dependencies [239c3a3]
- Updated dependencies [94a0bbc]
- Updated dependencies [d6bfb3d]
- Updated dependencies [a2266a6]
- Updated dependencies [d25a0ec]
- Updated dependencies [5c13368]
- Updated dependencies [1d5dc46]
- Updated dependencies [667b83e]
- Updated dependencies [627b188]
- Updated dependencies [8d4eae7]
- Updated dependencies [857a6cf]
- Updated dependencies [1e38158]
- Updated dependencies [65a3a84]
- Updated dependencies [de6daa5]
- Updated dependencies [ccd9397]
- Updated dependencies [bca935b]
- Updated dependencies [d92c72d]
- Updated dependencies [c54c822]
- Updated dependencies [8dcc0f5]
- Updated dependencies [75b9e51]
- Updated dependencies [0a2f233]
- Updated dependencies [8621cdd]
- Updated dependencies [c53aa53]
- Updated dependencies [6f23667]
- Updated dependencies [77a77fd]
- Updated dependencies [d82f8c0]
- Updated dependencies [5d21a48]
- Updated dependencies [19365b7]
- Updated dependencies [b7ed26d]
- Updated dependencies [2053714]
- Updated dependencies [b3a3d83]
- Updated dependencies [7a55913]
- Updated dependencies [35accbf]
- Updated dependencies [6038de7]
- Updated dependencies [7309c81]
- Updated dependencies [eb95d97]
- Updated dependencies [e4c2dc8]
- Updated dependencies [43fc039]
- Updated dependencies [1bd2795]
- Updated dependencies [8186a70]
- Updated dependencies [a329cca]
- Updated dependencies [6eec18c]
- Updated dependencies [4d7bebf]
- Updated dependencies [821ac7a]
- Updated dependencies [8f81731]
- Updated dependencies [8b50cb3]
- Updated dependencies [8c2db68]
- Updated dependencies [22b5e54]
- Updated dependencies [0166bd5]
- Updated dependencies [9b702dc]
- Updated dependencies [ab16331]
  - @objectstack/runtime@17.0.0-rc.1
  - @objectstack/spec@17.0.0-rc.1
  - @objectstack/objectql@17.0.0-rc.1
  - @objectstack/client@17.0.0-rc.1
  - @objectstack/metadata@17.0.0-rc.1
  - @objectstack/driver-sqlite-wasm@17.0.0-rc.1
  - @objectstack/knowledge-memory@17.0.0-rc.1
  - @objectstack/mcp@17.0.0-rc.1
  - @objectstack/service-knowledge@17.0.0-rc.1

## 4.0.92-rc.0

### Patch Changes

- Updated dependencies [50616d9]
- Updated dependencies [08b5a3d]
- Updated dependencies [d99aeb3]
- Updated dependencies [4727eb8]
- Updated dependencies [f63cd09]
- Updated dependencies [6169615]
- Updated dependencies [fa3d0cf]
- Updated dependencies [af5a224]
- Updated dependencies [71f76e1]
- Updated dependencies [37b1346]
- Updated dependencies [a749273]
- Updated dependencies [99736a0]
- Updated dependencies [fe67e34]
- Updated dependencies [fdb4f50]
- Updated dependencies [1bd5652]
- Updated dependencies [14252d3]
- Updated dependencies [7fb436c]
- Updated dependencies [879ea13]
- Updated dependencies [201b31f]
- Updated dependencies [e2616e0]
- Updated dependencies [6fdc5c6]
- Updated dependencies [8b9d71e]
- Updated dependencies [33f5e23]
- Updated dependencies [259af21]
- Updated dependencies [6877e9a]
- Updated dependencies [0bab8bb]
- Updated dependencies [840ee4b]
- Updated dependencies [587fc91]
- Updated dependencies [1986594]
- Updated dependencies [3c8cfd1]
- Updated dependencies [ad4af62]
- Updated dependencies [d44dbfa]
- Updated dependencies [474fe39]
- Updated dependencies [0bc685a]
- Updated dependencies [b949059]
- Updated dependencies [be1c52c]
- Updated dependencies [c5ff96d]
- Updated dependencies [84e7be9]
- Updated dependencies [a6c3f38]
- Updated dependencies [debc23a]
- Updated dependencies [0f8ad09]
- Updated dependencies [984396b]
- Updated dependencies [8f9689f]
- Updated dependencies [0cdb57a]
- Updated dependencies [57a3bb3]
- Updated dependencies [5f9a987]
- Updated dependencies [9f060e5]
- Updated dependencies [db02d47]
- Updated dependencies [d3f2ff6]
- Updated dependencies [b7550d6]
- Updated dependencies [0164f40]
- Updated dependencies [e295ad1]
- Updated dependencies [1b717e5]
- Updated dependencies [1003125]
- Updated dependencies [6e62a93]
- Updated dependencies [ecda20c]
- Updated dependencies [6e62a93]
- Updated dependencies [fc968af]
- Updated dependencies [0bfdf46]
- Updated dependencies [48c110e]
- Updated dependencies [87aca93]
- Updated dependencies [376a061]
- Updated dependencies [19e3e6e]
- Updated dependencies [7c7e246]
- Updated dependencies [f35cdc5]
- Updated dependencies [cbedd62]
- Updated dependencies [9ea2bc5]
- Updated dependencies [32d3800]
- Updated dependencies [094fa34]
- Updated dependencies [5e55739]
- Updated dependencies [c2d9098]
- Updated dependencies [a227ed7]
- Updated dependencies [9613396]
- Updated dependencies [e47b342]
- Updated dependencies [4ed7ed4]
- Updated dependencies [2fa4ca1]
- Updated dependencies [f5a2320]
- Updated dependencies [deb538f]
- Updated dependencies [5b89711]
- Updated dependencies [0c8a22f]
- Updated dependencies [763931e]
- Updated dependencies [de9af8a]
- Updated dependencies [c4df271]
- Updated dependencies [a41ba5c]
- Updated dependencies [189854c]
- Updated dependencies [5d4de37]
- Updated dependencies [0e3a226]
- Updated dependencies [1d4756e]
- Updated dependencies [720c5ad]
- Updated dependencies [a8d1e24]
- Updated dependencies [41642b0]
- Updated dependencies [4cca74c]
- Updated dependencies [88ef03e]
- Updated dependencies [9e2caf3]
- Updated dependencies [81ce41a]
- Updated dependencies [85e1e4e]
- Updated dependencies [dac6a08]
- Updated dependencies [394b7a1]
- Updated dependencies [677b591]
- Updated dependencies [d77d1b7]
- Updated dependencies [5b79a34]
- Updated dependencies [c757854]
- Updated dependencies [e1fa8d5]
- Updated dependencies [402f534]
- Updated dependencies [0045682]
- Updated dependencies [7180ed5]
- Updated dependencies [083c414]
- Updated dependencies [2a5f04a]
- Updated dependencies [4f740b0]
- Updated dependencies [030125b]
- Updated dependencies [4e9e184]
- Updated dependencies [67452d1]
- Updated dependencies [0fc6219]
- Updated dependencies [605e190]
- Updated dependencies [c6c59f1]
- Updated dependencies [b0e78a8]
- Updated dependencies [f31cc8d]
- Updated dependencies [f343dc4]
- Updated dependencies [8269e32]
- Updated dependencies [74f7339]
- Updated dependencies [a6c35a2]
- Updated dependencies [c2f1002]
- Updated dependencies [8e08bc3]
- Updated dependencies [16adb3c]
- Updated dependencies [f163028]
- Updated dependencies [f07808c]
- Updated dependencies [7ffc3d3]
- Updated dependencies [a137bbc]
- Updated dependencies [88346ba]
- Updated dependencies [4631592]
- Updated dependencies [32ff033]
- Updated dependencies [5ac93d4]
- Updated dependencies [3d5f726]
- Updated dependencies [70a1ce1]
- Updated dependencies [93f267f]
- Updated dependencies [0024abf]
- Updated dependencies [acbf364]
- Updated dependencies [f1a8114]
- Updated dependencies [48d5a1c]
- Updated dependencies [3216344]
- Updated dependencies [f5bfac8]
- Updated dependencies [6163393]
- Updated dependencies [688e9df]
- Updated dependencies [8f124a7]
- Updated dependencies [21ca1d5]
- Updated dependencies [03b11e8]
- Updated dependencies [8891f93]
- Updated dependencies [d729a31]
- Updated dependencies [cb8322e]
- Updated dependencies [7687f7b]
- Updated dependencies [1659072]
- Updated dependencies [810a3a2]
- Updated dependencies [abceb0d]
- Updated dependencies [9981c1d]
- Updated dependencies [d60968c]
- Updated dependencies [0c302a7]
- Updated dependencies [6633337]
- Updated dependencies [f00d8d4]
- Updated dependencies [503be86]
- Updated dependencies [5f0852f]
- Updated dependencies [cde1975]
- Updated dependencies [20cb232]
- Updated dependencies [e231abb]
- Updated dependencies [0bc685a]
- Updated dependencies [11949fc]
- Updated dependencies [b098b0e]
- Updated dependencies [4d00b13]
- Updated dependencies [57bab76]
- Updated dependencies [b90086a]
- Updated dependencies [b95577a]
- Updated dependencies [54f479a]
- Updated dependencies [83c161f]
- Updated dependencies [d8c4957]
- Updated dependencies [f24cb83]
- Updated dependencies [5dbbb92]
- Updated dependencies [69f1dfd]
  - @objectstack/spec@17.0.0-rc.0
  - @objectstack/objectql@17.0.0-rc.0
  - @objectstack/runtime@17.0.0-rc.0
  - @objectstack/client@17.0.0-rc.0
  - @objectstack/mcp@17.0.0-rc.0
  - @objectstack/metadata@17.0.0-rc.0
  - @objectstack/driver-sqlite-wasm@17.0.0-rc.0
  - @objectstack/knowledge-memory@17.0.0-rc.0
  - @objectstack/service-knowledge@17.0.0-rc.0

## 4.0.91

### Patch Changes

- Updated dependencies [9e45b63]
- Updated dependencies [818e6a3]
  - @objectstack/spec@16.1.0
  - @objectstack/runtime@16.1.0
  - @objectstack/metadata@16.1.0
  - @objectstack/client@16.1.0
  - @objectstack/mcp@16.1.0
  - @objectstack/objectql@16.1.0
  - @objectstack/driver-sqlite-wasm@16.1.0
  - @objectstack/knowledge-memory@16.1.0
  - @objectstack/service-knowledge@16.1.0

## 4.0.90

### Patch Changes

- Updated dependencies [b39c65d]
- Updated dependencies [f972574]
- Updated dependencies [6289ec3]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [8efa395]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [e057f42]
- Updated dependencies [9ccd1e9]
- Updated dependencies [a3823b2]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [fdc244e]
- Updated dependencies [bfa3c3f]
- Updated dependencies [5e3301d]
- Updated dependencies [46e876c]
- Updated dependencies [2ea08ee]
- Updated dependencies [d1d1c40]
- Updated dependencies [ee0a499]
- Updated dependencies [158aa14]
- Updated dependencies [62a2117]
- Updated dependencies [15dbe18]
- Updated dependencies [83e8f7d]
- Updated dependencies [230358c]
- Updated dependencies [d2723e2]
- Updated dependencies [674457a]
- Updated dependencies [fefcd54]
- Updated dependencies [2049b6a]
- Updated dependencies [beaf2de]
- Updated dependencies [369eb6e]
- Updated dependencies [06ff734]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
- Updated dependencies [668dd17]
- Updated dependencies [8abf133]
- Updated dependencies [e0859b1]
- Updated dependencies [92f5f19]
- Updated dependencies [a2d6555]
- Updated dependencies [3a6310c]
- Updated dependencies [32899e6]
- Updated dependencies [515f11a]
- Updated dependencies [4174a07]
- Updated dependencies [ce468c8]
- Updated dependencies [04ecd4e]
- Updated dependencies [4d5a892]
- Updated dependencies [16cebeb]
- Updated dependencies [86d30af]
- Updated dependencies [8923843]
- Updated dependencies [a2795f6]
- Updated dependencies [f16b492]
- Updated dependencies [4b6fde8]
- Updated dependencies [2018df9]
- Updated dependencies [fc5a3a2]
- Updated dependencies [8ff9210]
  - @objectstack/runtime@16.0.0
  - @objectstack/spec@16.0.0
  - @objectstack/objectql@16.0.0
  - @objectstack/client@16.0.0
  - @objectstack/metadata@16.0.0
  - @objectstack/mcp@16.0.0
  - @objectstack/driver-sqlite-wasm@16.0.0
  - @objectstack/knowledge-memory@16.0.0
  - @objectstack/service-knowledge@16.0.0

## 4.0.90-rc.1

### Patch Changes

- Updated dependencies [6289ec3]
- Updated dependencies [8efa395]
- Updated dependencies [bfa3c3f]
- Updated dependencies [ee0a499]
- Updated dependencies [62a2117]
- Updated dependencies [674457a]
- Updated dependencies [06ff734]
  - @objectstack/spec@16.0.0-rc.1
  - @objectstack/client@16.0.0-rc.1
  - @objectstack/runtime@16.0.0-rc.1
  - @objectstack/objectql@16.0.0-rc.1
  - @objectstack/mcp@16.0.0-rc.1
  - @objectstack/metadata@16.0.0-rc.1
  - @objectstack/driver-sqlite-wasm@16.0.0-rc.1
  - @objectstack/knowledge-memory@16.0.0-rc.1
  - @objectstack/service-knowledge@16.0.0-rc.1

## 4.0.90-rc.0

### Patch Changes

- Updated dependencies [b39c65d]
- Updated dependencies [f972574]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [e057f42]
- Updated dependencies [9ccd1e9]
- Updated dependencies [a3823b2]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [fdc244e]
- Updated dependencies [5e3301d]
- Updated dependencies [46e876c]
- Updated dependencies [2ea08ee]
- Updated dependencies [d1d1c40]
- Updated dependencies [158aa14]
- Updated dependencies [15dbe18]
- Updated dependencies [83e8f7d]
- Updated dependencies [230358c]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [2049b6a]
- Updated dependencies [beaf2de]
- Updated dependencies [369eb6e]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
- Updated dependencies [668dd17]
- Updated dependencies [8abf133]
- Updated dependencies [e0859b1]
- Updated dependencies [92f5f19]
- Updated dependencies [a2d6555]
- Updated dependencies [3a6310c]
- Updated dependencies [32899e6]
- Updated dependencies [515f11a]
- Updated dependencies [4174a07]
- Updated dependencies [ce468c8]
- Updated dependencies [04ecd4e]
- Updated dependencies [4d5a892]
- Updated dependencies [16cebeb]
- Updated dependencies [86d30af]
- Updated dependencies [8923843]
- Updated dependencies [a2795f6]
- Updated dependencies [f16b492]
- Updated dependencies [4b6fde8]
- Updated dependencies [2018df9]
- Updated dependencies [fc5a3a2]
  - @objectstack/runtime@16.0.0-rc.0
  - @objectstack/spec@16.0.0-rc.0
  - @objectstack/objectql@16.0.0-rc.0
  - @objectstack/client@16.0.0-rc.0
  - @objectstack/metadata@16.0.0-rc.0
  - @objectstack/mcp@16.0.0-rc.0
  - @objectstack/driver-sqlite-wasm@16.0.0-rc.0
  - @objectstack/knowledge-memory@16.0.0-rc.0
  - @objectstack/service-knowledge@16.0.0-rc.0

## 4.0.89

### Patch Changes

- @objectstack/runtime@15.1.1
- @objectstack/client@15.1.1
- @objectstack/spec@15.1.1
- @objectstack/metadata@15.1.1
- @objectstack/objectql@15.1.1
- @objectstack/driver-sqlite-wasm@15.1.1
- @objectstack/mcp@15.1.1
- @objectstack/service-knowledge@15.1.1
- @objectstack/knowledge-memory@15.1.1

## 4.0.88

### Patch Changes

- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [3fe9df1]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [4109153]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [627f225]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [d75c7ac]
- Updated dependencies [f531a26]
  - @objectstack/spec@15.1.0
  - @objectstack/runtime@15.1.0
  - @objectstack/objectql@15.1.0
  - @objectstack/mcp@15.1.0
  - @objectstack/service-knowledge@15.1.0
  - @objectstack/client@15.1.0
  - @objectstack/metadata@15.1.0
  - @objectstack/driver-sqlite-wasm@15.1.0
  - @objectstack/knowledge-memory@15.1.0

## 4.0.87

### Patch Changes

- Updated dependencies [28b7c28]
- Updated dependencies [13749ec]
- Updated dependencies [e62c233]
- Updated dependencies [ed61c9b]
- Updated dependencies [31d04d4]
  - @objectstack/spec@15.0.0
  - @objectstack/runtime@15.0.0
  - @objectstack/objectql@15.0.0
  - @objectstack/metadata@15.0.0
  - @objectstack/client@15.0.0
  - @objectstack/mcp@15.0.0
  - @objectstack/driver-sqlite-wasm@15.0.0
  - @objectstack/knowledge-memory@15.0.0
  - @objectstack/service-knowledge@15.0.0

## 4.0.86

### Patch Changes

- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [607aaf4]
- Updated dependencies [e46169c]
- Updated dependencies [bb71321]
- Updated dependencies [a199626]
  - @objectstack/spec@14.8.0
  - @objectstack/client@14.8.0
  - @objectstack/driver-sqlite-wasm@14.8.0
  - @objectstack/mcp@14.8.0
  - @objectstack/metadata@14.8.0
  - @objectstack/objectql@14.8.0
  - @objectstack/knowledge-memory@14.8.0
  - @objectstack/runtime@14.8.0
  - @objectstack/service-knowledge@14.8.0

## 4.0.85

### Patch Changes

- Updated dependencies [d6a72eb]
  - @objectstack/spec@14.7.0
  - @objectstack/client@14.7.0
  - @objectstack/mcp@14.7.0
  - @objectstack/metadata@14.7.0
  - @objectstack/objectql@14.7.0
  - @objectstack/driver-sqlite-wasm@14.7.0
  - @objectstack/knowledge-memory@14.7.0
  - @objectstack/runtime@14.7.0
  - @objectstack/service-knowledge@14.7.0

## 4.0.84

### Patch Changes

- Updated dependencies [609cb13]
- Updated dependencies [e4cf774]
- Updated dependencies [ce6d151]
- Updated dependencies [8f4a261]
  - @objectstack/spec@14.6.0
  - @objectstack/client@14.6.0
  - @objectstack/objectql@14.6.0
  - @objectstack/mcp@14.6.0
  - @objectstack/metadata@14.6.0
  - @objectstack/driver-sqlite-wasm@14.6.0
  - @objectstack/knowledge-memory@14.6.0
  - @objectstack/runtime@14.6.0
  - @objectstack/service-knowledge@14.6.0

## 4.0.83

### Patch Changes

- Updated dependencies [526805e]
- Updated dependencies [e8cedec]
- Updated dependencies [5f43f88]
- Updated dependencies [261aff5]
- Updated dependencies [d79ca07]
- Updated dependencies [33ebd34]
- Updated dependencies [c044f08]
- Updated dependencies [01274eb]
  - @objectstack/spec@14.5.0
  - @objectstack/mcp@14.5.0
  - @objectstack/runtime@14.5.0
  - @objectstack/objectql@14.5.0
  - @objectstack/client@14.5.0
  - @objectstack/metadata@14.5.0
  - @objectstack/driver-sqlite-wasm@14.5.0
  - @objectstack/knowledge-memory@14.5.0
  - @objectstack/service-knowledge@14.5.0

## 4.0.82

### Patch Changes

- Updated dependencies [7953832]
- Updated dependencies [82e745e]
- Updated dependencies [f3035bd]
- Updated dependencies [82c0d94]
- Updated dependencies [7449476]
  - @objectstack/spec@14.4.0
  - @objectstack/objectql@14.4.0
  - @objectstack/driver-sqlite-wasm@14.4.0
  - @objectstack/client@14.4.0
  - @objectstack/mcp@14.4.0
  - @objectstack/metadata@14.4.0
  - @objectstack/knowledge-memory@14.4.0
  - @objectstack/runtime@14.4.0
  - @objectstack/service-knowledge@14.4.0

## 4.0.81

### Patch Changes

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [ff648ad]
- Updated dependencies [c1064f1]
  - @objectstack/spec@14.3.0
  - @objectstack/metadata@14.3.0
  - @objectstack/objectql@14.3.0
  - @objectstack/runtime@14.3.0
  - @objectstack/client@14.3.0
  - @objectstack/mcp@14.3.0
  - @objectstack/driver-sqlite-wasm@14.3.0
  - @objectstack/knowledge-memory@14.3.0
  - @objectstack/service-knowledge@14.3.0

## 4.0.80

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/spec@14.2.0
  - @objectstack/client@14.2.0
  - @objectstack/runtime@14.2.0
  - @objectstack/mcp@14.2.0
  - @objectstack/metadata@14.2.0
  - @objectstack/objectql@14.2.0
  - @objectstack/driver-sqlite-wasm@14.2.0
  - @objectstack/knowledge-memory@14.2.0
  - @objectstack/service-knowledge@14.2.0

## 4.0.79

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0
  - @objectstack/client@14.1.0
  - @objectstack/mcp@14.1.0
  - @objectstack/metadata@14.1.0
  - @objectstack/objectql@14.1.0
  - @objectstack/driver-sqlite-wasm@14.1.0
  - @objectstack/knowledge-memory@14.1.0
  - @objectstack/runtime@14.1.0
  - @objectstack/service-knowledge@14.1.0

## 4.0.78

### Patch Changes

- Updated dependencies [57b8fe0]
- Updated dependencies [0a8e685]
- Updated dependencies [afa8115]
- Updated dependencies [80f12ca]
- Updated dependencies [332b711]
- Updated dependencies [e2fa074]
- Updated dependencies [23c8668]
- Updated dependencies [29f017d]
- Updated dependencies [bc26360]
- Updated dependencies [afa8115]
- Updated dependencies [216fa9a]
- Updated dependencies [6c22b12]
- Updated dependencies [bd39dc5]
  - @objectstack/runtime@14.0.0
  - @objectstack/spec@14.0.0
  - @objectstack/mcp@14.0.0
  - @objectstack/objectql@14.0.0
  - @objectstack/client@14.0.0
  - @objectstack/metadata@14.0.0
  - @objectstack/driver-sqlite-wasm@14.0.0
  - @objectstack/knowledge-memory@14.0.0
  - @objectstack/service-knowledge@14.0.0

## 4.0.77

### Patch Changes

- Updated dependencies [6d83431]
- Updated dependencies [01917c2]
- Updated dependencies [b271691]
- Updated dependencies [a5a1e41]
- Updated dependencies [466adf6]
- Updated dependencies [57b89b4]
- Updated dependencies [5be00c3]
- Updated dependencies [466adf6]
- Updated dependencies [a1766fe]
- Updated dependencies [2bee609]
- Updated dependencies [e097576]
- Updated dependencies [148beb4]
- Updated dependencies [fc7e7f7]
  - @objectstack/spec@13.0.0
  - @objectstack/runtime@13.0.0
  - @objectstack/objectql@13.0.0
  - @objectstack/metadata@13.0.0
  - @objectstack/mcp@13.0.0
  - @objectstack/client@13.0.0
  - @objectstack/driver-sqlite-wasm@13.0.0
  - @objectstack/knowledge-memory@13.0.0
  - @objectstack/service-knowledge@13.0.0

## 4.0.76

### Patch Changes

- Updated dependencies [6cebf22]
- Updated dependencies [b5a87eb]
  - @objectstack/spec@12.6.0
  - @objectstack/runtime@12.6.0
  - @objectstack/client@12.6.0
  - @objectstack/mcp@12.6.0
  - @objectstack/metadata@12.6.0
  - @objectstack/objectql@12.6.0
  - @objectstack/driver-sqlite-wasm@12.6.0
  - @objectstack/knowledge-memory@12.6.0
  - @objectstack/service-knowledge@12.6.0

## 4.0.75

### Patch Changes

- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0
  - @objectstack/objectql@12.5.0
  - @objectstack/client@12.5.0
  - @objectstack/mcp@12.5.0
  - @objectstack/metadata@12.5.0
  - @objectstack/driver-sqlite-wasm@12.5.0
  - @objectstack/knowledge-memory@12.5.0
  - @objectstack/runtime@12.5.0
  - @objectstack/service-knowledge@12.5.0

## 4.0.74

### Patch Changes

- Updated dependencies [60dc3ba]
- Updated dependencies [1dd5dfd]
  - @objectstack/spec@12.4.0
  - @objectstack/objectql@12.4.0
  - @objectstack/runtime@12.4.0
  - @objectstack/client@12.4.0
  - @objectstack/mcp@12.4.0
  - @objectstack/metadata@12.4.0
  - @objectstack/driver-sqlite-wasm@12.4.0
  - @objectstack/knowledge-memory@12.4.0
  - @objectstack/service-knowledge@12.4.0

## 4.0.73

### Patch Changes

- Updated dependencies [5a0da03]
- Updated dependencies [e7eceec]
  - @objectstack/objectql@12.3.0
  - @objectstack/spec@12.3.0
  - @objectstack/client@12.3.0
  - @objectstack/runtime@12.3.0
  - @objectstack/mcp@12.3.0
  - @objectstack/metadata@12.3.0
  - @objectstack/driver-sqlite-wasm@12.3.0
  - @objectstack/knowledge-memory@12.3.0
  - @objectstack/service-knowledge@12.3.0

## 4.0.72

### Patch Changes

- Updated dependencies [fce8ff4]
- Updated dependencies [3962023]
- Updated dependencies [2bb193d]
- Updated dependencies [0426d27]
- Updated dependencies [da807f7]
- Updated dependencies [4f5b791]
  - @objectstack/spec@12.2.0
  - @objectstack/objectql@12.2.0
  - @objectstack/runtime@12.2.0
  - @objectstack/client@12.2.0
  - @objectstack/mcp@12.2.0
  - @objectstack/metadata@12.2.0
  - @objectstack/driver-sqlite-wasm@12.2.0
  - @objectstack/knowledge-memory@12.2.0
  - @objectstack/service-knowledge@12.2.0

## 4.0.71

### Patch Changes

- Updated dependencies [497bda8]
- Updated dependencies [93e6d02]
  - @objectstack/runtime@12.1.0
  - @objectstack/spec@12.1.0
  - @objectstack/client@12.1.0
  - @objectstack/mcp@12.1.0
  - @objectstack/metadata@12.1.0
  - @objectstack/objectql@12.1.0
  - @objectstack/driver-sqlite-wasm@12.1.0
  - @objectstack/knowledge-memory@12.1.0
  - @objectstack/service-knowledge@12.1.0

## 4.0.70

### Patch Changes

- Updated dependencies [a8df396]
- Updated dependencies [e695fe0]
- Updated dependencies [9693a36]
- Updated dependencies [7c09621]
- Updated dependencies [2d567cb]
- Updated dependencies [e3498fb]
- Updated dependencies [24b62ee]
- Updated dependencies [7709db4]
- Updated dependencies [2082109]
- Updated dependencies [7c09621]
- Updated dependencies [c2fdbf9]
- Updated dependencies [9860de4]
- Updated dependencies [069c205]
  - @objectstack/spec@12.0.0
  - @objectstack/runtime@12.0.0
  - @objectstack/objectql@12.0.0
  - @objectstack/metadata@12.0.0
  - @objectstack/client@12.0.0
  - @objectstack/mcp@12.0.0
  - @objectstack/driver-sqlite-wasm@12.0.0
  - @objectstack/knowledge-memory@12.0.0
  - @objectstack/service-knowledge@12.0.0

## 4.0.69

### Patch Changes

- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/spec@11.10.0
  - @objectstack/client@11.10.0
  - @objectstack/mcp@11.10.0
  - @objectstack/metadata@11.10.0
  - @objectstack/objectql@11.10.0
  - @objectstack/driver-sqlite-wasm@11.10.0
  - @objectstack/knowledge-memory@11.10.0
  - @objectstack/runtime@11.10.0
  - @objectstack/service-knowledge@11.10.0

## 4.0.68

### Patch Changes

- Updated dependencies [852bc8e]
- Updated dependencies [d3595d9]
  - @objectstack/runtime@11.9.0
  - @objectstack/spec@11.9.0
  - @objectstack/client@11.9.0
  - @objectstack/mcp@11.9.0
  - @objectstack/metadata@11.9.0
  - @objectstack/objectql@11.9.0
  - @objectstack/driver-sqlite-wasm@11.9.0
  - @objectstack/knowledge-memory@11.9.0
  - @objectstack/service-knowledge@11.9.0

## 4.0.67

### Patch Changes

- @objectstack/metadata@11.8.0
- @objectstack/runtime@11.8.0
- @objectstack/client@11.8.0
- @objectstack/spec@11.8.0
- @objectstack/objectql@11.8.0
- @objectstack/driver-sqlite-wasm@11.8.0
- @objectstack/mcp@11.8.0
- @objectstack/service-knowledge@11.8.0
- @objectstack/knowledge-memory@11.8.0

## 4.0.66

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0
  - @objectstack/client@11.7.0
  - @objectstack/mcp@11.7.0
  - @objectstack/metadata@11.7.0
  - @objectstack/objectql@11.7.0
  - @objectstack/driver-sqlite-wasm@11.7.0
  - @objectstack/knowledge-memory@11.7.0
  - @objectstack/runtime@11.7.0
  - @objectstack/service-knowledge@11.7.0

## 4.0.65

### Patch Changes

- @objectstack/spec@11.6.0
- @objectstack/client@11.6.0
- @objectstack/metadata@11.6.0
- @objectstack/objectql@11.6.0
- @objectstack/runtime@11.6.0
- @objectstack/driver-sqlite-wasm@11.6.0
- @objectstack/mcp@11.6.0
- @objectstack/service-knowledge@11.6.0
- @objectstack/knowledge-memory@11.6.0

## 4.0.64

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/client@11.5.0
  - @objectstack/mcp@11.5.0
  - @objectstack/metadata@11.5.0
  - @objectstack/objectql@11.5.0
  - @objectstack/driver-sqlite-wasm@11.5.0
  - @objectstack/knowledge-memory@11.5.0
  - @objectstack/runtime@11.5.0
  - @objectstack/service-knowledge@11.5.0

## 4.0.63

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/client@11.4.0
  - @objectstack/mcp@11.4.0
  - @objectstack/metadata@11.4.0
  - @objectstack/objectql@11.4.0
  - @objectstack/driver-sqlite-wasm@11.4.0
  - @objectstack/knowledge-memory@11.4.0
  - @objectstack/runtime@11.4.0
  - @objectstack/service-knowledge@11.4.0

## 4.0.62

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0
  - @objectstack/client@11.3.0
  - @objectstack/mcp@11.3.0
  - @objectstack/metadata@11.3.0
  - @objectstack/objectql@11.3.0
  - @objectstack/driver-sqlite-wasm@11.3.0
  - @objectstack/knowledge-memory@11.3.0
  - @objectstack/runtime@11.3.0
  - @objectstack/service-knowledge@11.3.0

## 4.0.61

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0
  - @objectstack/client@11.2.0
  - @objectstack/mcp@11.2.0
  - @objectstack/metadata@11.2.0
  - @objectstack/objectql@11.2.0
  - @objectstack/driver-sqlite-wasm@11.2.0
  - @objectstack/knowledge-memory@11.2.0
  - @objectstack/runtime@11.2.0
  - @objectstack/service-knowledge@11.2.0

## 4.0.60

### Patch Changes

- Updated dependencies [e011d42]
- Updated dependencies [13dbcf2]
- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [fdb41c0]
- Updated dependencies [63d5403]
- Updated dependencies [7087cfe]
- Updated dependencies [69ae136]
  - @objectstack/runtime@11.1.0
  - @objectstack/objectql@11.1.0
  - @objectstack/spec@11.1.0
  - @objectstack/client@11.1.0
  - @objectstack/metadata@11.1.0
  - @objectstack/mcp@11.1.0
  - @objectstack/driver-sqlite-wasm@11.1.0
  - @objectstack/knowledge-memory@11.1.0
  - @objectstack/service-knowledge@11.1.0

## 4.0.59

### Patch Changes

- Updated dependencies [4d99a5c]
- Updated dependencies [ab5718a]
- Updated dependencies [61d441f]
- Updated dependencies [c224e18]
- Updated dependencies [d616e1d]
- Updated dependencies [4845c12]
- Updated dependencies [c1a754a]
- Updated dependencies [1b00ba2]
- Updated dependencies [6fbe91f]
- Updated dependencies [715d667]
- Updated dependencies [5eef4cf]
- Updated dependencies [4b5ec6e]
- Updated dependencies [72759e1]
- Updated dependencies [6c4fbd9]
- Updated dependencies [ef3ed67]
- Updated dependencies [359c0aa]
- Updated dependencies [cd51229]
- Updated dependencies [7697a0e]
- Updated dependencies [e7e04f1]
- Updated dependencies [cfd5ac4]
- Updated dependencies [2be5c1f]
- Updated dependencies [ad143ce]
- Updated dependencies [5c4a8c8]
- Updated dependencies [3afaeed]
- Updated dependencies [8801c02]
- Updated dependencies [3d04e06]
- Updated dependencies [4a84c98]
- Updated dependencies [aa33b02]
- Updated dependencies [d980f0d]
- Updated dependencies [a658523]
- Updated dependencies [82ff91c]
- Updated dependencies [638f472]
  - @objectstack/objectql@11.0.0
  - @objectstack/runtime@11.0.0
  - @objectstack/spec@11.0.0
  - @objectstack/client@11.0.0
  - @objectstack/metadata@11.0.0
  - @objectstack/mcp@11.0.0
  - @objectstack/driver-sqlite-wasm@11.0.0
  - @objectstack/knowledge-memory@11.0.0
  - @objectstack/service-knowledge@11.0.0

## 4.0.58

### Patch Changes

- Updated dependencies [211425e]
- Updated dependencies [8cf4f7c]
- Updated dependencies [f2063f3]
  - @objectstack/objectql@10.3.0
  - @objectstack/runtime@10.3.0
  - @objectstack/driver-sqlite-wasm@10.3.0
  - @objectstack/client@10.3.0
  - @objectstack/spec@10.3.0
  - @objectstack/metadata@10.3.0
  - @objectstack/service-ai@10.3.0
  - @objectstack/service-knowledge@10.3.0
  - @objectstack/knowledge-memory@10.3.0

## 4.0.57

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/client@10.2.0
  - @objectstack/metadata@10.2.0
  - @objectstack/objectql@10.2.0
  - @objectstack/driver-sqlite-wasm@10.2.0
  - @objectstack/knowledge-memory@10.2.0
  - @objectstack/runtime@10.2.0
  - @objectstack/service-ai@10.2.0
  - @objectstack/service-knowledge@10.2.0

## 4.0.56

### Patch Changes

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
- Updated dependencies [94d2161]
  - @objectstack/spec@10.1.0
  - @objectstack/runtime@10.1.0
  - @objectstack/client@10.1.0
  - @objectstack/metadata@10.1.0
  - @objectstack/objectql@10.1.0
  - @objectstack/driver-sqlite-wasm@10.1.0
  - @objectstack/knowledge-memory@10.1.0
  - @objectstack/service-ai@10.1.0
  - @objectstack/service-knowledge@10.1.0

## 4.0.55

### Patch Changes

- Updated dependencies [d7ff626]
- Updated dependencies [2a1b16b]
- Updated dependencies [e16f2a8]
- Updated dependencies [e411a82]
- Updated dependencies [a581385]
- Updated dependencies [47d978a]
- Updated dependencies [220ce5b]
- Updated dependencies [3efe334]
- Updated dependencies [feead7e]
- Updated dependencies [be07ce7]
- Updated dependencies [6ca20b3]
- Updated dependencies [5f875fe]
- Updated dependencies [b469950]
  - @objectstack/spec@10.0.0
  - @objectstack/objectql@10.0.0
  - @objectstack/runtime@10.0.0
  - @objectstack/service-ai@10.0.0
  - @objectstack/client@10.0.0
  - @objectstack/metadata@10.0.0
  - @objectstack/driver-sqlite-wasm@10.0.0
  - @objectstack/knowledge-memory@10.0.0
  - @objectstack/service-knowledge@10.0.0

## 4.0.54

### Patch Changes

- Updated dependencies [e7f6539]
- Updated dependencies [2365d07]
- Updated dependencies [6595b53]
- Updated dependencies [fa8964d]
- Updated dependencies [36138c7]
- Updated dependencies [a8e4f3b]
- Updated dependencies [4c213c2]
- Updated dependencies [2afb612]
  - @objectstack/spec@9.11.0
  - @objectstack/objectql@9.11.0
  - @objectstack/runtime@9.11.0
  - @objectstack/client@9.11.0
  - @objectstack/metadata@9.11.0
  - @objectstack/driver-sqlite-wasm@9.11.0
  - @objectstack/knowledge-memory@9.11.0
  - @objectstack/service-ai@9.11.0
  - @objectstack/service-knowledge@9.11.0

## 4.0.53

### Patch Changes

- Updated dependencies [db02bd5]
- Updated dependencies [641675d]
- Updated dependencies [94e9040]
- Updated dependencies [1f88fd9]
- Updated dependencies [1f88fd9]
- Updated dependencies [e2b5324]
- Updated dependencies [fd07027]
  - @objectstack/spec@9.10.0
  - @objectstack/objectql@9.10.0
  - @objectstack/runtime@9.10.0
  - @objectstack/driver-sqlite-wasm@9.10.0
  - @objectstack/client@9.10.0
  - @objectstack/metadata@9.10.0
  - @objectstack/knowledge-memory@9.10.0
  - @objectstack/service-ai@9.10.0
  - @objectstack/service-knowledge@9.10.0

## 4.0.52

### Patch Changes

- @objectstack/spec@9.9.1
- @objectstack/client@9.9.1
- @objectstack/metadata@9.9.1
- @objectstack/objectql@9.9.1
- @objectstack/runtime@9.9.1
- @objectstack/driver-sqlite-wasm@9.9.1
- @objectstack/service-ai@9.9.1
- @objectstack/service-knowledge@9.9.1
- @objectstack/knowledge-memory@9.9.1

## 4.0.51

### Patch Changes

- Updated dependencies [84249a4]
- Updated dependencies [44c5348]
- Updated dependencies [11af299]
- Updated dependencies [d5774b5]
- Updated dependencies [bfa3102]
- Updated dependencies [83fd318]
- Updated dependencies [134043a]
- Updated dependencies [67c29ee]
- Updated dependencies [90108e0]
- Updated dependencies [9afeb2d]
- Updated dependencies [6bec07e]
- Updated dependencies [601cc11]
- Updated dependencies [d99a75a]
- Updated dependencies [575448d]
  - @objectstack/spec@9.9.0
  - @objectstack/objectql@9.9.0
  - @objectstack/runtime@9.9.0
  - @objectstack/client@9.9.0
  - @objectstack/metadata@9.9.0
  - @objectstack/driver-sqlite-wasm@9.9.0
  - @objectstack/knowledge-memory@9.9.0
  - @objectstack/service-ai@9.9.0
  - @objectstack/service-knowledge@9.9.0

## 4.0.50

### Patch Changes

- Updated dependencies [76ac582]
- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
- Updated dependencies [884bf2f]
  - @objectstack/objectql@9.8.0
  - @objectstack/spec@9.8.0
  - @objectstack/runtime@9.8.0
  - @objectstack/service-ai@9.8.0
  - @objectstack/client@9.8.0
  - @objectstack/metadata@9.8.0
  - @objectstack/driver-sqlite-wasm@9.8.0
  - @objectstack/knowledge-memory@9.8.0
  - @objectstack/service-knowledge@9.8.0

## 4.0.49

### Patch Changes

- @objectstack/objectql@9.7.0
- @objectstack/runtime@9.7.0
- @objectstack/service-ai@9.7.0
- @objectstack/client@9.7.0
- @objectstack/spec@9.7.0
- @objectstack/metadata@9.7.0
- @objectstack/driver-sqlite-wasm@9.7.0
- @objectstack/service-knowledge@9.7.0
- @objectstack/knowledge-memory@9.7.0

## 4.0.48

### Patch Changes

- Updated dependencies [d1e930a]
- Updated dependencies [71578f2]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
- Updated dependencies [b04b7e3]
- Updated dependencies [d13df3f]
  - @objectstack/spec@9.6.0
  - @objectstack/objectql@9.6.0
  - @objectstack/runtime@9.6.0
  - @objectstack/client@9.6.0
  - @objectstack/metadata@9.6.0
  - @objectstack/driver-sqlite-wasm@9.6.0
  - @objectstack/knowledge-memory@9.6.0
  - @objectstack/service-ai@9.6.0
  - @objectstack/service-knowledge@9.6.0

## 4.0.47

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1
  - @objectstack/client@9.5.1
  - @objectstack/metadata@9.5.1
  - @objectstack/objectql@9.5.1
  - @objectstack/driver-sqlite-wasm@9.5.1
  - @objectstack/knowledge-memory@9.5.1
  - @objectstack/runtime@9.5.1
  - @objectstack/service-ai@9.5.1
  - @objectstack/service-knowledge@9.5.1

## 4.0.46

### Patch Changes

- Updated dependencies [d08551c]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
  - @objectstack/spec@9.5.0
  - @objectstack/client@9.5.0
  - @objectstack/metadata@9.5.0
  - @objectstack/objectql@9.5.0
  - @objectstack/driver-sqlite-wasm@9.5.0
  - @objectstack/knowledge-memory@9.5.0
  - @objectstack/runtime@9.5.0
  - @objectstack/service-ai@9.5.0
  - @objectstack/service-knowledge@9.5.0

## 4.0.45

### Patch Changes

- Updated dependencies [060467a]
- Updated dependencies [2c8e607]
- Updated dependencies [c1dfe34]
- Updated dependencies [0856476]
- Updated dependencies [fef38ec]
- Updated dependencies [3e675f6]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0
  - @objectstack/metadata@9.4.0
  - @objectstack/objectql@9.4.0
  - @objectstack/runtime@9.4.0
  - @objectstack/service-ai@9.4.0
  - @objectstack/client@9.4.0
  - @objectstack/driver-sqlite-wasm@9.4.0
  - @objectstack/knowledge-memory@9.4.0
  - @objectstack/service-knowledge@9.4.0

## 4.0.44

### Patch Changes

- Updated dependencies [1ada658]
- Updated dependencies [6259882]
- Updated dependencies [d100707]
- Updated dependencies [3219191]
- Updated dependencies [290f631]
- Updated dependencies [50b7b47]
- Updated dependencies [f15d6f6]
- Updated dependencies [f8684ea]
- Updated dependencies [b4765be]
- Updated dependencies [b10aa78]
- Updated dependencies [2796a1f]
  - @objectstack/spec@9.3.0
  - @objectstack/objectql@9.3.0
  - @objectstack/runtime@9.3.0
  - @objectstack/service-ai@9.3.0
  - @objectstack/metadata@9.3.0
  - @objectstack/client@9.3.0
  - @objectstack/driver-sqlite-wasm@9.3.0
  - @objectstack/knowledge-memory@9.3.0
  - @objectstack/service-knowledge@9.3.0

## 4.0.43

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0
  - @objectstack/client@9.2.0
  - @objectstack/metadata@9.2.0
  - @objectstack/objectql@9.2.0
  - @objectstack/driver-sqlite-wasm@9.2.0
  - @objectstack/knowledge-memory@9.2.0
  - @objectstack/runtime@9.2.0
  - @objectstack/service-ai@9.2.0
  - @objectstack/service-knowledge@9.2.0

## 4.0.42

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0
  - @objectstack/client@9.1.0
  - @objectstack/metadata@9.1.0
  - @objectstack/objectql@9.1.0
  - @objectstack/driver-sqlite-wasm@9.1.0
  - @objectstack/knowledge-memory@9.1.0
  - @objectstack/runtime@9.1.0
  - @objectstack/service-ai@9.1.0
  - @objectstack/service-knowledge@9.1.0

## 4.0.41

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1
  - @objectstack/client@9.0.1
  - @objectstack/metadata@9.0.1
  - @objectstack/objectql@9.0.1
  - @objectstack/driver-sqlite-wasm@9.0.1
  - @objectstack/knowledge-memory@9.0.1
  - @objectstack/runtime@9.0.1
  - @objectstack/service-ai@9.0.1
  - @objectstack/service-knowledge@9.0.1

## 4.0.40

### Patch Changes

- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0
  - @objectstack/service-ai@9.0.0
  - @objectstack/client@9.0.0
  - @objectstack/metadata@9.0.0
  - @objectstack/objectql@9.0.0
  - @objectstack/driver-sqlite-wasm@9.0.0
  - @objectstack/knowledge-memory@9.0.0
  - @objectstack/runtime@9.0.0
  - @objectstack/service-knowledge@9.0.0

## 4.0.39

### Patch Changes

- @objectstack/spec@8.0.1
- @objectstack/client@8.0.1
- @objectstack/metadata@8.0.1
- @objectstack/objectql@8.0.1
- @objectstack/runtime@8.0.1
- @objectstack/driver-sqlite-wasm@8.0.1
- @objectstack/service-ai@8.0.1
- @objectstack/service-knowledge@8.0.1
- @objectstack/knowledge-memory@8.0.1

## 4.0.38

### Patch Changes

- Updated dependencies [a46c017]
- Updated dependencies [f68be58]
- Updated dependencies [b990b89]
- Updated dependencies [99111ec]
- Updated dependencies [d5a8161]
- Updated dependencies [5cf1f1b]
- Updated dependencies [9ef89d4]
- Updated dependencies [bc0d85b]
- Updated dependencies [2537e28]
- Updated dependencies [0ec7717]
- Updated dependencies [e6374b5]
- Updated dependencies [3306d2f]
- Updated dependencies [c262301]
- Updated dependencies [bc44195]
- Updated dependencies [9e2e229]
- Updated dependencies [345e189]
  - @objectstack/spec@8.0.0
  - @objectstack/service-ai@8.0.0
  - @objectstack/runtime@8.0.0
  - @objectstack/objectql@8.0.0
  - @objectstack/client@8.0.0
  - @objectstack/metadata@8.0.0
  - @objectstack/driver-sqlite-wasm@8.0.0
  - @objectstack/knowledge-memory@8.0.0
  - @objectstack/service-knowledge@8.0.0

## 4.0.37

### Patch Changes

- Updated dependencies [ac1fc4c]
- Updated dependencies [ac1fc4c]
- Updated dependencies [ac1fc4c]
- Updated dependencies [ac1fc4c]
- Updated dependencies [4705fb8]
  - @objectstack/service-ai@7.9.0
  - @objectstack/objectql@7.9.0
  - @objectstack/runtime@7.9.0
  - @objectstack/client@7.9.0
  - @objectstack/spec@7.9.0
  - @objectstack/metadata@7.9.0
  - @objectstack/driver-sqlite-wasm@7.9.0
  - @objectstack/service-knowledge@7.9.0
  - @objectstack/knowledge-memory@7.9.0

## 4.0.36

### Patch Changes

- Updated dependencies [6b82e68]
- Updated dependencies [06f2bbb]
- Updated dependencies [a75823a]
- Updated dependencies [4fbb86a]
- Updated dependencies [e631f1e]
- Updated dependencies [328a7c4]
- Updated dependencies [4888ea2]
- Updated dependencies [6fc2678]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/service-ai@7.8.0
  - @objectstack/spec@7.8.0
  - @objectstack/objectql@7.8.0
  - @objectstack/runtime@7.8.0
  - @objectstack/client@7.8.0
  - @objectstack/metadata@7.8.0
  - @objectstack/driver-sqlite-wasm@7.8.0
  - @objectstack/knowledge-memory@7.8.0
  - @objectstack/service-knowledge@7.8.0

## 4.0.35

### Patch Changes

- Updated dependencies [b391955]
- Updated dependencies [984ddff]
- Updated dependencies [f06b64e]
- Updated dependencies [023bf93]
- Updated dependencies [764c747]
  - @objectstack/spec@7.7.0
  - @objectstack/service-ai@7.7.0
  - @objectstack/metadata@7.7.0
  - @objectstack/objectql@7.7.0
  - @objectstack/client@7.7.0
  - @objectstack/driver-sqlite-wasm@7.7.0
  - @objectstack/knowledge-memory@7.7.0
  - @objectstack/runtime@7.7.0
  - @objectstack/service-knowledge@7.7.0

## 4.0.34

### Patch Changes

- Updated dependencies [955d4c8]
- Updated dependencies [c4a4cbd]
- Updated dependencies [b046ec2]
- Updated dependencies [2170ad9]
- Updated dependencies [02d6359]
- Updated dependencies [7648242]
- Updated dependencies [8fa1e7f]
- Updated dependencies [3377e38]
- Updated dependencies [be20aa4]
- Updated dependencies [55866f5]
- Updated dependencies [8e539cc]
- Updated dependencies [60f9c45]
  - @objectstack/spec@7.6.0
  - @objectstack/service-ai@7.6.0
  - @objectstack/client@7.6.0
  - @objectstack/objectql@7.6.0
  - @objectstack/driver-sqlite-wasm@7.6.0
  - @objectstack/runtime@7.6.0
  - @objectstack/metadata@7.6.0
  - @objectstack/knowledge-memory@7.6.0
  - @objectstack/service-knowledge@7.6.0

## 4.0.33

### Patch Changes

- @objectstack/spec@7.5.0
- @objectstack/client@7.5.0
- @objectstack/metadata@7.5.0
- @objectstack/objectql@7.5.0
- @objectstack/runtime@7.5.0
- @objectstack/driver-sqlite-wasm@7.5.0
- @objectstack/service-ai@7.5.0
- @objectstack/service-knowledge@7.5.0
- @objectstack/knowledge-memory@7.5.0

## 4.0.32

### Patch Changes

- @objectstack/spec@7.4.1
- @objectstack/client@7.4.1
- @objectstack/metadata@7.4.1
- @objectstack/objectql@7.4.1
- @objectstack/runtime@7.4.1
- @objectstack/driver-sqlite-wasm@7.4.1
- @objectstack/service-ai@7.4.1
- @objectstack/service-knowledge@7.4.1
- @objectstack/knowledge-memory@7.4.1

## 4.0.31

### Patch Changes

- Updated dependencies [23c7107]
- Updated dependencies [c72daad]
- Updated dependencies [eea3f1b]
- Updated dependencies [13632b1]
- Updated dependencies [f115182]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [a6d4cbb]
- Updated dependencies [58b450b]
- Updated dependencies [394d34f]
- Updated dependencies [82eb6cf]
- Updated dependencies [13d8653]
- Updated dependencies [ff3d006]
- Updated dependencies [5e831de]
  - @objectstack/spec@7.4.0
  - @objectstack/objectql@7.4.0
  - @objectstack/runtime@7.4.0
  - @objectstack/metadata@7.4.0
  - @objectstack/service-ai@7.4.0
  - @objectstack/client@7.4.0
  - @objectstack/driver-sqlite-wasm@7.4.0
  - @objectstack/knowledge-memory@7.4.0
  - @objectstack/service-knowledge@7.4.0

## 4.0.30

### Patch Changes

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0
  - @objectstack/client@7.3.0
  - @objectstack/metadata@7.3.0
  - @objectstack/objectql@7.3.0
  - @objectstack/driver-sqlite-wasm@7.3.0
  - @objectstack/knowledge-memory@7.3.0
  - @objectstack/runtime@7.3.0
  - @objectstack/service-ai@7.3.0
  - @objectstack/service-knowledge@7.3.0

## 4.0.29

### Patch Changes

- Updated dependencies [9096dfe]
  - @objectstack/runtime@7.2.1
  - @objectstack/objectql@7.2.1
  - @objectstack/service-ai@7.2.1
  - @objectstack/metadata@7.2.1
  - @objectstack/client@7.2.1
  - @objectstack/spec@7.2.1
  - @objectstack/driver-sqlite-wasm@7.2.1
  - @objectstack/service-knowledge@7.2.1
  - @objectstack/knowledge-memory@7.2.1

## 4.0.28

### Patch Changes

- @objectstack/spec@7.2.0
- @objectstack/client@7.2.0
- @objectstack/metadata@7.2.0
- @objectstack/objectql@7.2.0
- @objectstack/runtime@7.2.0
- @objectstack/driver-sqlite-wasm@7.2.0
- @objectstack/service-ai@7.2.0
- @objectstack/service-knowledge@7.2.0
- @objectstack/knowledge-memory@7.2.0

## 4.0.27

### Patch Changes

- Updated dependencies [47a92f4]
  - @objectstack/spec@7.1.0
  - @objectstack/objectql@7.1.0
  - @objectstack/metadata@7.1.0
  - @objectstack/runtime@7.1.0
  - @objectstack/service-ai@7.1.0
  - @objectstack/client@7.1.0
  - @objectstack/driver-sqlite-wasm@7.1.0
  - @objectstack/knowledge-memory@7.1.0
  - @objectstack/service-knowledge@7.1.0

## 4.0.26

### Patch Changes

- Updated dependencies [74470ad]
- Updated dependencies [d29617e]
- Updated dependencies [dc72172]
- Updated dependencies [3a630b6]
  - @objectstack/spec@7.0.0
  - @objectstack/runtime@7.0.0
  - @objectstack/client@7.0.0
  - @objectstack/metadata@7.0.0
  - @objectstack/objectql@7.0.0
  - @objectstack/driver-sqlite-wasm@7.0.0
  - @objectstack/knowledge-memory@7.0.0
  - @objectstack/service-ai@7.0.0
  - @objectstack/service-knowledge@7.0.0

## 4.0.25

### Patch Changes

- Updated dependencies [bac7ae5]
- Updated dependencies [e9bacda]
  - @objectstack/runtime@6.9.0
  - @objectstack/service-ai@6.9.0
  - @objectstack/client@6.9.0
  - @objectstack/spec@6.9.0
  - @objectstack/metadata@6.9.0
  - @objectstack/objectql@6.9.0
  - @objectstack/driver-sqlite-wasm@6.9.0
  - @objectstack/service-knowledge@6.9.0
  - @objectstack/knowledge-memory@6.9.0

## 4.0.24

### Patch Changes

- @objectstack/spec@6.8.1
- @objectstack/client@6.8.1
- @objectstack/metadata@6.8.1
- @objectstack/objectql@6.8.1
- @objectstack/runtime@6.8.1
- @objectstack/driver-sqlite-wasm@6.8.1
- @objectstack/service-ai@6.8.1
- @objectstack/service-knowledge@6.8.1
- @objectstack/knowledge-memory@6.8.1

## 4.0.23

### Patch Changes

- Updated dependencies [6e88f77]
- Updated dependencies [c8b9f57]
- Updated dependencies [50ccd9c]
  - @objectstack/service-ai@6.8.0
  - @objectstack/spec@6.8.0
  - @objectstack/objectql@6.8.0
  - @objectstack/runtime@6.8.0
  - @objectstack/client@6.8.0
  - @objectstack/metadata@6.8.0
  - @objectstack/driver-sqlite-wasm@6.8.0
  - @objectstack/knowledge-memory@6.8.0
  - @objectstack/service-knowledge@6.8.0

## 4.0.22

### Patch Changes

- @objectstack/spec@6.7.1
- @objectstack/client@6.7.1
- @objectstack/metadata@6.7.1
- @objectstack/objectql@6.7.1
- @objectstack/runtime@6.7.1
- @objectstack/driver-sqlite-wasm@6.7.1
- @objectstack/service-ai@6.7.1
- @objectstack/service-knowledge@6.7.1
- @objectstack/knowledge-memory@6.7.1

## 4.0.21

### Patch Changes

- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
- Updated dependencies [c5efe15]
- Updated dependencies [4944f3a]
- Updated dependencies [e0c593f]
  - @objectstack/spec@6.7.0
  - @objectstack/service-ai@6.7.0
  - @objectstack/runtime@6.7.0
  - @objectstack/driver-sqlite-wasm@6.7.0
  - @objectstack/client@6.7.0
  - @objectstack/metadata@6.7.0
  - @objectstack/objectql@6.7.0
  - @objectstack/knowledge-memory@6.7.0
  - @objectstack/service-knowledge@6.7.0

## 4.0.20

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0
  - @objectstack/client@6.6.0
  - @objectstack/metadata@6.6.0
  - @objectstack/objectql@6.6.0
  - @objectstack/driver-sqlite-wasm@6.6.0
  - @objectstack/knowledge-memory@6.6.0
  - @objectstack/runtime@6.6.0
  - @objectstack/service-ai@6.6.0
  - @objectstack/service-knowledge@6.6.0

## 4.0.19

### Patch Changes

- @objectstack/runtime@6.5.1
- @objectstack/client@6.5.1
- @objectstack/spec@6.5.1
- @objectstack/metadata@6.5.1
- @objectstack/objectql@6.5.1
- @objectstack/driver-sqlite-wasm@6.5.1
- @objectstack/service-ai@6.5.1
- @objectstack/service-knowledge@6.5.1
- @objectstack/knowledge-memory@6.5.1

## 4.0.18

### Patch Changes

- @objectstack/spec@6.5.0
- @objectstack/client@6.5.0
- @objectstack/metadata@6.5.0
- @objectstack/objectql@6.5.0
- @objectstack/runtime@6.5.0
- @objectstack/driver-sqlite-wasm@6.5.0
- @objectstack/service-ai@6.5.0
- @objectstack/service-knowledge@6.5.0
- @objectstack/knowledge-memory@6.5.0

## 4.0.17

### Patch Changes

- Updated dependencies [a981d57]
- Updated dependencies [b486666]
- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
  - @objectstack/service-ai@6.4.0
  - @objectstack/spec@6.4.0
  - @objectstack/service-knowledge@6.4.0
  - @objectstack/knowledge-memory@6.4.0
  - @objectstack/client@6.4.0
  - @objectstack/metadata@6.4.0
  - @objectstack/objectql@6.4.0
  - @objectstack/driver-sqlite-wasm@6.4.0
  - @objectstack/runtime@6.4.0

## 4.0.16

### Patch Changes

- @objectstack/spec@6.3.0
- @objectstack/client@6.3.0
- @objectstack/metadata@6.3.0
- @objectstack/objectql@6.3.0
- @objectstack/runtime@6.3.0
- @objectstack/driver-sqlite-wasm@6.3.0
- @objectstack/service-ai@6.3.0

## 4.0.15

### Patch Changes

- 449e35d: Real-LLM smoke test for the `data_chat` agent loop, plus two `query_data`
  robustness fixes shaken out by running it against `openai/gpt-4.1-mini` via
  the Vercel AI Gateway.

  **`query_data` tool fixes**

  - Removed the LLM-controllable `model` parameter from the public tool
    schema. Frontier models were hallucinating `text-davinci-003` and other
    long-dead model ids, breaking every plan generation.
  - Switched the structured-output filter shape from `z.record(...)` (which
    emits `propertyNames` in JSON Schema, rejected by OpenAI Structured
    Outputs) to a `whereJson` string field. The model emits a JSON-encoded
    ObjectQL filter; the tool parses & validates it before execution. This
    also fixes a parallel issue with OpenAI's strict mode requiring every
    property to appear in `required`.
  - Switched all optional fields to `.nullable()` so the planner Zod schema
    satisfies OpenAI Structured Outputs' "every property must be required"
    rule.
  - Beefed up the planner system prompt with explicit operator hints — most
    importantly: use `$contains` for partial string matches (`"task named
Foo"` → `{"subject":{"$contains":"Foo"}}`), not equality. Without this
    hint the model defaulted to exact-match equality and never found
    anything.

  **New smoke test**

  `examples/app-todo/test/ai-llm.test.ts` (gated on `AI_GATEWAY_API_KEY`):
  boots the full ObjectStack, registers `query_data` + the six auto-generated
  `action_*` tools, sends _"Please mark the 'Build' task as complete."_ to a
  real LLM, and asserts that

  1. the model picked the right tools in the right order
     (`query_data` → `action_complete_task`),
  2. a task row actually flipped to `completed`, and
  3. an `ai_traces` `chat_with_tools` row landed.

  Run with: `pnpm --filter @example/app-todo test:llm`.

  Verified end-to-end against `openai/gpt-4.1-mini` (~6.6 s, 2 tool calls,
  1 task completed, trace persisted).

- Updated dependencies [13a4f38]
- Updated dependencies [b4c74a9]
- Updated dependencies [bce47a0]
- Updated dependencies [bce47a0]
- Updated dependencies [449e35d]
- Updated dependencies [dbb54e1]
  - @objectstack/service-ai@6.2.0
  - @objectstack/spec@6.2.0
  - @objectstack/runtime@6.2.0
  - @objectstack/client@6.2.0
  - @objectstack/metadata@6.2.0
  - @objectstack/objectql@6.2.0
  - @objectstack/driver-sqlite-wasm@6.2.0

## 4.0.14

### Patch Changes

- Updated dependencies [084ee2f]
  - @objectstack/driver-sqlite-wasm@6.1.1
  - @objectstack/runtime@6.1.1
  - @objectstack/spec@6.1.1
  - @objectstack/client@6.1.1
  - @objectstack/metadata@6.1.1
  - @objectstack/objectql@6.1.1
  - @objectstack/service-ai@6.1.1

## 4.0.13

### Patch Changes

- 93c0589: **AI v1: Actions-as-Tools** — every declarative UI `Action` of `type: 'script'`
  is now auto-exposed as an AI-callable tool named `action_<name>`. Agents can
  perform business operations ("complete the groceries task") via natural
  language, routed through the same `dataEngine.executeAction()` dispatcher
  Studio uses. This is the write-side counterpart to `query_data`.

  **Highlights**

  - `registerActionsAsTools(toolRegistry, { metadata, dataEngine })` walks every
    object's `actions[]` and registers script-type ones, auto-injecting a
    `recordId` argument for row-context actions and inheriting JSON-Schema
    parameter types from the owning object's fields.
  - Safety filters skip destructive actions by default: `confirmText`,
    `mode: 'delete'`, `variant: 'danger'`, or explicit `aiExposed: false`.
  - New `aiExposed?: boolean` flag on `ActionSchema` for fine-grained opt-out.
  - New `actions_executor` skill bundle subscribes to `action_*` (wildcard
    tool names now supported in `SkillSchema.tools`).
  - The built-in `data_chat` agent now references both `data_explorer` and
    `actions_executor` skills, so users get read + write capabilities out of
    the box.
  - `MemoryLLMAdapter` learned a small two-step heuristic — when it sees an
    action verb ("complete", "start", "clone", ...) it routes to the matching
    `action_*` tool, resolving `recordId` from any prior `query_data` result.
  - New `examples/app-todo/test/ai-action.test.ts` demo proves the loop:
    user says "please complete the groceries task" → agent finds the task →
    agent calls `action_complete_task` → task status flips → `ai_traces`
    records the run.

  **Breaking changes**

  None. `aiExposed` is additive; existing actions remain exposed unless
  they fail an existing safety filter.

  **Phase-1 limitations** (Phase-2 roadmap items)

  - Only `type: 'script'` actions; `api`/`flow`/`url`/`modal`/`form` skipped.
  - No human-in-the-loop approval flow for destructive actions yet.
  - No CEL evaluation of `visible`/`disabled` predicates against agent context.
  - No bulk action support (single-record only).

- Updated dependencies [93c0589]
  - @objectstack/service-ai@6.1.0
  - @objectstack/spec@6.1.0
  - @objectstack/client@6.1.0
  - @objectstack/metadata@6.1.0
  - @objectstack/objectql@6.1.0
  - @objectstack/driver-sqlite-wasm@5.2.2
  - @objectstack/runtime@6.1.0

## 4.0.12

### Patch Changes

- dbc4f7d: feat(ai): v1 AI capabilities — ModelRegistry, structured output, tracing, schema retrieval, and `query_data` tool

  This release lights up the first concrete capabilities on the slimmed AI protocol. All additions are
  non-breaking — new contract methods are optional and existing callers keep working unchanged.

  ### What's new

  - **ModelRegistry** (`@objectstack/service-ai`): in-memory runtime registry for `AI.ModelConfig`.
    Wire models via `AIServicePluginOptions.models` / `defaultModelId`. Exposes `get`, `getOrThrow`,
    `getDefault`, `list`, and `estimateCost(modelId, usage)` for ex-post token cost computation.

  - **ai_traces object + auto-tracing**: every LLM call from `AIService` (`chat`, `complete`,
    `stream_chat`, `chat_with_tools`, `generate_object`, `embed`) is now instrumented with latency,
    token usage, status, and (when pricing is registered) cost. The default `ObjectQLTraceRecorder`
    is auto-wired when the runtime exposes an `IDataEngine`, persisting rows to the new `ai_traces`
    object. Drop in a custom `TraceRecorder` via `AIServicePluginOptions.traceRecorder`, or pass
    `null` to opt out.

  - **Structured output (`IAIService.generateObject`)**: new optional method on `IAIService` and
    `LLMAdapter` that returns a parsed, schema-validated object instead of free-form text.
    Implemented end-to-end in `VercelLLMAdapter` (uses the AI SDK's `generateObject` — provider
    strict-mode is automatic when supported). `MemoryLLMAdapter` ships a deterministic heuristic
    implementation so tests and demos work without an API key.

  - **SchemaRetriever**: lightweight keyword-based retriever over `IMetadataService.listObjects()`.
    Scores by object name (×3), label/plural (×2), description (×1), field name (×2), and field
    label (×1) with English stop-word filtering. Tokenisation splits snake_case so `todo_task` in
    a query matches `name: 'todo_task'`. `SchemaRetriever.renderSnippet()` produces a Markdown
    block ready to inject into a system prompt — no embeddings, no extra infra.

  - **`query_data` tool**: auto-registered when AI + Metadata + Data engine are all present. Takes
    a natural-language `request`, retrieves relevant schemas, asks the model for a structured
    `QueryPlan` via `generateObject`, validates the plan targets a real object, and executes it
    through `IDataEngine.find`. Returns `{ plan, count, records }`. The composed primitive that
    closes the loop from "ask in English" → "validated SQL-shaped result".

  - **Working demo in `examples/app-todo`**: `pnpm --filter @example/app-todo test:ai` boots the
    full Todo stack, invokes `query_data` against the seeded tasks, and verifies the call lands
    in `ai_traces`. Zero API keys, ~3 seconds end-to-end. Serves as the canonical reference for
    wiring AI into a real app.

  ### Hardening

  - Strict tool schemas: nested `orderBy` and `aggregations` items in `data-tools` now declare
    `additionalProperties: false` + `required`, matching the top-level contract and making them
    safe for provider strict mode.

  ### Breaking-ish

  - `TraceOperation` values are now snake_case (`stream_chat`, `chat_with_tools`, `generate_object`)
    to match the project's data-value convention and so the `ai_traces.operation` select validates.
    Custom `TraceRecorder` implementations that hard-code the old camelCase names need to be
    updated. The values are an internal observability artefact — no public protocol surface
    exposes them.

  ### Notes

  - `zod` is now a direct dependency of `@objectstack/service-ai` (previously transitive via `ai`)
    because contract signatures and the new tool definition use `z.ZodType` types directly.
  - All new methods on `IAIService` / `LLMAdapter` are optional — existing custom adapters and
    callers continue to work without changes.
  - 12 new unit tests cover `ModelRegistry` (cost math, defaults, throwing lookups) and
    `SchemaRetriever` (scoring, snake_case tokenisation, limits, snippet rendering).
    Full suite: 323/323 ✓.

- Updated dependencies [629a716]
- Updated dependencies [dbc4f7d]
- Updated dependencies [944f187]
  - @objectstack/spec@6.0.0
  - @objectstack/service-ai@6.0.0
  - @objectstack/runtime@6.0.0
  - @objectstack/client@6.0.0
  - @objectstack/metadata@6.0.0
  - @objectstack/objectql@6.0.0
  - @objectstack/driver-sqlite-wasm@5.2.1

## 4.0.11

### Patch Changes

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [b806f58]
  - @objectstack/spec@5.2.0
  - @objectstack/runtime@5.2.0
  - @objectstack/client@5.2.0
  - @objectstack/objectql@5.2.0
  - @objectstack/driver-memory@5.2.0

## 4.0.10

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0
  - @objectstack/objectql@5.1.0
  - @objectstack/client@5.1.0
  - @objectstack/driver-memory@5.1.0
  - @objectstack/runtime@5.1.0

## 4.0.9

### Patch Changes

- Updated dependencies [5e9dcb4]
- Updated dependencies [f139a24]
- Updated dependencies [4eb9f8c]
- Updated dependencies [2f7e42a]
- Updated dependencies [602cce7]
- Updated dependencies [1e625b8]
- Updated dependencies [6ee42b8]
- Updated dependencies [888a5c1]
- Updated dependencies [5cfdc85]
- Updated dependencies [09f005a]
- Updated dependencies [7825394]
- Updated dependencies [96ad4df]
- Updated dependencies [df18ae9]
- Updated dependencies [2f9073a]
  - @objectstack/objectql@5.0.0
  - @objectstack/runtime@5.0.0
  - @objectstack/spec@5.0.0
  - @objectstack/client@5.0.0
  - @objectstack/driver-memory@5.0.0

## 4.0.8

### Patch Changes

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0
  - @objectstack/objectql@4.2.0
  - @objectstack/client@4.2.0
  - @objectstack/runtime@4.2.0
  - @objectstack/driver-memory@4.2.0

## 4.0.7

### Patch Changes

- Updated dependencies [5326c6b]
  - @objectstack/client@4.1.1
  - @objectstack/spec@4.1.1
  - @objectstack/objectql@4.1.1
  - @objectstack/runtime@4.1.1
  - @objectstack/driver-memory@4.1.1

## 4.0.6

### Patch Changes

- Updated dependencies [2108c30]
- Updated dependencies [96fb108]
- Updated dependencies [23db640]
- Updated dependencies [5683206]
- Updated dependencies [70db902]
- Updated dependencies [70db902]
- Updated dependencies [f0b3972]
- Updated dependencies [0e63f2f]
  - @objectstack/spec@4.1.0
  - @objectstack/runtime@4.1.0
  - @objectstack/objectql@4.1.0
  - @objectstack/client@4.1.0
  - @objectstack/driver-memory@4.1.0

## 4.0.5

### Patch Changes

- Updated dependencies [15e0df6]
  - @objectstack/spec@4.0.5
  - @objectstack/client@4.0.5
  - @objectstack/objectql@4.0.5
  - @objectstack/runtime@4.0.5
  - @objectstack/driver-memory@4.0.5

## 4.0.4

### Patch Changes

- Updated dependencies [326b66b]
  - @objectstack/spec@4.0.4
  - @objectstack/client@4.0.4
  - @objectstack/objectql@4.0.4
  - @objectstack/driver-memory@4.0.4
  - @objectstack/runtime@4.0.4

## 4.0.3

### Patch Changes

- @objectstack/spec@4.0.3
- @objectstack/client@4.0.3
- @objectstack/objectql@4.0.3
- @objectstack/runtime@4.0.3
- @objectstack/driver-memory@4.0.3

## 4.0.2

### Patch Changes

- Updated dependencies [5f659e9]
  - @objectstack/driver-memory@4.0.2
  - @objectstack/client@4.0.2
  - @objectstack/spec@4.0.2
  - @objectstack/objectql@4.0.2
  - @objectstack/runtime@4.0.2

## 3.0.26

### Patch Changes

- Updated dependencies [f08ffc3]
- Updated dependencies [e0b0a78]
  - @objectstack/spec@4.0.0
  - @objectstack/client@4.0.0
  - @objectstack/runtime@4.0.0
  - @objectstack/objectql@4.0.0
  - @objectstack/driver-memory@4.0.0

## 3.0.25

### Patch Changes

- @objectstack/spec@3.3.1
- @objectstack/client@3.3.1
- @objectstack/objectql@3.3.1
- @objectstack/runtime@3.3.1
- @objectstack/driver-memory@3.3.1

## 3.0.24

### Patch Changes

- @objectstack/spec@3.3.0
- @objectstack/client@3.3.0
- @objectstack/objectql@3.3.0
- @objectstack/runtime@3.3.0
- @objectstack/driver-memory@3.3.0

## 3.0.23

### Patch Changes

- Updated dependencies [c3065dd]
  - @objectstack/objectql@3.2.9
  - @objectstack/client@3.2.9
  - @objectstack/spec@3.2.9
  - @objectstack/runtime@3.2.9
  - @objectstack/driver-memory@3.2.9

## 3.0.22

### Patch Changes

- @objectstack/spec@3.2.8
- @objectstack/client@3.2.8
- @objectstack/objectql@3.2.8
- @objectstack/runtime@3.2.8
- @objectstack/driver-memory@3.2.8

## 3.0.21

### Patch Changes

- @objectstack/spec@3.2.7
- @objectstack/client@3.2.7
- @objectstack/objectql@3.2.7
- @objectstack/runtime@3.2.7
- @objectstack/driver-memory@3.2.7

## 3.0.20

### Patch Changes

- @objectstack/spec@3.2.6
- @objectstack/client@3.2.6
- @objectstack/objectql@3.2.6
- @objectstack/runtime@3.2.6
- @objectstack/driver-memory@3.2.6

## 3.0.19

### Patch Changes

- @objectstack/spec@3.2.5
- @objectstack/client@3.2.5
- @objectstack/objectql@3.2.5
- @objectstack/runtime@3.2.5
- @objectstack/driver-memory@3.2.5

## 3.0.18

### Patch Changes

- @objectstack/spec@3.2.4
- @objectstack/client@3.2.4
- @objectstack/objectql@3.2.4
- @objectstack/runtime@3.2.4
- @objectstack/driver-memory@3.2.4

## 3.0.17

### Patch Changes

- @objectstack/spec@3.2.3
- @objectstack/client@3.2.3
- @objectstack/objectql@3.2.3
- @objectstack/runtime@3.2.3
- @objectstack/driver-memory@3.2.3

## 3.0.16

### Patch Changes

- Updated dependencies [46defbb]
  - @objectstack/spec@3.2.2
  - @objectstack/driver-memory@3.2.2
  - @objectstack/client@3.2.2
  - @objectstack/objectql@3.2.2
  - @objectstack/runtime@3.2.2

## 3.0.15

### Patch Changes

- Updated dependencies [850b546]
  - @objectstack/spec@3.2.1
  - @objectstack/client@3.2.1
  - @objectstack/objectql@3.2.1
  - @objectstack/driver-memory@3.2.1
  - @objectstack/runtime@3.2.1

## 3.0.14

### Patch Changes

- Updated dependencies [5901c29]
  - @objectstack/spec@3.2.0
  - @objectstack/client@3.2.0
  - @objectstack/objectql@3.2.0
  - @objectstack/driver-memory@3.2.0
  - @objectstack/runtime@3.2.0

## 3.0.13

### Patch Changes

- Updated dependencies [953d667]
  - @objectstack/spec@3.1.1
  - @objectstack/client@3.1.1
  - @objectstack/objectql@3.1.1
  - @objectstack/driver-memory@3.1.1
  - @objectstack/runtime@3.1.1

## 3.0.12

### Patch Changes

- Updated dependencies [0088830]
  - @objectstack/spec@3.1.0
  - @objectstack/client@3.1.0
  - @objectstack/objectql@3.1.0
  - @objectstack/driver-memory@3.1.0
  - @objectstack/runtime@3.1.0

## 3.0.11

### Patch Changes

- Updated dependencies [92d9d99]
  - @objectstack/spec@3.0.11
  - @objectstack/client@3.0.11
  - @objectstack/objectql@3.0.11
  - @objectstack/driver-memory@3.0.11
  - @objectstack/runtime@3.0.11

## 3.0.10

### Patch Changes

- Updated dependencies [d1e5d31]
  - @objectstack/spec@3.0.10
  - @objectstack/client@3.0.10
  - @objectstack/objectql@3.0.10
  - @objectstack/driver-memory@3.0.10
  - @objectstack/runtime@3.0.10

## 3.0.9

### Patch Changes

- Updated dependencies [15e0df6]
  - @objectstack/spec@3.0.9
  - @objectstack/client@3.0.9
  - @objectstack/objectql@3.0.9
  - @objectstack/driver-memory@3.0.9
  - @objectstack/runtime@3.0.9

## 3.0.8

### Patch Changes

- Updated dependencies [5a968a2]
  - @objectstack/spec@3.0.8
  - @objectstack/client@3.0.8
  - @objectstack/objectql@3.0.8
  - @objectstack/driver-memory@3.0.8
  - @objectstack/runtime@3.0.8

## 1.2.16

### Patch Changes

- Updated dependencies [0119bd7]
- Updated dependencies [5426bdf]
  - @objectstack/spec@3.0.7
  - @objectstack/client@3.0.7
  - @objectstack/objectql@3.0.7
  - @objectstack/driver-memory@3.0.7
  - @objectstack/runtime@3.0.7

## 1.2.15

### Patch Changes

- Updated dependencies [5df254c]
  - @objectstack/spec@3.0.6
  - @objectstack/client@3.0.6
  - @objectstack/objectql@3.0.6
  - @objectstack/driver-memory@3.0.6
  - @objectstack/runtime@3.0.6

## 1.2.14

### Patch Changes

- Updated dependencies [23a4a68]
  - @objectstack/spec@3.0.5
  - @objectstack/client@3.0.5
  - @objectstack/objectql@3.0.5
  - @objectstack/driver-memory@3.0.5
  - @objectstack/runtime@3.0.5

## 1.2.13

### Patch Changes

- Updated dependencies [d738987]
- Updated dependencies [437b0b8]
  - @objectstack/spec@3.0.4
  - @objectstack/objectql@3.0.4
  - @objectstack/client@3.0.4
  - @objectstack/driver-memory@3.0.4
  - @objectstack/runtime@3.0.4

## 1.2.12

### Patch Changes

- Updated dependencies [c7267f6]
  - @objectstack/spec@3.0.3
  - @objectstack/client@3.0.3
  - @objectstack/objectql@3.0.3
  - @objectstack/runtime@3.0.3
  - @objectstack/driver-memory@3.0.3

## 1.2.11

### Patch Changes

- Updated dependencies [28985f5]
  - @objectstack/spec@3.0.2
  - @objectstack/client@3.0.2
  - @objectstack/objectql@3.0.2
  - @objectstack/driver-memory@3.0.2
  - @objectstack/runtime@3.0.2

## 1.2.10

### Patch Changes

- Updated dependencies [389725a]
  - @objectstack/spec@3.0.1
  - @objectstack/client@3.0.1
  - @objectstack/objectql@3.0.1
  - @objectstack/driver-memory@3.0.1
  - @objectstack/runtime@3.0.1

## 1.2.9

### Patch Changes

- Updated dependencies
  - @objectstack/spec@3.0.0
  - @objectstack/client@3.0.0
  - @objectstack/objectql@3.0.0
  - @objectstack/runtime@3.0.0
  - @objectstack/driver-memory@3.0.0

## 1.2.8

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.7
  - @objectstack/client@2.0.7
  - @objectstack/objectql@2.0.7
  - @objectstack/driver-memory@2.0.7
  - @objectstack/runtime@2.0.7

## 1.2.7

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.6
  - @objectstack/client@2.0.6
  - @objectstack/objectql@2.0.6
  - @objectstack/runtime@2.0.6
  - @objectstack/driver-memory@2.0.6

## 1.2.6

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.5
  - @objectstack/client@2.0.5
  - @objectstack/objectql@2.0.5
  - @objectstack/driver-memory@2.0.5
  - @objectstack/runtime@2.0.5

## 1.2.5

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.4
  - @objectstack/client@2.0.4
  - @objectstack/objectql@2.0.4
  - @objectstack/runtime@2.0.4
  - @objectstack/driver-memory@2.0.4

## 1.2.4

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.3
  - @objectstack/client@2.0.3
  - @objectstack/objectql@2.0.3
  - @objectstack/runtime@2.0.3
  - @objectstack/driver-memory@2.0.3

## 1.2.3

### Patch Changes

- Updated dependencies [1db8559]
  - @objectstack/spec@2.0.2
  - @objectstack/client@2.0.2
  - @objectstack/objectql@2.0.2
  - @objectstack/driver-memory@2.0.2
  - @objectstack/runtime@2.0.2

## 1.2.2

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.1
  - @objectstack/client@2.0.1
  - @objectstack/objectql@2.0.1
  - @objectstack/runtime@2.0.1
  - @objectstack/driver-memory@2.0.1

## 1.2.1

### Patch Changes

- Updated dependencies [38e5dd5]
- Updated dependencies [38e5dd5]
  - @objectstack/spec@2.0.0
  - @objectstack/client@2.0.0
  - @objectstack/objectql@2.0.0
  - @objectstack/driver-memory@2.0.0
  - @objectstack/runtime@2.0.0

## 0.9.15

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.12
  - @objectstack/client@1.0.12
  - @objectstack/runtime@1.0.12
  - @objectstack/objectql@1.0.12
  - @objectstack/driver-memory@1.0.12

## 0.9.14

### Patch Changes

- @objectstack/client@1.0.11
- @objectstack/spec@1.0.11
- @objectstack/objectql@1.0.11
- @objectstack/runtime@1.0.11
- @objectstack/driver-memory@1.0.11

## 0.9.13

### Patch Changes

- @objectstack/client@1.0.10
- @objectstack/objectql@1.0.10
- @objectstack/driver-memory@1.0.10
- @objectstack/runtime@1.0.10
- @objectstack/spec@1.0.10

## 0.9.12

### Patch Changes

- Updated dependencies [b9f8c68]
  - @objectstack/objectql@1.0.9
  - @objectstack/client@1.0.9
  - @objectstack/spec@1.0.9
  - @objectstack/runtime@1.0.9
  - @objectstack/driver-memory@1.0.9

## 0.9.11

### Patch Changes

- @objectstack/client@1.0.8
- @objectstack/spec@1.0.8
- @objectstack/objectql@1.0.8
- @objectstack/runtime@1.0.8
- @objectstack/driver-memory@1.0.8

## 0.9.10

### Patch Changes

- Updated dependencies [ebdf787]
  - @objectstack/runtime@1.0.7
  - @objectstack/client@1.0.7
  - @objectstack/spec@1.0.7
  - @objectstack/objectql@1.0.7
  - @objectstack/driver-memory@1.0.7

## 0.9.9

### Patch Changes

- Updated dependencies [a7f7b9d]
  - @objectstack/spec@1.0.6
  - @objectstack/client@1.0.6
  - @objectstack/objectql@1.0.6
  - @objectstack/driver-memory@1.0.6
  - @objectstack/runtime@1.0.6

## 0.9.8

### Patch Changes

- Updated dependencies [b1d24bd]
- Updated dependencies [877b864]
  - @objectstack/objectql@1.0.5
  - @objectstack/runtime@1.0.5
  - @objectstack/driver-memory@1.0.5
  - @objectstack/client@1.0.5
  - @objectstack/spec@1.0.5

## 0.9.7

### Patch Changes

- Updated dependencies [5d13533]
  - @objectstack/objectql@1.0.4
  - @objectstack/spec@1.0.4
  - @objectstack/client@1.0.4
  - @objectstack/runtime@1.0.4
  - @objectstack/driver-memory@1.0.4

## 0.9.6

### Patch Changes

- Updated dependencies [fb2eabd]
- Updated dependencies [22a48f0]
  - @objectstack/runtime@1.0.3
  - @objectstack/objectql@1.0.3
  - @objectstack/client@1.0.3
  - @objectstack/driver-memory@1.0.3
  - @objectstack/spec@1.0.3

## 0.9.5

### Patch Changes

- Updated dependencies [a0a6c85]
- Updated dependencies [109fc5b]
  - @objectstack/spec@1.0.2
  - @objectstack/client@1.0.2
  - @objectstack/objectql@1.0.2
  - @objectstack/runtime@1.0.2
  - @objectstack/driver-memory@1.0.2

## 0.9.4

### Patch Changes

- Updated dependencies
  - @objectstack/runtime@1.0.1
  - @objectstack/spec@1.0.1
  - @objectstack/client@1.0.1
  - @objectstack/objectql@1.0.1
  - @objectstack/driver-memory@1.0.1

## 0.9.3

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.0
  - @objectstack/runtime@1.0.0
  - @objectstack/objectql@1.0.0
  - @objectstack/client@1.0.0
  - @objectstack/driver-memory@1.0.0

## 0.9.2

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.9.2
  - @objectstack/client@0.9.2
  - @objectstack/objectql@0.9.2
  - @objectstack/driver-memory@0.9.2
  - @objectstack/runtime@0.9.2

## 0.9.1

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.9.1
  - @objectstack/client@0.9.1
  - @objectstack/objectql@0.9.1
  - @objectstack/runtime@0.9.1
  - @objectstack/driver-memory@0.9.1

## 0.7.5

### Patch Changes

- Updated dependencies [555e6a7]
  - @objectstack/spec@0.8.2
  - @objectstack/client@0.8.2

## 0.7.4

### Patch Changes

- @objectstack/spec@0.8.1
- @objectstack/client@0.8.1

## 0.7.3

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.0
  - @objectstack/client@1.0.0

## 0.7.2

### Patch Changes

- Updated dependencies [fb41cc0]
  - @objectstack/spec@0.7.2
  - @objectstack/client@0.7.2

## 0.7.1

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.7.1
  - @objectstack/client@0.7.1

## 0.6.1

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.6.1
  - @objectstack/client@0.6.1

## 0.6.0

### Minor Changes

- b2df5f7: Unified version bump to 0.5.0

  - Standardized all package versions to 0.5.0 across the monorepo
  - Fixed driver-memory package.json paths for proper module resolution
  - Ensured all packages are in sync for the 0.5.0 release

### Patch Changes

- Updated dependencies [b2df5f7]
  - @objectstack/spec@0.6.0
  - @objectstack/client@0.6.0

## 1.0.9

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.4.2
  - @objectstack/client@0.4.2

## 1.0.8

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.4.1
  - @objectstack/client@0.4.1

## 1.0.7

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.3.3
  - @objectstack/client@0.3.3

## 1.0.6

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/client@0.3.2
  - @objectstack/spec@0.3.2

## 1.0.5

### Patch Changes

- @objectstack/spec@0.3.1
- @objectstack/client@0.3.1

## 1.0.4

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.0
  - @objectstack/client@1.0.0

## 1.0.3

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.3.0
  - @objectstack/client@0.2.1

## 1.0.2

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.2.0
  - @objectstack/client@0.2.0

## 1.0.1

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.1.2
  - @objectstack/client@0.1.1
