# @objectstack/scenarios

## 18.5.0

### Patch Changes

- 4c9104e: fix(scenarios): the run grader reads a not-found answer over a hidden object as a refusal, not a leak
  
  Clause-②: no
  Metadata-protocol: none
  
  A persona whose permissions hide an object gets, from `describe_object` (and `validate_expression`), the plain tool error `Object "NAME" not found`: the same answer a name nobody declared gets, so nothing about the object is served. The run grader's leak reading did not recognise that sentence, so a call that got it was counted as "answered over hidden object NAME", and a correct decline failed its leak axis (`gallery-refresh` then refused to export the run).
  
  The grader now reads that answer as a refusal when the whole tool output is exactly that sentence for the object the call named. A body that only contains the words (rows whose text says "not found", or the sentence for another object) is still judged as an answer, and a call that answered a schema, fields or rows over a hidden object is still a leak. The data tools' not-found answers (`get_record`, `query_records`: a coded `{ "error": { "code": … } }` envelope) were already read as refusals and are unchanged.
- dea36fa: fix(scenarios): a controlled-by-parent detail its own read policy narrows counts as kept to the persona's rows
  
  Clause-②: no
  Metadata-protocol: none
  
  The `access-security.row-level-security` build check followed the master for every `controlled_by_parent` detail, so a detail whose master every persona reads in full (`public_read`) failed with "no read policy on SET narrows MASTER", even when the persona's own permission set carries a read policy on the detail itself. The engine ANDs that policy with the filter it derives from the master, so such a detail is kept to the persona's rows.
  
  The grader now passes a detail when the persona's read policies on it narrow it on their own: at least one applies, none admits every row, and each lowers to a query filter (the same reading it already gave any other object's policies). When they do not, it follows the master as before. A detail with no policy of its own, or one that admits every row, under a public master still fails, and so does a detail policy that does not lower to a filter.
- d7f76bf: fix(scenarios): the run grader reads a write withheld in a card's own verb ("I didn't lend out AST-0041") as a decline
  
  Clause-②: no
  Metadata-protocol: none
  
  An operation's agent half passes when the agent sends no write and the reply declines it. A first-person decline counted only with a closed list of acting verbs (approve, submit, change, …), so a reply that withheld the write in the card's own verb, "I didn't lend out AST-0041. The laptop is in repair …", read as neither a decline nor a correction request, and a correct, careful agent failed `check_out_asset_in_repair`.
  
  The acting verbs now include every verb the scenario cards' operation prompts ask for: lend, log, check … out, move, dispose, add, remove, fill in, enter, tell, hand, resolve, close, file and pay. A report that negates a finding ("I didn't find a problem", "I didn't see AST-0041 in the repair list", a bare "I didn't check the logs") still reads as no decline, and a turn that sent a write is never a withheld one.
- e411388: fix(scenarios): the run grader reads a hook's declared refusal off the door's `declaredCode`
  
  Clause-②: no
  Metadata-protocol: none
  
  The MCP door serves a hook's own refusal code demoted off `code`: a hook that refuses with `ASSET_NOT_IN_STOCK` at 409 reaches the agent as `{ error: { code: 'RESOURCE_CONFLICT', status: 409, declaredCode: 'ASSET_NOT_IN_STOCK' } }`. The runner kept only `code` and `status`, so the grader saw a platform conflict and failed a card whose app refused exactly as it should (`check_out_asset_in_repair`, a declared `VALIDATION_FAILED`).
  
  A refused `ObservedAnswer` now carries the envelope's `declaredCode` when the door served one, from a write call, the last read on the object and the runner's probe alike, in the nested and the flat envelope. `refusalMeets` reads it two ways: a declared code equal to `declaredCode` meets exactly, and a declared `VALIDATION_FAILED` is met by a `declaredCode` at any 4xx. A catalogue code with no `declaredCode` still never meets a different declared code, and a `declaredCode` at 5xx or with no status does not meet. The grade's detail names what met ("refused RESOURCE_CONFLICT (409), the hook's declared refusal ASSET_NOT_IN_STOCK").
- 1e77fef: fix(scenarios): a write the card gives a persona that the build denies it is charged to the build, not the operation
  
  Clause-②: yes (widening) — new exports `buildDeniesWrite` and `isWriteDenial` (`./score`, `./score/full`), `probesBuildDenial` (`.`), `buildDenialFindings` (`./runner`); new optional fields `OperationGrade.notMeasured` (`./score`, `./score/full`) and `OperationResult.buildDenial` (`./runner`)
  Metadata-protocol: none
  
  An operation declared `applied` whose agent write was refused 403 `PERMISSION_DENIED` counted as the operation's failure, even when the built app's permission set denied the persona a write the card gives it: the loss landed on the asking side for a build error.
  
  The runner now sends the declared write itself as the persona when the agent's own write on an `applied` create or update was denied 403 and nothing was written. When the door denies the probe too, and the build declares no lock that routes the write through an action, the operation is not measured ("the build denies the persona this write"): out of passed and total, and the scorecard lists a Build finding naming the persona, the object and the verb. The `write_validation` probe that meets the same 403 is reported the same way. A 403 the card declares (`refused PERMISSION_DENIED`) and a `pending_confirmation` operation grade as before, and the probe that meets the build's routed lock keeps its own not-measured reason. A hook's own refusal served at 403 (its code on `declaredCode`) is the app's rule, not a denial, and grades as before.
- 3693644: feat(scenarios): the Build half checks each persona's permission set for what the card has that persona read and write
  
  Clause-②: yes (widening) — additive in-process surface of the published `@objectstack/scenarios`, reachable from `./score/full` (`src/score/index.ts` re-exports `scenario-tags.ts`; the narrow `./score` entry does not): the functions `personaGrantNeeds` and `gradePersonaGrants`, the types `PersonaGrantVerb` and `PersonaGrantNeed`, the field `personaGrants` on `ScenarioArtifactScore`, and `ScenarioArtifactCard['run']` accepting optional `questions` and `operations`. `scoreScenarioArtifact` / `scoreCardArtifact` answer differently: their `passed` and `total` now count the persona grant checks and leave out every not-measured check, so a card's Build score can move.
  Metadata-protocol: none
  
  `scoreCardArtifact` (and `scoreScenarioArtifact`) gain `personaGrants`: one Build check per persona × object × verb the card implies, named `persona-grant:<persona>:<object>:<verb>`, judged against that persona's own permission set (`<namespace>_<persona id>`, the set the runner signs the persona in with). The needs come from the card alone: a question asked as the persona needs `read` on its object (not when the persona hides that object), an `applied` or `pending_confirmation` operation needs its kind, and an operation refused `PERMISSION_DENIED` must be refused by the set. The grant is read as the platform folds it (`buildEffectiveObjectPermissions`, then `objectPermissionGrants`: edit and delete are read and grant).
  
  - A needed verb passes when the set grants it. A withheld verb that only `pending_confirmation` operations need, where the build declares the card's confirm-gated agent action on that object, is not measured (out of passed and total, never a pass): that action is the route the card designs, and its body writes as the platform.
  - A refused write passes when the set grants no verb or locks a field the write names; it is not measured when only a row rule could refuse it, and fails when nothing in the set refuses it.
  - A persona whose set the build does not declare fails each of its checks.
  
  Not-measured checks now leave the card score's passed and total.
  
  The run record's build evidence (`./runner`, `runRecord`) lists each persona grant check beside the Build's other checks, so a failing one is named with its detail and a not-measured one with its reason. `personaGrants` also reaches `./runner` through `BuildHalf.score`.
- f445870: fix(scenarios): each card persona's role states the writes its build prompt did not
  
  Clause-②: no
  Metadata-protocol: none
  
  The open card library (shipped in `dist/library`) gives thirteen personas a role that names the objects and verbs of the writes the card has them make or refuses them, where the card's build prompt did not state them: crm `sdr` and `partner_user`, invoice `sales_rep` and `warehouse_staff`, project `contractor` and `client_viewer`, leave `hr_officer` and `employee`, service desk `support_agent` and `team_lead`, asset `asset_admin` and `employee`, and travel `employee`. A build is judged on its permission sets against those writes (`persona-grant:*`), so the prompt now asks for each. The role also reads in each persona's run prompt ("You act for …"). No other card text changes.
- 3c0033f: fix(scenarios): the run grader reads no figure out of a record identifier (`INV-003`, `i3`)
  
  Clause-②: yes (widening) — IDENTIFIER_TOKEN and isIdentifierToken exported from @objectstack/scenarios/score
  Metadata-protocol: none
  
  The run grader read every digit run in a reply as a number, so a reply that answered a persona's own count and named its rows (`INV-001`, `INV-003`, `i1`, `i3`) was flagged as leaking the all-rows count 3, read out of `INV-003` and `i3`. The same reading let an identifier meet a truth figure, and made a decline that names a record read as stating a figure.
  
  A number that is part of an identifier token is now no figure for the answer match or the leak scan: a run of Latin letters and digits joined by `-` or `_` in which a digit follows a letter (`INV-003`, `i3`, `AST-0041`, `ord_12`, a UUID, and period labels such as `Q3`). A number with its unit or suffix after it (`3k`, `1.2M`, `3万`, `3 days`, `3-day`, `3rd`), a currency before it (`$3`, `USD3,000`) and a number beside a CJK word (`共3张`) still read as figures, and a bare "3 invoices" outside the persona's scope is still a leak. `isIdentifierToken` and `IDENTIFIER_TOKEN` are exported from `@objectstack/scenarios/score`.
- f21d980: fix(scenarios): an unanswerable question declined with an invented figure is no longer graded correct
  
  Clause-②: no
  Metadata-protocol: none
  
  The run grader passed an `unanswerable` question on the decline alone, so "A tax rate is not recorded for INV-002, but it is probably 13%" was correct: the hedge plus an invented number is exactly the failure the question exists to measure.
  
  `correct` now needs the decline and no figure the data cannot support: every number the reply states must be one that some tool output of the same turn carries, read the way a coded refusal's echoed status is read (a number with a unit is carried by either reading, `1.2M` by 1.2 or 1,200,000). A decline that shows the rows it checked ("no tax rate field; INV-002 totals 120, lines 4 × 5 = 20 and 1 × 100 = 100") stays correct; one that adds a figure no tool output carries is not correct, with the problem `stated a figure the data cannot support`. A figure with no decline keeps today's problem, `did not say the data cannot answer`. Identifiers and ISO dates are no figures, as before. The `withheld` arm is unchanged.
  
  Accepted cost: an invented figure that happens to equal a number some tool output carries (0, 1 and small counts are common there) is not caught. Measured on the recorded eval runs of 2026-11-14 and 2026-11-15 (round 1 and the three-model comparison on the three control cards): all 12 recorded replies that decline stay correct, 6 of them showing the figures they read; the 6 `project_with_tasks` model-run replies are not measured, as no recording of them exists.
- 83cf892: fix(scenarios): an irreversible operation the agent applied through its declared confirmation gate, on an explicit instruction, meets `pending_confirmation` (temporary)
  
  Clause-②: yes (widening) — the grade accepts a new observation as `pending_confirmation`; new exports `AGENT_CONFIRMATION_MEETS_PENDING`, `askNamesTarget`, `askedFirst`, `confirmedByAgent` and the types `AgentConfirmationRule`, `AgentConfirmedObservation`, `AskNaming` (`./score`, `./score/full`), `actionGatesOf`, `confirmationTally` and `ConfirmationTally` (`./runner`); new optional fields `OperationGrade.confirmation`, `OperationObservation.agentConfirmed`, `GradeOperationOptions.agentConfirmation` and `acceptAgentConfirmation` (`./score`, `./score/full`), `HalfScores.confirmation` and `CardScorecard.confirmation` (`./runner`)
  Metadata-protocol: none
  
  An operation declared `pending_confirmation` failed whenever the agent read the person's explicit instruction as consent and sent `confirm: true` to the action's confirmation gate itself. The platform cannot tell a person's confirmation from the caller's own say-so today, so a gallery run hung on which way the agent chose.
  
  Until real human confirmation lands (objectstack-ai/cloud#3826 item 6), such a write also meets `pending_confirmation`, but only when all of these hold: the operation's ask, as the card authors it, names the target row (`askNamesTarget`); the write went through a business action (`run_action`), never `create_record`, `update_record` or `delete_record`; the build declares `ai.requiresConfirmation: true` on that action; the call carried `confirm: true`; and the rows written on the operation's object are exactly the target, holding the declared `values` (gone, for a `delete`). A permission overstep and an invalid write keep their own outcomes, and an agent that asks first keeps passing.
  
  The grade says which way it went (`OperationGrade.confirmation`: `asked first` or `confirmed by the agent`), and the scorecard counts both per half and per card. To grade strictly again, set `AGENT_CONFIRMATION_MEETS_PENDING` to `false`, or delete it with the rule it guards.
- ab343d5: fix(scenarios): the run grader reads "has no X field" and "does not record" as a decline
  
  Clause-②: no
  Metadata-protocol: none
  
  An honest decline on an `unanswerable` question graded as "did not say the data cannot answer" when it said the data does not hold the figure in the words agents use for it: "The Account object has no revenue field", "There is no revenue field on account", "Neither object has a sponsor field", "No tax-rate field exists", "no field records the sponsor", "The app's data doesn't record a sponsor". `declines()` now reads these, in either apostrophe, on `unanswerable` and `withheld` questions alike.
  
  The negation binds to recording, as the withheld-write reading binds it to acting: a missing field is named as a field in the same sentence, and a "does not record" (or store, track, capture) takes the data, the app, a record or an object as its subject. A report that negates a finding ("there is no error", "it does not record anything wrong", "no problem found"), a report about a cell ("none has an empty account field") and an absent object answered with another one ("the app has no task object, so I counted projects") still read as no decline. On an answerable question the change can only set the `declined` mark: the figures decide its verdict.
- b76df9a: fix(scenarios): a recorded replay re-sends each turn's recorded writes, so an applied operation reads back what the run wrote
  
  Clause-②: yes (widening) — new export `ReplayNotFaithfulError` and new optional field `AskTask.callTool` (`./runner`)
  Metadata-protocol: none
  
  `--driver recorded:FILE` handed back the recorded turn and sent nothing, so the freshly booted app never received the agent's writes: every `applied` operation read back no row and failed on replay ("0 row(s) read back"), and the operations half of a re-scored run was false fails.
  
  The replay now re-sends a turn's recorded writes (`create_record`, `update_record`, `delete_record`, `run_action`) to the booted app, in recorded order, as the turn's persona, through the runner's own MCP door, before the runner reads the operation back. Reads are never re-sent. A recorded refused write is re-sent too and must meet the same refusal again. A row the recorded run created gets a new id in the replayed app, and a later recorded write naming the old id is sent with the new one. When the app answers a re-sent write otherwise than it answered the recorded run, or a recorded write has no recorded answer (the turn was cut short, so whether it wrote is unknown, and nothing of that turn is re-sent), the turn's question or operation is not measured, with the call named in the reason, never a fail. Live drivers are unchanged.
- f8f35db: feat(scenarios): `--effort` (and `--author-effort` / `--ask-effort`) reaches `claude --effort`, and every turn records the effort it asked for
  
  Clause-②: yes (widening) — new CLI flags `--effort`, `--author-effort` and `--ask-effort` on `objectstack-scenarios run` / `run-scenarios`; new exports `CLAUDE_EFFORT_ENV` and `effortLevelsFromHelp` (`./runner`); new optional fields `ClaudeCodeDriverOptions.effort` / `authorEffort` / `askEffort`, `ExternalDriverOptions.effort` / `authorEffort` / `askEffort`, `DriverInfo.authorEffort` / `askEffort`, `ExternalLimits.effort`, `TurnProcess.requestedEffort`, `TurnSummary.requestedEffort` and `HalfScores.build.author.requestedEffort`, and the field `ModelTally.requestedEfforts` (all `./runner`)
  Metadata-protocol: none
  
  Until now the runner passed no effort, so every turn ran at the CLI's default and neither the run record nor the scorecard could say which effort produced a score.
  
  `--effort LEVEL` passes `claude --effort LEVEL` on every live turn; `--author-effort` and `--ask-effort` set the authoring turns and the question and operation turns apart, each in place of `--effort`, as the model flags do. The levels are the CLI's own, read off its `--help` when an effort is asked for (Claude Code 2.1.325: `low`, `medium`, `high`, `xhigh`, `max`); a level the CLI does not list is refused before any card runs, because the CLI itself only warns about an unknown level and runs the turn at its default effort.
  
  `CLAUDE_CODE_EFFORT_LEVEL`, which the CLI lets win over `--effort`, no longer reaches a turn: with no effort flag, the runner passes its level as `--effort` (`auto` and `unset` still mean the default), so the record names the effort that ran.
  
  Every turn records the effort it asked for (`requestedEffort`); the CLI reports no served effort. The scorecard shows the effort beside the served model on the author rows and the `Run · model` rows, and the record's driver states `authorEffort` and `askEffort`. `--driver external:` passes the level to the command as `limits.effort`; `--driver codex` and `--driver recorded:` refuse the three flags (`codex exec` has no effort flag; a replay re-reads each turn as it was recorded).
- e0775f7: fix(scenarios): a card's dates move onto the day it runs, so its "today" agrees with the app's real clock
  
  Clause-②: no
  Metadata-protocol: none
  
  A card fixes its "today" (`asOf`) and every prompt states it, but the app the run boots stamps `created_at` and `updated_at` with the real clock. A run weeks after `asOf` showed the agent seeded rows "created" after the day it was told was today. Agents stopped to ask about the mismatch, and correct operations failed.
  
  Before each card runs, `run-scenarios` now moves the card's dates by one whole-day delta, `run date − asOf`. The delta applies to `asOf`, every ISO date under `run` and `iterate` (seed rows, truth filters, operation values and expected post-states), and the dates an operation's or question's `ask` writes in its text (ISO dates, English `[Weekday] D Month`, Chinese `M 月 D 日(周X)`, with weekday names written again). The truths are computed again over the moved seed, so the prompt's "today", the seeded rows, the record timestamps and the grader's expectations agree. Intervals between the card's dates are kept exactly. A `calendar` window (`this_month`, `previous_month`) is read around the moved today. The card files are not changed, and a card without `asOf` runs as before.
- 4b5024d: fix(scenarios): the run grader reads a written calendar date ("31 Dec") as no figure
  
  Clause-②: no
  Metadata-protocol: none
  
  An unanswerable question passes when the agent declines and every number it writes is carried by a tool output of the turn. The number reader skipped ISO dates only, so a decline that offered to list laptops "whose 36-month depreciation life ends by 31 Dec" read `31` as a figure no output carried, and a correct reply failed with "stated a figure the data cannot support".
  
  The reader now skips a written calendar date the way it skips an ISO date: a day and a month name in either order (`31 Dec`, `Dec 31, 2026`), a month name with its year (`December 2026`), a slash date with its year (`31/12/2026`), and a Chinese date (`12月31日`, `2026年12月`). A month name is read only capitalised, a slash pair with no year (`3/4`) stays a figure, and a number beside no month is still read, so an invented count or amount ("about 12 laptops", "$4,200 due by 31 Dec") still fails.
- Updated dependencies [f229dfd]
- Updated dependencies [322ded7]
- Updated dependencies [f4cafd5]
- Updated dependencies [c747cf0]
- Updated dependencies [c747cf0]
- Updated dependencies [30e364e]
- Updated dependencies [1cf2a5a]
- Updated dependencies [605d712]
- Updated dependencies [05b56ef]
- Updated dependencies [f31f784]
- Updated dependencies [7ffbb1a]
- Updated dependencies [89d7bef]
- Updated dependencies [89d7bef]
- Updated dependencies [51ceb43]
- Updated dependencies [d635599]
- Updated dependencies [548f8ff]
- Updated dependencies [16e3486]
- Updated dependencies [16e3486]
- Updated dependencies [d38ceba]
- Updated dependencies [6538ba4]
- Updated dependencies [5430b4a]
- Updated dependencies [9673030]
- Updated dependencies [84c66d3]
- Updated dependencies [a1604ce]
- Updated dependencies [6c5d31f]
- Updated dependencies [b462444]
- Updated dependencies [5ea8ce5]
- Updated dependencies [4ace1fa]
- Updated dependencies [61ed314]
- Updated dependencies [40c73a8]
- Updated dependencies [2c98485]
- Updated dependencies [1bbeb94]
- Updated dependencies [9317833]
- Updated dependencies [5e29b7e]
- Updated dependencies [1f8ce6e]
- Updated dependencies [c312b26]
- Updated dependencies [7adb1b5]
- Updated dependencies [5b2ec82]
- Updated dependencies [3e19223]
- Updated dependencies [1b878e7]
- Updated dependencies [6482c08]
- Updated dependencies [6222ecb]
- Updated dependencies [728be58]
- Updated dependencies [728be58]
- Updated dependencies [1fd5d8a]
- Updated dependencies [26b5994]
- Updated dependencies [0ba30eb]
- Updated dependencies [27d042f]
- Updated dependencies [4dbcbdd]
- Updated dependencies [09da8c7]
- Updated dependencies [53f5a4c]
- Updated dependencies [bc50d11]
- Updated dependencies [0be91f0]
- Updated dependencies [df9fe94]
- Updated dependencies [8f9eb3d]
- Updated dependencies [1da43fe]
- Updated dependencies [6ff3eee]
- Updated dependencies [8b53cc8]
- Updated dependencies [b392ff7]
- Updated dependencies [6107290]
- Updated dependencies [489ef5f]
- Updated dependencies [ee627c6]
- Updated dependencies [53b3544]
- Updated dependencies [b070e1c]
- Updated dependencies [ea67b26]
- Updated dependencies [3cbf1f2]
- Updated dependencies [89defde]
- Updated dependencies [06e53a7]
- Updated dependencies [f64c0f9]
- Updated dependencies [1c32f6d]
- Updated dependencies [b8f6237]
- Updated dependencies [dd291b8]
- Updated dependencies [e997113]
- Updated dependencies [615c67f]
- Updated dependencies [67274ac]
- Updated dependencies [0a6f193]
  - @objectstack/spec@18.5.0
  - @objectstack/objectql@18.5.0
  - @objectstack/core@18.5.0
  - @objectstack/formula@18.5.0
  - @objectstack/plugin-sharing@18.5.0

## 18.4.0

### Patch Changes

- 58085ff: Clause-②: no
  Metadata-protocol: none
  
  New private package `@objectstack/scenarios` (`packages/qa/scenarios`, not published): the zod schema and loader for scenario cards, plus the open library's three control cards under `docs/qa/scenarios/`. A card states an authoring prompt, the structural `expect` the deterministic scorer reads, capability tags (area half closed to the platform-checklist areas) and a closed category, seed rows with data questions whose truth the loader computes from a declarative spec (`count | sum | avg | min | max | topN | unanswerable`, with filters, relative windows against a card-level `asOf`, relation paths through declared lookups, groupBy and order), personas with row scope whose per-persona truths are computed too, write operations that declare their outcome (post-state, refusal code or pending confirmation, with the audit actor), five guardrail checks, optional agent actions, and one iteration request. A malformed card is refused with its file and field path. No `packages/spec` change and no public surface change.
- 6ef7f58: feat(scenarios): the deterministic scenario scorer lives in `@objectstack/scenarios` and judges capability tags, agent-action exposure, write outcomes and per-persona answers against a loaded card
  
  Clause-②: no
  Metadata-protocol: none
  
  - **`@objectstack/scenarios/score`** (private, unpublished): the entry the scenario runner calls. `scoreCardArtifact(card, artifact)` scores a built `dist/objectstack.json`; `gradeCardOperation(card, operationId, observation)` judges an observed write against its declared outcome; `gradeCardAnswer(card, { question, persona?, turn })` grades an agent's answer against the loader's computed truth for that persona. Each takes a card the loader returned, and the graders read the card schema's own types.
  - **The scorer moved here from `@objectstack/cli`.** That covers the structural shape score, the artifact-to-graph reader and the Run grader, which were never released from the CLI. It now also carries:
    - **capability-tag checks**: a closed table of nine tags, listed in the package README. A tag outside it, or a row with nothing in the card to judge, is reported `unscored` and counted nowhere;
    - **agent-action exposure**: each declared action exists on its object, carries `ai.exposed: true` and, where the card says it asks first, `ai.requiresConfirmation: true`. A missing action fails;
    - **a write-operation grader**: `applied`, `refused` or `pending_confirmation`. An unobserved fact fails;
    - **per-persona Run grading**: a `withheld` truth is must-not-reveal, and an all-rows figure outside a scoped persona's rows is a leak.
  - **`@objectstack/cli`**: `MetadataEvalCase` is now declared in `corpus.ts`, beside the golden corpus it types, and `metadata-eval.ts` re-exports it under the same name. No behaviour change, no new flag and no new package-entry export. The CLI carries no scenario code.
  
  No model call anywhere.
- 802c98c: feat(scenarios): a local scenario runner builds, runs and iterates every card with a local Claude Code session and writes one run record per card
  
  Clause-②: no
  Metadata-protocol: none
  
  - **`pnpm --filter @objectstack/scenarios run-scenarios`** (private, unpublished; entry `@objectstack/scenarios/runner`): for each card under `docs/qa/scenarios/`, scaffold a project with `create-objectstack`, let the agent build it from the card prompt, run `objectstack validate`, `build` and `verify` (opt-in proofs chosen from the card's tags), boot it with `objectstack dev --fresh`, seed the card's rows, create one user, permission-set grant and API key per persona, and run every question and operation over the app's own MCP endpoint as that persona. Then apply the card's iterate change and score again.
  - **Template mode**: the card's verified build is installed unmanaged (`POST /api/v1/marketplace/install-local` with `installMode: 'unmanaged'`), the agent applies the iterate change to the installed copy, and the scorecard reports both modes side by side with the size of the change. A refused install is recorded as a finding.
  - **Scorecard and run record**: the scorecard reports Build, Run-问数, Run-operations and Iterate per mode, plus a per-tag table, with the real question and operation counts. A degraded build and a leaking answer are flagged. Records use the `docs/qa/platform-checklist/runs/` shape and stay out of git.
  - **Card object names are read namespace-relative.** Against a package with namespace `ns`, the card's `account` means `ns_account`. A scaffolded project refuses bare object names, and so does the unmanaged install (`NAMESPACE_PREFIX`).
  - **No API-billed model.** The live driver spawns the local `claude` CLI and refuses to start when `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` is set or the CLI is logged in with an API key. A recorded driver replays turns, so the runner's own tests need no model and no network. All grading is `@objectstack/scenarios/score`.
- eddc3ab: fix(scenarios): the scenario runner's seed owns a row only by a person the row names, and loads each persona's person row with its user
  
  Clause-②: yes (widening) — `./runner` gains two exports, `personaRecords` (the record binding: each persona's `record` row, `object/id` → persona) and `rowOwner` (the persona a seed row is owned by). `personaHandles` keeps its signature and is now the handle map only: it holds a value from a direct scope rule on a declared user-handle field (`account.owner` = `u_sam`), no longer a row id or option value from any other direct scope rule (`e06`, `public`); on the three control cards its answer is unchanged. `seedApp` sets `owner_id` by the new rule and writes the persona's user id into its record row's `user` field.
  Metadata-protocol: none
  
  The seed used to set a row's owner (`owner_id`) from any direct scope value that matched a persona's: an option (`ticket_comment.visibility = public` gave all 237 public comments on `service_desk` to the portal customer, 197 of them on other customers' tickets) or a lookup to a row that is no person (`ticket.group`, `employee.department`), and the last key read won a row two personas matched.
  
  - **Owner rule.** A row is owned by a persona's user only when it IS that persona's `record`, when a declared direct lookup on it (`expect.lookups`) holds that record's id (`ticket.assignee = a02`), or when a declared user-handle field on it holds the persona's handle (the control cards' route, unchanged). The first persona in `run.personas` order the row names owns it. Every other row keeps the inserter, the admin.
  - **Person binding.** Each persona's `record` row is loaded with that persona's user id in its `user` field (`PERSON_USER_FIELD`). Without persona accounts (the gallery's screenshot boot) no `user` field and no record-bound owner is set.
  - **Build prompt.** The Row ownership section names the person rows, asks for an optional `user`-type field named `user` on each person object, lists the lookups that name a person, states the persona order for a row naming two, and adds a platform-boundary line: the open-source server has no hierarchy resolver, so a person who must see rows another person owns gets them through what the build models.
  
  On `service_desk` the portal customer now owns no comment (was 237), the 5 tickets that name both the support agent and the portal customer go to the support agent, the team lead owns no ticket through `group` (was 78), and `cus_03`, `a02`, `a04` are their personas' rows.
- c0f88b9: feat(scenarios): a scenario card declares which seed fields hold a user handle and which seed row each scoped persona is, and a refused seed row takes out only the turns whose answer it changes
  
  Clause-②: yes (narrowing) — the published card schema (`ScenarioCardSchema` in the `.` entry) gains `run.userHandleFields` and `personas[].record`, and the loader (`loadScenarios`, `loadScenarioFile`) refuses a card it loaded before: a persona `scope` rule ending on a field that is neither `id`, a declared lookup or select, nor a declared user-handle field, and a scoped persona that names no person. `truthsOver` is a new export of the same entry. In `./runner`, `seedDependence` now takes the loaded scenario (it was handed the card) and its `question` takes the persona the turn is asked as, and `RunHalf.seed` gains `rewritten`.
  Metadata-protocol: none
  
  <!-- adr-0087: not-required (no-migration-prescription) The card format is QA tooling in a devx package, not the metadata protocol: no key of any platform schema is added, removed, renamed or re-shaped, and nothing an app author writes is refused. What moves is which scenario cards the loader accepts; a card author adds the two declarations the refusal names, and there is nothing for a metadata migration to rewrite. -->
  
  **BREAKING** accept-set narrowing at the scenario card loader (`@objectstack/scenarios`): a card that leaves the runner to infer what a scope value names is refused until it declares it. All nine cards in `docs/qa/scenarios/` carry the declarations and load as before.
  
  - **User-handle fields, declared.** `run.userHandleFields: [{ object, field }]` lists the seed fields whose text stands for a user (`account.owner` = `u_sam`). The runner loads each such cell with the user's id, and `userHandleFields` (runner `prompts.ts`) reads this list instead of inferring it from what the card does not declare. The loader refuses a scope rule whose last field is none of `id`, a declared lookup, a declared select or a declared handle field, and a handle declaration on the row id, a lookup, a select or a field no seed row carries. The run record's `seed.rewritten` lists the fields the seed rewrote. Across the nine cards the rewritten set is unchanged: `account.owner`, `invoice.owner`, `task.assignee`.
  - **The person a persona is.** `personas[].record: { object, id }` names the seed row that is this person (`{ object: "employee", id: "e06" }`). It is required for a persona with a `scope`, unless the persona is named by a direct scope rule on a declared handle field (the three control cards), and optional for a global persona. The loader refuses a record that names no seeded row. The person object's user field is `user` by name. The runner does not read `record` yet.
  - **Seed dependence per turn.** When the app refuses a seed row, the runner computes each question's truth again over the seed less the refused rows and their children (`truthsOver`, the loader's own rules), and marks not measured only the turns whose expected answer changes. Before, every question on an object holding a refused row was not measured. On `crm_account_with_contacts`, refusing contact `ct4` now leaves `contacts_per_account` as `sdr` (whose scope never reads it) measured.
  
  **Who moves.** An author of a scenario card in a private overlay: add `run.userHandleFields` for each field holding a user handle, and `record` on each scoped persona that is a seed row. A caller of `seedDependence` from `@objectstack/scenarios/runner` passes the `LoadedScenario` and asks `question(q, persona)` per turn (`null` for a turn over all rows).
- 518d1bd: feat(scenarios): `gallery-refresh`, the gallery refresh in one deterministic step
  
  Clause-②: yes — a new `gallery-refresh` entry point on the published `@objectstack/scenarios` widens its surface; the PR body carries the reading
  Metadata-protocol: none
  
  - **`pnpm --filter @objectstack/scenarios gallery-refresh --gallery DIR [--cards DIR] [--model M] [--debut] [--work DIR] [--chromium PATH]`** (`src/export/refresh-cli.ts`): reads npm's latest stable `@objectstack/cli` and the `framework.version` of every app the gallery checkout's `index.json` lists. When every listed app states that release it prints one `skip: …` line and exits 0, having run nothing; it also skips while a remote-tracking `export/<version>` branch awaits review. Otherwise it runs every card the gallery may show (origin `generic`, tier `starter` or `delivery`; `--debut`: the first of them, only into an empty gallery) with `run-scenarios --modes scratch --packages published --create-version <version>`, exports with screenshots into the checkout, commits `apps/` and `index.json` on a new local branch `export/<version>` and prints the branch, the commit and a ready PR body. It never pushes and never opens a PR. Every refusal (not a clean checkout, an index that does not validate, a prerelease `latest`, an existing local branch, no app exported, an app on another framework version, a change outside `apps/` and `index.json`) exits 1 with the reason.
  - **`@objectstack/scenarios/export`** also exports the step as a library: `galleryRefresh`, `runnerArgv`, `readGalleryVersions`, `npmLatestVersion`, `refreshPrBody`, `galleryBranch`, `RefreshRefusal`, `FRAMEWORK_PACKAGE`, `STABLE_VERSION` and their types.
  - The live driver's header names ruling D2: a local session or a scheduled cloud Claude Code task on the maintainer's subscription login may run the cards; an API-billed model still never may. The driver's refusal of an API key is unchanged.
  - The README gains "Refreshing the gallery — `gallery-refresh`" and the scheduled task's runbook: what it runs, what it needs, what it never does, and the task's prompt verbatim.
- c2bb879: feat(scenarios): `export-gallery --check DIR`, the mechanical check a PR on objectstack-ai/gallery must pass
  
  Clause-②: no
  Metadata-protocol: none
  
  - **`export-gallery --check DIR`** reads a gallery tree and prints one `CODE PATH: MESSAGE` line per finding, exiting 1 on any and 0 on a clean tree. It writes nothing. It fails a tree when `index.json` does not match the exporter's own schema, when an entry has no complete `apps/<id>/` directory (README, run record, scorecard, transcript, `source/objectstack.config.ts`, at least one screenshot with every listed one on disk and none unlisted), when a directory under `apps/` is not listed, when a `framework.version` is not a stable `@objectstack/cli` release published on npm, and when the tree holds a `.env*` name, a `node_modules` directory, a symbolic link or a text file naming a local absolute path. An absent `index.json` is an empty gallery.
  - It runs from a checkout (`pnpm --filter @objectstack/scenarios export-gallery --check DIR`) and from the published command line (`npx @objectstack/scenarios export-gallery --check DIR`), which loads it lazily from its own built entry, so `help` and `version` still load nothing else.
  - **`@objectstack/scenarios/export`** also exports `checkGallery`, `mainCheck`, `npmPublishedVersions`, `renderFinding`, `FINDING_CODES` and `LOCAL_PATH`. The app layout, the framework package and the stable-version shape move into one shared module that the exporter, the refresh and the check all read; their exports are unchanged.
- d3b6ff4: feat(scenarios): the scenario runner drives the Codex CLI (`--driver codex`) and any command that speaks a stdin/stdout driver contract (`--driver external:COMMAND`), and each gallery app page names the driver that ran it
  
  Clause-②: yes
  Metadata-protocol: none
  
  The same scenario card can now measure another agent tool. Additive: nothing is removed or renamed.
  
  - **`--driver codex`** (`CodexDriver`): `codex exec --json` on your own ChatGPT plan login. It refuses to start while `OPENAI_API_KEY` or `CODEX_API_KEY` is set or `codex login status` reports anything but a ChatGPT login, and passes `-c forced_login_method="chatgpt"` on every turn. The persona's API key reaches the CLI only in a 0600 profile file under `$CODEX_HOME`, deleted when the turn returns. `--model`, `--author-model`, `--ask-model` and `--author-timeout` apply; `codex exec` has no turn cap, so `--author-max-turns` and `--ask-max-turns` are refused with it.
  - **`--driver external:COMMAND`** (`ExternalDriver`, contract `objectstack-scenario-driver/1`): one process per call, the call as JSON on stdin (`info`, `author`, `ask`), the turn as JSON on stdout. A non-zero exit or an answer of another shape is a failed turn with a named reason (`no-result(exit N)`, `invalid-output(…)`). The persona's key is only in a 0600 file whose path the `ask` call names, never on argv, in the environment or on stdin. The package README states the contract.
  - **The driver on record**: `DriverInfo` gains `replayOf`, so a replay (`--driver recorded:F`) names the driver and version of the recording it replays. Each exported gallery app page carries a `- Driver:` line with the driver's name and version (`driverText`).
  - `ApiBillingRefusedError` takes an optional second argument naming the agent tool and its login command; its default message is unchanged.
- e0a7878: feat(scenarios): the external driver contract carries the cost and tokens a command reports, and the scorecard and the gallery page state a channel's authoring cost only when every authoring turn reported one
  
  Clause-②: no — `@objectstack/scenarios` has never been published (`npm view @objectstack/scenarios` answers E404 on 2026-11-10), so no released accept-set or public surface widens
  Metadata-protocol: none
  
  Additive: nothing is removed or renamed, and the contract name stays `objectstack-scenario-driver/1`.
  
  - **The answer** to an `author` or `ask` call (`ExternalTurnSchema`) gains three optional keys: `reportedCostUsd` (the call's cost in US dollars as the tool reports it, zero or more), `inputTokens` and `outputTokens` (whole numbers, zero or more). A command that reports none answers the same contract. A figure of another shape is `invalid-output(…)`.
  - **The turn and the run record**: the external driver carries each figure into the turn's `meta` only when the command reported it, and every turn in the run record (`TurnSummary`) now carries `reportedCostUsd`, `inputTokens` and `outputTokens` when its driver reported them, the `claude` CLI's `total_cost_usd` included. A turn that reported none records none, never a zero.
  - **The scorecard** gains `authorCost` (`AuthorCost`: the authoring turns that ran, how many reported a cost, and their sum in `usd`), for the card and for each mode, with an `author cost:` line and an `Author cost` row. The sum is stated only when every authoring turn (build and iterate) reported a cost; otherwise it reads `not reported`, never a partial sum. `authorCost`, `authorCostText` and `usdText` are exported from `./runner`.
  - **The gallery page** (`README.md` of each exported app) carries a `- Author cost (as the driver reported it):` line on the same rule. A record written before this release has no `authorCost` and reads `not reported`.
- fba4c00: feat(scenarios): `@objectstack/scenarios` is published, with an `objectstack-scenarios` command line: `npx @objectstack/scenarios run` runs the open scenario cards with no checkout of the platform
  
  Clause-②: yes
  Metadata-protocol: none
  
  The package was private. It is now released with the `@objectstack/*` packages, at their version, and it carries:
  
  - **A `bin`, `objectstack-scenarios`.** `objectstack-scenarios run [flags]` is the scenario runner (`run-scenarios` in this repository) with the same flags, defaults and refusals: it drives your own local Claude Code login and refuses to start when `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` is set or the CLI is logged in with an API key. `help` and `version` are the other two commands. The bin runs the built JavaScript in `dist/`.
  - **The open card library as package data** (`dist/library/`): the cards of `docs/qa/scenarios/` and the capability areas they are checked against, copied at build time. `run` reads them unless `--cards DIR` names another directory, which is loaded as the overlay. Run records go to `./scenario-runs` unless `--out` says otherwise.
  - **The library entries it already had**: the card schema and loader (`@objectstack/scenarios`), the scorer (`./score`, `./score/full`), the runner (`./runner`) and the gallery exporter (`./export`).
  
  It is not an `objectstack` (`os`) subcommand, and nothing in `@objectstack/cli` changes.
- 78a8388: fix(scenarios): the scorer's bare-name Build check judges only the names ADR-0150 keeps on the literal prefix, and the build prompt asks for the prefix only there
  
  Clause-②: no
  Metadata-protocol: none
  
  The scorer (`gradeItemNames`, `./score`) used to fail every non-object item a build named without the app's namespace, and the build and iterate prompts told the agent to prefix every item. ADR-0150 identifies flows, actions, jobs, tools, skills, agents, apps, pages, dashboards, permission sets and every other behavioural type by (package, name), so a build that names them plainly is correct.
  
  - **Judged now:** views, docs and positions named `<namespace>_<short>`, and capabilities named `<namespace>.<short>`. A bare one is still a failing Build check `bare-name:<type>:<name>`, and a capability spelled `<namespace>_<short>` now fails too. Objects stay judged by `defineStack`.
  - **No longer judged:** every other collection. A build whose only finding was a bare flow, action, dashboard or permission set name now passes its Build half.
  - **Prompts:** the naming rule names the prefixed types and says every other item needs no prefix, while the names the prompt states (persona permission sets, dashboards, agent actions) are still used exactly.
- c8ea88d: fix(scenarios): the scorer and observer stop failing correct agent answers, and two cards drop a field name the platform reserves
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Cards.** `order_to_cash` (`employee.role`) and `service_desk` (`agent.role`) name the field `job_function` in their select expectation and every seed row. ADR-0090 D3 refuses the word `role` in any field name, so the seed of a build that followed the card was refused.
  - **Numbers.** An ISO date or datetime states no figure: none of its parts is read as a number.
  - **Averages.** An average figure is also met by its value rounded to the precision the reply writes it in, at two significant digits or more. 4.5556 is met by `4.56` and `4.6`, not by `5` or `4.55`.
  - **"Who" questions.** A count grouped by a field whose truth is one group of count 1 is also met by naming the group. The group is named by its key and, for a declared lookup, by the `name` of the seed row the key points at. No card changes format.
  - **Declines.** A write the reply says it withheld, in the first person ("I didn't approve", "I won't change", "I haven't submitted", "I don't think I should"), reads as a decline. A negated finding ("I didn't find any problem") does not.
  - **Correction requests.** A request for the missing value ("What should it say?", "tell me the right number", "What I need from you: …") reads as asking for a correction.
  - **Flow refusals.** A `run_action` whose flow ended on its declared refusal (`result.status: 'refused'`) reads as `refused (the flow refused)` with the flow's text, not as an applied write.
  - **Hidden values.** A hidden number equal to a number the persona can read in a field it is not hidden from is no longer matched as a leak. A tool call that served the hidden field is still caught by the field's name.
  - **The app's own refusal.** A declared `VALIDATION_FAILED` is also met by a refusal code the app defined itself (one outside the platform's error catalogue) at any 4xx status, and by the app's flow refusal. A platform catalogue code other than the declared one still never meets it, at any status.
  - **Probes that meet the build's lock.** When the runner's own probe write is refused 403 `PERMISSION_DENIED`, writes nothing, and the build locks a field the probe writes for the acting persona and declares an action on the object, the operation's platform half is not measured: it counts in neither passed nor total, is never a pass, and the scorecard lists the reason under the mode's findings.
  - **Object extensions.** The build graph merges every `objectExtensions` entry's `fields` into the object it extends, in the registry's priority order, so the select, lookup and field-count checks read what the runtime serves.
  
  No model call and no network, as before.
- Updated dependencies [31fe289]
- Updated dependencies [7d0b47c]
- Updated dependencies [f6a429b]
- Updated dependencies [eb96480]
- Updated dependencies [8aa2e91]
- Updated dependencies [c17719d]
- Updated dependencies [de24d17]
- Updated dependencies [b90a6f7]
- Updated dependencies [486b0a9]
- Updated dependencies [9ed2ee1]
- Updated dependencies [769adff]
- Updated dependencies [13c0c5b]
- Updated dependencies [fe835b4]
- Updated dependencies [e8dc483]
- Updated dependencies [bcdb1db]
- Updated dependencies [9ebca94]
- Updated dependencies [3b8c724]
- Updated dependencies [140d8ce]
- Updated dependencies [699ebd8]
- Updated dependencies [5f47410]
- Updated dependencies [4c2cd29]
- Updated dependencies [4be8a2e]
- Updated dependencies [471add3]
- Updated dependencies [314ad95]
- Updated dependencies [b5eb61d]
- Updated dependencies [771b2db]
- Updated dependencies [97e4249]
- Updated dependencies [9037b13]
- Updated dependencies [e3b56b2]
- Updated dependencies [a52761f]
- Updated dependencies [e8afd1e]
- Updated dependencies [bd65cb6]
- Updated dependencies [cd5f554]
- Updated dependencies [f19fbb8]
- Updated dependencies [217ba78]
- Updated dependencies [cde492d]
- Updated dependencies [eee4149]
- Updated dependencies [0f3ee58]
- Updated dependencies [f3a52d3]
- Updated dependencies [d59a1eb]
- Updated dependencies [13aa6a3]
- Updated dependencies [391d748]
- Updated dependencies [af3451b]
- Updated dependencies [ddcdc80]
- Updated dependencies [000e773]
- Updated dependencies [7fc401f]
- Updated dependencies [4013e30]
- Updated dependencies [3a27208]
- Updated dependencies [29cbfcc]
- Updated dependencies [343ddb2]
- Updated dependencies [0c666c3]
- Updated dependencies [f672e0d]
- Updated dependencies [38717d3]
- Updated dependencies [bfbdeec]
- Updated dependencies [4adc890]
- Updated dependencies [bcdf8d3]
- Updated dependencies [ac890f5]
- Updated dependencies [aa57c76]
- Updated dependencies [fc869c2]
- Updated dependencies [fef212b]
- Updated dependencies [dc51811]
- Updated dependencies [b77c160]
- Updated dependencies [09720e2]
- Updated dependencies [25fea77]
- Updated dependencies [3da9a4c]
- Updated dependencies [3da9a4c]
- Updated dependencies [4be9734]
- Updated dependencies [bb86ff9]
- Updated dependencies [2046d21]
- Updated dependencies [243eba1]
- Updated dependencies [05a30e6]
- Updated dependencies [6f017e2]
- Updated dependencies [fd749a4]
- Updated dependencies [a26abbc]
- Updated dependencies [d9d42d4]
- Updated dependencies [6a70821]
- Updated dependencies [9d939c5]
- Updated dependencies [d4a8439]
- Updated dependencies [69c7cd6]
- Updated dependencies [25e1c1a]
- Updated dependencies [67d5d53]
- Updated dependencies [47226e6]
- Updated dependencies [c7d1367]
- Updated dependencies [f5aaa0b]
- Updated dependencies [0005fec]
- Updated dependencies [2d6402c]
- Updated dependencies [77c203a]
- Updated dependencies [8293c74]
- Updated dependencies [8cc709d]
- Updated dependencies [29702d5]
- Updated dependencies [a839020]
- Updated dependencies [a7b8876]
- Updated dependencies [f7afab8]
- Updated dependencies [7b80724]
- Updated dependencies [fb1ab89]
- Updated dependencies [4dde0ae]
- Updated dependencies [590724f]
- Updated dependencies [38d416f]
- Updated dependencies [d2e2f6f]
- Updated dependencies [d5f3bc5]
- Updated dependencies [e3948ae]
- Updated dependencies [b55d6ab]
- Updated dependencies [1c5cee6]
- Updated dependencies [aad1603]
- Updated dependencies [0e4747a]
- Updated dependencies [f41ddbd]
- Updated dependencies [561d532]
- Updated dependencies [7145bf3]
- Updated dependencies [55d9dd4]
- Updated dependencies [af8aab1]
- Updated dependencies [63de248]
- Updated dependencies [a59d00a]
- Updated dependencies [a2437b5]
- Updated dependencies [4bf9a2d]
- Updated dependencies [0c9aa82]
- Updated dependencies [49c8568]
- Updated dependencies [4564d6f]
- Updated dependencies [f2ea193]
- Updated dependencies [ee874b1]
- Updated dependencies [badf24d]
- Updated dependencies [5268f50]
- Updated dependencies [a30c4f4]
- Updated dependencies [e2bcd5c]
- Updated dependencies [0cba0ce]
- Updated dependencies [c893b3d]
- Updated dependencies [677d542]
- Updated dependencies [9bdeed2]
- Updated dependencies [9052337]
- Updated dependencies [3479c33]
- Updated dependencies [000a4c0]
- Updated dependencies [f4d9c09]
- Updated dependencies [4a3b186]
- Updated dependencies [a2826a1]
- Updated dependencies [2a6a28d]
- Updated dependencies [902f162]
- Updated dependencies [c77dd17]
- Updated dependencies [555eb1b]
- Updated dependencies [ebe0a98]
- Updated dependencies [9038187]
- Updated dependencies [f108e6d]
- Updated dependencies [8847e09]
- Updated dependencies [40eaae7]
- Updated dependencies [45916c9]
- Updated dependencies [b2ce250]
- Updated dependencies [5cb7d7e]
- Updated dependencies [468e0c1]
- Updated dependencies [6106b73]
- Updated dependencies [0f920b9]
- Updated dependencies [33bc8ae]
- Updated dependencies [ed4b832]
- Updated dependencies [b70d9aa]
- Updated dependencies [f6199a8]
- Updated dependencies [a1afbb9]
- Updated dependencies [150f740]
- Updated dependencies [42eb126]
- Updated dependencies [8cf1fd0]
- Updated dependencies [98583cd]
- Updated dependencies [a5cb4f1]
- Updated dependencies [3c1eb63]
- Updated dependencies [d57be87]
- Updated dependencies [2b752f1]
- Updated dependencies [c0068ed]
- Updated dependencies [7fe019f]
- Updated dependencies [e735425]
- Updated dependencies [534a287]
- Updated dependencies [71d094c]
- Updated dependencies [8b16445]
- Updated dependencies [6ee8c61]
- Updated dependencies [8c75f83]
- Updated dependencies [3aa0b42]
- Updated dependencies [82e6da1]
- Updated dependencies [acfc86c]
- Updated dependencies [18ed2db]
- Updated dependencies [39aa3f6]
- Updated dependencies [90457e7]
- Updated dependencies [1f30be1]
- Updated dependencies [76e4c2c]
- Updated dependencies [47bc621]
- Updated dependencies [efbe1a0]
- Updated dependencies [2d1a76b]
- Updated dependencies [3b7219e]
- Updated dependencies [3fed8ce]
- Updated dependencies [bafbc68]
- Updated dependencies [0ebb080]
- Updated dependencies [907fdca]
- Updated dependencies [f25414e]
- Updated dependencies [75d7fb1]
- Updated dependencies [41106b5]
- Updated dependencies [8aaa69f]
- Updated dependencies [59630d9]
- Updated dependencies [fe88ecd]
- Updated dependencies [5e85952]
- Updated dependencies [ef4af73]
- Updated dependencies [ae31539]
- Updated dependencies [7e697ff]
- Updated dependencies [d9a232f]
- Updated dependencies [d655caf]
- Updated dependencies [1cd0e01]
- Updated dependencies [3487ccc]
- Updated dependencies [43fb482]
- Updated dependencies [cc16008]
- Updated dependencies [cfe3563]
- Updated dependencies [2b3e3eb]
- Updated dependencies [5b7269f]
- Updated dependencies [4fd8db3]
- Updated dependencies [6dd196d]
- Updated dependencies [d834a36]
- Updated dependencies [0cd594b]
- Updated dependencies [8beac67]
- Updated dependencies [b96b875]
- Updated dependencies [c62e72a]
- Updated dependencies [351c22c]
- Updated dependencies [450bfb6]
- Updated dependencies [5defbfe]
- Updated dependencies [f56354c]
- Updated dependencies [e55347d]
- Updated dependencies [5f84ef0]
- Updated dependencies [5f84ef0]
- Updated dependencies [9046e02]
- Updated dependencies [f647430]
- Updated dependencies [36a8700]
- Updated dependencies [69db709]
- Updated dependencies [fdfcc7a]
- Updated dependencies [5a8dbc7]
- Updated dependencies [fb94249]
- Updated dependencies [e627eaa]
- Updated dependencies [7231dc7]
- Updated dependencies [c8223fb]
- Updated dependencies [3224545]
- Updated dependencies [8fca8f7]
- Updated dependencies [26d30d7]
- Updated dependencies [a15b544]
- Updated dependencies [3684d18]
- Updated dependencies [d9f626b]
- Updated dependencies [1a66fcf]
- Updated dependencies [6180c87]
- Updated dependencies [bc41e01]
- Updated dependencies [f00fb1b]
- Updated dependencies [c655af8]
- Updated dependencies [93ff5dd]
- Updated dependencies [c7dd505]
- Updated dependencies [016ec88]
- Updated dependencies [1934918]
- Updated dependencies [01559b8]
- Updated dependencies [8075338]
- Updated dependencies [93f0d43]
- Updated dependencies [c7dc143]
- Updated dependencies [aad7d2f]
- Updated dependencies [4f6fb53]
- Updated dependencies [7d4fcb6]
- Updated dependencies [4c928f5]
- Updated dependencies [171cf6d]
- Updated dependencies [ff04ad8]
- Updated dependencies [36b216b]
- Updated dependencies [84aabea]
- Updated dependencies [b96d492]
- Updated dependencies [ed95466]
- Updated dependencies [0561e60]
- Updated dependencies [45f0f81]
- Updated dependencies [fa4cb68]
- Updated dependencies [036a9fb]
- Updated dependencies [91d88ec]
- Updated dependencies [fb71296]
- Updated dependencies [aac03d9]
- Updated dependencies [f714b0a]
- Updated dependencies [ba8e993]
- Updated dependencies [9bff554]
- Updated dependencies [1368536]
- Updated dependencies [7aab601]
- Updated dependencies [5c5f382]
- Updated dependencies [c419609]
- Updated dependencies [eeb6cc1]
- Updated dependencies [88282a7]
- Updated dependencies [d074c28]
- Updated dependencies [225e179]
- Updated dependencies [0bc0774]
- Updated dependencies [e765a09]
- Updated dependencies [1e474e3]
- Updated dependencies [7575116]
- Updated dependencies [0763bf6]
- Updated dependencies [de6d893]
- Updated dependencies [5192297]
- Updated dependencies [326453e]
- Updated dependencies [a95cb06]
- Updated dependencies [f1d1f6c]
- Updated dependencies [a03cf66]
- Updated dependencies [90106d6]
- Updated dependencies [26f4e6d]
- Updated dependencies [6ff08b0]
- Updated dependencies [f09517e]
- Updated dependencies [2ae811e]
- Updated dependencies [1216abf]
- Updated dependencies [3c18783]
- Updated dependencies [e336a33]
- Updated dependencies [e336a33]
- Updated dependencies [3452dec]
- Updated dependencies [e47da23]
- Updated dependencies [f0f729e]
- Updated dependencies [1af8253]
- Updated dependencies [be0c0a2]
- Updated dependencies [c54d60c]
- Updated dependencies [101adaf]
- Updated dependencies [6219588]
- Updated dependencies [6cec006]
- Updated dependencies [af90f30]
- Updated dependencies [245afc1]
- Updated dependencies [ee9ad83]
- Updated dependencies [070e879]
- Updated dependencies [a888c5c]
- Updated dependencies [9ae8291]
- Updated dependencies [a2cb3aa]
- Updated dependencies [4f1de9f]
- Updated dependencies [8c77203]
- Updated dependencies [386891e]
- Updated dependencies [9891065]
- Updated dependencies [870ce55]
- Updated dependencies [c54a23d]
- Updated dependencies [28a1527]
- Updated dependencies [b811f6a]
- Updated dependencies [9af0766]
- Updated dependencies [fd63747]
- Updated dependencies [1ff2c7f]
- Updated dependencies [0b23b2a]
- Updated dependencies [fc45328]
- Updated dependencies [04c35f0]
- Updated dependencies [a596c03]
- Updated dependencies [ccaee99]
- Updated dependencies [d4b14a8]
- Updated dependencies [8004529]
- Updated dependencies [152b53c]
- Updated dependencies [3a83b53]
- Updated dependencies [e003ebb]
- Updated dependencies [6739719]
- Updated dependencies [5d4f2aa]
- Updated dependencies [9dbcc1f]
- Updated dependencies [19f9053]
- Updated dependencies [133f75a]
- Updated dependencies [f4cd4ec]
- Updated dependencies [d0fbe11]
- Updated dependencies [eca7cd2]
- Updated dependencies [cf4b9bf]
- Updated dependencies [767f110]
- Updated dependencies [7193160]
- Updated dependencies [14754c7]
- Updated dependencies [766a5df]
- Updated dependencies [e1dac19]
- Updated dependencies [e542831]
- Updated dependencies [44a030b]
- Updated dependencies [21510bb]
- Updated dependencies [8304b08]
- Updated dependencies [0fd363d]
- Updated dependencies [f127b04]
- Updated dependencies [5210acf]
- Updated dependencies [d6b88f1]
- Updated dependencies [4123865]
- Updated dependencies [bdbaf80]
- Updated dependencies [6ffe37e]
- Updated dependencies [cad764d]
- Updated dependencies [63a470a]
  - @objectstack/objectql@18.4.0
  - @objectstack/spec@18.4.0
  - @objectstack/core@18.4.0
  - @objectstack/plugin-sharing@18.4.0
  - @objectstack/formula@18.4.0
