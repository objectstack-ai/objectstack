# @objectstack/example-showcase

## 0.3.15

### Patch Changes

- 06f9848: Land the showcase seed fixtures the platform checklist could not run without (#9308)
  
  Three capabilities the platform ships had no fixture anywhere in the reference app, so the
  checklist items covering them were not failing — they were unrunnable. Each is closed here
  with the smallest stock addition that makes it observable, and with the negative control
  left intact.
  
  **A second, actually loginable member.** The demo personas (Mei Phone the submitter, Ada
  Auditor the sole `auditor`) have existed as `sys_user` rows since #3409/#3411, and neither
  could sign in — so every item needing two acting identities was stuck: per-group 会签 needs
  the two groups decided by two different people, submitter-side viewer gating needs the
  submitter looking at their own request, and an out-of-office delegation is only falsifiable
  when the delegate holds a separate token. The non-obvious half is why a password hash was
  never enough: better-auth 1.7 keys accounts on `(issuer, providerAccountId)`, so a
  credential row carrying any other issuer is invisible to sign-in, which then fails
  `INVALID_EMAIL_OR_PASSWORD` behind a "User not found" warn pointing at the user row rather
  than at the account. `seed-approval-demo.ts` now provisions the credential account through
  better-auth's own `$context` — its hasher, its `internalAdapter.createAccount` — and READS
  the issuer off the dev admin's own credential row instead of re-spelling a constant
  `plugin-auth` owns, so the two cannot drift. Dev-only by construction: the bootstrap runs
  only where the dev admin exists, and that admin is hard-gated on `NODE_ENV=development`.
  
  **An object that opts into `publicSharing`.** No stock object declared it, so
  `POST /share-links` answered 422 `SHARING_NOT_ENABLED` for every showcase object and the
  whole downstream half of link sharing — resolve, redaction, the audience and password
  gates, fail-closed revoke — was unreachable. `showcase_client_brief` opts in with
  `redactFields`, an expiry cap and an `eligibility` predicate, and the seed carries both a
  `published` brief (mint-eligible) and a `draft` one (refused `RECORD_NOT_ELIGIBLE`) so the
  predicate is falsifiable and not merely satisfied. Every other object still declines the
  opt-in, which is what keeps the per-object 422 a real control.
  
  **A `readable: false` FLS grant.** The app governed the three `showcase_project` budget
  figures with `readable: true, editable: false` — the WRITE half of field-level security —
  and authored no read-withheld grant at all, leaving `plugin-security`'s field masker with
  no stock fixture. `showcase_client_liaison` is that grant, on the same three fields, so the
  two sets read side by side as the two halves of one mechanism. All three figures move
  together because `budget_remaining` is a formula over `budget - spent` and masking one
  leaks it back through arithmetic.
  
  Downstream reconciliations, each deliberate: `access-matrix.json` gains two rows and moves
  none; the persona × CRUD sweep's census follows the matrix (50/50 → 54/54, arithmetic
  recorded at the assertion) and its fixture maps learn the new object; the position count
  pin follows the new position. The five checklist items whose `knownGaps` this closes are
  revised in the same change — gap text kept, marked closed-by-fixture, `revision` bumped,
  `history` appended.
- b0fa4fc: Guard the showcase's authored action predicates against the sparse action face (#8990)
  
  Every record-scoped `visible` / `disabled` predicate in `app-showcase` now carries the
  `has()` guard the sparse action face requires, closing the remainder of #8990 in this
  repo. A row action's predicate binds a LIST ROW carrying only the view's `$select`
  projection, and CEL aborts with `No such key` on a column that row never projected —
  fail-closed, so the button silently is not offered.
  
  Measured against the running app's own payloads: 40 of the 53 predicates in
  `predicate-matrix.action.ts` aborted on a default-list row before this change and 0 do
  after, while every verdict on a record-detail binding is unchanged — the Full-vs-Minimal
  contrast the fixture exists to demonstrate is preserved exactly.
  
  The guard is minimal per predicate rather than blanket: `has()` alone where the read is
  only compared by `==` / `!=` (CEL compares heterogeneously and answers `false` rather
  than faulting), the full `has(x) && x != null` conjunction only where an operand can
  fault — traversal, method call, ordering, arithmetic, `in`, or a bare `!`.
  
  The teaching surfaces move with the code, since they quote it: `content/docs/ui/actions.mdx`
  (whose `visible: '!record.done'` was the exact negation shape that faults on a NULL
  column), `quick-start.mdx` and `build-with-claude-code.mdx`.
- 4012a70: Retire the showcase sharing rules no gate could consult; re-home the position/compound demo (#9237)
  
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
- Updated dependencies [56656aa]
- Updated dependencies [07e630e]
- Updated dependencies [2f65b1b]
- Updated dependencies [ca2e020]
- Updated dependencies [720ee95]
- Updated dependencies [f287435]
- Updated dependencies [e43d63a]
- Updated dependencies [e374b4d]
- Updated dependencies [a433122]
- Updated dependencies [bc6434b]
- Updated dependencies [96f397a]
- Updated dependencies [9aa8890]
- Updated dependencies [48032c9]
- Updated dependencies [7c9c1dd]
- Updated dependencies [8bbf459]
- Updated dependencies [2277443]
- Updated dependencies [75b7c24]
- Updated dependencies [d5552ca]
- Updated dependencies [d9813a9]
- Updated dependencies [8640fb2]
- Updated dependencies [5c38492]
- Updated dependencies [2420641]
- Updated dependencies [2ad91c3]
- Updated dependencies [f57fb38]
- Updated dependencies [3508678]
- Updated dependencies [00777a0]
- Updated dependencies [d491625]
- Updated dependencies [6a51704]
- Updated dependencies [2c570f3]
- Updated dependencies [c766ec3]
- Updated dependencies [7337f30]
- Updated dependencies [420804d]
- Updated dependencies [c8e85fc]
- Updated dependencies [3d61924]
- Updated dependencies [5244fd7]
- Updated dependencies [cbf4b40]
- Updated dependencies [9c4d096]
- Updated dependencies [86431f7]
- Updated dependencies [716ac9b]
- Updated dependencies [62b1427]
- Updated dependencies [7ea1372]
- Updated dependencies [23abe27]
- Updated dependencies [985a9cd]
- Updated dependencies [b2789ad]
- Updated dependencies [a8189ae]
- Updated dependencies [26e70fb]
- Updated dependencies [42b05af]
- Updated dependencies [2b292ce]
- Updated dependencies [abcf853]
- Updated dependencies [8b9eba5]
- Updated dependencies [d575779]
- Updated dependencies [94f7ef8]
- Updated dependencies [c5ac5e4]
- Updated dependencies [a777944]
- Updated dependencies [6aceca9]
- Updated dependencies [dd88e1c]
- Updated dependencies [856527c]
- Updated dependencies [870f710]
- Updated dependencies [79c46da]
- Updated dependencies [1e050a5]
- Updated dependencies [7ff3975]
- Updated dependencies [29d055b]
- Updated dependencies [65589d6]
- Updated dependencies [2c86fe3]
- Updated dependencies [e196c6a]
- Updated dependencies [4ab7523]
- Updated dependencies [19539b4]
- Updated dependencies [e0695b5]
- Updated dependencies [01074e5]
- Updated dependencies [7c3a7eb]
- Updated dependencies [a9df51c]
- Updated dependencies [11b779e]
- Updated dependencies [ab8b10f]
- Updated dependencies [739fe5b]
- Updated dependencies [20067c5]
- Updated dependencies [e783e16]
- Updated dependencies [4bfe1a5]
- Updated dependencies [2065e31]
- Updated dependencies [b69d0f5]
- Updated dependencies [4d47afe]
- Updated dependencies [4fc4a3c]
- Updated dependencies [90a12fb]
- Updated dependencies [e4e5c6e]
- Updated dependencies [72050cc]
- Updated dependencies [d70428a]
- Updated dependencies [9a56784]
- Updated dependencies [c8806ae]
- Updated dependencies [bb96297]
- Updated dependencies [d00d2f6]
- Updated dependencies [df0c12d]
- Updated dependencies [d31785f]
- Updated dependencies [c308a4f]
- Updated dependencies [3b3f67d]
- Updated dependencies [e2899f6]
- Updated dependencies [17854cb]
- Updated dependencies [3851f87]
- Updated dependencies [09b880b]
- Updated dependencies [d2e6b1d]
- Updated dependencies [0961065]
- Updated dependencies [2a29caa]
- Updated dependencies [09a6eee]
- Updated dependencies [1a7f907]
- Updated dependencies [cd455c8]
- Updated dependencies [05864fb]
- Updated dependencies [30d3752]
- Updated dependencies [c80e7ae]
- Updated dependencies [09a9a8a]
- Updated dependencies [07026cf]
- Updated dependencies [5d4f3d5]
- Updated dependencies [4d80e8b]
- Updated dependencies [30b1c63]
- Updated dependencies [7fc01db]
- Updated dependencies [079b457]
- Updated dependencies [e43b211]
- Updated dependencies [c86799f]
- Updated dependencies [990a893]
- Updated dependencies [5989b0d]
- Updated dependencies [19db5fa]
- Updated dependencies [2b9d33a]
- Updated dependencies [ad217b1]
- Updated dependencies [890b38f]
- Updated dependencies [8bee54b]
- Updated dependencies [7a537ce]
- Updated dependencies [593c4bf]
- Updated dependencies [ff08691]
- Updated dependencies [60e0f90]
- Updated dependencies [90c5285]
- Updated dependencies [7901b2d]
- Updated dependencies [56bca91]
- Updated dependencies [79394d7]
- Updated dependencies [730fd9a]
- Updated dependencies [44bc51d]
- Updated dependencies [73cfddf]
- Updated dependencies [a4acb8d]
- Updated dependencies [d634e66]
- Updated dependencies [682b86b]
- Updated dependencies [6a1b45e]
  - @objectstack/spec@17.1.0
  - @objectstack/runtime@17.1.0
  - @objectstack/driver-sql@17.1.0
  - @objectstack/cloud-connection@17.1.0
  - @objectstack/service-datasource@17.1.0
  - @objectstack/connector-mcp@17.1.0
  - @objectstack/connector-openapi@17.1.0
  - @objectstack/connector-rest@17.1.0
  - @objectstack/connector-slack@17.1.0

## 0.3.14

### Patch Changes

- 3905c00: feat(objectql)!: a predicate bulk write evaluates and fires after-hooks PER ROW (#5038)

  The 2026-08-04 maintainer ruling on #4800 / #4862, recorded as ADR-0058's
  bulk-write addendum: **a bulk write is N record changes**, so every record-scoped
  declaration on it is evaluated per row — `record` = that row's state, `previous` =
  that row's pre-write state. Validation predicates have worked this way since
  #3106; hook `condition`s and the record-change flow triggers riding the same
  lifecycle hooks now join them.

  **What was broken.** A `multi: true` update reaches `driver.updateMany`, which
  resolves an affected COUNT. The lifecycle hook fired **once**, `previous` was
  never assigned (only the single-id branch fetched a prior row), and `record`
  degraded to the write's bare payload. So the transition condition the docs, the
  formula skill and ten showcase flows all teach —
  `status == "done" && previous.status != "done"` — could not be evaluated on a
  bulk write. Hook conditions rejected the write (#4775/#5037); record-change flow
  triggers were **silent**, firing zero times or once for a record that did not
  exist. A missing audit row is the one failure nobody goes looking for.

  **What changed.** The engine's bulk `update` / `delete` branches now read the
  matched row set **once** — the same `driver.find` #3106 already issues, with
  "this object has after-hooks" added to its demand test — and dispatch
  `afterUpdate` / `afterDelete` once per matched row, each on a context with the
  **single-record shape**: `input.id` = the row, `previous` = its pre-image,
  `result` = its state. That is #2922's batch-INSERT ruling restated, and it is why
  this fix has no code in the consumers: `hook-wrappers`' `record`/`previous`
  bindings, the record-change trigger's context builder and plugin-audit's diff all
  read those same fields and became correct at the producer.

  - **Per-row dispatch is uniform across after-hooks.** It is deliberately NOT
    keyed on whether a condition mentions `previous` — the ruling rejected that as
    a hidden rule that would make a hook's firing count depend on its condition
    text.
  - **`ctx.result` per row is the ROW**, composed as `row ⊕ payload` from the
    pre-image already in hand, so the batch still costs one extra query, not one
    per row. A bulk DELETE has no post-state: its per-row context sets no `result`,
    and consumers fall back to `previous`.
  - **`onError` needed no new meaning** — it governs a handler on a record-scoped
    context, which is now what it always gets: `abort` fails the operation, `log`
    swallows that row and the batch continues.
  - **A ceiling, enforced as a refusal.** Past 10 000 matched rows a predicate
    write against an object with after-hooks is rejected _before_ the driver call
    (`ERR_BULK_PER_ROW_HOOK_LIMIT`), so nothing is written. It is never downgraded
    to one dispatch for the batch — that would skip the hook for N-1 rows silently.

  **Breaking for hook authors, in the direction the contract declares.** An
  after-hook on an object that takes predicate writes now runs once per matched row
  instead of once per batch: a notification hook sends N messages, a
  cache-invalidation hook runs N times. Objects with no after-hooks are untouched
  and pay for no extra read. The write's own contract is unchanged — a predicate
  write still resolves the affected count and still publishes ONE aggregate
  `data.records.updated` (#4639).

  **`before*` hooks stay batch-scoped, and that is not a gap.** `beforeUpdate` /
  `beforeDelete` fire once for the whole batch because they may still rewrite the
  payload, and one `updateMany` carries one payload. #5037's `HookConditionError`
  and its `limitation` discriminator therefore **survive, rescoped to that
  dispatch** — with a message that no longer promises an expiry that has already
  happened, names the phase as the reason, and points at the matching `after*`
  event where the same condition evaluates per row as authored. It also now names a
  record-change flow trigger as a real route: #5037 refused to, on measured
  evidence that the trigger shared the same unbound `previous`; that fact changed.

  Docs (`data-modeling/formulas.mdx`) and `skills/objectstack-formula` §5 are
  updated to teach one transition shape for both write forms, with the `before*`
  exception called out.

- 450f3e5: fix(examples): name the form/page sections that had a label but no `name`, and translate the headings into zh-CN (#8231)

  `translation-section-name-missing` fired on every build of both example apps: a
  form or `record:details` section that declares a `label` but no `name` has no
  key a bundle can carry (`objects.<object>._sections.<name>.label`), so its
  heading renders in the source locale in EVERY locale — permanently, and
  invisibly, because every neighbouring field label on the same object
  translates fine. `app-crm` ships en + zh-CN; `app-showcase` ships the same.

  21 of the 24 flagged sections now declare a stable snake_case `name` and
  resolve a real (non-echoed) zh-CN label:

  - **app-crm** (9/9): `crm_activity` (`activity_details`, `related_records`,
    `notes`), `crm_lead` (`contact_us`, `lead_information`, `qualification`,
    `conversion`, `notes`), `crm_opportunity` (`opportunity`).
  - **app-showcase** (12/15): `showcase_project` form (`project`,
    `budget_schedule`) and its detail page (`overview`, `financials`,
    `timeline`); `showcase_task`'s detail page (`overview`, `schedule`,
    `details` — reusing the same names and zh-CN copy its `tabbed` form view
    already declares, so no new bundle entries were needed there);
    `showcase_inquiry` (`tell_us_about_yourself`); `showcase_business_unit`
    (`unit`); `showcase_preference`'s settings page (`appearance`,
    `notifications`).

  **Not named here — a `packages/**`conflict, out of this PR's scope.** Three`app-showcase` sections (`showcase_task`'s `formViews.edit`/`Task`and`formViews.quick`/`Quick Edit`, `showcase_contact`'s `formViews.create`/`Who is
  this?`) are pinned NAMELESS as regression fixtures by
`packages/lint/src/validate-translatable-sections.test.ts`and`validate-translation-references.test.ts`, which import `TaskViews`/`ContactViews`directly from this app and assert on their current unnamed
shape. Naming them requires a coordinated`packages/lint` test update; #8231
  remains open for that follow-up.

  Adding a `name` alone would have silenced the warning with zero translation
  delivered, so both apps also gain a generalized i18n-coverage sweep test
  (`examples/app-crm/test/i18n-sections.test.ts`,
  `examples/app-showcase/test/seed.test.ts`) asserting every section this PR
  touches BOTH has a `name` AND resolves a real, non-ASCII zh-CN
  `_sections.<name>.label` — not just that the section has a name.

- c13350b: feat(spec)!: retire `external.label` and `external.requirePermission` (#4583 batch D)

  Two keys on the federation block, both read by nothing.

  **`external.label`** — nothing rendered the federation block's own label. Setup →
  Datasources renders the datasource's **top-level** `label`, which every datasource already
  has, so this was a second display name that never displayed. The showcase example declared
  both; it now declares only the one that shows.

  **`external.requirePermission`** — no authorization check ever consulted it. A permission
  named here gated nothing: access to a federated datasource's data is governed by the
  ordinary object permission sets and RLS, exactly as for a managed datasource. Naming a
  permission that is never required is the false-compliance shape ADR-0049 exists to remove
  — it reads like an access control and is one only in the author's head.

  FROM → TO: delete `external.label` (use the top-level `label`); delete
  `external.requirePermission` and grant or withhold the object permissions instead.
  `os migrate meta --from 16` removes both automatically (conversion
  `datasource-inert-blocks-removed`).

  With these, the `datasource` liveness ledger reaches **zero dead properties** — down from
  the 20 it was seeded with in #4487, the highest dead ratio of any governed type.

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

- e8d0c21: feat(spec): `FormSection.pane` — explicit split-pane placement (objectui#2153 follow-up)

  A `type: 'split'` form view had no way to say which pane a section renders in:
  the renderer hardcoded "first section left, everything else right". That
  positional rule is invisible in the metadata — nothing in the JSON records the
  assignment — so reordering sections silently moved them across the divider, and
  an author (human or AI) could not place two sections side by side on the left at
  all.

  `FormSectionSchema` gains an optional `pane: 'primary' | 'secondary'`:

  - **Explicit and per-section**, so placement survives reordering and an agent
    editing the view can see — and must preserve — where each section lives.
  - **Omitted → the legacy rule** (first section `primary`, others `secondary`),
    so existing keyless metadata keeps its exact layout.
  - **Split-only, enforced loudly**: a `FormViewSchema` refinement rejects `pane`
    on any other form type at parse (covering the legacy `groups` alias and the
    defaulted `type: 'simple'`). "Accepted but ignored" is the failure mode this
    key must never have — a silent no-op reads as working, especially to an AI
    author. zod 4 keeps refinements through `.extend()`, so the flattened
    runtime-overlay variant in `ViewMetadataSchema` enforces it too.
  - Strict two-value enum, not free text — a typo (`'left'`) is a parse error.

  The `'split'` type's enum comment claimed "Master-Detail split"; master-detail
  already has two homes (`subforms` on the form, related lists on record pages),
  so the comment now states split's actual, non-redundant meaning: side-by-side
  resizable panes with sections placed via `section.pane`.

  The showcase task form's `split` view previously declared a single section —
  which renders as a plain (unsplit) form — and now demonstrates the feature:
  two sections with explicit panes.

  Renderer support ships in ObjectUI (`SplitForm` → `FormSchema.fieldPanes`,
  whose pane keys are already named `primary`/`secondary` — a 1:1 mapping).

- 284e7d2: fix(rest): a crashing hook body answers the sanitised fault envelope, not a raw `TypeError` at 400 (#7543)

  `POST /api/v1/data/showcase_task` with `{"title": 12345}` answered

  ```
  400 { "error": "TypeError: not a function", "object": "showcase_task" }
  ```

  — a JS runtime error as the client-facing message, in a body with no `code` at
  all. Two contract breaks in one response: an internal fault echoed verbatim to a
  caller, and an error body outside the ledgered envelope, so a client keying on
  `code` got nothing.

  **The seam.** `mapDataError` has two sandbox-unwrap branches, and they are the
  only ones in the file that emit `{ error, object }` with no `code` at 400. They
  exist for one shape: a hook or action body that runs
  `throw new Error('删除被阻断：仍有未结清的发票')` — an author writing a business
  rule whose message _is_ the remedy, which is answered verbatim at 400 and
  deliberately without a `code`. A body that instead **crashes** arrives as a
  thrown error too, so it took the same branch and its `TypeError` went out as if
  it were that author's message.

  **The fix.** Both branches now separate a body that _reported_ something from a
  body that _faulted_, by the thrown error's constructor name — the sandbox
  stringifies a throw as `<name>: <message>`, so a leading `TypeError:`,
  `ReferenceError:`, `RangeError:`, `SyntaxError:`, `URIError:`, `EvalError:`,
  `InternalError:` or `AggregateError:` is structural evidence of a crash rather
  than a keyword heuristic over prose. A crash answers the same sanitised
  `500 INTERNAL_ERROR` the mapper's terminal branch already gives — which is not
  new policy: that branch's own contract (#5489) names this exact case ("a plain
  handler bug (`TypeError: x is not a function`) … server faults that a caller
  cannot fix and a caller SHOULD retry"). The unwraps simply sat above it and
  intercepted the crash first.

  Both doors are guarded, not one. The `innerMessage` branch and the raw-message
  regex fallback produce byte-identical bodies, so classifying in only one would
  make the envelope depend on whether the `SandboxError` instance survived a
  rethrow.

  **Unchanged:** a deliberate refusal still reaches the caller verbatim at 400
  with no `code`. The fix changes _which_ errors take that branch, not what it
  emits. A body that expresses a business rule as `throw new RangeError('…')` is
  now sanitised — an accepted cost, since that is not the documented authoring
  style and the fail-safe direction is the one that does not ship runtime faults to
  clients. The operator still gets the full text: 500 is outside
  `isExpectedDataStatus`, so `handleRouteError` logs `[REST] Unhandled error` with
  the whole error.

  **Showcase.** `NormalizeTaskTitleHook` guarded its trim with truthiness
  (`if (ctx.input.title)`), so the number `12345` passed the guard and had no
  `.trim`. It now checks `typeof … === 'string'`. That is the actual cause of the
  reported repro, and with it fixed the request **succeeds** rather than erroring:
  `record-validator` coerces a `text` value with `String(value)`, so a number in a
  text field breaks no declared contract. These hook bodies are read as
  documentation, so the type-safe shape is the one to show — a hook must not assume
  a field's runtime type just because its metadata declares one.

- d62f8eb: feat(spec)!: refuse inline credentials at publish — driver `config.password` / `config.authToken` and connector `authentication` on authored entries (#7990)

  `sys_metadata.metadata` is served back by the ordinary data API, and a datasource or
  connector artefact is persisted whole — so any schema that _accepted_ an inline
  credential stored that credential in cleartext at rest. The maintainer-ruled fix
  (#7990, Option A: per-artefact contract closure) makes the two measured surfaces
  refuse the inline form at publish and divert to the mechanisms that already exist.

  **Driver config (postgres / mysql / mongo / turso).** `config.password` (SQL/mongo)
  and `config.authToken` (turso) are now declared-unwritable: writing one fails `tsc`
  (the input type is `never`) and fails the parse with a prescription naming the
  replacement. The former alias spellings (`passwd`, `pwd`, `token`, `jwt`,
  `auth_token`, `authtoken`) carry the same refusal. The connection form's masked
  secret input is unaffected — it never wrote `config`; it feeds the datasource secret
  binder, which encrypts into `sys_secret` and stores only an opaque handle.

  **Connector authoring door.** `DeclarativeConnectorEntrySchema` (behind
  `defineStack({ connectors })` and `PUT /meta/connector/:name`) now refuses a
  non-`none` `authentication` on **every** authored entry — catalog descriptors
  included. Until now only provider-bound instances were covered (ADR-0097 §3), so a
  descriptor could publish an inline `token`/`key`/`password`/`clientSecret`. The
  runtime shape is unchanged: a plugin handing resolved secrets to
  `registerConnector` keeps working.

  ## FROM → TO

  ```ts
  // before — accepted, stored in cleartext in sys_metadata
  defineDatasource({
    name: "warehouse",
    driver: "postgres",
    config: { database: "analytics", username: "ro", password: "hunter2" },
  });

  // after — the secret lives in the secret store; config carries no credential
  defineDatasource({
    name: "warehouse",
    driver: "postgres",
    schemaMode: "external",
    config: { database: "analytics", username: "ro" },
    external: { allowWrites: false, credentialsRef: "sys_secret:<handle>" },
  });
  // (Setup → Datasources binds the secret for you: its password field encrypts into
  // sys_secret and writes external.credentialsRef — it never wrote config.)
  ```

  ```ts
  // before — descriptor published an inline credential
  defineConnector({
    name: "erp",
    label: "ERP",
    type: "saas",
    authentication: { type: "api-key", key: "…", headerName: "X-API-Key" },
  });

  // after — descriptor: no live credentials (document the scheme in prose);
  defineConnector({
    name: "erp",
    label: "ERP",
    type: "saas",
    description: "Authenticates with an API key in the X-API-Key header.",
  });
  // instance: reference the credential (ADR-0097 §3)
  defineConnector({
    name: "erp",
    label: "ERP",
    type: "saas",
    provider: "openapi",
    providerConfig: { spec: "./erp-openapi.json" },
    auth: { type: "api-key", credentialRef: "ERP_API_KEY" },
  });
  ```

  There is deliberately **no automatic rewrite**: moving a cleartext credential into
  `sys_secret` requires encrypting it through a running secret binder, which a
  source-file transform cannot do — auto-deleting the key would silently drop a live
  credential instead. `os migrate meta` surfaces both changes as structured TODOs
  (semantic entries `datasource-config-inline-credential-refused`,
  `connector-inline-authentication-publish-refused`). The migration story for
  **already-stored** cleartext rows is programme scope, tracked as a follow-up card
  under #7990 — this release closes the doors that keep writing new ones.

  <!-- adr-0087: registered datasource-config-inline-credential-refused, connector-inline-authentication-publish-refused -->

- 69f1a5f: showcase: stop the Invoice Dual Sign-off approval demo stranding its flow run

  `showcase_invoice_signoff`'s `notify_cleared` node addressed `{record.account.owner}`
  while its `start` node declared no `config.expand`, so the hop read a scalar foreign key
  and resolved to nothing. The notify node refuses a run with no recipients, so approving
  the showcase's marquee approval demo recorded the decision and then stranded the flow
  run — the "Notify: Cleared" inbox message never arrived.

  The hop was unfixable as written: `showcase_account` has no `owner` field, so hydrating
  the relation would not have helped. The notice now addresses `showcase_invoice.owner`
  (the seeded rep, and the object's own row-level-security anchor), while the start node
  declares `expand: ['account']` and the message body reads `{record.account.name}` — so
  the demo still teaches the relation-hydration path, with a field the account really has.

  The same resume-time pattern is fixed in `showcase_task_done_notify_owner`, which hopped
  `{record.project.owner}` into a subflow's notify with no `expand` on its start node.

- d6bfb3d: refactor(spec)!: remove the RLS-policy `priority` key — it promised conflict resolution that cannot exist (#3896 audit)

  `RowLevelSecurityPolicySchema.priority` was documented as _"Policy priority for
  conflict resolution"_. The 2026-07-30 security-subset liveness re-verification
  found that **nothing ever read it** — and, stronger, that nothing ever could:
  applicable policies **OR-combine** (any match allows access, most permissive
  wins — the schema's own describe said so), so there is never a conflict to
  order and evaluation order cannot change an outcome. A semantically-void knob
  on a security policy is worse than dead: an author — very often an AI
  (ADR-0033) — reads it as a precedence lever and reasons about policy
  interactions that do not exist.

  Removed per the `tool.requiresConfirmation` (#3715) / `DynamicLoadingConfig`
  (#3950) precedent, inside the v17 breaking window:

  - **Tombstoned, not silently stripped** (`retiredKey`, #3855 pattern): an
    authored `priority` fails `tsc` (the input type is `never`) and rejects at
    parse with the prescription itself — _"policies OR-combine (most permissive
    wins), so there is no conflict to order. Delete the key — policy outcomes are
    unchanged."_
  - **ADR-0087 D2 conversion + D3 chain step** (`permission-rls-priority-removed`):
    `os migrate meta` deletes the key from authored sources mechanically — a pure
    lossless delete, no semantic residue. spec-changes.json and the protocol
    upgrade guide carry the entry.
  - The policy factory helpers (`ownerPolicy`, `tenantPolicy`, …), the showcase
    example's permission sets, and `content/docs/permissions/rls.mdx` no longer
    author it; the docs table's `enabled` row now states the (since-enforced)
    contract instead.
  - Liveness ledger entry updated to record the removal; the tombstone and entry
    age out ~two majors from now.

  Dropping the key changes **no policy outcome anywhere** — that impossibility of
  effect is the entire reason for the removal.

- 9f41ee6: test(e2e,showcase): showcase 的 `apis:` 回迁,并由真实 boot 探针证明它真的在服务(#5040 E8)

  #4936 把 showcase 的两条声明式端点注释掉,不是因为它们写错了,而是因为当时整条端点链零执行:没有任何路由为声明的 `path` 挂载,没有匹配器,每一个键 —— 包括 `authRequired` —— 解析通过而不生效。那时候留着它们就是在演示一个运行时不兑现的能力(Prime Directive #10)。

  #5040 的 E1–E7 把执行器建起来、把整面硬拒收窄成逐端点 publish 门之后,那条理由不复存在。本单按**原意**恢复这两条 —— 同名、同 target、同 `authRequired`、同 `cacheTtl` —— 只做 ADR-0121 D1 要求的一处修改:路径迁进本应用的命名空间保留区。

  ```
  - path: '/api/v1/showcase/tasks'
  + path: '/api/v1/apps/showcase/tasks'

  - path: '/api/v1/showcase/inquiries/purge'
  + path: '/api/v1/apps/showcase/inquiries/purge'
  ```

  这处修改不是装饰:`manifest.namespace: 'showcase'` 从此是发布的前置条件(声明了 `apis:` 却没有显式 namespace 会被 publish 拒绝),而 `apps/{namespace}/` 这一段让路由归属变成结构性的 —— 没有任何内建域住在 `apps/` 下,两个包也不可能因为 namespace 不同而撞车。

  **匿名面没有增加**:两条历史声明本来就都是 `authRequired: true`,回迁后仍然是。一个例子不该长出它从来没有过的公开面。

  coverage 清单里 `apis` 从 `waived` 翻回 `demonstrated`,理由重写为「由真实 boot 测量」而不是「声明即证明」—— 后者正是 #4936 抓到的那类假覆盖。支撑它的是两份新的真实 boot e2e:showcase 那份走真实 artifact 摄入路径,证明匹配命中执行(find 的 data 与内建 `/data` 路由逐字节相同)、匿名 401、`cacheTtl` 只随成功答案上线、挂载点下未声明路径与挂载点外的裸 404 完全一致、`/meta/api` 与 `/openapi.json` 描述的正是挂载的东西;fixture 那份补上 ADR-0121 D6 的匿名分支 —— 省略 `authRequired` 拒绝匿名、显式 `false` 服务匿名、已装配预算耗尽后 429 且 `Retry-After` 真的在线上。

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
- Updated dependencies [5823d59]
- Updated dependencies [3140f9c]
- Updated dependencies [9500ba4]
- Updated dependencies [fa3d0cf]
- Updated dependencies [698cbc2]
- Updated dependencies [af5a224]
- Updated dependencies [71f76e1]
- Updated dependencies [37b1346]
- Updated dependencies [99736a0]
- Updated dependencies [fe67e34]
- Updated dependencies [fdb4f50]
- Updated dependencies [270650f]
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
- Updated dependencies [06be54e]
- Updated dependencies [28ad90e]
- Updated dependencies [76d74ec]
- Updated dependencies [201b31f]
- Updated dependencies [e6b1b69]
- Updated dependencies [29e28a3]
- Updated dependencies [c7f4417]
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
- Updated dependencies [553a47f]
- Updated dependencies [43a7a8d]
- Updated dependencies [116c0d9]
- Updated dependencies [a98085f]
- Updated dependencies [20b1a9e]
- Updated dependencies [344a22a]
- Updated dependencies [4827e91]
- Updated dependencies [8d895ff]
- Updated dependencies [86f7a20]
- Updated dependencies [9f747ee]
- Updated dependencies [a3a884d]
- Updated dependencies [cfed092]
- Updated dependencies [203a449]
- Updated dependencies [8f9689f]
- Updated dependencies [73f69dc]
- Updated dependencies [04c56aa]
- Updated dependencies [f6472d7]
- Updated dependencies [c546c89]
- Updated dependencies [57a3bb3]
- Updated dependencies [627e65a]
- Updated dependencies [4c5df00]
- Updated dependencies [b16dcb4]
- Updated dependencies [22df871]
- Updated dependencies [b3efeb7]
- Updated dependencies [ecb39ea]
- Updated dependencies [ddd075a]
- Updated dependencies [88154be]
- Updated dependencies [db12b88]
- Updated dependencies [62452c6]
- Updated dependencies [6f6fec7]
- Updated dependencies [7d1ff75]
- Updated dependencies [e8dc61e]
- Updated dependencies [9c82146]
- Updated dependencies [5f9a987]
- Updated dependencies [744b8f5]
- Updated dependencies [ac37fc6]
- Updated dependencies [2f3e793]
- Updated dependencies [4820f55]
- Updated dependencies [462d9c4]
- Updated dependencies [78caf51]
- Updated dependencies [7d21581]
- Updated dependencies [37785ed]
- Updated dependencies [62a789b]
- Updated dependencies [2e284b2]
- Updated dependencies [d8e8d9c]
- Updated dependencies [789ad63]
- Updated dependencies [f2445c9]
- Updated dependencies [94e749b]
- Updated dependencies [ea1d916]
- Updated dependencies [2af1988]
- Updated dependencies [0af50a3]
- Updated dependencies [f7d80f4]
- Updated dependencies [fce14ab]
- Updated dependencies [43ca399]
- Updated dependencies [1b49eaf]
- Updated dependencies [ae31a19]
- Updated dependencies [2e836de]
- Updated dependencies [e0f300b]
- Updated dependencies [0161c7f]
- Updated dependencies [e900015]
- Updated dependencies [db02d47]
- Updated dependencies [b5bdf48]
- Updated dependencies [23338c3]
- Updated dependencies [7309c81]
- Updated dependencies [d3f2ff6]
- Updated dependencies [b7550d6]
- Updated dependencies [0164f40]
- Updated dependencies [e295ad1]
- Updated dependencies [12a19a8]
- Updated dependencies [5b843fb]
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
- Updated dependencies [04476e7]
- Updated dependencies [67bf2e2]
- Updated dependencies [eaaf03c]
- Updated dependencies [d17df80]
- Updated dependencies [7d0e7b5]
- Updated dependencies [c6d1cb4]
- Updated dependencies [6513c17]
- Updated dependencies [36030ff]
- Updated dependencies [e38db3d]
- Updated dependencies [a225ef5]
- Updated dependencies [79228cd]
- Updated dependencies [6117f7b]
- Updated dependencies [7bf5349]
- Updated dependencies [48c110e]
- Updated dependencies [87aca93]
- Updated dependencies [e533b0b]
- Updated dependencies [cdf4d9a]
- Updated dependencies [aee1806]
- Updated dependencies [37b82ed]
- Updated dependencies [c13350b]
- Updated dependencies [c13350b]
- Updated dependencies [63b33e6]
- Updated dependencies [01faeb1]
- Updated dependencies [2c1988c]
- Updated dependencies [9ca2d85]
- Updated dependencies [c13350b]
- Updated dependencies [366105c]
- Updated dependencies [99d7a93]
- Updated dependencies [c9d254a]
- Updated dependencies [d92ed03]
- Updated dependencies [891d345]
- Updated dependencies [42e3b01]
- Updated dependencies [c8124e5]
- Updated dependencies [a52e2ef]
- Updated dependencies [5293114]
- Updated dependencies [376a061]
- Updated dependencies [ff17642]
- Updated dependencies [c142ced]
- Updated dependencies [211abdb]
- Updated dependencies [b3363e9]
- Updated dependencies [39eb01b]
- Updated dependencies [c3bcb42]
- Updated dependencies [19e3e6e]
- Updated dependencies [eda599e]
- Updated dependencies [a1a4140]
- Updated dependencies [c20b875]
- Updated dependencies [7c7e246]
- Updated dependencies [7bf3d1c]
- Updated dependencies [2ef1807]
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
- Updated dependencies [32d3800]
- Updated dependencies [606d577]
- Updated dependencies [4384921]
- Updated dependencies [d367f03]
- Updated dependencies [45e711a]
- Updated dependencies [465a0fa]
- Updated dependencies [cf5e033]
- Updated dependencies [6de592c]
- Updated dependencies [d254421]
- Updated dependencies [e2798fa]
- Updated dependencies [e2798fa]
- Updated dependencies [e2798fa]
- Updated dependencies [06ba036]
- Updated dependencies [3c628ce]
- Updated dependencies [347f460]
- Updated dependencies [c2d9098]
- Updated dependencies [0fd8556]
- Updated dependencies [3c7bcc0]
- Updated dependencies [4b6cac7]
- Updated dependencies [7631964]
- Updated dependencies [18b8eaa]
- Updated dependencies [ac471a0]
- Updated dependencies [60ae58e]
- Updated dependencies [a5d3aa1]
- Updated dependencies [7f62706]
- Updated dependencies [667fa44]
- Updated dependencies [37e38d1]
- Updated dependencies [e906126]
- Updated dependencies [ce92674]
- Updated dependencies [08363a0]
- Updated dependencies [444de5b]
- Updated dependencies [8a341a4]
- Updated dependencies [78adc2e]
- Updated dependencies [0f17114]
- Updated dependencies [a227ed7]
- Updated dependencies [7cb922e]
- Updated dependencies [1d22114]
- Updated dependencies [81e2744]
- Updated dependencies [277eb36]
- Updated dependencies [41e605e]
- Updated dependencies [2649ccb]
- Updated dependencies [1eb13a0]
- Updated dependencies [a70cd0a]
- Updated dependencies [c52e608]
- Updated dependencies [9613396]
- Updated dependencies [3f7b4ff]
- Updated dependencies [74155c7]
- Updated dependencies [b5f9397]
- Updated dependencies [ed77493]
- Updated dependencies [6908830]
- Updated dependencies [8b06bba]
- Updated dependencies [58a03d2]
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
- Updated dependencies [4ed7ed4]
- Updated dependencies [9b9b70f]
- Updated dependencies [f5a9bc2]
- Updated dependencies [e59786e]
- Updated dependencies [2fa4ca1]
- Updated dependencies [bcf1112]
- Updated dependencies [baeb4f0]
- Updated dependencies [29488cc]
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
- Updated dependencies [b49ccfd]
- Updated dependencies [c7406b0]
- Updated dependencies [5b89711]
- Updated dependencies [85d95e7]
- Updated dependencies [08cd163]
- Updated dependencies [0c8a22f]
- Updated dependencies [6f98c2d]
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
- Updated dependencies [abeb375]
- Updated dependencies [cb3b6cd]
- Updated dependencies [73b7234]
- Updated dependencies [d2b97c3]
- Updated dependencies [61cc079]
- Updated dependencies [45dc446]
- Updated dependencies [0e96e46]
- Updated dependencies [7674859]
- Updated dependencies [c1d44f7]
- Updated dependencies [59b794f]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [db59e9c]
- Updated dependencies [fc3a36a]
- Updated dependencies [ab9fb5c]
- Updated dependencies [69787f0]
- Updated dependencies [5d022a1]
- Updated dependencies [042b9ee]
- Updated dependencies [f985b3f]
- Updated dependencies [795b6e1]
- Updated dependencies [d52d4fe]
- Updated dependencies [742cebb]
- Updated dependencies [175d789]
- Updated dependencies [f549a0d]
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
- Updated dependencies [4856789]
- Updated dependencies [81ce41a]
- Updated dependencies [85e1e4e]
- Updated dependencies [c3f4916]
- Updated dependencies [55dbbba]
- Updated dependencies [33e0385]
- Updated dependencies [dac6a08]
- Updated dependencies [72c3c86]
- Updated dependencies [9fd9ae7]
- Updated dependencies [2d8dba3]
- Updated dependencies [7f1a635]
- Updated dependencies [2205363]
- Updated dependencies [09fe58d]
- Updated dependencies [f9fc874]
- Updated dependencies [d62f8eb]
- Updated dependencies [d0a5ceb]
- Updated dependencies [a7586cd]
- Updated dependencies [7737bc8]
- Updated dependencies [4c5e80e]
- Updated dependencies [ef678d0]
- Updated dependencies [4b5702a]
- Updated dependencies [011b386]
- Updated dependencies [e18a162]
- Updated dependencies [394b7a1]
- Updated dependencies [ce92674]
- Updated dependencies [cf2c9b7]
- Updated dependencies [d127ff0]
- Updated dependencies [af05400]
- Updated dependencies [36d90fc]
- Updated dependencies [7777e8f]
- Updated dependencies [9b86cf6]
- Updated dependencies [c51ffa5]
- Updated dependencies [d063a96]
- Updated dependencies [8825a06]
- Updated dependencies [5087ac6]
- Updated dependencies [677b591]
- Updated dependencies [fa48973]
- Updated dependencies [cf7c694]
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
- Updated dependencies [6146b67]
- Updated dependencies [df95346]
- Updated dependencies [3dede58]
- Updated dependencies [c6b6bb4]
- Updated dependencies [5a45b9b]
- Updated dependencies [594508e]
- Updated dependencies [7cf42fe]
- Updated dependencies [5966c2a]
- Updated dependencies [402f534]
- Updated dependencies [1c8bf4f]
- Updated dependencies [ac1cc8c]
- Updated dependencies [99b4392]
- Updated dependencies [591f675]
- Updated dependencies [0045682]
- Updated dependencies [974c6d4]
- Updated dependencies [7309c81]
- Updated dependencies [2f59da0]
- Updated dependencies [8aacf94]
- Updated dependencies [d56012f]
- Updated dependencies [73648ba]
- Updated dependencies [f78dd83]
- Updated dependencies [a2cd18a]
- Updated dependencies [9051802]
- Updated dependencies [20bc1ec]
- Updated dependencies [1c625ca]
- Updated dependencies [2f8328c]
- Updated dependencies [a954634]
- Updated dependencies [2a6c279]
- Updated dependencies [8c8f0df]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [90c2b15]
- Updated dependencies [7180ed5]
- Updated dependencies [4638aaa]
- Updated dependencies [0222d3c]
- Updated dependencies [08863dd]
- Updated dependencies [33a5ff4]
- Updated dependencies [9e01213]
- Updated dependencies [39eb01b]
- Updated dependencies [071d0dc]
- Updated dependencies [f293d45]
- Updated dependencies [56664f5]
- Updated dependencies [71f205d]
- Updated dependencies [f067930]
- Updated dependencies [414395b]
- Updated dependencies [42eeb7d]
- Updated dependencies [31cbe90]
- Updated dependencies [6b7129a]
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
- Updated dependencies [4addd9d]
- Updated dependencies [ef7b5ef]
- Updated dependencies [9514767]
- Updated dependencies [8f20201]
- Updated dependencies [155507e]
- Updated dependencies [643b7c7]
- Updated dependencies [7bba90b]
- Updated dependencies [8813b90]
- Updated dependencies [108ba8d]
- Updated dependencies [2a5f04a]
- Updated dependencies [4f740b0]
- Updated dependencies [7ce02eb]
- Updated dependencies [b4ad984]
- Updated dependencies [a9f32df]
- Updated dependencies [aeb9b27]
- Updated dependencies [1203bb2]
- Updated dependencies [7d27da0]
- Updated dependencies [b948a41]
- Updated dependencies [4fccace]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
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
- Updated dependencies [3fe0ff1]
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
- Updated dependencies [27358d5]
- Updated dependencies [7127b48]
- Updated dependencies [1c3da1f]
- Updated dependencies [c1f344b]
- Updated dependencies [1fa224a]
- Updated dependencies [3eb1b2b]
- Updated dependencies [9c93465]
- Updated dependencies [a34fd2e]
- Updated dependencies [ebb209c]
- Updated dependencies [76bcb83]
- Updated dependencies [8e08bc3]
- Updated dependencies [59b85c0]
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
- Updated dependencies [9c5abf4]
- Updated dependencies [82397b6]
- Updated dependencies [31e0be9]
- Updated dependencies [4bfd455]
- Updated dependencies [ffd2ce2]
- Updated dependencies [2a44c1d]
- Updated dependencies [7084313]
- Updated dependencies [f07808c]
- Updated dependencies [477195c]
- Updated dependencies [7ffc3d3]
- Updated dependencies [88346ba]
- Updated dependencies [4631592]
- Updated dependencies [62f8017]
- Updated dependencies [32ff033]
- Updated dependencies [a831df1]
- Updated dependencies [f752ee3]
- Updated dependencies [a1b61e0]
- Updated dependencies [cd6b9f2]
- Updated dependencies [2cb6d3c]
- Updated dependencies [3ba8d77]
- Updated dependencies [af2a095]
- Updated dependencies [5ac93d4]
- Updated dependencies [3d5f726]
- Updated dependencies [695cfbd]
- Updated dependencies [0e043d8]
- Updated dependencies [70a1ce1]
- Updated dependencies [93f267f]
- Updated dependencies [7445149]
- Updated dependencies [ec796d5]
- Updated dependencies [071d0dc]
- Updated dependencies [0024abf]
- Updated dependencies [8dd98bf]
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
- Updated dependencies [0931185]
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
- Updated dependencies [4018fc1]
- Updated dependencies [631ddbf]
- Updated dependencies [8f124a7]
- Updated dependencies [21ca1d5]
- Updated dependencies [03b11e8]
- Updated dependencies [89d7b35]
- Updated dependencies [0cd08d5]
- Updated dependencies [8891f93]
- Updated dependencies [6155c3c]
- Updated dependencies [d729a31]
- Updated dependencies [b30963d]
- Updated dependencies [cb8322e]
- Updated dependencies [94f7b6a]
- Updated dependencies [1d5dc46]
- Updated dependencies [d13f627]
- Updated dependencies [5c94f83]
- Updated dependencies [ea936f3]
- Updated dependencies [f98fa65]
- Updated dependencies [0c0fbd9]
- Updated dependencies [667b83e]
- Updated dependencies [f3141d8]
- Updated dependencies [7687f7b]
- Updated dependencies [5a84d41]
- Updated dependencies [fd3013a]
- Updated dependencies [85ec26d]
- Updated dependencies [73e576f]
- Updated dependencies [f6476fc]
- Updated dependencies [69ac82c]
- Updated dependencies [4ac12ef]
- Updated dependencies [833ed84]
- Updated dependencies [a18abf3]
- Updated dependencies [86d2e5e]
- Updated dependencies [c6a4eeb]
- Updated dependencies [1659072]
- Updated dependencies [f450ae7]
- Updated dependencies [810a3a2]
- Updated dependencies [abceb0d]
- Updated dependencies [627b188]
- Updated dependencies [8d4eae7]
- Updated dependencies [c5a5996]
- Updated dependencies [9981c1d]
- Updated dependencies [d60968c]
- Updated dependencies [0c302a7]
- Updated dependencies [b88f5e8]
- Updated dependencies [857a6cf]
- Updated dependencies [5cfd4d5]
- Updated dependencies [1e38158]
- Updated dependencies [cba7454]
- Updated dependencies [65a3a84]
- Updated dependencies [6633337]
- Updated dependencies [21676eb]
- Updated dependencies [e9cb9ab]
- Updated dependencies [42cc219]
- Updated dependencies [d7e0b42]
- Updated dependencies [0996899]
- Updated dependencies [de6daa5]
- Updated dependencies [378d8b1]
- Updated dependencies [3510e4a]
- Updated dependencies [d5749d7]
- Updated dependencies [f00d8d4]
- Updated dependencies [5326b36]
- Updated dependencies [aa4b90d]
- Updated dependencies [ccd9397]
- Updated dependencies [503be86]
- Updated dependencies [647ec8b]
- Updated dependencies [54299ca]
- Updated dependencies [3264516]
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
- Updated dependencies [193cd5c]
- Updated dependencies [f1544e2]
- Updated dependencies [7457a09]
- Updated dependencies [5aae790]
- Updated dependencies [07f1822]
- Updated dependencies [d48aad5]
- Updated dependencies [5f0852f]
- Updated dependencies [c53aa53]
- Updated dependencies [6f23667]
- Updated dependencies [cca11e9]
- Updated dependencies [cfb549d]
- Updated dependencies [77a77fd]
- Updated dependencies [d82f8c0]
- Updated dependencies [cde1975]
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
- Updated dependencies [2053714]
- Updated dependencies [60b672e]
- Updated dependencies [6b441a8]
- Updated dependencies [ce0cfe9]
- Updated dependencies [04f1182]
- Updated dependencies [be87153]
- Updated dependencies [dd0f681]
- Updated dependencies [60f0dd8]
- Updated dependencies [a87c5cd]
- Updated dependencies [a47f338]
- Updated dependencies [b3a3d83]
- Updated dependencies [7a55913]
- Updated dependencies [35accbf]
- Updated dependencies [6038de7]
- Updated dependencies [fc5f536]
- Updated dependencies [bee5ffe]
- Updated dependencies [5647006]
- Updated dependencies [e654bfd]
- Updated dependencies [01a7337]
- Updated dependencies [b45c71e]
- Updated dependencies [d71ff32]
- Updated dependencies [7309c81]
- Updated dependencies [3172831]
- Updated dependencies [f8cfbb4]
- Updated dependencies [5aaa6fc]
- Updated dependencies [dca5bd3]
- Updated dependencies [939f579]
- Updated dependencies [6e6c872]
- Updated dependencies [2598216]
- Updated dependencies [11949fc]
- Updated dependencies [2c7e62d]
- Updated dependencies [eb95d97]
- Updated dependencies [b098b0e]
- Updated dependencies [4d00b13]
- Updated dependencies [1363084]
- Updated dependencies [fa5758e]
- Updated dependencies [38f7e4f]
- Updated dependencies [eb7613c]
- Updated dependencies [c57f3cf]
- Updated dependencies [43f37e1]
- Updated dependencies [ecf0bef]
- Updated dependencies [68f5ecc]
- Updated dependencies [b0c16a5]
- Updated dependencies [ecc9110]
- Updated dependencies [e4c2dc8]
- Updated dependencies [97faca3]
- Updated dependencies [57bab76]
- Updated dependencies [43fc039]
- Updated dependencies [c89d18c]
- Updated dependencies [1bd2795]
- Updated dependencies [f7bd4e2]
- Updated dependencies [694c350]
- Updated dependencies [361bd5b]
- Updated dependencies [acf34e3]
- Updated dependencies [aac90a5]
- Updated dependencies [bd5fc38]
- Updated dependencies [3da3da5]
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
- Updated dependencies [a0fdc56]
- Updated dependencies [b95577a]
- Updated dependencies [0dcbc11]
- Updated dependencies [2342ee4]
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
- Updated dependencies [69f1dfd]
- Updated dependencies [bbe05de]
- Updated dependencies [355e951]
- Updated dependencies [a1dd1e4]
- Updated dependencies [a5dcb74]
- Updated dependencies [dadb43f]
  - @objectstack/spec@17.0.0
  - @objectstack/runtime@17.0.0
  - @objectstack/driver-sql@17.0.0
  - @objectstack/cloud-connection@17.0.0
  - @objectstack/connector-mcp@17.0.0
  - @objectstack/connector-openapi@17.0.0
  - @objectstack/connector-rest@17.0.0
  - @objectstack/connector-slack@17.0.0
  - @objectstack/service-datasource@17.0.0

## 0.3.14-rc.5

### Patch Changes

- 69f1a5f: showcase: stop the Invoice Dual Sign-off approval demo stranding its flow run

  `showcase_invoice_signoff`'s `notify_cleared` node addressed `{record.account.owner}`
  while its `start` node declared no `config.expand`, so the hop read a scalar foreign key
  and resolved to nothing. The notify node refuses a run with no recipients, so approving
  the showcase's marquee approval demo recorded the decision and then stranded the flow
  run — the "Notify: Cleared" inbox message never arrived.

  The hop was unfixable as written: `showcase_account` has no `owner` field, so hydrating
  the relation would not have helped. The notice now addresses `showcase_invoice.owner`
  (the seeded rep, and the object's own row-level-security anchor), while the start node
  declares `expand: ['account']` and the message body reads `{record.account.name}` — so
  the demo still teaches the relation-hydration path, with a field the account really has.

  The same resume-time pattern is fixed in `showcase_task_done_notify_owner`, which hopped
  `{record.project.owner}` into a subflow's notify with no `expand` on its start node.

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
- Updated dependencies [29e28a3]
- Updated dependencies [259459d]
- Updated dependencies [3f7f14e]
- Updated dependencies [6968885]
- Updated dependencies [eaed61f]
- Updated dependencies [debe2f6]
- Updated dependencies [97b0798]
- Updated dependencies [43a7a8d]
- Updated dependencies [73f69dc]
- Updated dependencies [04c56aa]
- Updated dependencies [4c5df00]
- Updated dependencies [b3efeb7]
- Updated dependencies [ddd075a]
- Updated dependencies [88154be]
- Updated dependencies [db12b88]
- Updated dependencies [6f6fec7]
- Updated dependencies [7d1ff75]
- Updated dependencies [e8dc61e]
- Updated dependencies [2f3e793]
- Updated dependencies [d8e8d9c]
- Updated dependencies [94e749b]
- Updated dependencies [ea1d916]
- Updated dependencies [f7d80f4]
- Updated dependencies [ae31a19]
- Updated dependencies [e0f300b]
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
- Updated dependencies [01faeb1]
- Updated dependencies [d92ed03]
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
- Updated dependencies [d367f03]
- Updated dependencies [45e711a]
- Updated dependencies [465a0fa]
- Updated dependencies [6de592c]
- Updated dependencies [d254421]
- Updated dependencies [e2798fa]
- Updated dependencies [e2798fa]
- Updated dependencies [e2798fa]
- Updated dependencies [0fd8556]
- Updated dependencies [74155c7]
- Updated dependencies [6908830]
- Updated dependencies [8b06bba]
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
- Updated dependencies [cb3b6cd]
- Updated dependencies [73b7234]
- Updated dependencies [d2b97c3]
- Updated dependencies [59b794f]
- Updated dependencies [db59e9c]
- Updated dependencies [fc3a36a]
- Updated dependencies [69787f0]
- Updated dependencies [5d022a1]
- Updated dependencies [042b9ee]
- Updated dependencies [f549a0d]
- Updated dependencies [a36db28]
- Updated dependencies [3f8817a]
- Updated dependencies [a2443e3]
- Updated dependencies [e1554b1]
- Updated dependencies [4856789]
- Updated dependencies [c3f4916]
- Updated dependencies [33e0385]
- Updated dependencies [2205363]
- Updated dependencies [09fe58d]
- Updated dependencies [d0a5ceb]
- Updated dependencies [7737bc8]
- Updated dependencies [ef678d0]
- Updated dependencies [e18a162]
- Updated dependencies [d127ff0]
- Updated dependencies [9b86cf6]
- Updated dependencies [c51ffa5]
- Updated dependencies [8825a06]
- Updated dependencies [5087ac6]
- Updated dependencies [2d1ddf0]
- Updated dependencies [354b00f]
- Updated dependencies [3de535b]
- Updated dependencies [fe2e15a]
- Updated dependencies [6146b67]
- Updated dependencies [c6b6bb4]
- Updated dependencies [2f59da0]
- Updated dependencies [73648ba]
- Updated dependencies [a954634]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [08863dd]
- Updated dependencies [56664f5]
- Updated dependencies [31cbe90]
- Updated dependencies [90bbf25]
- Updated dependencies [eb91eba]
- Updated dependencies [8fbed3b]
- Updated dependencies [42da73d]
- Updated dependencies [643b7c7]
- Updated dependencies [b948a41]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [b295e4b]
- Updated dependencies [2233a85]
- Updated dependencies [62dd69a]
- Updated dependencies [e15e679]
- Updated dependencies [2ab1257]
- Updated dependencies [4cc4fb7]
- Updated dependencies [2c26040]
- Updated dependencies [f758cec]
- Updated dependencies [1fa224a]
- Updated dependencies [78f0be8]
- Updated dependencies [35f7fb4]
- Updated dependencies [a5302c7]
- Updated dependencies [82397b6]
- Updated dependencies [7084313]
- Updated dependencies [0e043d8]
- Updated dependencies [dadd1ad]
- Updated dependencies [2f2e63c]
- Updated dependencies [486d526]
- Updated dependencies [f8fe47e]
- Updated dependencies [89d7b35]
- Updated dependencies [6155c3c]
- Updated dependencies [d13f627]
- Updated dependencies [85ec26d]
- Updated dependencies [f6476fc]
- Updated dependencies [4ac12ef]
- Updated dependencies [b88f5e8]
- Updated dependencies [42cc219]
- Updated dependencies [d7e0b42]
- Updated dependencies [0996899]
- Updated dependencies [378d8b1]
- Updated dependencies [3510e4a]
- Updated dependencies [aa4b90d]
- Updated dependencies [54299ca]
- Updated dependencies [3264516]
- Updated dependencies [dc61def]
- Updated dependencies [251e888]
- Updated dependencies [183b4c4]
- Updated dependencies [2fdb36e]
- Updated dependencies [62159bd]
- Updated dependencies [d48aad5]
- Updated dependencies [cca11e9]
- Updated dependencies [cfb549d]
- Updated dependencies [20526f5]
- Updated dependencies [c5eef1d]
- Updated dependencies [e0f300b]
- Updated dependencies [761a0ba]
- Updated dependencies [be87153]
- Updated dependencies [60f0dd8]
- Updated dependencies [a87c5cd]
- Updated dependencies [a47f338]
- Updated dependencies [bee5ffe]
- Updated dependencies [3172831]
- Updated dependencies [939f579]
- Updated dependencies [2598216]
- Updated dependencies [2c7e62d]
- Updated dependencies [eb7613c]
- Updated dependencies [68f5ecc]
- Updated dependencies [b0c16a5]
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
  - @objectstack/spec@17.0.0-rc.6
  - @objectstack/driver-sql@17.0.0-rc.6
  - @objectstack/runtime@17.0.0-rc.6
  - @objectstack/service-datasource@17.0.0-rc.6
  - @objectstack/cloud-connection@17.0.0-rc.6
  - @objectstack/connector-mcp@17.0.0-rc.6
  - @objectstack/connector-openapi@17.0.0-rc.6
  - @objectstack/connector-rest@17.0.0-rc.6
  - @objectstack/connector-slack@17.0.0-rc.6

## 0.3.14-rc.4

### Patch Changes

- Updated dependencies [e8f8f6c]
- Updated dependencies [7f713b6]
- Updated dependencies [c960170]
- Updated dependencies [def5919]
- Updated dependencies [ce0cfe9]
- Updated dependencies [1363084]
  - @objectstack/spec@17.0.0-rc.5
  - @objectstack/cloud-connection@17.0.0-rc.5
  - @objectstack/connector-mcp@17.0.0-rc.5
  - @objectstack/connector-openapi@17.0.0-rc.5
  - @objectstack/connector-rest@17.0.0-rc.5
  - @objectstack/connector-slack@17.0.0-rc.5
  - @objectstack/driver-sql@17.0.0-rc.5
  - @objectstack/runtime@17.0.0-rc.5
  - @objectstack/service-datasource@17.0.0-rc.5

## 0.3.14-rc.3

### Patch Changes

- 3905c00: feat(objectql)!: a predicate bulk write evaluates and fires after-hooks PER ROW (#5038)

  The 2026-08-04 maintainer ruling on #4800 / #4862, recorded as ADR-0058's
  bulk-write addendum: **a bulk write is N record changes**, so every record-scoped
  declaration on it is evaluated per row — `record` = that row's state, `previous` =
  that row's pre-write state. Validation predicates have worked this way since
  #3106; hook `condition`s and the record-change flow triggers riding the same
  lifecycle hooks now join them.

  **What was broken.** A `multi: true` update reaches `driver.updateMany`, which
  resolves an affected COUNT. The lifecycle hook fired **once**, `previous` was
  never assigned (only the single-id branch fetched a prior row), and `record`
  degraded to the write's bare payload. So the transition condition the docs, the
  formula skill and ten showcase flows all teach —
  `status == "done" && previous.status != "done"` — could not be evaluated on a
  bulk write. Hook conditions rejected the write (#4775/#5037); record-change flow
  triggers were **silent**, firing zero times or once for a record that did not
  exist. A missing audit row is the one failure nobody goes looking for.

  **What changed.** The engine's bulk `update` / `delete` branches now read the
  matched row set **once** — the same `driver.find` #3106 already issues, with
  "this object has after-hooks" added to its demand test — and dispatch
  `afterUpdate` / `afterDelete` once per matched row, each on a context with the
  **single-record shape**: `input.id` = the row, `previous` = its pre-image,
  `result` = its state. That is #2922's batch-INSERT ruling restated, and it is why
  this fix has no code in the consumers: `hook-wrappers`' `record`/`previous`
  bindings, the record-change trigger's context builder and plugin-audit's diff all
  read those same fields and became correct at the producer.

  - **Per-row dispatch is uniform across after-hooks.** It is deliberately NOT
    keyed on whether a condition mentions `previous` — the ruling rejected that as
    a hidden rule that would make a hook's firing count depend on its condition
    text.
  - **`ctx.result` per row is the ROW**, composed as `row ⊕ payload` from the
    pre-image already in hand, so the batch still costs one extra query, not one
    per row. A bulk DELETE has no post-state: its per-row context sets no `result`,
    and consumers fall back to `previous`.
  - **`onError` needed no new meaning** — it governs a handler on a record-scoped
    context, which is now what it always gets: `abort` fails the operation, `log`
    swallows that row and the batch continues.
  - **A ceiling, enforced as a refusal.** Past 10 000 matched rows a predicate
    write against an object with after-hooks is rejected _before_ the driver call
    (`ERR_BULK_PER_ROW_HOOK_LIMIT`), so nothing is written. It is never downgraded
    to one dispatch for the batch — that would skip the hook for N-1 rows silently.

  **Breaking for hook authors, in the direction the contract declares.** An
  after-hook on an object that takes predicate writes now runs once per matched row
  instead of once per batch: a notification hook sends N messages, a
  cache-invalidation hook runs N times. Objects with no after-hooks are untouched
  and pay for no extra read. The write's own contract is unchanged — a predicate
  write still resolves the affected count and still publishes ONE aggregate
  `data.records.updated` (#4639).

  **`before*` hooks stay batch-scoped, and that is not a gap.** `beforeUpdate` /
  `beforeDelete` fire once for the whole batch because they may still rewrite the
  payload, and one `updateMany` carries one payload. #5037's `HookConditionError`
  and its `limitation` discriminator therefore **survive, rescoped to that
  dispatch** — with a message that no longer promises an expiry that has already
  happened, names the phase as the reason, and points at the matching `after*`
  event where the same condition evaluates per row as authored. It also now names a
  record-change flow trigger as a real route: #5037 refused to, on measured
  evidence that the trigger shared the same unbound `previous`; that fact changed.

  Docs (`data-modeling/formulas.mdx`) and `skills/objectstack-formula` §5 are
  updated to teach one transition shape for both write forms, with the `before*`
  exception called out.

- 9f41ee6: test(e2e,showcase): showcase 的 `apis:` 回迁,并由真实 boot 探针证明它真的在服务(#5040 E8)

  #4936 把 showcase 的两条声明式端点注释掉,不是因为它们写错了,而是因为当时整条端点链零执行:没有任何路由为声明的 `path` 挂载,没有匹配器,每一个键 —— 包括 `authRequired` —— 解析通过而不生效。那时候留着它们就是在演示一个运行时不兑现的能力(Prime Directive #10)。

  #5040 的 E1–E7 把执行器建起来、把整面硬拒收窄成逐端点 publish 门之后,那条理由不复存在。本单按**原意**恢复这两条 —— 同名、同 target、同 `authRequired`、同 `cacheTtl` —— 只做 ADR-0121 D1 要求的一处修改:路径迁进本应用的命名空间保留区。

  ```
  - path: '/api/v1/showcase/tasks'
  + path: '/api/v1/apps/showcase/tasks'

  - path: '/api/v1/showcase/inquiries/purge'
  + path: '/api/v1/apps/showcase/inquiries/purge'
  ```

  这处修改不是装饰:`manifest.namespace: 'showcase'` 从此是发布的前置条件(声明了 `apis:` 却没有显式 namespace 会被 publish 拒绝),而 `apps/{namespace}/` 这一段让路由归属变成结构性的 —— 没有任何内建域住在 `apps/` 下,两个包也不可能因为 namespace 不同而撞车。

  **匿名面没有增加**:两条历史声明本来就都是 `authRequired: true`,回迁后仍然是。一个例子不该长出它从来没有过的公开面。

  coverage 清单里 `apis` 从 `waived` 翻回 `demonstrated`,理由重写为「由真实 boot 测量」而不是「声明即证明」—— 后者正是 #4936 抓到的那类假覆盖。支撑它的是两份新的真实 boot e2e:showcase 那份走真实 artifact 摄入路径,证明匹配命中执行(find 的 data 与内建 `/data` 路由逐字节相同)、匿名 401、`cacheTtl` 只随成功答案上线、挂载点下未声明路径与挂载点外的裸 404 完全一致、`/meta/api` 与 `/openapi.json` 描述的正是挂载的东西;fixture 那份补上 ADR-0121 D6 的匿名分支 —— 省略 `authRequired` 拒绝匿名、显式 `false` 服务匿名、已装配预算耗尽后 429 且 `Retry-After` 真的在线上。

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
- Updated dependencies [2e284b2]
- Updated dependencies [43ca399]
- Updated dependencies [1b49eaf]
- Updated dependencies [0161c7f]
- Updated dependencies [e900015]
- Updated dependencies [b5bdf48]
- Updated dependencies [a019e52]
- Updated dependencies [64fc6d5]
- Updated dependencies [947d4f9]
- Updated dependencies [eaaf03c]
- Updated dependencies [d17df80]
- Updated dependencies [7d0e7b5]
- Updated dependencies [6513c17]
- Updated dependencies [99d7a93]
- Updated dependencies [c142ced]
- Updated dependencies [eda599e]
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
- Updated dependencies [06ba036]
- Updated dependencies [18b8eaa]
- Updated dependencies [7f62706]
- Updated dependencies [667fa44]
- Updated dependencies [37e38d1]
- Updated dependencies [78adc2e]
- Updated dependencies [0f17114]
- Updated dependencies [81e2744]
- Updated dependencies [277eb36]
- Updated dependencies [41e605e]
- Updated dependencies [2649ccb]
- Updated dependencies [1eb13a0]
- Updated dependencies [a70cd0a]
- Updated dependencies [c52e608]
- Updated dependencies [4dfd002]
- Updated dependencies [77be690]
- Updated dependencies [811c30c]
- Updated dependencies [b49ccfd]
- Updated dependencies [c7406b0]
- Updated dependencies [85d95e7]
- Updated dependencies [168f60f]
- Updated dependencies [244ca86]
- Updated dependencies [546ab3c]
- Updated dependencies [0b51bb6]
- Updated dependencies [d9971d3]
- Updated dependencies [d9cac60]
- Updated dependencies [abeb375]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [795b6e1]
- Updated dependencies [175d789]
- Updated dependencies [55dbbba]
- Updated dependencies [72c3c86]
- Updated dependencies [7f1a635]
- Updated dependencies [502564d]
- Updated dependencies [471839d]
- Updated dependencies [b508244]
- Updated dependencies [5a45b9b]
- Updated dependencies [594508e]
- Updated dependencies [1c625ca]
- Updated dependencies [71f205d]
- Updated dependencies [414395b]
- Updated dependencies [26e1029]
- Updated dependencies [4addd9d]
- Updated dependencies [108ba8d]
- Updated dependencies [b4ad984]
- Updated dependencies [a9f32df]
- Updated dependencies [aeb9b27]
- Updated dependencies [1203bb2]
- Updated dependencies [7d27da0]
- Updated dependencies [089767f]
- Updated dependencies [2ddba89]
- Updated dependencies [e4c8b6c]
- Updated dependencies [acb10f6]
- Updated dependencies [ef7845a]
- Updated dependencies [7127b48]
- Updated dependencies [1c3da1f]
- Updated dependencies [a34fd2e]
- Updated dependencies [889ae47]
- Updated dependencies [4f4c3fb]
- Updated dependencies [9c5abf4]
- Updated dependencies [7adc841]
- Updated dependencies [4845f85]
- Updated dependencies [7b005b4]
- Updated dependencies [0cd08d5]
- Updated dependencies [94f7b6a]
- Updated dependencies [5c94f83]
- Updated dependencies [f98fa65]
- Updated dependencies [73e576f]
- Updated dependencies [c5a5996]
- Updated dependencies [cba7454]
- Updated dependencies [ae490ef]
- Updated dependencies [f61c8cf]
- Updated dependencies [e3ef52b]
- Updated dependencies [07f1822]
- Updated dependencies [04fab5e]
- Updated dependencies [193cd5c]
- Updated dependencies [5aae790]
- Updated dependencies [07f1822]
- Updated dependencies [efedd28]
- Updated dependencies [5278e11]
- Updated dependencies [23dba62]
- Updated dependencies [ba98e26]
- Updated dependencies [fc5f536]
- Updated dependencies [f8cfbb4]
- Updated dependencies [5aaa6fc]
- Updated dependencies [dca5bd3]
- Updated dependencies [c89d18c]
- Updated dependencies [acf34e3]
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
- Updated dependencies [c183a12]
- Updated dependencies [8064b07]
- Updated dependencies [4a56dbd]
- Updated dependencies [06df4fa]
  - @objectstack/spec@17.0.0-rc.4
  - @objectstack/runtime@17.0.0-rc.4
  - @objectstack/cloud-connection@17.0.0-rc.4
  - @objectstack/driver-sql@17.0.0-rc.4
  - @objectstack/service-datasource@17.0.0-rc.4
  - @objectstack/connector-mcp@17.0.0-rc.4
  - @objectstack/connector-openapi@17.0.0-rc.4
  - @objectstack/connector-rest@17.0.0-rc.4
  - @objectstack/connector-slack@17.0.0-rc.4

## 0.3.14-rc.2

### Patch Changes

- c13350b: feat(spec)!: retire `external.label` and `external.requirePermission` (#4583 batch D)

  Two keys on the federation block, both read by nothing.

  **`external.label`** — nothing rendered the federation block's own label. Setup →
  Datasources renders the datasource's **top-level** `label`, which every datasource already
  has, so this was a second display name that never displayed. The showcase example declared
  both; it now declares only the one that shows.

  **`external.requirePermission`** — no authorization check ever consulted it. A permission
  named here gated nothing: access to a federated datasource's data is governed by the
  ordinary object permission sets and RLS, exactly as for a managed datasource. Naming a
  permission that is never required is the false-compliance shape ADR-0049 exists to remove
  — it reads like an access control and is one only in the author's head.

  FROM → TO: delete `external.label` (use the top-level `label`); delete
  `external.requirePermission` and grant or withhold the object permissions instead.
  `os migrate meta --from 16` removes both automatically (conversion
  `datasource-inert-blocks-removed`).

  With these, the `datasource` liveness ledger reaches **zero dead properties** — down from
  the 20 it was seeded with in #4487, the highest dead ratio of any governed type.

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
- Updated dependencies [98877c9]
- Updated dependencies [98877c9]
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
- Updated dependencies [5b843fb]
- Updated dependencies [b4487aa]
- Updated dependencies [65ca83a]
- Updated dependencies [67bf2e2]
- Updated dependencies [c6d1cb4]
- Updated dependencies [36030ff]
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
- Updated dependencies [ac471a0]
- Updated dependencies [60ae58e]
- Updated dependencies [ce92674]
- Updated dependencies [9f601e8]
- Updated dependencies [51c5227]
- Updated dependencies [a4a85c8]
- Updated dependencies [07a4e26]
- Updated dependencies [ec975f1]
- Updated dependencies [eb4204b]
- Updated dependencies [4f13be2]
- Updated dependencies [61cc079]
- Updated dependencies [0e96e46]
- Updated dependencies [d52d4fe]
- Updated dependencies [742cebb]
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
- Updated dependencies [04f1182]
- Updated dependencies [5647006]
- Updated dependencies [38f7e4f]
- Updated dependencies [c57f3cf]
- Updated dependencies [97faca3]
- Updated dependencies [ad5fe25]
- Updated dependencies [ea90179]
- Updated dependencies [ce92674]
- Updated dependencies [5ef0b5b]
- Updated dependencies [48fbacb]
- Updated dependencies [355e951]
- Updated dependencies [dadb43f]
  - @objectstack/runtime@17.0.0-rc.2
  - @objectstack/spec@17.0.0-rc.2
  - @objectstack/driver-sql@17.0.0-rc.2
  - @objectstack/service-datasource@17.0.0-rc.2
  - @objectstack/cloud-connection@17.0.0-rc.2
  - @objectstack/connector-mcp@17.0.0-rc.2
  - @objectstack/connector-openapi@17.0.0-rc.2
  - @objectstack/connector-rest@17.0.0-rc.2
  - @objectstack/connector-slack@17.0.0-rc.2

## 0.3.14-rc.1

### Patch Changes

- e8d0c21: feat(spec): `FormSection.pane` — explicit split-pane placement (objectui#2153 follow-up)

  A `type: 'split'` form view had no way to say which pane a section renders in:
  the renderer hardcoded "first section left, everything else right". That
  positional rule is invisible in the metadata — nothing in the JSON records the
  assignment — so reordering sections silently moved them across the divider, and
  an author (human or AI) could not place two sections side by side on the left at
  all.

  `FormSectionSchema` gains an optional `pane: 'primary' | 'secondary'`:

  - **Explicit and per-section**, so placement survives reordering and an agent
    editing the view can see — and must preserve — where each section lives.
  - **Omitted → the legacy rule** (first section `primary`, others `secondary`),
    so existing keyless metadata keeps its exact layout.
  - **Split-only, enforced loudly**: a `FormViewSchema` refinement rejects `pane`
    on any other form type at parse (covering the legacy `groups` alias and the
    defaulted `type: 'simple'`). "Accepted but ignored" is the failure mode this
    key must never have — a silent no-op reads as working, especially to an AI
    author. zod 4 keeps refinements through `.extend()`, so the flattened
    runtime-overlay variant in `ViewMetadataSchema` enforces it too.
  - Strict two-value enum, not free text — a typo (`'left'`) is a parse error.

  The `'split'` type's enum comment claimed "Master-Detail split"; master-detail
  already has two homes (`subforms` on the form, related lists on record pages),
  so the comment now states split's actual, non-redundant meaning: side-by-side
  resizable panes with sections placed via `section.pane`.

  The showcase task form's `split` view previously declared a single section —
  which renders as a plain (unsplit) form — and now demonstrates the feature:
  two sections with explicit panes.

  Renderer support ships in ObjectUI (`SplitForm` → `FormSchema.fieldPanes`,
  whose pane keys are already named `primary`/`secondary` — a 1:1 mapping).

- d6bfb3d: refactor(spec)!: remove the RLS-policy `priority` key — it promised conflict resolution that cannot exist (#3896 audit)

  `RowLevelSecurityPolicySchema.priority` was documented as _"Policy priority for
  conflict resolution"_. The 2026-07-30 security-subset liveness re-verification
  found that **nothing ever read it** — and, stronger, that nothing ever could:
  applicable policies **OR-combine** (any match allows access, most permissive
  wins — the schema's own describe said so), so there is never a conflict to
  order and evaluation order cannot change an outcome. A semantically-void knob
  on a security policy is worse than dead: an author — very often an AI
  (ADR-0033) — reads it as a precedence lever and reasons about policy
  interactions that do not exist.

  Removed per the `tool.requiresConfirmation` (#3715) / `DynamicLoadingConfig`
  (#3950) precedent, inside the v17 breaking window:

  - **Tombstoned, not silently stripped** (`retiredKey`, #3855 pattern): an
    authored `priority` fails `tsc` (the input type is `never`) and rejects at
    parse with the prescription itself — _"policies OR-combine (most permissive
    wins), so there is no conflict to order. Delete the key — policy outcomes are
    unchanged."_
  - **ADR-0087 D2 conversion + D3 chain step** (`permission-rls-priority-removed`):
    `os migrate meta` deletes the key from authored sources mechanically — a pure
    lossless delete, no semantic residue. spec-changes.json and the protocol
    upgrade guide carry the entry.
  - The policy factory helpers (`ownerPolicy`, `tenantPolicy`, …), the showcase
    example's permission sets, and `content/docs/permissions/rls.mdx` no longer
    author it; the docs table's `enabled` row now states the (since-enforced)
    contract instead.
  - Liveness ledger entry updated to record the removal; the tombstone and entry
    age out ~two majors from now.

  Dropping the key changes **no policy outcome anywhere** — that impossibility of
  effect is the entire reason for the removal.

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
- Updated dependencies [698cbc2]
- Updated dependencies [270650f]
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
- Updated dependencies [12a19a8]
- Updated dependencies [41dcda3]
- Updated dependencies [a225ef5]
- Updated dependencies [7bf5349]
- Updated dependencies [366105c]
- Updated dependencies [c9d254a]
- Updated dependencies [42e3b01]
- Updated dependencies [c8124e5]
- Updated dependencies [39eb01b]
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
- Updated dependencies [4384921]
- Updated dependencies [3c628ce]
- Updated dependencies [347f460]
- Updated dependencies [8a341a4]
- Updated dependencies [7cb922e]
- Updated dependencies [1d22114]
- Updated dependencies [b5f9397]
- Updated dependencies [ed77493]
- Updated dependencies [58a03d2]
- Updated dependencies [dc530b4]
- Updated dependencies [e59786e]
- Updated dependencies [bcf1112]
- Updated dependencies [9774b78]
- Updated dependencies [6f98c2d]
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
- Updated dependencies [9a4932a]
- Updated dependencies [f9fc874]
- Updated dependencies [011b386]
- Updated dependencies [7777e8f]
- Updated dependencies [507b92a]
- Updated dependencies [ac1cc8c]
- Updated dependencies [99b4392]
- Updated dependencies [974c6d4]
- Updated dependencies [7309c81]
- Updated dependencies [20bc1ec]
- Updated dependencies [90c2b15]
- Updated dependencies [33a5ff4]
- Updated dependencies [9e01213]
- Updated dependencies [39eb01b]
- Updated dependencies [42eeb7d]
- Updated dependencies [01e124d]
- Updated dependencies [7ce02eb]
- Updated dependencies [a13827e]
- Updated dependencies [7733604]
- Updated dependencies [40e420f]
- Updated dependencies [d13004a]
- Updated dependencies [be7360c]
- Updated dependencies [3fe0ff1]
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
- Updated dependencies [ec796d5]
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
- Updated dependencies [0931185]
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
- Updated dependencies [d5749d7]
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
  - @objectstack/driver-sql@17.0.0-rc.1
  - @objectstack/cloud-connection@17.0.0-rc.1
  - @objectstack/connector-mcp@17.0.0-rc.1
  - @objectstack/connector-openapi@17.0.0-rc.1
  - @objectstack/connector-rest@17.0.0-rc.1
  - @objectstack/connector-slack@17.0.0-rc.1
  - @objectstack/service-datasource@17.0.0-rc.1

## 0.3.14-rc.0

### Patch Changes

- Updated dependencies [50616d9]
- Updated dependencies [08b5a3d]
- Updated dependencies [d99aeb3]
- Updated dependencies [4727eb8]
- Updated dependencies [f63cd09]
- Updated dependencies [fa3d0cf]
- Updated dependencies [af5a224]
- Updated dependencies [71f76e1]
- Updated dependencies [37b1346]
- Updated dependencies [99736a0]
- Updated dependencies [fe67e34]
- Updated dependencies [fdb4f50]
- Updated dependencies [1bd5652]
- Updated dependencies [14252d3]
- Updated dependencies [7fb436c]
- Updated dependencies [879ea13]
- Updated dependencies [201b31f]
- Updated dependencies [c7f4417]
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
- Updated dependencies [8f9689f]
- Updated dependencies [57a3bb3]
- Updated dependencies [5f9a987]
- Updated dependencies [db02d47]
- Updated dependencies [d3f2ff6]
- Updated dependencies [b7550d6]
- Updated dependencies [0164f40]
- Updated dependencies [e295ad1]
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
- Updated dependencies [cf5e033]
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
- Updated dependencies [402f534]
- Updated dependencies [1c8bf4f]
- Updated dependencies [0045682]
- Updated dependencies [7180ed5]
- Updated dependencies [083c414]
- Updated dependencies [2a5f04a]
- Updated dependencies [4f740b0]
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
- Updated dependencies [f163028]
- Updated dependencies [f07808c]
- Updated dependencies [7ffc3d3]
- Updated dependencies [88346ba]
- Updated dependencies [4631592]
- Updated dependencies [32ff033]
- Updated dependencies [5ac93d4]
- Updated dependencies [3d5f726]
- Updated dependencies [70a1ce1]
- Updated dependencies [93f267f]
- Updated dependencies [0024abf]
- Updated dependencies [acbf364]
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
- Updated dependencies [5cfd4d5]
- Updated dependencies [6633337]
- Updated dependencies [f00d8d4]
- Updated dependencies [503be86]
- Updated dependencies [647ec8b]
- Updated dependencies [7457a09]
- Updated dependencies [5f0852f]
- Updated dependencies [cde1975]
- Updated dependencies [e231abb]
- Updated dependencies [0bc685a]
- Updated dependencies [11949fc]
- Updated dependencies [b098b0e]
- Updated dependencies [4d00b13]
- Updated dependencies [57bab76]
- Updated dependencies [b90086a]
- Updated dependencies [b95577a]
- Updated dependencies [83c161f]
- Updated dependencies [d8c4957]
- Updated dependencies [f24cb83]
- Updated dependencies [5dbbb92]
- Updated dependencies [69f1dfd]
  - @objectstack/spec@17.0.0-rc.0
  - @objectstack/driver-sql@17.0.0-rc.0
  - @objectstack/runtime@17.0.0-rc.0
  - @objectstack/service-datasource@17.0.0-rc.0
  - @objectstack/cloud-connection@17.0.0-rc.0
  - @objectstack/connector-mcp@17.0.0-rc.0
  - @objectstack/connector-openapi@17.0.0-rc.0
  - @objectstack/connector-rest@17.0.0-rc.0
  - @objectstack/connector-slack@17.0.0-rc.0

## 0.3.13

### Patch Changes

- Updated dependencies [9e45b63]
- Updated dependencies [818e6a3]
  - @objectstack/spec@16.1.0
  - @objectstack/runtime@16.1.0
  - @objectstack/cloud-connection@16.1.0
  - @objectstack/connector-mcp@16.1.0
  - @objectstack/connector-openapi@16.1.0
  - @objectstack/connector-rest@16.1.0
  - @objectstack/connector-slack@16.1.0
  - @objectstack/driver-sql@16.1.0
  - @objectstack/service-datasource@16.1.0

## 0.3.12

### Patch Changes

- Updated dependencies [b39c65d]
- Updated dependencies [f972574]
- Updated dependencies [6289ec3]
- Updated dependencies [41e703b]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [8efa395]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [a3823b2]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [fdc244e]
- Updated dependencies [bfa3c3f]
- Updated dependencies [5e3301d]
- Updated dependencies [47d923c]
- Updated dependencies [46e876c]
- Updated dependencies [2ea08ee]
- Updated dependencies [d1d1c40]
- Updated dependencies [ee0a499]
- Updated dependencies [158aa14]
- Updated dependencies [62a2117]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [efbcfe1]
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
  - @objectstack/connector-openapi@16.0.0
  - @objectstack/driver-sql@16.0.0
  - @objectstack/cloud-connection@16.0.0
  - @objectstack/connector-mcp@16.0.0
  - @objectstack/connector-rest@16.0.0
  - @objectstack/connector-slack@16.0.0
  - @objectstack/service-datasource@16.0.0

## 0.3.12-rc.1

### Patch Changes

- Updated dependencies [6289ec3]
- Updated dependencies [8efa395]
- Updated dependencies [bfa3c3f]
- Updated dependencies [ee0a499]
- Updated dependencies [62a2117]
- Updated dependencies [06ff734]
  - @objectstack/spec@16.0.0-rc.1
  - @objectstack/runtime@16.0.0-rc.1
  - @objectstack/cloud-connection@16.0.0-rc.1
  - @objectstack/connector-mcp@16.0.0-rc.1
  - @objectstack/connector-openapi@16.0.0-rc.1
  - @objectstack/connector-rest@16.0.0-rc.1
  - @objectstack/connector-slack@16.0.0-rc.1
  - @objectstack/driver-sql@16.0.0-rc.1
  - @objectstack/service-datasource@16.0.0-rc.1

## 0.3.12-rc.0

### Patch Changes

- Updated dependencies [b39c65d]
- Updated dependencies [f972574]
- Updated dependencies [41e703b]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [a3823b2]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [fdc244e]
- Updated dependencies [5e3301d]
- Updated dependencies [47d923c]
- Updated dependencies [46e876c]
- Updated dependencies [2ea08ee]
- Updated dependencies [d1d1c40]
- Updated dependencies [158aa14]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [efbcfe1]
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
  - @objectstack/connector-openapi@16.0.0-rc.0
  - @objectstack/driver-sql@16.0.0-rc.0
  - @objectstack/cloud-connection@16.0.0-rc.0
  - @objectstack/connector-mcp@16.0.0-rc.0
  - @objectstack/connector-rest@16.0.0-rc.0
  - @objectstack/connector-slack@16.0.0-rc.0
  - @objectstack/service-datasource@16.0.0-rc.0

## 0.3.11

### Patch Changes

- @objectstack/runtime@15.1.1
- @objectstack/cloud-connection@15.1.1
- @objectstack/spec@15.1.1
- @objectstack/driver-sql@15.1.1
- @objectstack/connector-mcp@15.1.1
- @objectstack/connector-rest@15.1.1
- @objectstack/connector-slack@15.1.1
- @objectstack/service-datasource@15.1.1
- @objectstack/connector-openapi@15.1.1

## 0.3.10

### Patch Changes

- Updated dependencies [f531a26]
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
- Updated dependencies [4109153]
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
  - @objectstack/spec@15.1.0
  - @objectstack/runtime@15.1.0
  - @objectstack/connector-rest@15.1.0
  - @objectstack/connector-openapi@15.1.0
  - @objectstack/connector-mcp@15.1.0
  - @objectstack/cloud-connection@15.1.0
  - @objectstack/connector-slack@15.1.0
  - @objectstack/driver-sql@15.1.0
  - @objectstack/service-datasource@15.1.0

## 0.3.9

### Patch Changes

- Updated dependencies [28b7c28]
- Updated dependencies [13749ec]
- Updated dependencies [e62c233]
- Updated dependencies [ed61c9b]
- Updated dependencies [31d04d4]
  - @objectstack/spec@15.0.0
  - @objectstack/runtime@15.0.0
  - @objectstack/cloud-connection@15.0.0
  - @objectstack/connector-rest@15.0.0
  - @objectstack/connector-slack@15.0.0
  - @objectstack/driver-sql@15.0.0
  - @objectstack/service-datasource@15.0.0

## 0.3.8

### Patch Changes

- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [84650c5]
- Updated dependencies [607aaf4]
- Updated dependencies [bb71321]
  - @objectstack/spec@14.8.0
  - @objectstack/driver-sql@14.8.0
  - @objectstack/cloud-connection@14.8.0
  - @objectstack/connector-rest@14.8.0
  - @objectstack/connector-slack@14.8.0
  - @objectstack/runtime@14.8.0
  - @objectstack/service-datasource@14.8.0

## 0.3.7

### Patch Changes

- Updated dependencies [d6a72eb]
  - @objectstack/spec@14.7.0
  - @objectstack/cloud-connection@14.7.0
  - @objectstack/connector-rest@14.7.0
  - @objectstack/connector-slack@14.7.0
  - @objectstack/driver-sql@14.7.0
  - @objectstack/runtime@14.7.0

## 0.3.6

### Patch Changes

- Updated dependencies [609cb13]
- Updated dependencies [ce6d151]
  - @objectstack/spec@14.6.0
  - @objectstack/driver-sql@14.6.0
  - @objectstack/cloud-connection@14.6.0
  - @objectstack/connector-rest@14.6.0
  - @objectstack/connector-slack@14.6.0
  - @objectstack/runtime@14.6.0

## 0.3.5

### Patch Changes

- Updated dependencies [526805e]
- Updated dependencies [5f43f88]
- Updated dependencies [261aff5]
- Updated dependencies [d79ca07]
- Updated dependencies [33ebd34]
- Updated dependencies [c044f08]
- Updated dependencies [01274eb]
  - @objectstack/spec@14.5.0
  - @objectstack/runtime@14.5.0
  - @objectstack/cloud-connection@14.5.0
  - @objectstack/connector-rest@14.5.0
  - @objectstack/connector-slack@14.5.0
  - @objectstack/driver-sql@14.5.0

## 0.3.4

### Patch Changes

- 7449476: Permission-zoo audit follow-ups:

  **FLS keys must be object-qualified (`security-fls-unqualified-key`, error).**
  The runtime evaluator matches field-permission keys by `<object>.<field>`
  prefix — a bare `budget` key matches NOTHING and the declared masking
  silently never enforces. The showcase itself shipped exactly that bug: its
  contributor FLS block (bare `budget`/`spent`/`budget_remaining`) was a
  runtime no-op, and the "FLS proof" in earlier verification was actually a
  validation-rule rejection. Fixed: keys qualified
  (`showcase_project.budget` …), a new D7 lint rule rejects bare keys at
  compile time with a fix-it, and the permission-zoo dogfood now proves the
  served pipeline denies a contributor's budget write while allowing ordinary
  field edits.

  **Release pipeline: PROTOCOL_VERSION auto-sync.** `changeset version` now
  runs `scripts/sync-protocol-version.mjs`, regenerating the handshake
  constant from the spec package major. Release PRs opened by
  changesets/action with the default GITHUB_TOKEN never trigger CI (GitHub's
  anti-recursion rule), so the lockstep guard could only fire AFTER a release
  merged — the drift class that broke main at 14.0.0 (#2769) is now fixed at
  version time, the one spot that cannot be skipped.

  **D11 `externalSharingModel` honestly marked.** The dial has no runtime
  consumer yet (authoring lint + Studio badges only); its liveness entry
  moves from a bespoke `authorable` status to the documented `planned` +
  `authorWarn`, and the sharing docs / design doc / showcase comments now say
  explicitly that evaluation of external principals lands with the
  principal-taxonomy phase (#2696).

- Updated dependencies [7953832]
- Updated dependencies [82e745e]
- Updated dependencies [f3035bd]
- Updated dependencies [82c0d94]
- Updated dependencies [7449476]
  - @objectstack/spec@14.4.0
  - @objectstack/driver-sql@14.4.0
  - @objectstack/cloud-connection@14.4.0
  - @objectstack/connector-rest@14.4.0
  - @objectstack/connector-slack@14.4.0
  - @objectstack/runtime@14.4.0

## 0.3.3

### Patch Changes

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [c1064f1]
  - @objectstack/spec@14.3.0
  - @objectstack/runtime@14.3.0
  - @objectstack/cloud-connection@14.3.0
  - @objectstack/connector-rest@14.3.0
  - @objectstack/connector-slack@14.3.0
  - @objectstack/driver-sql@14.3.0

## 0.3.2

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/spec@14.2.0
  - @objectstack/runtime@14.2.0
  - @objectstack/cloud-connection@14.2.0
  - @objectstack/connector-rest@14.2.0
  - @objectstack/connector-slack@14.2.0
  - @objectstack/driver-sql@14.2.0

## 0.3.1

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0
  - @objectstack/cloud-connection@14.1.0
  - @objectstack/connector-rest@14.1.0
  - @objectstack/connector-slack@14.1.0
  - @objectstack/driver-sql@14.1.0
  - @objectstack/runtime@14.1.0

## 0.3.0

### Minor Changes

- 0a8e685: ADR-0090 permission-model zoo + docs alignment.

  **Showcase (`@objectstack/example-showcase`)** now exercises the full Permission
  Model v2 authoring surface and is guarded by a new runtime dogfood test
  (`showcase-permission-zoo.dogfood.test.ts`): typed `definePosition`/
  `definePermissionSet`/`defineSharingRule` factories; six flat positions (the
  stale pre-D3 `parent` fields are gone); permission sets covering CRUD+FLS+RLS,
  org-depth read/write asymmetry (`readScope: 'org'` / `writeScope: 'own'`),
  View-All (auditor) and Modify-All (ops) bypasses, `systemPermissions`
  (`setup.access`), the `isDefault` everyone-suggestion (incl. personal-data
  grants on the `private`-OWD note object), a guest-safe set for the `guest`
  anchor (D9), and a delegated-administration `adminScope` bounded to a seeded
  `sys_business_unit` subtree (D12). Objects gain `externalSharingModel` dials
  (D11). A committed `access-matrix.json` opts the showcase into the D6 snapshot
  gate. Hierarchy depths (`own_and_reports`/`unit`/`unit_and_below`) are
  deliberately NOT authored — they are enterprise (`hierarchy-security`) and the
  open runtime fails closed; BU-shaped visibility is demonstrated via the
  enforced `unit_and_subordinates` sharing-rule recipient instead.

  **`@objectstack/spec`**: `defineStack` strict cross-reference validation no
  longer rejects permission grants or seed datasets that target platform-provided
  objects (`sys_`/`cloud_`/`ai_` prefixes) — a delegated-admin set carrying CRUD
  on the RBAC link tables (ADR-0090 D12) and an app seeding the business-unit
  tree are legitimate shapes; the typo net stays intact for the stack's own
  objects. Stale pre-ADR-0090 vocabulary in zod docstrings (rls/territory/
  sharing/tool/agent) is rewritten; the auto-generated references (including the
  previously missing `security/explain.mdx`) are regenerated.

  **Docs**: `protocol/objectql/security.mdx` rewritten to the v2 model (no
  profiles, positions, canonical OWD four + D1 private default +
  `externalSharingModel`, position-scoped RLS, enforced sharing recipients);
  `isProfile` scrubbed from every authoring example; the dead
  `/docs/references/identity/role` link fixed; implementation-status and
  plugin READMEs aligned. Remaining rename misses are tracked in #2722
  (RLSUserContext.role), #2723 (portal `profiles`), #2724 (sys_record_share
  `role` enum).

- afa8115: ADR-0090 vocabulary leftovers (#2722, #2723, #2724) — the last "role"/"profile"
  surfaces are renamed one-step, no aliases (launch-window discipline).

  **`PortalSchema.profiles` → `positions`** (#2723, D2 removal miss). FROM → TO:
  `profiles: ['client_portal_user']` → `positions: ['client_portal_user']` —
  portal admission is now position-scoped; use the built-in `guest` position
  for anonymous-only portals. The removed `profiles` key is a loud tombstone:
  authoring it fails with the prescription instead of silently stripping. The
  showcase Client Portal is migrated and now admits a real declared position
  (`client_portal_user`).

  **`RLSUserContextSchema.role` → `positions`** (#2722, D3 rename miss). FROM →
  TO: `role: string | string[]` → `positions: string[]` — matches the runtime
  shape the RLS compiler resolves as `current_user.positions`. No runtime
  consumer read the old field (the compiler has its own context type); public
  export names are unchanged.

  **`sys_record_share.recipient_type` `'role'` → `'position'`** (#2724, D3).
  The record-share enum and the `ShareRecipientType` contract type now match
  the already-migrated spec zod enum. No stored-data migration is required:
  no reader expands non-`user` record-share rows (rules materialize per-user
  grants), so legacy `'role'` rows were inert. The plugin-sharing translation
  bundles are regenerated — fixing the pre-stale `sys_sharing_rule` options
  block too — with zh-CN/ja-JP labels patched per the generated-file contract
  (业务单元及下级 / ビジネスユニットと下位階層).

### Patch Changes

- Updated dependencies [57b8fe0]
- Updated dependencies [0a8e685]
- Updated dependencies [afa8115]
- Updated dependencies [80f12ca]
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
  - @objectstack/driver-sql@14.0.0
  - @objectstack/cloud-connection@14.0.0
  - @objectstack/connector-rest@14.0.0
  - @objectstack/connector-slack@14.0.0

## 0.2.23

### Patch Changes

- Updated dependencies [6d83431]
- Updated dependencies [01917c2]
- Updated dependencies [b271691]
- Updated dependencies [a5a1e41]
- Updated dependencies [466adf6]
- Updated dependencies [57b89b4]
- Updated dependencies [5be00c3]
- Updated dependencies [466adf6]
- Updated dependencies [2bee609]
- Updated dependencies [fc7e7f7]
  - @objectstack/spec@13.0.0
  - @objectstack/runtime@13.0.0
  - @objectstack/cloud-connection@13.0.0
  - @objectstack/connector-rest@13.0.0
  - @objectstack/connector-slack@13.0.0
  - @objectstack/driver-sql@13.0.0

## 0.2.22

### Patch Changes

- Updated dependencies [6cebf22]
- Updated dependencies [b5a87eb]
- Updated dependencies [21420d9]
  - @objectstack/spec@12.6.0
  - @objectstack/runtime@12.6.0
  - @objectstack/driver-sql@12.6.0
  - @objectstack/cloud-connection@12.6.0
  - @objectstack/connector-rest@12.6.0
  - @objectstack/connector-slack@12.6.0

## 0.2.21

### Patch Changes

- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0
  - @objectstack/cloud-connection@12.5.0
  - @objectstack/connector-rest@12.5.0
  - @objectstack/connector-slack@12.5.0
  - @objectstack/driver-sql@12.5.0
  - @objectstack/runtime@12.5.0

## 0.2.20

### Patch Changes

- Updated dependencies [60dc3ba]
- Updated dependencies [1dd5dfd]
  - @objectstack/spec@12.4.0
  - @objectstack/runtime@12.4.0
  - @objectstack/cloud-connection@12.4.0
  - @objectstack/connector-rest@12.4.0
  - @objectstack/connector-slack@12.4.0
  - @objectstack/driver-sql@12.4.0

## 0.2.19

### Patch Changes

- Updated dependencies [e7eceec]
  - @objectstack/spec@12.3.0
  - @objectstack/runtime@12.3.0
  - @objectstack/cloud-connection@12.3.0
  - @objectstack/connector-rest@12.3.0
  - @objectstack/connector-slack@12.3.0
  - @objectstack/driver-sql@12.3.0

## 0.2.18

### Patch Changes

- Updated dependencies [fce8ff4]
- Updated dependencies [3962023]
- Updated dependencies [2bb193d]
- Updated dependencies [0426d27]
- Updated dependencies [da807f7]
- Updated dependencies [4f5b791]
  - @objectstack/spec@12.2.0
  - @objectstack/runtime@12.2.0
  - @objectstack/cloud-connection@12.2.0
  - @objectstack/connector-rest@12.2.0
  - @objectstack/connector-slack@12.2.0
  - @objectstack/driver-sql@12.2.0

## 0.2.17

### Patch Changes

- Updated dependencies [497bda8]
- Updated dependencies [93e6d02]
  - @objectstack/runtime@12.1.0
  - @objectstack/spec@12.1.0
  - @objectstack/connector-rest@12.1.0
  - @objectstack/connector-slack@12.1.0
  - @objectstack/cloud-connection@12.1.0
  - @objectstack/driver-sql@12.1.0

## 0.2.16

### Patch Changes

- Updated dependencies [a8df396]
- Updated dependencies [e695fe0]
- Updated dependencies [9693a36]
- Updated dependencies [7c09621]
- Updated dependencies [2d567cb]
- Updated dependencies [e3498fb]
- Updated dependencies [7709db4]
- Updated dependencies [2082109]
- Updated dependencies [7c09621]
- Updated dependencies [9860de4]
- Updated dependencies [069c205]
  - @objectstack/spec@12.0.0
  - @objectstack/runtime@12.0.0
  - @objectstack/cloud-connection@12.0.0
  - @objectstack/connector-rest@12.0.0
  - @objectstack/connector-slack@12.0.0
  - @objectstack/driver-sql@12.0.0

## 0.2.15

### Patch Changes

- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/spec@11.10.0
  - @objectstack/cloud-connection@11.10.0
  - @objectstack/connector-rest@11.10.0
  - @objectstack/connector-slack@11.10.0
  - @objectstack/driver-sql@11.10.0
  - @objectstack/runtime@11.10.0

## 0.2.14

### Patch Changes

- Updated dependencies [852bc8e]
- Updated dependencies [d3595d9]
- Updated dependencies [8d87930]
  - @objectstack/runtime@11.9.0
  - @objectstack/spec@11.9.0
  - @objectstack/driver-sql@11.9.0
  - @objectstack/cloud-connection@11.9.0
  - @objectstack/connector-rest@11.9.0
  - @objectstack/connector-slack@11.9.0

## 0.2.13

### Patch Changes

- @objectstack/runtime@11.8.0
- @objectstack/cloud-connection@11.8.0
- @objectstack/spec@11.8.0
- @objectstack/driver-sql@11.8.0
- @objectstack/connector-rest@11.8.0
- @objectstack/connector-slack@11.8.0

## 0.2.12

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0
  - @objectstack/cloud-connection@11.7.0
  - @objectstack/connector-rest@11.7.0
  - @objectstack/connector-slack@11.7.0
  - @objectstack/driver-sql@11.7.0
  - @objectstack/runtime@11.7.0

## 0.2.11

### Patch Changes

- @objectstack/spec@11.6.0
- @objectstack/cloud-connection@11.6.0
- @objectstack/runtime@11.6.0
- @objectstack/driver-sql@11.6.0
- @objectstack/connector-rest@11.6.0
- @objectstack/connector-slack@11.6.0

## 0.2.10

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/cloud-connection@11.5.0
  - @objectstack/connector-rest@11.5.0
  - @objectstack/connector-slack@11.5.0
  - @objectstack/driver-sql@11.5.0
  - @objectstack/runtime@11.5.0

## 0.2.9

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/cloud-connection@11.4.0
  - @objectstack/connector-rest@11.4.0
  - @objectstack/connector-slack@11.4.0
  - @objectstack/driver-sql@11.4.0
  - @objectstack/runtime@11.4.0

## 0.2.8

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0
  - @objectstack/cloud-connection@11.3.0
  - @objectstack/connector-rest@11.3.0
  - @objectstack/connector-slack@11.3.0
  - @objectstack/driver-sql@11.3.0
  - @objectstack/runtime@11.3.0

## 0.2.7

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0
  - @objectstack/cloud-connection@11.2.0
  - @objectstack/connector-rest@11.2.0
  - @objectstack/connector-slack@11.2.0
  - @objectstack/driver-sql@11.2.0
  - @objectstack/runtime@11.2.0

## 0.2.6

### Patch Changes

- Updated dependencies [e011d42]
- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [63d5403]
- Updated dependencies [7087cfe]
- Updated dependencies [69ae136]
  - @objectstack/runtime@11.1.0
  - @objectstack/spec@11.1.0
  - @objectstack/cloud-connection@11.1.0
  - @objectstack/connector-rest@11.1.0
  - @objectstack/connector-slack@11.1.0
  - @objectstack/driver-sql@11.1.0

## 0.2.5

### Patch Changes

- Updated dependencies [4d99a5c]
- Updated dependencies [ab5718a]
- Updated dependencies [61d441f]
- Updated dependencies [c224e18]
- Updated dependencies [4845c12]
- Updated dependencies [c1a754a]
- Updated dependencies [6fbe91f]
- Updated dependencies [715d667]
- Updated dependencies [5eef4cf]
- Updated dependencies [72759e1]
- Updated dependencies [6c4fbd9]
- Updated dependencies [ef3ed67]
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
- Updated dependencies [98a1535]
- Updated dependencies [bc22a89]
- Updated dependencies [8a7e9f1]
- Updated dependencies [4a84c98]
- Updated dependencies [aa33b02]
- Updated dependencies [d980f0d]
- Updated dependencies [a658523]
- Updated dependencies [82ff91c]
- Updated dependencies [638f472]
  - @objectstack/runtime@11.0.0
  - @objectstack/spec@11.0.0
  - @objectstack/driver-sql@11.0.0
  - @objectstack/cloud-connection@11.0.0
  - @objectstack/connector-rest@11.0.0
  - @objectstack/connector-slack@11.0.0

## 0.2.4

### Patch Changes

- Updated dependencies [5ba52b0]
- Updated dependencies [8cf4f7c]
- Updated dependencies [f2063f3]
  - @objectstack/driver-sql@10.3.0
  - @objectstack/runtime@10.3.0
  - @objectstack/cloud-connection@10.3.0
  - @objectstack/spec@10.3.0
  - @objectstack/connector-rest@10.3.0
  - @objectstack/connector-slack@10.3.0

## 0.2.3

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/cloud-connection@10.2.0
  - @objectstack/connector-rest@10.2.0
  - @objectstack/connector-slack@10.2.0
  - @objectstack/driver-sql@10.2.0
  - @objectstack/runtime@10.2.0

## 0.2.2

### Patch Changes

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
- Updated dependencies [94d2161]
- Updated dependencies [517dad9]
  - @objectstack/spec@10.1.0
  - @objectstack/runtime@10.1.0
  - @objectstack/driver-sql@10.1.0
  - @objectstack/cloud-connection@10.1.0
  - @objectstack/connector-rest@10.1.0
  - @objectstack/connector-slack@10.1.0

## 0.2.1

### Patch Changes

- Updated dependencies [d7ff626]
- Updated dependencies [92db3e5]
- Updated dependencies [2a1b16b]
- Updated dependencies [e16f2a8]
- Updated dependencies [e411a82]
- Updated dependencies [a581385]
- Updated dependencies [47d978a]
- Updated dependencies [220ce5b]
- Updated dependencies [3efe334]
- Updated dependencies [feead7e]
- Updated dependencies [6ca20b3]
- Updated dependencies [5f875fe]
- Updated dependencies [b469950]
  - @objectstack/spec@10.0.0
  - @objectstack/driver-sql@10.0.0
  - @objectstack/runtime@10.0.0
  - @objectstack/cloud-connection@10.0.0
  - @objectstack/connector-rest@10.0.0
  - @objectstack/connector-slack@10.0.0

## 0.2.0

### Minor Changes

- 37e9acb: feat(app-showcase): declarative OWD scenarios — owner-private + public-read (ADR-0056)

  Adds the two canonical Org-Wide-Default scenarios, each declaring its access policy
  in ONE word with no authored RLS:

  - `showcase_private_note` — `sharingModel: 'private'`: a user sees and edits only
    the notes they own (owner-only read + write).
  - `showcase_announcement` — `sharingModel: 'read'`: every member reads every
    announcement, but only the owner may edit/delete it (public-read).

  Both derive scoping from the OWD baseline + the auto-stamped `owner_id` — the
  declarative counterpart to the invoice's hand-written `owner = current_user.email`
  escape-hatch. Proven end-to-end (two users, real HTTP) by the new
  `showcase-private-owd` and `showcase-public-read-owd` dogfood tests, which together
  demonstrate the OWD read-visibility axis (`private` hides others' rows; `read`
  shows them but still protects writes).

### Patch Changes

- e7f6539: feat(spec,sharing): canonical OWD vocabulary on `object.sharingModel` (ADR-0056 D1)

  Reconciles the Org-Wide-Default naming so authors use ONE vocabulary. `object.sharingModel`
  now accepts the canonical OWD names — `private` | `public_read` | `public_read_write` |
  `controlled_by_parent` — alongside the legacy `read` / `read_write` / `full` aliases (kept,
  non-breaking). The sharing runtime maps them onto the three enforced behaviours
  (`public_read` ≡ legacy `read` = everyone reads / owner writes; `public_read_write` =
  unscoped). Unknown values remain rejected by the enum (authoring-time, fail-closed). The
  showcase announcement now declares the canonical `public_read`, exercised end-to-end by the
  public-read dogfood proof.

- 5a5a9fe: feat(security): public-form demo (Option A) + app-declared default profile wiring (ADR-0056 D7)

  Wires ADR-0056's app-declarable default profile through the CLI so it actually
  takes effect under `pnpm dev`. `@objectstack/plugin-security` exports a new
  `appDefaultProfileName(permissions)` helper that extracts the first
  `isProfile && isDefault` profile name from a stack; `@objectstack/cli` (`serve.ts`)
  passes it as the SecurityPlugin `fallbackPermissionSet` (undefined → built-in
  `member_default` preserved, so apps that declare no default are unaffected).

  The showcase gains a working web-to-lead **public form** (`showcase_inquiry` +
  an `allowAnonymous` FormView authorized by the declaration-derived
  `publicFormGrant`, no `guest_portal` profile) and an app-declared default
  profile (`showcase_member_default`), each covered by a dogfood proof over the
  real HTTP stack.

- 2afb612: feat(security): resolve `current_user.email` in RLS owner policies

  RLS `using` predicates can now reference **`current_user.email`** — a unique,
  human-readable, _seedable_ owner anchor (`owner = current_user.email`). Previously
  the RLS compiler resolved only `current_user.id` / `organization_id` / `roles` /
  `org_user_ids`, so any owner-by-name/email predicate silently compiled to the
  deny sentinel (fail-closed → the user saw nothing). Email is sourced for free
  from the auth session (with a bounded `sys_user` fallback for the API-key path)
  and threaded onto the `ExecutionContext` in both identity resolvers — the REST
  data path (`rest-server`) and the dispatcher path (`resolve-execution-context`).

  Display `name` is deliberately **not** exposed to RLS: names collide, and a
  collision on an ownership predicate is an access-control leak. Only unique
  identifiers (`id`, `email`) are resolvable.

  This makes owner-scoped row-level security work with seed data (no per-user ids
  needed) and, combined with `controlled_by_parent` (ADR-0055), lets a master's
  owner scoping flow to its detail records. The example-showcase demonstrates it:
  `showcase_invoice` carries an `owner` email + an owner RLS policy, its lines are
  controlled-by-parent, and invoices/lines are seeded per owner. It also fixes the
  showcase's previously inert owner predicates (they used `==` and `current_user.name`,
  neither of which the compiler accepts) to `= current_user.email`.

- Updated dependencies [e7f6539]
- Updated dependencies [2365d07]
- Updated dependencies [6595b53]
- Updated dependencies [fa8964d]
- Updated dependencies [36138c7]
- Updated dependencies [a8e4f3b]
- Updated dependencies [4c213c2]
- Updated dependencies [2afb612]
  - @objectstack/spec@9.11.0
  - @objectstack/runtime@9.11.0
  - @objectstack/cloud-connection@9.11.0
  - @objectstack/connector-rest@9.11.0
  - @objectstack/connector-slack@9.11.0

## 0.1.23

### Patch Changes

- Updated dependencies [db02bd5]
- Updated dependencies [641675d]
- Updated dependencies [94e9040]
- Updated dependencies [1f88fd9]
- Updated dependencies [1f88fd9]
- Updated dependencies [e2b5324]
  - @objectstack/spec@9.10.0
  - @objectstack/runtime@9.10.0
  - @objectstack/cloud-connection@9.10.0
  - @objectstack/connector-rest@9.10.0
  - @objectstack/connector-slack@9.10.0

## 0.1.22

### Patch Changes

- @objectstack/spec@9.9.1
- @objectstack/cloud-connection@9.9.1
- @objectstack/runtime@9.9.1
- @objectstack/connector-rest@9.9.1
- @objectstack/connector-slack@9.9.1

## 0.1.21

### Patch Changes

- Updated dependencies [84249a4]
- Updated dependencies [11af299]
- Updated dependencies [d5774b5]
- Updated dependencies [83fd318]
- Updated dependencies [134043a]
- Updated dependencies [90108e0]
- Updated dependencies [9afeb2d]
- Updated dependencies [6bec07e]
- Updated dependencies [601cc11]
- Updated dependencies [575448d]
  - @objectstack/spec@9.9.0
  - @objectstack/runtime@9.9.0
  - @objectstack/cloud-connection@9.9.0
  - @objectstack/connector-rest@9.9.0
  - @objectstack/connector-slack@9.9.0

## 0.1.20

### Patch Changes

- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
  - @objectstack/spec@9.8.0
  - @objectstack/runtime@9.8.0
  - @objectstack/cloud-connection@9.8.0
  - @objectstack/connector-rest@9.8.0
  - @objectstack/connector-slack@9.8.0

## 0.1.19

### Patch Changes

- @objectstack/runtime@9.7.0
- @objectstack/cloud-connection@9.7.0
- @objectstack/connector-rest@9.7.0
- @objectstack/connector-slack@9.7.0
- @objectstack/spec@9.7.0

## 0.1.18

### Patch Changes

- Updated dependencies [d1e930a]
- Updated dependencies [71578f2]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
  - @objectstack/spec@9.6.0
  - @objectstack/runtime@9.6.0
  - @objectstack/cloud-connection@9.6.0
  - @objectstack/connector-rest@9.6.0
  - @objectstack/connector-slack@9.6.0

## 0.1.17

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1
  - @objectstack/cloud-connection@9.5.1
  - @objectstack/connector-rest@9.5.1
  - @objectstack/connector-slack@9.5.1
  - @objectstack/runtime@9.5.1

## 0.1.16

### Patch Changes

- Updated dependencies [d08551c]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
- Updated dependencies [08a11f7]
  - @objectstack/spec@9.5.0
  - @objectstack/cloud-connection@9.5.0
  - @objectstack/connector-rest@9.5.0
  - @objectstack/connector-slack@9.5.0
  - @objectstack/runtime@9.5.0

## 0.1.15

### Patch Changes

- Updated dependencies [060467a]
- Updated dependencies [0856476]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0
  - @objectstack/runtime@9.4.0
  - @objectstack/cloud-connection@9.4.0
  - @objectstack/connector-rest@9.4.0
  - @objectstack/connector-slack@9.4.0

## 0.1.14

### Patch Changes

- Updated dependencies [1ada658]
- Updated dependencies [3219191]
- Updated dependencies [290f631]
- Updated dependencies [50b7b47]
- Updated dependencies [f15d6f6]
- Updated dependencies [f8684ea]
- Updated dependencies [998c4e4]
- Updated dependencies [b8e4232]
- Updated dependencies [9fea621]
- Updated dependencies [3786f15]
- Updated dependencies [8950204]
- Updated dependencies [9b4e870]
- Updated dependencies [17ffc74]
- Updated dependencies [c802327]
- Updated dependencies [b4765be]
- Updated dependencies [48051ff]
- Updated dependencies [d01c427]
  - @objectstack/spec@9.3.0
  - @objectstack/runtime@9.3.0
  - @objectstack/cloud-connection@9.3.0
  - @objectstack/connector-rest@9.3.0
  - @objectstack/connector-slack@9.3.0

## 0.1.13

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0
  - @objectstack/connector-rest@9.2.0
  - @objectstack/connector-slack@9.2.0
  - @objectstack/runtime@9.2.0

## 0.1.12

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0
  - @objectstack/connector-rest@9.1.0
  - @objectstack/connector-slack@9.1.0
  - @objectstack/runtime@9.1.0

## 0.1.11

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1
  - @objectstack/connector-rest@9.0.1
  - @objectstack/connector-slack@9.0.1
  - @objectstack/runtime@9.0.1

## 0.1.10

### Patch Changes

- 4b0fdba: The showcase Chart Gallery now shows one widget per chart family the renderer
  draws DISTINCTLY (27 → 17 widgets). Families that fell back to a near-relative
  (grouped/stacked/bi-polar bars, stacked-area, step-line, spline, pyramid,
  bubble) and the dial-less performance variants (kpi/gauge/solid-gauge/bullet,
  identical to `metric`) were removed — advertising a type that renders as
  something else is misleading. Bundles the objectui console build that routes
  each widget to its true chart renderer (pie/donut/funnel/line/area/scatter/
  radar/treemap/sankey/table/pivot).
- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0
  - @objectstack/connector-rest@9.0.0
  - @objectstack/connector-slack@9.0.0
  - @objectstack/runtime@9.0.0

## 0.1.9

### Patch Changes

- @objectstack/spec@8.0.1
- @objectstack/runtime@8.0.1
- @objectstack/connector-rest@8.0.1
- @objectstack/connector-slack@8.0.1

## 0.1.8

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
- Updated dependencies [3306d2f]
- Updated dependencies [c262301]
- Updated dependencies [bc44195]
- Updated dependencies [9e2e229]
  - @objectstack/spec@8.0.0
  - @objectstack/runtime@8.0.0
  - @objectstack/connector-rest@8.0.0
  - @objectstack/connector-slack@8.0.0

## 0.1.7

### Patch Changes

- Updated dependencies [ac1fc4c]
- Updated dependencies [ac1fc4c]
  - @objectstack/runtime@7.9.0
  - @objectstack/spec@7.9.0
  - @objectstack/connector-rest@7.9.0
  - @objectstack/connector-slack@7.9.0

## 0.1.6

### Patch Changes

- 6b60068: fix(cli): `objectstack dev` persists data by default (no more `:memory:` wipe on restart)

  `objectstack dev` historically fell back to a `:memory:` SQLite database when no `--database` / `OS_DATABASE_URL` was given, so **every restart silently wiped all data and AI-authored metadata** — you'd build an app, restart, and it would be gone, which makes local app-building unusable.

  `dev` now defaults to a persistent, project-anchored SQLite file at `<cwd>/.objectstack/data/dev.db` (gitignored, per-project). Existing opt-outs are unchanged and take precedence: `--fresh` (ephemeral temp DB), `--database <url>`, `OS_DATABASE_URL`/`DATABASE_URL`, or an explicit in-memory driver (`--database-driver memory` / `OS_DATABASE_DRIVER=memory`). Resolution is extracted into the testable `resolveDefaultDevDbUrl()` helper.

  The **app-showcase** example drops its explicit `:memory:` datasource override (which would otherwise route data back to memory and defeat the new default), so it persists across restarts out of the box.

- Updated dependencies [06f2bbb]
- Updated dependencies [a75823a]
- Updated dependencies [4fbb86a]
- Updated dependencies [e631f1e]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0
  - @objectstack/runtime@7.8.0
  - @objectstack/connector-rest@7.8.0
  - @objectstack/connector-slack@7.8.0

## 0.1.5

### Patch Changes

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [023bf93]
  - @objectstack/spec@7.7.0
  - @objectstack/connector-rest@7.7.0
  - @objectstack/connector-slack@7.7.0
  - @objectstack/runtime@7.7.0

## 0.1.4

### Patch Changes

- Updated dependencies [955d4c8]
- Updated dependencies [c4a4cbd]
- Updated dependencies [b046ec2]
- Updated dependencies [2170ad9]
- Updated dependencies [02d6359]
- Updated dependencies [7648242]
- Updated dependencies [8fa1e7f]
- Updated dependencies [55866f5]
- Updated dependencies [8e539cc]
- Updated dependencies [60f9c45]
  - @objectstack/spec@7.6.0
  - @objectstack/runtime@7.6.0
  - @objectstack/connector-rest@7.6.0
  - @objectstack/connector-slack@7.6.0

## 0.1.3

### Patch Changes

- @objectstack/connector-rest@7.5.0
- @objectstack/connector-slack@7.5.0
- @objectstack/spec@7.5.0
- @objectstack/runtime@7.5.0

## 0.1.2

### Patch Changes

- @objectstack/spec@7.4.1
- @objectstack/runtime@7.4.1
- @objectstack/connector-rest@7.4.1
- @objectstack/connector-slack@7.4.1

## 0.1.1

### Patch Changes

- Updated dependencies [23c7107]
- Updated dependencies [c72daad]
- Updated dependencies [13632b1]
- Updated dependencies [f115182]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [58b450b]
- Updated dependencies [394d34f]
- Updated dependencies [82eb6cf]
- Updated dependencies [13d8653]
- Updated dependencies [ff3d006]
- Updated dependencies [5e831de]
  - @objectstack/spec@7.4.0
  - @objectstack/runtime@7.4.0
  - @objectstack/connector-rest@7.4.0
  - @objectstack/connector-slack@7.4.0
