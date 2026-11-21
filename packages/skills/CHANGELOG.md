# @objectstack/skills

## 18.7.0

### Patch Changes

- adcb9f8: docs(skills): the hooks skill teaches when a `before*` hook's `ctx.api` writes roll back with a refused save
  
  Clause-②: no
  Metadata-protocol: none
  
  objectstack-data's `references/data-hooks.md`, "Before vs After Hooks" table: the `before*` Transaction cell no longer says only "Within transaction". It now says the hook runs in one transaction with the outer write, so a refusal anywhere in that write (a validation, a later hook, a driver constraint) rolls back the hook's `ctx.api` writes too, with no per-hook opt-out. It names the four exits: a caller's open transaction decides; a hooked object off the default datasource, or a default driver with no transactions (Turso's remote transport), opens none, so those writes stay stored after a refusal; a hook registered in code with `registerHook` opens none. It also says MongoDB needs a replica set, which was read in the driver's code and not measured. Best Practices gains one DON'T: a `before*` hook does not write business records to another datasource through `ctx.api`. Its transaction refuses that write with `CrossDatasourceTransactionWriteError`, and only an append-only ledger (`lifecycle.class` `audit` / `telemetry` / `event`) is written outside it. `evals/hooks-security-seeds-datasources.json` gains two cases, one for each rule. Four restatements in data-hooks.md were removed to pay for the new text.
- 0d9d982: docs(skills): the api and i18n skills teach `RuntimeBuildIssue.userMessage`
  
  Clause-②: no
  Metadata-protocol: none
  
  objectstack-api's SKILL.md, in the error-envelope section, names the post-publish probe report a batch publish answers (`probes`, `BuildProbeReportSchema`) and its finding element (`RuntimeBuildIssueSchema`): `message` / `fix` are English for the agent that built the app, the optional `userMessage` is the sentence for the person who published, and a client shows a person `userMessage`, never `message`, with its own generic sentence when the field is absent; the publish door reads the request's locale from `Accept-Language` alone. objectstack-i18n's SKILL.md lists the `probes` issue among the server-composed user text, which its platform locale ladder covers. The api skill points at the schema and ADR-0038 for the rest. One new eval case in the api skill grades a client that renders a build finding to a person.
- fca72df: docs(skills): `objectstack-automation` teaches the `fault` edge on a write after an approval decision, and what `RESUME_FAILED` carries without one
  
  Clause-②: no
  Metadata-protocol: none
  
  `references/state-machines-and-approvals.md` § Branching, side-effects & rejection gains one bullet. When a step on the `approve` / `reject` branch writes a record that a record hook, a validation rule or a permission may refuse, the flow draws a `fault` edge from that step to a handler: the refusal takes that edge and the decision answers normally. Without the edge `POST …/approve` (or `/reject`) answers `500 RESUME_FAILED`: the decision stands (`finalized: true`), the run is stranded, and the body may carry `innerRefusal` (`{ code, message }`) and `userMessage`, the hook's declared sentence for the approver. One eval case covers it; its prompt asks for the flow as a TypeScript `defineFlow`.
  
  Paid in place, the token ceiling does not move. Four restatements were cut, each keeping another home: the send-back section's text diagram (the paragraph above it and the snippet below it trace the same path), and three bullets of § Branching: "Conditional step" (the discount-approval example's `needs_director` node and the list item above it that names the `e1` edge), the send-back pointer (the section it pointed to), and "Hard reject" (the examples' `reject` edges into an `end` node).
- e91d967: docs(skills): `objectstack-ui` teaches an action's `resultDialog` (its `table` format included) and the aggregate bulk handler's `BulkActionResult`
  
  Clause-②: no
  Metadata-protocol: none
  
  `rules/actions.md` gains a `resultDialog` entry beside `preflight`: the keys of the one-shot dialog, the `fields` row, the six formats, and `format: 'table'` with its required `columns` (one row per element of the array, one cell per column). It states that a `text` or `code-list` cell has no copy control while a `secret` or `qrcode` cell keeps its own. A second entry teaches what an `execution: 'aggregate'` bulk handler resolves with when it wrote some rows and refused others, `{ succeeded: string[], failed: [{ id, message }] }`, that it resolves and does not throw, and how the console counts the ids. One eval case for each.
- 9d07723: Clause-②: no
  Metadata-protocol: none
  
  `objectstack-ask` gains trigger cases (`evals/triggers.json`); `objectstack-automation`'s flow-type table sends a stepped form that never branches to an `objectstack-ui` form view, `type: 'wizard'`, and `objectstack-ui` gains that trigger case.
- 5ed945b: Clause-②: no
  Metadata-protocol: none
  
  docs(skills): the `description` of `objectstack-data`, `-ui`, `-automation`, `-formula`, `-i18n` and `-query` now leads with what the user is doing ("design or change a data model, in a project or through MCP"), keeps the `*.object.ts`-style file names as a secondary cue, and ends with a "Not for" clause naming the neighbouring skill. An agent building through MCP has no project files, so a description that triggered on file names never loaded the skill. Each is 432 to 450 characters (432 to 849 before). No skill body changes; the README index and the Skills reference page are regenerated from the new text.
- 6ec3a73: docs(skills): the sections served to MCP clients show their examples as JSON, and a check pins their headings
  
  Clause-②: no
  Metadata-protocol: none
  
  A client that builds through MCP writes JSON, and the sections of `objectstack-data`, `objectstack-ui` and `objectstack-automation` that the hosted MCP door serves showed their examples in TypeScript. Those sections now give each example as JSON, with one line on how a TypeScript project wraps the same literal:
  
  - `objectstack-data`: the object in Object Definition, the `state_machine` rule in State Machine Validation, and the `summary` field and the permission set in Roll-up Summaries. Field Type Selection names the `{ dialect: 'cel', source }` envelope beside the TypeScript tag.
  - `objectstack-ui`: the write-button action in Actions.
  - `objectstack-automation`: the `notify` node (its key notes are a list under the block), the `script` and `update_record` pair in Valid-but-silently-wrong, the whole approval flow in Approvals (Flow Nodes), and the start node and window filter of the time-relative trigger, beside its TypeScript flow.
  
  The other served sections are prose and tables and read the same to both kinds of client; three of them drop a TypeScript-only phrase.
  
  Every JSON block in a served section is parsed and validated against the spec schema for its kind in CI, and a renamed, removed or duplicated heading of a served section now fails there.
- 693e921: feat(skills): objectstack-mcp-build, the order of work for a client that builds through the MCP draft door
  
  Clause-②: no
  Metadata-protocol: none
  
  The skills catalog gains `objectstack-mcp-build`, a short process skill for a client that builds or changes an app's metadata through an environment's MCP draft door, with no project files. It gives the order of work: read what exists (`list_metadata_items`, `get_metadata_item`, and `describe_object` where the connection lists it), load the domain skill for the type, save with `save_metadata_draft`, read the publish verdict in the reply and repair the item until no refusal is left, then report the drafts and give a person the Studio review routes the reply names. The door has no publish tool, so the skill tells the client never to say a draft is live.
  
  It restates no shape and no tool argument: the domain skills (`objectstack-data`, `objectstack-ui`, `objectstack-automation` and the others) stay the one copy of each type's keys and traps, for a project author and an MCP client alike.
  
  A project that already syncs its skills gets the new one on its next `npx skills@1.7.2 experimental_sync --agent <runtime> --copy -y` after bumping `@objectstack/skills`.
- f1bf850: docs(skills): the seeds reference drops the retired seed modes `insert` / `replace`, names `locale`, `fallback` and `dependsOn`, and stops teaching array order as load order
  
  Clause-②: no
  Metadata-protocol: none
  
  `objectstack-data`'s `references/seeds.md` no longer lists `insert` or `replace` as import modes: both are refused, and a dataset with no single natural key keeps the default mode with a composite `externalId` (a junction table's `['team', 'project']`), or `'id'` when the records carry their own ids. `objectstack-platform`'s Seed Data passage lists only `ignore`, `upsert` and `update`.
  
  The seeds field table now names `locale` (the BCP-47 tags a dataset loads for), `fallback` (`true` on one locale-scoped set per object, which also loads for a resolved locale no set of that object lists) and `dependsOn`.
  
  The relationship section says lookups order the load and the exported array's order only breaks ties; a lifecycle hook that reads a seeded object no lookup links to declares `dependsOn` with object names, and a name that is the dataset's own object, is not seeded by the same load, or closes a cycle refuses the whole load with nothing written. Two eval cases cover the composite-key conversion and `fallback`.
  
  `seeds.md` pays first by deleting restatement in the same file (three best-practice rows, the `upsert` re-assert clause, "no other mode updates a matched row", "Natural keys remain the portable default"); its token ceiling moves +13, the measured remainder. `objectstack-platform/SKILL.md` re-locks 15 tokens lower.
- 9c29d73: docs(skills, spec): the ui and i18n skills teach an action's `refusals` catalogue and its translation keys; `action.zod.ts` gains a module description
  
  Clause-②: no — skill teaching text, evals and two comment-only edits in packages/spec; no schema, export or accept set moves
  Metadata-protocol: none — no metadata key is touched
  
  objectstack-ui's `rules/actions.md` gains a short section, "Refusing by code (`refusals`)": a `type: 'script'` action with a `js` body declares the refusals it may throw and throws the code instead of a sentence, the catalogue, the throws and the checks are the ones a hook has (taught in objectstack-data's `references/data-hooks.md` § Declared refusals), the sentence is answered as `userMessage` and translated at `objects.<object>._actions.<action>.refusals.<CODE>.message`, and an authored `errorMessage` replaces it in the console's failure toast. The file's Add Line example now declares `refusals: { PRODUCT_NOT_FOUND: … }` and throws `{ code: 'PRODUCT_NOT_FOUND' }` where it threw `new Error('Product not found.')`.
  
  objectstack-i18n's SKILL.md lists the keys in the object key table — `_actions.{action_name}.refusals.{CODE}` holds `message` and `reasons.{reason}.message`, the same under `globalActions.{action_name}`, and a key for a code or reason the action does not declare is `translation-target-unknown` — and the server-composed text section names an action's refusal beside a hook's. Each skill's eval file gains one case that grades the rule.
  
  `@objectstack/spec`: comments only. `src/ui/action.zod.ts` opens with a module doc block, so the generated reference page and the two skill reference indexes describe the module ("Action protocol schemas — `ActionSchema`, the `action` metadata type, and the parts it is built from.") where they listed its first five exports, and the jsdoc above `actionRefusalsWithoutSandboxedBody` names the third case as the function judges it: a `script` action with no `body`.
- f54fc93: docs(skills): the `objectstack-ask` skill follows `list_datasets` `nextStep` and cites `query_dataset` `sourceLine` as given, before `provenance`
  
  Clause-②: no
  Metadata-protocol: none
  
  The `objectstack-ask` skill, and the page at `GET /mcp/skill` that is generated from it, now tell a connected client two things. Under the step 2 decision table: when the `list_datasets` answer has `nextStep`, follow its `decision` and `note`. In step 3's citation bullet: cite the `query_dataset` answer's `sourceLine` as given, and build the source from `provenance` only when the answer has no `sourceLine`. Both members are answered by servers whose dataset tools fill them; a server that does not answer them leaves the skill's existing steps in force, with the `provenance` citation as before. When a `nextStep` note says to answer one measure and to ask about a word that has only candidates, the skill says to do both and to use none of that word's candidates until the user answers; the question-alone rule (no tool call until the user answers) covers a reply that only asks.
  
  Two sentences that restated another line of the same skill are removed: the fallback row's "and say in the answer that no governed metric was used" (step 4 opens every fallback answer with that line) and "no figure" in the paragraph under the table (its next sentence says the same). The `candidates` row also drops "one or several", which its own right cell states. `packages/mcp/src/ask-skill.generated.ts` is regenerated from the skill; no code path changes.
- 81c0947: docs(skills): the i18n and ui skills teach the `mappings` translation group, an action's `texts` and where hook and action texts sit in a bundle; the stale label-serving caveat is gone
  
  Clause-②: no
  Metadata-protocol: none
  
  - `objectstack-i18n`: the top-level group list names `mappings` (`mappings.{mapping}.label`, an import mapping's label by its `name`). The paragraph on keys picked in the organization's language now covers the sentences a hook or a `script` action declares in `texts` and writes through `ctx.text`: `hooks.{hook}.texts.{key}.message` and `_actions.{action_name}.texts.{key}.message`, also under `globalActions`.
  - `objectstack-i18n`: the caveat that label serving reads inline text as `defaultLocale` text is removed, because serving honours `i18n.sourceLocale`. What is still true stays: validation and refusal messages read labels through `t()`, which falls back to `fallbackLocale`, else `defaultLocale`, so an English-source app with a zh-CN default still declares `fallbackLocale: 'en'`.
  - `objectstack-ui` `rules/actions.md`: a `script` action declares a sentence it writes into a record under `texts` and asks for it with `ctx.text`. The rule covers the organization's language, the `texts.<key>.message` key beside the refusals key, a missing translation, an unreadable Localization setting and an undeclared key. Two sentences that restated the example below them are shorter.
  - `objectstack-i18n` pays for its new text in the same file. It drops a sentence that restated the option-key paragraph, two flags from the `extract --help` list that are taught in place, two partial copies of the group list, and the empty "Translate" step.
  - Evals: the i18n set gains a `mappings` case and a hook-texts bundle-key case, and case 11 states the remaining `t()` reason for `fallbackLocale: 'en'`. The ui set gains an action `texts` case.
- e4bfa33: docs(skills): the hooks skill says when `ctx.api.transaction` joins an outer unit, that its transaction is one datasource, and teaches hook `texts` with `ctx.text`
  
  Clause-②: no
  Metadata-protocol: none
  
  objectstack-data's `references/data-hooks.md`:
  
  - The `api.transaction` capability row no longer says only "commit on return, rollback on throw". It now says the callback runs in one transaction on the default datasource, and that a write in it to an object on any other datasource is refused before it runs (`400 ERR_CROSS_DATASOURCE_TRANSACTION_WRITE`). Inside a unit that is already open (the one the hook's write runs in, or a caller's) it joins that unit: its return is no commit and its throw no rollback, so a throw the body catches keeps the callback's writes, and the outer unit commits or rolls back all of it.
  - A new "Declared texts (`texts`)" block beside "Declared refusals" teaches a hook's `texts` and `ctx.text(key, params?)`: the sentence is written in the organization's language, translated first and then filled, a missing translation never fails the hook, an unreadable Localization setting rejects, and only declared keys are answered. The sandbox `ctx` table gains a `ctx.text` row that points to it. It names the translation key, `hooks.HOOK.texts.KEY.message`, and leaves the bundle to objectstack-i18n.
  - Ten restatements in the same file were removed to pay for the new text.
  
  `evals/hooks-security-seeds-datasources.json` gains two cases, one on the joined transaction and the default-datasource rule, one on `texts` with `ctx.text`.
- 7c8d689: docs(skills): `objectstack-data`'s seeds reference says seed rows obey the object's validation rules (all but `state_machine`) as they load: a rule reading a parent roll-up sees the total earlier rows left, a seeded roll-up value is stored as written, and `os verify`, not `os validate`, fails on a dropped row. One eval case covers it; the file pays in deleted restatement and its token ceiling does not move.
  
  Clause-②: no
  Metadata-protocol: none
- 8c18a36: test(skills): the `objectstack-ask` eval cases cover a matched measure beside a grouping word that names nothing
  
  Clause-②: no
  Metadata-protocol: none
  
  Two changes to the eval fixtures of the `objectstack-ask` skill (`evals/metric-selection-fallback.json`, which ships inside the catalog and is inert in a consumer install); the skill text and the page at `GET /mcp/skill` are unchanged.
  
  - A new case, 20: the word for the thing measured equals one measure, and the grouping word matches nothing in any dataset and has no candidates. The expected answer computes the measure through `query_dataset` and cites its source, takes the breakdown by that grouping from the object tools (`describe_object`, then `aggregate_records`) under the line saying it is not from a governed metric (非指标口径), and asks the user nothing about the word. This is ADR-0149 D3 rule 2 for the measure and rule 4 for the word, as `list_datasets`' `nextStep.note` already writes it; the skill already says to follow that note and to go to step 4 for a word with no match and no candidates, so no rule and no skill sentence is added.
  - Case 19 (a reply to an ask-back that names another word) now also forbids the `list_objects(` call spelling, so an answer that starts the object-query fallback at its first call no longer passes by mentioning `list_datasets`.
- d6ce9ba: docs(skills): the `objectstack-ask` skill says what the client does after the user answers an ask-back
  
  Clause-②: no
  Metadata-protocol: none
  
  Step 2 of the `objectstack-ask` skill, and the page at `GET /mcp/skill` that is generated from it, told a connected client to ask which reading the user meant and stopped there. It now carries the turn after the answer: an option is used only once the user picks it, and is then computed by its exact name as step 3 says (`query_dataset`, with the source cited from the tool's answer); a reply that names another word ("no, I mean ARR") starts at step 1, a new `list_datasets` lookup with that word, before anything else; a user who only picks none of the options gets step 4, the object-query fallback with its label. This is ADR-0149 D3 rule 1, rule 2 and rule 4 applied to the user's reply; no rule is added. The another-word case is also part of the ask-skill iteration loop (Part of #34996, item a of its third round).
  
  Four restatements are cut from the same file, each keeping its other home, so the skill does not grow: "and in the user's language" in step 1 (beside "Do not translate or reword a term"), "a fragment's matches are not the user's" in the same bullet (beside "a match on a word you supplied is your reading, not the user's"), the "by stage" example and "You still need a measure match" in the grouping row of step 2, and "use none of that word's candidates until the user answers" under the step 2 table, which the new sentence now states for every option. `packages/mcp/src/ask-skill.generated.ts` is regenerated from the skill; no code path changes.
- 475ae46: docs(skills): objectstack-ai teaches that an AI-gated action guards its own door only, and pairs an irreversible transition with a lock on the field it changes; the tool-name ladder names its fourth source and the MCP prompts paragraph names `mcpPrompt`
  
  Clause-②: no
  Metadata-protocol: none
  
  objectstack-ai's Common Pitfalls gains "Gating the action, not the state". `ai.requiresConfirmation` guards the action's door, and an agent can still write the same field with `update_record` or any data write. An irreversible transition is a gated `script` action, whose body writes elevated, over a field a non-system write cannot set. `readonly: true` binds every non-system caller (the value is stripped); a field permission without `editable` (refused `403`) binds only a caller no held set grants it, and Modify All grants it. The body skips the caller's edit right, so the action declares who may run it in `requiredPermissions`. A declarative `operation: 'update'` action and a `flow` action under `runAs: 'user'` write as the caller, so the lock stops them too. `readonlyWhen` and a `state_machine` rule bind the elevated body as well, so neither is the door; a `state_machine` dead-end still makes the reached state final for every writer. objectstack-automation's `references/state-machines-and-approvals.md` points to it.
  
  The resolution ladder for `skill.tools[]` names four sources: the fourth is `MCP_FILE_TOOL_NAMES`, the MCP door's file tools, resolved only for a skill MCP can offer (`mcpPrompt` not `false`).
  
  The paragraph on which skills MCP offers as prompts names `mcpPrompt`: `false` keeps a skill for the in-product agents only, never offered over MCP on any connection whatever its binding, and the stdio transport withholds it too; absent or `true` keeps the binding rule.
- 60ed6bd: docs(skills): sixteen eval cases forbid the wrong code spelling, not a mention of its name
  
  Clause-②: no
  Metadata-protocol: none
  
  A `must_not_contain` entry is matched as a literal substring, so a bare identifier also fails a correct answer that names it as the thing to avoid: `objectstack-ui` `analytics-inline-vs-dataset` case 5 failed an answer saying an ad-hoc react-page chart "doesn't need a `defineDataset`". Sixteen cases whose bundle or reference answer states such a negative now forbid the spelling a wrong answer writes: a call with its paren (`defineDataset(` in that case and `objectstack-data` `hooks-security-seeds-datasources` 4, `definePage(` in `record-page` 2, `getAppBundle(` / `loadAppBundle(` in `objectstack-i18n` `bundles-locales-coverage` 4), a key with its colon or dot (`categoryField:` in `analytics-inline-vs-dataset` 1; `sourceView:`, `disabledMessage:` / `disabledTooltip:` in `views-apps-actions-pages` 5 and 9; `readonlyWhen:`, `assigned_to:` in the data file's 5 and 8; `subDays:` in `objectstack-query` `filters-pagination-search` 6; `permissionSets:` / `permissionSets.` in the i18n file's 6; `pageName:` / `viewName:`, bare and JSON-quoted, in `objectui` `app-composition` 2 and 4) and a quoted literal (`type: 'record_detail'` in the views file's 4; `'admin_full_access'` and a quote-opened `@objectstack/adapter-` in `objectstack-platform` `config-plugins-ops` 7 and 4). Each of the sixteen has a new case hash, so `skill-evals --regrade` sets it apart from a round recorded before this change: compare it across rounds only after a re-run. No prompt, reference answer, `must_contain` entry or skill text changes.
- 09ba0c7: docs(skills): the `objectstack-ask` skill and the `list_datasets` output schema ask back only about a word with a measure among its `candidates`
  
  Clause-②: no
  Metadata-protocol: none
  
  The `list_datasets` tool description and the MCP `initialize` selection rule already scope the ask-back: "A word whose candidates are all dimensions is at most a possible grouping: never ask about it, and it never stops a matched measure." Two texts a connected client also reads still said to ask about every word with candidates. The skill now carries the same sentence, and the schema description states the same scope in its own words.
  
  - The `objectstack-ask` skill, and the page at `GET /mcp/skill` that is generated from it. Step 2's `candidates` row is now two rows. A word with a measure among its `candidates` is asked about the same way as a word that matches several measures; with one candidate, the client asks whether it is the one meant. A word whose `candidates` are all dimensions is at most a possible grouping: the client never asks about it, and it never stops a matched measure. So 「按行业看销售额」, where 销售额 matches a measure and 「按行业」 is only near a 行业 dimension, is computed and grouped with no question back.
  - `@objectstack/spec`: the description of `ListDatasetsOutputSchema.candidates`, which `list_datasets` serves in its `outputSchema`. It said every candidate is offered for a clarifying question. It now says the clarifying question is for a term with a measure among its candidates, and that a term whose candidates are all dimensions is offered them as a possible grouping, not for a question, and does not stop a matched measure. It states what the candidates are offered for and does not carry the sentence above: the instruction stays in the tool description and the skill. The doc comment of `DatasetTermCandidateSchema` says the same. No shape changes: `candidates` holds the same entries in the same order.
  
  The new skill row is paid for inside the same file, by removing text that restated another line of it: the `candidates` row's own listing instruction and "Do not pick one." (the row above states both, and the row now says "Ask the same way"), "A word matches nothing, and" in its left cell (step 1 says a word that matched nothing may have `candidates`), and "on the answer" in that step 1 bullet. `packages/mcp/src/ask-skill.generated.ts` is regenerated from the skill and `content/docs/references/ai/dataset-tools.mdx` from the spec; no code path changes.
- 1134519: docs(skills): the hierarchy-scope row and the `os verify` row name the capability advisory, the `plugins[]` wiring check and `os verify --json`'s `capabilities`
  
  Clause-②: no
  Metadata-protocol: none
  
  `objectstack-data`'s access-depth section now says the hierarchy-relative scopes need the `@objectstack/security-enterprise` plugin in `plugins[]`, not only installed, and that the CLI only advises on a missing or unwired plugin: `os validate` warns, and `os verify --json` lists it in `capabilities`. The same sentence now says the stack, not the grant, declares `requires: ['hierarchy-security']`.
  
  `objectstack-project`'s `os verify` row now says that `os validate`'s capability findings are advisory there, carried on `--json` as `capabilities`.
  
  Both files pay for the new text by deleting restatement in the same file: a duplicate link to the security rules that the quick reference already gives, the code comment in the related-title search example, which restated the sentence above it, "so the app never hand-writes it" above the check table (the paragraph under it says so), and "Nothing in its row is checked until someone runs it", which restated the clause before it. Neither file's token ceiling moves.
- 9e4eabb: docs(skills): the `objectstack-ui` routing table sends a refused action's message to its rule
  
  Clause-②: no
  Metadata-protocol: none
  
  The Actions row of the `objectstack-ui` routing table now names `refusals` in the words of the rule's heading, "refusing by code (`refusals`)", so an agent looking for how an action refuses with a declared code and a translated message opens `rules/actions.md`. First checks 3 loses a clause that restated First checks 1.
- abb40ae: docs(skills): the `objectstack-ask` skill reads `withheldFields`, asks `aggregate_records` for a top or bottom N, and answers "how many" from `totalGroups`
  
  Clause-②: no
  Metadata-protocol: none
  
  The `objectstack-ask` skill, and the page at `GET /mcp/skill` that is generated from it, now tell a connected client three things. In step 4: a `query_records` or `get_record` answer whose `withheldFields` names a field means the field exists but is hidden from the caller, so the client says it is not visible, never that it is empty; and a top or bottom N is asked of `aggregate_records` with `orderBy` (an aggregation alias or a group key) and `limit: N`, so the database ranks and cuts the groups. In step 6, one bullet covers `truncated: true`: more rows or groups existed than came back, so the client says the result is partial, and cites `totalGroups` (answered by `query_dataset` and `aggregate_records`) as how many groups existed before the cut; a `query_dataset` answer without `totalGroups` has an unknown total, never `rowCount`. A capped `query_records` page keeps stating its own `total`, which the bullet leaves alone.
  
  The two per-tool `truncated` sentences that bullet replaces are removed from steps 3 and 4. `packages/mcp/src/ask-skill.generated.ts` is regenerated from the skill; no code path changes.
- afbd903: feat(skills): a process skill for running a metadata-app project
  
  Clause-②: no
  Metadata-protocol: none
  
  The skills catalog gains `objectstack-project`. The domain skills teach how to write each kind of metadata; this one teaches how a change moves through an app project: whether it belongs in the app or the platform, what to write at each stage, what the app tests itself (with `bootStack` from `@objectstack/verify`) and what `os validate`, `os lint` and `os verify` already check, how a platform defect is handled without a workaround, how a change is described for customers, and how to bump `@objectstack/*` and carry customer data across an upgrade with a backfill. Steps that matter only to an app shipped to customers are marked, and the light path is the default.
  
  A project that already syncs its skills gets the new one on its next `npx skills@1.7.2 experimental_sync --agent <runtime> --copy -y` after bumping `@objectstack/skills`.
  
  `npm create objectstack` projects now:
  
  - point `AGENTS.md` at `objectstack-project` in place of its hand-written skill table, which listed nine of the catalog's skills;
  - carry a three-line `.github/pull_request_template.md`: what a user can do now, how it was checked, which docs changed.
  
  Existing projects are not changed.
- 0188989: feat(scaffold): new projects run their tests in CI
  
  Clause-②: no
  Metadata-protocol: none
  
  `npm create objectstack` projects now run `pnpm test` in `.github/workflows/ci.yml`, after `validate`, `lint` and `typecheck`, so the starter `note.test.ts` and every test you add run on each push.
  
  `os init -t app` and `os init -t empty` now declare a `test` script (`vitest run`), list `vitest` in `devDependencies`, and ship one starter test (`app.test.ts`, `project.test.ts`) that reads the project's definition, so the same CI workflow passes on a project made either way. To test what the engine does with a record, add `@objectstack/verify` and boot the stack with `bootStack`; the `objectstack-project` skill shows how.
  
  Existing projects are not changed. To take the CI step, add `- run: pnpm test` after `- run: pnpm typecheck` in your `ci.yml`; a project with no `test` script adds vitest and the script first.
- cf2e321: docs(skills): the data and automation skills name the publish-time findings in place of their trap warnings; the i18n skill drops the `fallbackLocale` workaround for refusal labels; the ai skill names `MCP_DOOR_TOOL_NAMES` as the fourth tool source
  
  Clause-②: no
  Metadata-protocol: none
  
  **objectstack-data.** A `state_machine` rule that runs on insert declares `initialStates`, or publish refuses it (`state-machine-no-initial-states`); an update-only machine (`events: ['update']`) needs none, since the engine reads them only on insert. `SKILL.md`, `rules/validation.md` and eval 11 say so. The yes/no-flag bullet no longer says "never `required`": on a boolean `required` refuses only `null`, an unchecked box is a value, so it never means "must be checked". A box that must be checked (terms, consent) is a `validations[]` `script` rule, and the bullet carries one. Eval 10 follows, and no longer fails an answer that keeps `required: true`.
  
  **objectstack-automation.** `SKILL.md`: a node `type` no executor runs is refused when the flow is published to a running server (`flow-node-type-no-executor`); an `http` node with no positive `timeoutMs` has no timeout and raises the warning `flow-http-timeout-missing`. `references/state-machines-and-approvals.md`: `initialStates` is no longer described as optional with a legacy opt-out, and names the same refusal and the same update-only exception; an approval's downstream nodes hang off out-edges labelled exactly `approve` and `reject`, and with one missing or respelled publish refuses the flow (`flow-approval-decision-unrouted`).
  
  **objectstack-ui.** `rules/actions.md`: a standalone action that declares `locations` and no `objectName` is refused at validate and at publish (`action-no-object-binding`); the fix is `objectName`, or `locations: []` for a headless action. Paid in the same file: three parentheticals of the locations table and some wording of the same paragraph.
  
  **objectstack-i18n.** Validation, delete-restriction and permission-denial messages name fields and objects in the request's language, as label serving does: a request in `sourceLocale` reads the inline label. The sentence telling an English-authored, Chinese-default app to add `fallbackLocale: 'en'` for that is gone from `SKILL.md` and from eval 11; `fallbackLocale` stays documented as the fallback for a missing translation.
  
  **objectstack-ai.** Source 4 of the `skill.tools[]` resolution ladder is `MCP_DOOR_TOOL_NAMES`, every tool the MCP door registers (the `MCP_FILE_TOOL_NAMES` file pair included), resolved only for a skill MCP can offer (`mcpPrompt` not `false`). On a `mcpPrompt: false` skill a name only the door serves still warns, with its own hint.
  
  Paid in place, no token ceiling moves. Cut to pay: in `rules/validation.md` the state-machine example loses three states and its default `severity`; in `references/state-machines-and-approvals.md` three asides (automation being AI-generated, a multi-step review reading as one diagram, a back-edge re-entering its node); in objectstack-automation `SKILL.md` a few words of seven node-table rows; in objectstack-data `SKILL.md` two example state names and a few words of the same bullets.
- 084f606: docs(skills): the objectstack-ui router names action files by the suffix the platform writes
  
  Clause-②: no
  Metadata-protocol: none
  
  The Actions row of the `objectstack-ui` routing table pointed at `src/actions/*.actions.ts`. The metadata type registry declares `**/*.action.ts` for actions and `os generate action` writes `src/actions/NAME.action.ts`, so an agent reading a project's actions by that glob missed every generated file. The row now names `src/actions/*.action.ts` first and `*.actions.ts` second: a project loads its actions through the barrel its `objectstack.config.ts` imports, so a plural file the barrel names loads as well.
  
  Trap 3 keeps its pointer to the Dashboards rule and drops the list of widgets, datasets and charts after it, which the routing table already sends to that rule.
- bc75bcd: docs(skills): `objectstack-platform` says which declared capabilities fail the boot and which only warn
  
  Clause-②: no
  Metadata-protocol: none
  
  The "Declaring is a demand" rule taught that any capability an app declares in `requires` with its provider package absent is a hard boot error. `os serve` does that for the tokens of the provider table and for `ai` / `ai-studio`. A declared enterprise or cloud token (`hierarchy-security`, `ai-seat`, `governance`, `audit-compliance`, `access-policy-console`) with no provider only prints a warning and the boot goes on; for `hierarchy-security` the hierarchy-relative scopes then fall back to owner-only. The rule now says so, so an agent no longer reads a clean boot as proof that those scopes are enforced, nor tells a user the app will refuse to start when it starts with narrower visibility.
  
  Two restatements in the same file were cut to pay for the sentence.
- 0ca5218: docs(skills): a generated platform catalog, and `objectstack-project` asks "does the platform ship it?" before any new object, field or flow
  
  Clause-②: no
  Metadata-protocol: none
  
  `objectstack-project` gains `references/platform-catalog.md`, generated from `@objectstack/spec`: the platform objects an app would otherwise build (users, attachments, comments, the audit trail, notifications, mail, exchange rates, imports, approvals, sharing, queues, webhooks, settings), each with what it replaces and how the app reaches it; the three value domains and the field names that should declare them; every `requires` capability switch with what it mounts; the master data that stays with each app; and a short Planned section whose rows are marked not available and link to their contract.
  
  Its §0 asks a third question: check the catalog before adding an object, a field or a flow; use what the platform ships; when it is absent and a second app would copy it, file a platform card and build the app's own meanwhile, marked `// PLATFORM-CANDIDATE: <link>`. §5's bump sweep now retires those markers beside the `PLATFORM-GAP` tests. A defect (§3) is still never worked around; the new question is about a missing capability.
  
  `objectstack-data`'s currency paragraph now teaches `valueDomain` for a time zone (`iana_time_zone`) and a country (`iso_3166_alpha2`) beside the currency code.
  
  Six new eval cases (an attachments table, a business-hours calendar, a change-history table, a free-text unit, a country and time zone, an exchange-rate table) expect the platform object, the value domain, or a platform card with the marker.
- d1ebe86: docs(skills): the dashboards rule says a drill on a relationship-path dimension offers no "Open in list" link today
  
  Clause-②: no
  Metadata-protocol: none
  
  objectstack-ui's `rules/dashboards.md`, Drilldown: the **Escape hatch — "Open in list →"** bullet said the drill drawer's header always links to the object's full list page. It now adds the exception: today a dimension whose field is a relationship path (`account.industry`) drills into the drawer only, with no link. The drawer still lists the records and a row still opens its record. The list page's `filter[...]` URL has no spelling for a condition on a related record, so the console offers no list destination for that drill instead of a wider list.
  
  The Reports paragraph of the same section loses its closing clause ("peek the records, click a row to open one, or "Open in list →" for the full list page"). It restated the three bullets above it and repeated the same promise; the paragraph still says reports drill the same way through the identical drawer. Removing it pays for the new sentence: the file is 2 bytes smaller.
  
  `content/docs/ui/dashboards.mdx` states the same exception in its Drill-down section and in the renderer note below it. No code path changes.
- 908d56c: docs(skills): the data, query and ui skills teach five landed refusals and behaviours
  
  Clause-②: no
  Metadata-protocol: none
  
  Five pieces of published skill text, one per landed behaviour the skills did not teach. Each comes with its own eval case.
  
  **The `{current_iso_week}` period key.** objectstack-query's `rules/filters.md`, section "Date Macros", now names the period key beside the date macros and the session tokens. `{current_iso_week}` (or `${current_iso_week}`) resolves to today's ISO week key, `YYYY-Www`, in the workspace time zone: Monday-start weeks, the ISO week-year at year edges. It is text, for a text field that stores week keys. A `date`, `datetime` or `time` field refuses it with `INVALID_FILTER` / 400, as it refuses the literal key; a date dashboard filter's `defaultValue` and `calendar.initialDate` refuse it too. On a date field write `{current_week_start}` / `{current_week_end}`. The section also names `resolveFilterPlaceholders()` as the client resolver for all three vocabularies and `isKnownFilterToken()` as the one spelling check. One eval case covers the text-field / date-field split.
  
  **A hook or job `js` body that does not compile is refused.** objectstack-data's `references/data-hooks.md`, "Sandbox restrictions":
  
  - A new bullet says a `js` source is compiled, without being run, inside the `(async (ctx) => { … })` wrapper the runtime runs it in, where `ctx` is already declared. `const ctx = ctx.input || {};` (or `let ctx`, one name declared twice, any syntax error) is `hook-body-does-not-compile`: an error from `os validate`, `os build`, `os lint` and a runtime hook save (`422 INVALID_METADATA`), naming the hook, the `SyntaxError` and its line. The fix is to use `ctx` as it is or rename the local (`const input = ctx.input || {};`). A job's `js` body runs in the same wrapper and is `job-body-does-not-compile` from the three commands. A regular-expression pattern the checking engine refuses is a warning: the runtime may accept it.
  - Six restatements in the same file were removed to pay for the new text; the file is four lines shorter and no larger in tokens than before.
  
  `evals/hooks-security-seeds-datasources.json` gains one case on the refusal and its fix.
  
  **A seed record with a blank key field is refused at load, and a saved seed naming an unknown object is refused 422.** objectstack-data's `references/seeds.md`:
  
  - "`externalId` selection" says every record carries a value for each `externalId` field (each field of a list, or `name` when the seed names none), and that a record leaving one blank (no value, `null` or `''`; whitespace is a value) is refused at load in every mode: the load result names the object, the record index, the field and the fix, and the other records still load. The `externalId` row of the field table points at it.
  - The note under the field table says a `seed` saved at runtime names its `object` itself, and that one resolving to nothing is refused with `422 INVALID_METADATA` at `object` ("which is not defined"). The fix is the object's full name (`crm_lead`, not `lead`) or creating the object first: a draft of it is enough for a draft seed, a live seed needs it published. The `object` row points at the note.
  - Three restatements in the same file were removed to pay for part of the new text: the `columns` row's shape literal, the one-row best-practices table (now a sentence) and the second telling of what a refused seed value leaves behind.
  
  `evals/hooks-security-seeds-datasources.json` gains one case on each refusal.
  
  **A `master_detail` child is a record-page body table by default.** The record page draws a `master_detail` child as a full-width body table whenever its FK declares no `relatedList`. The skills still tied that to `inlineEdit`. They now teach the rule the runtime applies.
  
  - objectstack-data's `rules/relationships.md`, "Detail-page related lists": a `master_detail` child is a body table by default and a `lookup` child is a panel. `inlineEdit` governs entry in the parent's form only. The `relatedList` list reads `'primary'` (the `master_detail` default), `true` (the `lookup` default) and `false`. The example no longer writes `inlineEdit` and `relatedList: 'primary'` on a `master_detail` field to get the table.
  - objectstack-ui's `rules/record-page.md`, step 2: the same defaults, the body table is drawn after the open field sections (it used to say after the first one), and "put the tasks first" is the parent's `relatedLists`. The example field drops its `relatedList: 'primary'`.
  - objectstack-ui's `evals/record-page.json`, case 1: the expected answer adds no placement flag to a `master_detail` field, and an answer that authors `inlineEdit` fails the case. `evals/README.md` follows.
  
  Both of those rules files are shorter than before, and neither one's token ceiling moves.
- c4d6acc: Clause-②: yes — widening: one new read on the draft door behind the same `metadata:write` grant and `manage_metadata` check; no save, publish or existing read changes, so nothing accepted today is refused.
  Metadata-protocol: none
  
  feat(runtime): the MCP draft door answers a metadata type's contract
  
  - **`list_metadata_items` takes an optional `contract: true`.** The reply then also carries `contract`, read from the same entry `GET /meta/types` serves for the type. By default it is the lean form of the type's JSON Schema: the `required` keys, and for each top-level key its type, a short enum and a one-line description, where `drill` names the JSON Pointer of any key with nested structure, plus the type's `createSeed`. A client that cannot read files can now see which keys a type accepts and which it requires before its first save, also for a type that has no item in the environment yet. A type with no JSON Schema answers `schema: null` with the reason. The read is admitted as the list is: the `metadata:write` scope and the user's own `manage_metadata`, the type-level read admission, and the unknown-type refusal. Without the flag the reply is unchanged.
  - **`contractPath` drills into that schema.** With `contract: true`, a JSON Pointer such as `/properties/fields` answers the full schema at that pointer. `contractPath` without `contract: true` is refused with a validation error, and so is a pointer that does not resolve, with an error that names the pointer and the keys found there.
  - **No `contract` takes more than 24 KiB of the reply,** so the largest types (`object`, `view`, `page`) fit an MCP client's tool-result limit. A lean form still over that size drops its descriptions first and says `truncated: true`. A sub-schema over that size is answered in its lean form marked `truncated: true`, so the client can drill again.
  - **`objectstack-mcp-build` skill, step 3** names that read where it said to copy a published item of the same type: read the lean contract, drill into the key you write with `contractPath`, and let the save check you. The save is still the final check.
- 9a28a48: docs(skills): objectstack-automation's `references/state-machines-and-approvals.md` says a reject recorded through `ApprovalService.decide()` or `POST …/reject` always carries a non-blank `comment`, its reason, else `400 VALIDATION_ERROR`. Text only; the outputs paragraph gives up a restatement to pay for it.
  Clause-②: no
  Metadata-protocol: none
- 7ba22bb: Clause-②: no
  Metadata-protocol: none
  
  `objectstack-query`'s description no longer claims a records query or aggregation sent over MCP, and its "Not for" names `objectstack-ask` for a business question answered from the app's records (a number, ranking or governed metric). Query trigger case 3 now asks for an aggregation written in server code; `objectstack-ask` gains a negative trigger case for a metadata change asked over MCP.
- e606eff: Clause-②: no
  Metadata-protocol: none
  
  The automation skill teaches the approval escalation clock: `escalation.clock: 'working_time'` counts `timeoutHours` as working hours on a working calendar (the `escalation.calendar` code, else the organization's default, else refused), a calendar that cannot count the deadline holds the escalation and shows why, and `calendar` without `clock: 'working_time'` is the lint error `approval-escalation-calendar-without-working-time`. The row no longer says the platform ships no business-hours calendar. The data skill's hook note calls an hours-table deadline wall-clock hours and points at the approval clock.
- 72b7f13: Clause-②: no
  Metadata-protocol: none
  
  The platform catalog (`objectstack-project/references/platform-catalog.md`) now lists working calendars as shipped. `sys_work_calendar` and `sys_work_calendar_exception` have rows beside `sys_exchange_rate`: each organization keeps its calendars and holidays in Setup, and an approval's `escalation.clock: 'working_time'` reads them. An app no longer declares its own calendar or holiday object. The Planned section keeps only what is still missing: no formula reads a calendar yet.

## 18.6.0

### Patch Changes

- b51cb18: docs(skills): `objectstack-data` states what `writeRequiresMasterRead` asks when a master is set or emptied, and whose ownership floor binds an on-behalf-of write
  
  Clause-②: no
  Metadata-protocol: none
  
  objectstack-data's `rules/relationships.md` is more exact about a `controlled_by_parent` detail's two write opt-ins. Under `sharing.controlledByParent.writeRequiresMasterRead`, setting a master on a row and emptying one both ask read (the sentence read as if only emptying did), and both still ask edit under `ownerMayEdit`. On an on-behalf-of update or delete the ownership floor binds for both users, not one. The `ownerMayEdit` bullet now says "every other write, on-behalf-of included, still needs master edit" where it listed the writes, which pays for the added words: the file is the same size. The eval case for the key also fails an answer that writes `ownerMayEdit: true` beside it, in either order, or puts the key on the `master_detail` field.
- 551e628: docs(skills): `objectstack-automation` teaches the silent half of the after-save retried-callout rule
  
  Clause-②: no
  Metadata-protocol: none
  
  The `try_catch` row of the `objectstack-automation` skill already said that, in a `record-after-*` flow, a retry may not reach an inline `http` / `connector_action` node (refused when the flow is saved). It now also names the half that is not refused: when the retried inline call sits inside a `subflow` / `map` child, retried by either flow, the caller saves but is never armed, and `GET /api/v1/automation/_status` reports it `bound: false` with `unboundCause: retried_callout_in_subflow` until the child's `http` node is `durable: true` or nothing retries the call. One eval case covers it.
  
  The fault-edge note no longer spells the flow-level retry as `errorHandling.retry`, a key the schema does not have; it reads `errorHandling.strategy: 'retry'`.
  
  Paid in place, the token ceiling does not move. Five restatements were cut, each keeping another home: the trigger table's `Fires` column (the token and the hook column say it), "not a name-keyed map" (the array example beside it), "Not author-facing" (the same row's "author the container"), the hook `runAs` note's closing "declare `runAs: 'system'`" (the note's own first sentence), and "an inbound vendor callback is an `api` flow" (the Flow Types `api` row and integration recipe 4).
- 2c96e0d: docs(skills): renaming a position tells the author to re-point their own source, names the environment as an owner, and restores who may explain another user
  
  Clause-②: no
  Metadata-protocol: none
  
  `skills/objectstack-data/rules/security.md`, the **Renaming a position** paragraph: the holder carry moves holders only and rewrites no other reference to the old name, Setup-authored ones included, so the author re-points their own package source that names the old position (a `type: 'position'` sharing recipient, queue member or approver, a policy's `positions`, a `current_user.positions` predicate); the boot log lists stored references by table for an administrator. The not-carried list now says an old name recorded under another owner, a package or the environment, since the activation ledger records the environment as an owner too. § Assigning a permission set to a user says again who may ask `GET /api/v1/security/explain` about another user: a holder of `manage_users`, an administrator of one of that user's organizations, or a delegated `adminScope` covering that user. One eval case asks the rename with a same-package sharing rule. The `tabPermissions` pointer to objectstack-ui `rules/navigation.md` is kept, shortened. The file pays by dropping text that is stated elsewhere, and its token ceiling moves by the measured remainder: the kernel-name list (now a reference to the placeholder table in the same file), the membership-tier list (at the linked docs anchor), the second definition of `outside-closure` / `ambiguous-in-closure` (now a reference to the queue bullet above it), and short restatements. No schema or runtime change.
- b33365c: docs(skills): `objectstack-i18n` teaches `i18n.sourceLocale`
  
  Clause-②: no
  Metadata-protocol: none
  
  The `objectstack-i18n` skill now teaches the optional `i18n.sourceLocale` key: the language the inline `label:` text is written in, which `os lint`, `os i18n check` and `os i18n extract` read (`i18n.sourceLocale`, else `i18n.defaultLocale`, else `en`; `--default-locale` overrides it for one run). `defaultLocale` is described as what it is, the locale a user who has not chosen one gets, so an app authored in English for Chinese users declares `defaultLocale: 'zh-CN', sourceLocale: 'en'`. The skill also states the current serving behaviour: label serving still reads inline text as `defaultLocale` text, so that stack declares `fallbackLocale: 'en'` to keep an `en` request on the authored labels. The coverage and extract sections say "source locale" where they said "default locale", and a new eval case grades the configuration.
- 6ec7b93: docs(skills): the hooks and i18n skills teach a handler hook's `refusals`, a code's `reasons` and its `params`
  
  Clause-②: no
  Metadata-protocol: none
  
  objectstack-data's `references/data-hooks.md` § Declared refusals no longer says only a `js` body can declare `refusals`: a `handler` hook (inline or named) can too, and only an `expression` body, or a hook with neither, is refused at save. Its example now declares a `reasons` entry (`on_loan`, thrown as `{ code, reason }`) and `params` (`due`, thrown as `params: { due }`), and the bullets say a `{{ name }}` hole is allowed only over a declared param, a reason missing from a code's `reasons` is refused like an undeclared code, and a reason's sentence is translated through `hooks.<hook>.refusals.<CODE>.reasons.<REASON>.message`. objectstack-i18n's SKILL.md names that key beside `hooks.<hook>.refusals.<CODE>.message`, and says a translation of a sentence with `params` keeps its holes. Four restatements in data-hooks.md were removed to pay for the new text.
- 9e0bc61: docs(skills): the data skill teaches the `dynamic` roll-up over a stored home amount
  
  Clause-②: no
  Metadata-protocol: none
  
  `skills/objectstack-data/rules/field-types.md` § Currency now says how a roll-up of a home-currency amount is drawn as money: a `sum` / `min` / `max` / `avg` `summary` over a child field that a `homeAmount.field` names declares `currencyConfig: { currencyMode: 'dynamic' }` with no `defaultCurrency`, and is then shown in the organization's home currency (`localization.currency`) instead of as a bare number. Metadata never names the home currency (ADR-0144), so the roll-up is never `fixed` with that code; `defineStack` (`os validate`, the build) refuses `dynamic` on any other roll-up, and a `count` carries no `currencyConfig`. One worked example and a matching eval case. To pay for it, two same-file restatements are cut: the `currency` row's list of `currencyConfig` keys (§ Currency spells each) and the Autonumber snippet (the `autonumber` row and the token table carry the same `CASE-{0000}` format). No schema or runtime change.
- a209074: Clause-②: no
  Metadata-protocol: none
  
  The published query and hook skill examples now filter on the platform's `owner_id` column with `{current_user_id}`, and the hook `find` example reads the caller's id from `ctx.session?.userId` instead of an unbound variable.
- 81af309: docs(skills): the data skill's roll-up guidance has the builder resolve a `security-rollup-source-unreadable` warning before finishing
  
  Clause-②: no
  Metadata-protocol: none
  
  `skills/objectstack-data/rules/relationships.md` § Roll-up Summaries now says what to do when a permission set reads a parent `summary` but not the child data behind it: grant the child read when the set should see the children, otherwise mask the summary on that set (`fields["PARENT.SUMMARY"]: { readable: false }`, after removing any View All / Modify All the set holds on the parent), with one worked example and a matching eval case.
- e71ecc1: docs(skills): the query skill teaches that a column with no value fails an ordering filter, and where a per-measure filter runs
  
  Clause-②: no
  Metadata-protocol: none
  
  objectstack-query's `rules/filters.md` gains the rule that `$gt` / `$gte` / `$lt` / `$lte` / `$between` never match a row whose column is null or absent, in `where`, an aggregation's `filter` and `having` alike, with the `$or` + `$null: true` spelling that keeps those rows; the same section says `null` is not an ordering comparand. `rules/aggregation.md` no longer says a per-measure `filter` always forces the in-memory path: a driver that declares `supports.aggregationFilter` (`driver-sql`; `driver-turso` outside remote mode) runs it in the database, where it answers and is refused as the same condition is in that datasource's `where`, text collation included; on any other driver the engine evaluates it over the scoped rows. Its `having` section says `avg` / `min` / `max` over no rows is `null` and so fails an ordering test. One eval case covers the rule in a measure filter. Two restatements in `filters.md` were removed to pay for the new text: the case-sensitivity paragraph SKILL.md § String Operators carries, and a second `$between` example.
- b8456eb: docs(skills): an action that adds a child line sets the line's price, and a create policy tied to the caller gets a `current_user` default
  
  Clause-②: no
  Metadata-protocol: none
  
  `objectstack-ui` `rules/actions.md` teaches that an action inserting a line item reads the price from the source the build declares (or takes it as a required param), because `lookupAutofill` and a stored `expression` do not fill it on a server-side insert. `objectstack-data` `rules/security.md` teaches that a `check` over a field the request never names refuses a plain create, and that `defaultValue: 'current_user'` on the tying `user` field fills it before `check` is judged. One eval case each.
- 24b6ae5: docs: deciding an in-app AI pending action is the person's own act, on their signed-in session
  
  Clause-②: no
  Metadata-protocol: none
  
  The `objectstack-ai` skill, the client SDK page, the actions-as-tools page and the `client.ai.pendingActions` docblock now say what the confirmation rule says for the in-app assistant door (`in-app-pending-action-decided-by-person`): only the person the assistant call ran as approves or rejects their item, in the app on their signed-in session. Another user's `ai:approve` does not decide it, and an API key or token is refused, even the person's own, and so is an AI identity. A client on a token can still list and get the queue. The door enforces this from the runtime release that carries the in-app door, not from this package release. Docs and docblock text only: no export, type, route or behaviour changes in these packages. The skill gains one eval case (an operator script on an API token asked to approve the queue).
- 8d827da: docs(skills): an `async` after-hook on a write event starts after the commit and is dropped on rollback; an `async` `afterFind` starts at dispatch
  
  Clause-②: no
  Metadata-protocol: none
  
  `skills/objectstack-data/references/data-hooks.md`, the **Transaction** row of Before vs After Hooks: an `async: true` hook on `afterInsert` / `afterUpdate` / `afterDelete` starts once the outermost transaction commits and never runs if it rolls back, a failed commit included; on `afterFind` it starts as the read is dispatched; outside a transaction it starts at once. The row used to say "in the background, after commit" for every event and did not say the hook is dropped on rollback. Best Practices gains one DON'T: do not react to a refused or rolled-back write from an `async: true` hook, which never runs then; use a sync hook, whose `ctx.api` writes roll back with the write, or record it in the caller, where the write is made. Two eval cases exercise it: a background `afterInsert` that must not announce an order that did not survive, and a request for a background hook that records a failed insert. The file pays by dropping three restatements (the "Update by id" paragraph, which repeated its row of the `ctx.api.object` method table; the sentence above the `body` vs `handler` table, which repeated the table; and the closing sentence of the `findOne` note, which repeated its opening paragraph), so its token ceiling does not move. No schema or runtime change.
- 144cdc2: docs(skills): `objectstack-data` teaches the `lookupFilters` `{ $record }` reference and `orEmpty`
  
  Clause-②: no
  Metadata-protocol: none
  
  objectstack-data's `rules/field-types.md` now teaches a lookup filter that reads the record being edited. A `lookupFilters` value may be `{ $record: 'field' }`, or one lookup hop away, `{ $record: 'lookup_field.field' }` (at most one dot). It is the whole `value`, never a member of an `in` / `notIn` list, and pairs only with `eq`, `ne`, `gt`, `lt`, `gte`, `lte`. Only a record form resolves it; every other picker host leaves the entry out, and while the referenced value is empty the entry is dropped. `orEmpty: true` also matches a candidate whose column is null, with the same six operators. The picker re-queries when a referenced field changes, so that field is not also listed in `dependsOn`, which would add an equality filter on it. The section's example is now a quote's price-book lookup.
  
  Five restatements in the same file are cut to pay for part of it (the `secret` row's recommendation, which the `password` row states; the `autonumber` row's token summary and second format example, which the Autonumber section carries; and two repeats of "pad width is a minimum"). The data-modeling docs pages `relationships.mdx` and `fields.mdx` teach the same four points.
- 082f9c2: docs(skills): the AI and platform skills teach that a person confirms a gated MCP action, and that `run_action` and `resume_run` take no `confirm`
  
  Clause-②: no
  Metadata-protocol: none
  
  objectstack-ai's MCP tool table no longer tells an agent to ask the human and retry `run_action` with `confirm: true`. The `run_action` row now says an action declaring `ai.requiresConfirmation: true` never runs on the call: the host's pending-confirmation service hands it to the person the call runs as and the answer is `status: 'pending_confirmation'` with a `pendingId`, a success the agent relays without retrying; an AI service account's refusal carries `details.reason: 'service_account'` at every action door. A paragraph under the table adds the rest: never send `confirm` to `run_action` or `resume_run` (a call carrying it is refused, on every action); a host with no pending-confirmation service refuses a gated call 428 with `details.reason: 'no_confirmation_service'`; and on a long-lived (stdio) server whose bridge serves these tools, a client that advertised form-mode `elicitation` is asked in the client, where `accept` runs the call once and a decline, a dismissal or five minutes without an answer refuse it (`declined`, `cancelled`, `timed_out`). The `delete_record` and `delete_records` rows are unchanged: those tools still read `confirm: true`.
  
  objectstack-platform gains a sixth rule under `requires:`: AI-door confirmation is a service the host registers, an `IActionConfirmationService` under `'ai.actionConfirmation'`, and the open build ships none. Two restatements were removed from that file to pay for part of the rule: "Never rebuild what the platform owns." in the App / Platform Boundary intro, which the bullets under it carry, and the `HonoServerPlugin` row's note that `os dev` and `os serve` register it, which the boot sequence lists.
  
  Three eval cases cover the teaching: an agent that retried with `confirm: true`, the answers to an in-client question together with the service-account refusal, and a host that wants its people to approve these calls in its app.
- ea28882: docs(ui, skills): a print page whose sections may break between sheets authors one `record:details` block per section
  
  Clause-②: no
  Metadata-protocol: none
  
  `skills/objectstack-ui/rules/pages.md`, § Print pages: one sentence after the page-break hints says that where sections may break between sheets, the author writes one `record:details` block per section, because `avoidBreakInside` keeps each block whole on one sheet when it fits (the qualifier the spec describe carries: a block taller than one sheet still breaks inside itself) and a multi-section block moves to the next sheet whole. The file pays for it within its token ceiling, which is not raised. It drops the sentence that said the console's print rendering was still to follow and that `os validate` warns the layout is not applied, which no longer holds: the console applies every `print` key. It also drops the words ", in full" from "must draw all it declares", which they only repeated; the "draws a window of its rows" refusal still covers a block that draws part of its rows. And § Routing model drops "regardless of which app you came from" after "one global `/docs/<name>` route resolves any doc": the same paragraph already says the viewer is platform-level and the URL has no package or app prefix. The docs page `content/docs/ui/print-pages.mdx` carries the same guidance under its key table. `avoidBreakInside` keeps its meaning; no schema or runtime change.
- 12b69e1: feat(formula): `rmbUpper(amount)` writes an amount in Chinese capital numerals (人民币大写) for printed quotes, contracts and invoices
  
  Clause-②: yes (widening) — a new CEL stdlib function, `rmbUpper(dyn): string`, registered by `registerStdLib` and advertised in `CEL_STDLIB_FUNCTIONS`; an expression that calls it was refused as an unknown function before, and nothing that worked before is refused or changes value.
  Metadata-protocol: added — a formula, predicate or flow value may now call `rmbUpper(...)`.
  Skills-docs: updated here — `skills/objectstack-formula/SKILL.md` lists it in the stdlib Numbers table, and `content/docs/data-modeling/formulas.mdx` adds the catalog row and an "Amount in Chinese capitals" cookbook entry.
  
  `rmbUpper(245000)` is `贰拾肆万伍仟元整` and `rmbUpper(10500.5)` is `壹万零伍佰元伍角`. A formula field reads it as text:
  
  ```ts
  Field.formula({ label: '大写金额', returnType: 'text', expression: 'rmbUpper(record.total_amount)' })
  ```
  
  - The amount is rounded once to 分, half away from zero, on the exact decimal it spells, so `1.005` is `壹元零壹分` and binary floating point never decides a cent.
  - One `零` stands for each run of zeros (`壹仟零伍元整`, `壹万零伍佰元整`, `壹亿零壹元整`), a ten is `壹拾`, the 万 and 亿 groups follow the usual rules, and the count of 亿 above 亿 is written with 万 (`壹拾万零壹亿元整`).
  - A whole amount ends in `整`; a 分 with no 角 writes `零` for the 角 (`壹元零伍分`); an amount under one yuan is its 角 and 分 alone (`伍角`).
  - `0` is `零元整`, a negative amount is prefixed `负`, and `null` reads `''`, so an empty total prints an empty line.
  - A number, a currency field and decimal text (`'245000.00'`) are read. Text that spells no number, a boolean or a list, and an amount of 10^16 yuan or more, is a runtime error rather than some text.
- d11756a: docs(skills): teach a flow record write's text envelope and its organization-language key
  
  Clause-②: no
  Metadata-protocol: none
  
  `objectstack-automation` now says that a `create_record` / `update_record` `fields` value takes a third form beside the literal and the CEL envelope: the text envelope `{ dialect: 'template', source }`, for a sentence people read. Its `source` is a text slot, it is written in the organization's language (the Localization setting when somebody set it, else the app's `i18n.defaultLocale`), never in the language of the person who started the run, a missing translation writes the authored text, and a Localization setting that cannot be read fails the node. A bare string stays a literal and is never translated.
  
  `objectstack-i18n` names the key that translation lives at, `flows.FLOW.records.NODE_ID.fields.FIELD`, beside the other keys that sit deeper than their group's `label`, and says `os i18n extract --no-objects-only` scaffolds it.
  
  To pay for the text, `objectstack-automation` drops three sentences that are said elsewhere: the CEL callout's pointer to `objectstack-formula` (the skill's description already says to load it), the Trigger Configuration lead-in listing a flow's top-level keys (the examples reference shows whole flows), and the pure-function row of the `functions` example (the same item says a flow function is a pure compute step).
- b3863b7: docs(skills): `objectstack-formula` teaches `label()` over a multi-select and the `timestamp()` refusal over a date field
  
  Clause-②: no
  Metadata-protocol: none
  
  The `label(record.f)` row of the `objectstack-formula` built-ins table now says what a select with `multiple: true` reads: each selected value's option label in the reader's locale, in the order the record stores them, joined with `, `; an empty selection reads `''`, as null does.
  
  The built-ins line that lists `timestamp(s)` now says that `timestamp()` parses only a full ISO instant, so over a `date` field (its `YYYY-MM-DD` text) the build refuses it as `date-text-call`, inside `+ duration(…)` arithmetic too, and that a date is shifted with `isoDate(addDays(record.d, n))`. Both are the behaviour `@objectstack/formula` already ships; the skill only teaches it. One eval case covers each.
  
  Paid down first under the standing ruling 「A:先削重复,余额按实测提高」 (ruling record 6513306068): three restatements were cut, each keeping another home — the `has()` paragraph's null-check sentence (the cheat-sheet `Null check` row), the template section's `shared/expression.zod.ts` sentence (Core contract and See also), and the translation-table note's per-matched-row clause (the §5 `previous` table). The token ceiling moves by the measured remainder, +11 (5997 → 6008).
- 5a50524: docs(skills): `objectstack-ai` says a `delete_record` the human named, with exactly one record matching, is already approved
  
  Clause-②: no
  Metadata-protocol: none
  
  `skills/objectstack-ai/SKILL.md`, MCP tools table, the `create_record`, `update_record`, `delete_record` row: "ask the human first, then retry" becomes the rule the `delete_record` tool description has carried since #34453. A request in which the human names the record to delete, with exactly one record matching, is their approval, so the agent sends `confirm: true` on that call without asking again. When the name matches more than one record, or the request does not identify one, the agent lists the candidates, asks which one, and sends `confirm: true` only after the answer. The server still refuses a `delete_record` without `confirm: true`; no schema or runtime change.
- f8d016c: docs(skills): `objectstack-ui` keeps a long form `simple`, and both skills name the `bulk` an `inlineEdit` save needs; `os lint`, `os validate` and `os build` warn when it is withheld
  
  Clause-②: no
  Metadata-protocol: none
  
  `skills/objectstack-ui/SKILL.md` § Form Views no longer caps `simple` at 15 fields or sends objects with many field groups to `tabbed`. `simple` (stacked sections on one scrolling page) is the default at any field count. `tabbed` is for sections read apart, and the row names its cost: a required field missed on another tab is flagged only on its tab, and the tab strip overflows on a phone. A new paragraph says how a long form stays `simple`: `collapse: 'collapsed'` on the object's `fieldGroups` entry or `collapsed: true` on a form section, `columns` as a per-row ceiling (unset, a section draws two), and `modalSize` for the New / Edit dialog (unset, `lg` or `xl` by field count). One eval case asks for a 42-field form and fails an answer with `type: 'tabbed'`.
  
  The parent's form saves an `inlineEdit` child's rows with the parent in one `/api/v1/batch`, and that route asks every object in it for `bulk`. Master-Detail Forms in `objectstack-ui` and § Inline Editing in `objectstack-data` `rules/relationships.md` now say so: a parent or child that declares `enable.apiMethods` must list `'bulk'`, or the save is refused `405 OBJECT_API_METHOD_NOT_ALLOWED`. An undeclared `apiMethods` allows it.
  
  A new authoring rule, `relationship/inline-edit-needs-bulk` (`lintInlineEditBulk`, exported with its id constant `RELATIONSHIP_INLINE_EDIT_NEEDS_BULK`), warns on an `inlineEdit` relationship (`true`, `'grid'` or `'form'`) whose parent or child declares `enable.apiMethods` without `'bulk'`: once per object, at that object's `enable.apiMethods`, with a fix line naming the value to add. It is registered for all three commands, so `os lint`, `os validate` and `os build` (and `objectstack dev`) report it. It is advisory and never fails a build. `references/lint-rules.md` lists it.
  
  The skill files pay for most of this by cutting text stated elsewhere, and the `objectstack-ui/SKILL.md` token ceiling moves by the measured remainder.
- 367e324: docs(skills): the query skill says where a zoned date bucket is computed
  
  Clause-②: no
  Metadata-protocol: none
  
  objectstack-query's `rules/aggregation.md` no longer says a date bucket under a non-UTC `timezone` always keeps the whole aggregate call in memory. A driver that declares `supports.zonedDateBucketing` (PostgreSQL via `driver-sql`) buckets the date in the database when the zone resolves to an area/location (`Asia/Taipei`); on every other driver, and for a zone that resolves to none (`+08:00`, `EST5EDT`), the whole call still runs in memory. One eval case covers the sentence.
- 581c916: docs(skills): `objectstack-ask`, a skill for a client that answers business questions over MCP
  
  Clause-②: no
  Metadata-protocol: none
  
  A person who connects Claude Code (or another MCP client) to an ObjectStack app and asks it for a number now has a skill that tells the client how to answer. Until now that procedure was written only in the `list_datasets` tool description and on the page at `GET /mcp/skill`, and a client does not reliably read either before it picks a tool.
  
  The new skill `objectstack-ask` is for the connected client, not for a developer writing queries in code. It gives the steps in order:
  
  - Lift the business words of the question and call `list_datasets` with them as `terms`, in the user's own words and language.
  - Decide by `matches`. A word matches only when it equals a member's name, label or synonym (case, spacing, `_` and `-` aside), never by similarity. One measure match is computed with `query_dataset`, and the source is cited from the answer's `provenance`. Several matches are a question for the user. A dimension match alone is not an answer.
  - When nothing matches but the word is a loose form of several listed measures (a bare "revenue" beside Won Revenue, Annual Revenue and Planned Revenue), ask which one is meant and compute nothing yet.
  - Otherwise fall back to `aggregate_records` / `query_records`, and open the answer with a line saying it is not from a governed metric (非指标口径).
  - `membersWithheld: true` is reported as measures the user may not read, never as a metric that does not exist.
  - When no metric, object or field records what the question needs, say what is missing. Never answer from an assumed value.
  
  `objectstack-ai` and `objectstack-query`'s aggregation rules each gain one line pointing to it. Install or update the catalog as before (`@objectstack/skills`, then the sync); nothing else changes.
- d576509: feat(lint): a dataset measure or dimension that declares neither `synonyms` nor a `description` is advised
  
  Clause-②: yes (widening) — @objectstack/lint gains three exports on its "." entry: validateDatasetMemberVocabulary, DATASET_MEMBER_NO_VOCABULARY and the DatasetMemberVocabularyFinding type; nothing accepted before is refused
  Metadata-protocol: none
  
  A dataset member answers a business question through its vocabulary (ADR-0149 D1): `synonyms`, the words a person types for it, and `description`, a short business definition. Both keys are optional, so a dataset that declares neither on a member passes every check, and that member then answers only to its own name and label. A person who asks in other words, or in another language, matches nothing and gets a number from a plain object query instead of the governed metric.
  
  `@objectstack/lint` adds one advisory rule, `dataset-member-no-vocabulary` (`warning`). It reports once per measure or dimension that has no non-blank `synonyms` entry and no non-blank `description`, names the dataset and the member, and says what is lost. One of the two keys is enough to silence it. It runs at `os validate`, `os build` and `os lint`, and at the metadata publish door for a `dataset` write, where it is an advisory on the save response. Nothing is refused: a dataset that only feeds charts loses nothing by leaving both keys out. `os explain dataset-member-no-vocabulary` prints the full reasoning.
  
  The author-time rule count the CLI prints (`Running author-time rules (N)`) rises by one, to 70 for `os validate` and `os build`.
  
  `@objectstack/lint` exports `validateDatasetMemberVocabulary`, `DATASET_MEMBER_NO_VOCABULARY` and the `DatasetMemberVocabularyFinding` type.
  
  `@objectstack/cli`: `os generate dataset` now writes one `synonyms` entry on each member it scaffolds, seeded from a label the stack already declares (the title field's label on the dimension, the object's plural label on the record count), in whatever language that label is written in, under a comment that says to replace the seed with the words your users type and to add a `description`. A fresh scaffold therefore draws no finding. When a seed would answer to two members (a title field labelled like the object), the scaffold picks the next candidate, so the dataset it writes always parses.
  
  `@objectstack/skills`: the `objectstack-ui` dashboards rule now says, for every dataset member, to write `synonyms` as the words a person types, in the language of the brief, and a one-sentence business `description`; that one word names one member; and that a member with neither draws the new warning. Its dataset example gives the dimension a synonym too, and the skill's evals gain a case for a dataset authored from a Chinese brief.
- c21945d: docs(skills): `objectstack-data` teaches `rollupSourceUnreadableReason` beside `security-rollup-source-unreadable`
  
  Clause-②: no
  Metadata-protocol: none
  
  objectstack-data's `rules/relationships.md` named two ways to resolve `security-rollup-source-unreadable` on a permission set that reads a roll-up `summary` but not the child data under it: grant the child read, or mask the summary. It now names the third. When the request says the set should see the total but not the children, keep the column readable and add `rollupSourceUnreadableReason` to the set's entry for it: `fields: { 'project.task_count': { readable: true, rollupSourceUnreadableReason: 'Clients see progress counts, not tasks' } }`. The warning for that set and column is then reported as a note quoting the reason. A blank reason, or one beside `readable: false`, is refused at parse time. The reason is never added to silence a total the request withholds: that one is masked.
  
  The mask sentence now names Modify All alone as what must leave the set first. A set's own `readable: false` binds beside its own View All, so the skill no longer asks for View All to be removed.
  
  Six restatements in the same file are cut to pay for it, so the file's token ceiling goes down, 4229 to 4221. The skill's evals gain one case (the set sees the total but not the rows, so the answer acknowledges it with a reason) beside the existing mask case.
- ab1c734: docs(skills): objectstack-ui's SKILL.md is a router: first checks, run-time traps, where each rule lives
  
  Clause-②: no
  Metadata-protocol: none
  
  `skills/objectstack-ui/SKILL.md` goes from 15.7 KB to 9.0 KB and now holds three things. No rule's teaching changes; text moved, and the page says where it went.
  
  - **First checks.** The installed `@objectstack/spec` version against the skill's `compatibility` line; the object's declaration and the project's own view, app, action and dataset files; the type's contract (`references/_index.md` points at the Zod source in `node_modules/@objectstack/spec/src/`, which decides what to write; a running environment serves the parsed shape as JSON Schema at `GET /api/v1/meta/types`, where a defaulted key reads as required); `os validate` before reporting done.
  - **Seven traps that parse and then fail at run time.** A long form stays `simple`; a record with its line items is `inlineEdit` on the child's `master_detail` field (and `enable.apiMethods` must list `'bulk'`); a persisted chart binds a declared dataset; a filter token is presentation scope, not security; the object declares its record page. Two keep their own headings: `List Views` (keep the view kind the request names, with the nine kinds) and `Actions` (an operation is an `action` whose body calls the API).
  - **Where to go.** One table from the task to the file to open: list views, form views, navigation, record page, actions, dashboards and reports, pages and docs, and the React-tier block contract.
  
  The Navigation Item Types, Action Types and Report Types tables stay in `SKILL.md`, with the item and action keys behind their homes.
  
  Where the rest moved, each under its old heading text:
  
  - `rules/list-views.md` now carries **Form Views** (the three types, the long-form paragraph, the public form), **Master-Detail Forms (parent + child line items)** and **Field Conditional Rules in Forms**, plus the column-count pitfall under Column Features.
  - `rules/navigation.md` opens with `App.create`, the one-App-per-package rule, each navigation item type's keys (`label` and `icon` on every type but `separator`), `requiresObject` / `requiresService` and the `AppContextSelector` note.
  - `rules/actions.md` opens with what an action is, where it is registered, and why a record button needs a placement and a `js` body with `api.write`; a bare field ref in `visible` or `disabled` fails `os validate`, and a parameterized bulk mutation is `script`.
  - `rules/dashboards.md` says an omitted widget `layout` auto-flows, `position` is not a widget key, and a widget binding that resolves to nothing declared fails `os validate`.
  - `rules/pages.md` points at objectstack-query `rules/filters.md` for relative-date placeholders.
  
  A reader who linked `SKILL.md#date-macros--filter-placeholders`, `#master-detail-forms-parent--child-line-items`, `#form-views`, `#common-pitfalls` or `#verify-your-work` finds those headings gone from `SKILL.md`: the first is trap 4 and objectstack-query `rules/filters.md`; the second and third are in `rules/list-views.md`; `#common-pitfalls` is in `rules/list-views.md` (Column Features) and `rules/dashboards.md`; `#verify-your-work` is first check 4, with what the gate catches in `rules/actions.md` and `rules/dashboards.md`.
- eb7b09d: docs(skills): objectstack-data teaches that the package shipping a `fieldPatches` relabel translates that text in its own `translations`
  
  Clause-②: no
  Metadata-protocol: none
  
  `skills/objectstack-data/SKILL.md`, the `fieldPatches` paragraph: patched text is translated in the patching package's `translations`, under the owner's keys (`objects.crm_account.fields.industry.label`, `.help`, `.options.<value>`); the owner's translation of the text the patch replaced never applies, a pair `.custom` translation comes first on `/meta`, and a locale the package does not translate serves the patch text. This is the skill text for the behaviour `@objectstack/spec` 18 already ships; the docs page `data-modeling/object-extensions` teaches the same. One eval case asks where a dependent package's zh-CN strings for its patch go. The file pays in full by dropping restatement and its token ceiling does not move: the lead-in line under the Quick Reference heading, the second half of the multi-value-lookup note (the Relationship Patterns rows carry it), and the two unique scopes named again under the index example. No schema or runtime change.
- 62da8a3: docs(skills): trigger cases for the six metadata skills, and eval cases that grade the skill instead of a spelling or a missing project
  
  Clause-②: no
  Metadata-protocol: none
  
  `@objectstack/skills` ships each bundle's `evals/` as eval fixtures, inert in a consumer install. The six metadata skills (`objectstack-data`, `-query`, `-ui`, `-automation`, `-formula`, `-i18n`) each gain `evals/triggers.json`: 42 trigger cases, 12 of them near misses that should leave the skill alone. A trigger case carries `should_trigger: true | false` in place of `assertions` and is graded on whether the skill was loaded. Eleven existing cases had an assertion bound to one spelling of a right answer, or forbidding a token a right answer quotes; those assertions are narrowed. Thirty prompts that read as if a project were on disk now state that none is and what the answer should carry.
  
  The `@objectstack/scenarios` README documents how the checkout-only `skill-evals` runner grades and reports trigger cases and places a case's `files`. The runner is not in the package's published `bin` or `exports`, so nothing a consumer installs changes beyond the README text.
- b85dff0: docs(skills): the automation skill says who an `admin_rescue` request opens on
  
  Clause-②: no
  Metadata-protocol: none
  
  objectstack-automation's `references/state-machines-and-approvals.md` no longer says that under `onEmptyApprovers: 'admin_rescue'` "only a privileged admin can act via Reassign". The row now says what the runtime does: the request opens on the organization's administrators. Nothing else in the row changes.
  
  No runtime change. In-code descriptions (one of them a comment that ships in `@objectstack/platform-objects`' build output) of the approval request's served `viewer` block now name its four leaves (`can_act`, `is_submitter`, `can_override`, `can_override_approve`) and say that Approve reads `can_override_approve` while Reject, Reassign and Recall read `can_override`.
- e556e3a: docs(skills): the `objectstack-ask` skill reads `candidates` for a word that matched nothing
  
  Clause-②: no
  Metadata-protocol: none
  
  `list_datasets` now answers a business word that matched nothing with `candidates`, the members the server offers as possible readings. The `objectstack-ask` skill, and the page at `GET /mcp/skill` that is generated from it, still told a client to judge near readings itself from the catalogue. They now read the server's list, in the same rule the `list_datasets` tool description and the `initialize` selection rule state.
  
  What a connected client now reads, where it differs from before:
  
  - Step 1 names `candidates`: a word that matched nothing may have them, each a `{ term, dataset, member }` pointer to a member the same answer lists. A candidate is not a match.
  - A word with no match and one or more candidates is a question for the user. The client lists each candidate's label, its dataset's label and its description, picks none, treats none as a match and computes nothing until the user answers.
  - One candidate is a question too: the client asks whether it is the one meant. This replaces the earlier wording, in which one near form selected nothing and went to the fallback.
  - No match and no candidates for the word for a thing measured is the fallback to the object tools, with the answer saying no governed metric was used (非指标口径).
  - The client's own loose-form check is removed: the two rows that had the client judge whether a word was a loose form of several listed measures, and the paragraph that defined a loose form. This supersedes the loose-form sentences in this release's earlier `objectstack-ask` and `GET /mcp/skill` entries. Against a server that returns no `candidates`, a word with no match goes to the labelled fallback, which still names a listed dataset on the same object.
  
  The skill's eval cases cover several candidates, one candidate, and no candidates. `packages/mcp/src/ask-skill.generated.ts` is regenerated from the skill; no code path changes.
- 301b7c1: docs(skills): the i18n skill names the action table column label keys
  
  Clause-②: no
  Metadata-protocol: none
  
  objectstack-i18n's SKILL.md lists `resultDialog.columns.{path}.{column_path}` and `preflight.columns.{path}.{column_path}` in the `_actions.{action_name}` row of its key table: the header labels of a `format: 'table'` answer field's columns, written beside `fields` and keyed by the table field's literal `path`, then by the literal `path` of one of its `columns[]`, each value a plain string. The `translation-target-unknown` paragraph gains the matching refusal (a field path that is no declared table field, or a column path the field's `columns[]` does not list), and the zh-CN example block shows the key as the platform's `sys_user` bundle spells it. One new eval case grades a result-dialog table whose headers stayed English, and the preflight eval case no longer says a `preflight` node holds only `fields`. The text is paid for in the same file by cutting five restatements, so the skill's token ceiling does not move.
- 3b4ffb2: docs(skills): the `objectstack-ask` skill loads for every question about the app's records, asks back without a figure of its own, keeps terms whole and declines a record kind it cannot see
  
  Clause-②: no
  Metadata-protocol: none
  
  The `objectstack-ask` skill, and the page at `GET /mcp/skill` that is generated from it, now tell a connected client:
  
  - The skill is for every question answered from the app's records, before the first data tool call, even one that names no metric: what has been claimed, spent, sold or paid so far, as well as a number, a total, a ranking, a breakdown, a trend or a list ("how much", "so far", 「一共」 join the trigger words).
  - A term sent to `list_datasets` is the user's noun phrase for the thing, kept whole ("travel budget", not "travel" and "budget") and without the verbs, time words and question words around it ("trip days", not "trip days requested").
  - A reply that asks the user back states no figure of its own (no count, total or option number): each option is named by its label in a bullet, and its description is quoted as written. It asks only about matches or candidates for words the user wrote; a word with no match and no candidates goes to the object fallback instead of a question about another word's matches.
  - The object fallback opens with one rule: when the question names a kind of record that no listed object or dataset is, the client says it cannot see those records here (they may be hidden from it) and stops, and never answers from a different object that merely links to them.
  
  Two sentences in the `candidates` row of step 2 that restated step 1 and the paragraph under the table are removed. The skill's eval cases add a question about what has been claimed so far and a question about a record kind no listed object shows. `packages/mcp/src/ask-skill.generated.ts` is regenerated from the skill; no code path changes.

## 18.5.0

### Patch Changes

- d683e6f: skills(objectstack-api): a flow door's `FLOW_FAILED` `details.innerRefusal` is the refusal any node met, not only a write's
  
  The flow-door paragraph described `innerRefusal` as the refusal "a node's write was refused with" and listed three codes as if they were the set. On `main` it is filled by a data node's refused read or write (any declared 4xx, its code the `ErrorCode` member a record save of the same call answers) and by a `script` node whose function name is ambiguous or outside its package's reach (`RESOURCE_CONFLICT`). The paragraph now says so and gives the codes as examples. The "Choosing between `apis:` and a code handler" table now links the `script` node row to objectstack-automation's package rule (silently-wrong item 3) for which function runs, without restating it.
  
  Clause-②: no
  Metadata-protocol: none
- 6e23180: docs(skills): the dashboards rule says a parent-path record-currency amount admits no grouping, and the data evals measure the parent-path `currencyField`
  
  Clause-②: no
  Metadata-protocol: none
  
  `objectstack-ui`'s dashboards rule said a `currencyMode: 'record'` amount refuses `sum` / `avg` / `min` / `max` "unless grouped by its code field". For a `master_detail` child amount whose `currencyField` is the parent path (`'invoice.currency_code'`), no grouping is admitted: the engine's aggregate door refuses it whatever it groups by, and the analytics cube door never matches a dimension to a dotted code field. A dashboard author who grouped by the path was refused. The rule now says so in one parenthesis, points to `objectstack-data` → Field Types → Currency for the declaration, and names the two single-currency shapes to measure instead: the amount's `homeAmount` field or the parent's `summary`. To pay for it, two clauses whose home is the package source are deleted from the same comment: what a result column carries (`AnalyticsResult.fields` in `@objectstack/spec/contracts`) and the "not judged" list of the measure-currency check. `objectstack-data`'s `objects-fields-relationships` evals gain a case for an invoice whose line amounts follow the invoice's currency, with the `lookup` path refused. No schema or runtime change.
- 34c0522: docs(skills): the `manifest.namespace` paragraph lists `runs` among the namespaces a package may never declare
  
  Clause-②: no
  Metadata-protocol: none
  
  `objectstack-platform` named `actions`, `connectors`, `global`, `hooks`, `oauth` and `trigger` as the route literals a package namespace may never spell, but the address grammar's refused set (`NAMESPACE_REFUSED_LITERALS`, derived from `NAMESPACE_POSITION_LITERALS` in `@objectstack/spec/kernel`) also holds `runs`, the literal in the inbound hook's namespace position. An AI author who picked `runs` met the refusal only at `os validate`, build or the install door. The list now names all seven, in the set's sorted order. No schema or runtime change.
- 7e61983: docs(skills): the automation skill says what two packages shipping one flow function name now get, since function names are held per namespace
  
  Clause-②: no
  Metadata-protocol: none
  
  Since engine `function` joined `NAMESPACE_SCOPED_BARE_NAME_TYPES` (ADR-0150 D2/D9), two packages declaring two different `namespace`s may each bind a function of one name, each flow's `script` node running its own package's, and the cold boot no longer warns for that pair. `objectstack-automation` still said every two-package pair makes the boot warn `Bare-name conflict at boot`. Item 3 of "Valid-but-silently-wrong" now says: packages of two namespaces each run their own; within one namespace, or where a package declares none, the later bind is refused at install, and a boot holding such a pair warns `Bare-name conflict at boot`. The guard refusal for a flow whose package holds none (two holders in reach, or one only outside its `dependencies` closure: `RESOURCE_CONFLICT`) is unchanged. No schema, accept set or behaviour changes.
- 4c5c93d: docs(skills): the automation skill says a flow that runs after a record change may not retry an inline outbound call
  
  Clause-②: no
  Metadata-protocol: none
  
  The platform refuses a flow whose start node runs it after a record change (`record-after-create`, `-update`, `-delete`, `-insert`, `-write`) when a retry reaches an `http` node without `durable: true` or a `connector_action` node (`flow-after-save-inline-retry`), because the save waits for the run. The published automation skill now says so, so an author following it is not refused at the save door first.
  
  - **`@objectstack/skills`** (`objectstack-automation`, `SKILL.md`): the `try_catch` row says that in a `record-after-*` flow neither its `retry` nor the flow's `errorHandling.strategy: 'retry'` may reach an inline `http` or `connector_action` node, since the save would wait out every attempt. The `http` row gives the fix: `durable: true`, which queues the request on the messaging HTTP outbox, or where none is wired sends it once in the background, unretried, so the run gets no response. The `connector_action` row gives its fix: drop the retry, or run the flow on demand or on a schedule. A credential still never goes in an `http` node's `url` or `headers`, as the `http` row already says.
  - To pay for those words, three sentences that restate text with another home are cut: the screen row's `progress` field list (home: `content/docs/automation/flows.mdx`, the screen progress table), the trigger note's "unless you must modify or reject the record" (home: the trigger table's before rows), and Verify your work's bare-reference sentence and command block (home: **objectstack-formula** § Verify your work and its flow-condition note). No schema, runtime or behaviour changes.
- 25febd3: docs(skills): a stored computed field reads only its own row; the skills name the cross-record and volatile-input warnings
  
  Clause-②: no
  Metadata-protocol: none
  
  The three places the published skills tell an agent to move a `formula`'s `expression` onto a stored field now say what that field may read. `objectstack-data` → Relationships → Computed column owns the sentence: a stored computed field reads only its own row; a related record's value (`record.product.unit_price`) keeps what it held at the row's last write and draws the `stored-expression-cross-record-input` warning, so it stays a `formula` (read time, not totallable) or becomes a snapshot a flow on the related object writes, and a field left stored is repaired by `os migrate stored-expressions --object OBJECT --field FIELD --changed --apply`; the clock (`now()`, `today()`, `daysFromNow()`, `daysAgo()`), the acting user, `can()` and `hasCapability()` are fixed at the write and draw `stored-expression-volatile-input`; a `formula` keeps them current, and for the clock a scheduled flow does too. The `formula` row in `rules/field-types.md` and the total-over-a-computed-value bullet in `objectstack-ui` `rules/dashboards.md` point to it. The dashboards bullet also stops saying existing rows have no backfill: rows a publish did not fill are filled by `os migrate stored-expressions --apply`. Both rules are warnings, not refusals; no schema or runtime change.
- 6c5d31f: docs(spec,skills): `SkillSchema.tools` is described as what it now does on an MCP server, not as inert in the open framework
  
  Clause-②: no
  Metadata-protocol: none
  
  Since 18.4.0 the prompt surface `registerSkillPrompts` (`@objectstack/mcp`) installs offers a skill on `prompts/list` and `prompts/get` only when the server it is installed on lists every tool the skill binds. The published texts still said the binding was authored for the cloud runtime and inert in the open framework, or that every skill with instructions is served to any connected client. They now state the rule; no schema, accept set or behaviour changes.
  
  - **`@objectstack/spec`**: the `SkillSchema` class JSDoc, the `tools` JSDoc and its describe text (so the generated JSON Schema description and the skill reference page), plus one clause on the `instructions` JSDoc. `tools` is bound by the cloud agent runtime and read by MCP: a plain name is served by a tool of that name, a trailing wildcard by any listed tool it matches, and an `action_<name>` entry (or `action_*`) also by `run_action`. A skill that binds no tool is offered as before, and `prompts/get` answers a withheld skill as it answers a prompt name no skill derives. The rule reaches every server `registerSkillPrompts` is installed on, `MCPServerRuntime`'s HTTP door and a host's own `McpServer` alike, stdio included; `MCPServerRuntime.bridgePrompts`, which projects skills onto the long-lived server without it, applies no such filter. `surface` and `triggerConditions` stay cloud-runtime-only.
  - **`@objectstack/skills`** (`objectstack-ai`): the built-in-skills note says the same, and the `instructions` row calls it the one field the open edition serves, since the open edition now reads `tools` as well.
  - **`@objectstack/spec`**, liveness ledger (`liveness/skill.json`): the `tools` entry cites its in-repo reader, `skillBindingServed` in `packages/mcp/src/skill-prompts.ts`, beside the cloud readers, and its note no longer calls the key cloud-runtime-only.
  - **`@objectstack/mcp`**: the README's Prompts section says which servers apply the rule. `bridgePrompts` lists every skill that carries instructions on the long-lived server; the HTTP door and any server a host installs `registerSkillPrompts` on offer a skill only when that server lists every tool it binds.
  - The agents guide (`content/docs/ai/agents.mdx`) carries the rule under its two-halves table and advises binding a skill only to tools its intended connections serve. The MCP connection guide (`content/docs/ai/connect-mcp.mdx`) says a skill is offered only where its tools are: its example skill, bound to `query_records` and `action_resolve_case`, is not offered to a token without the `actions:execute` scope, which lists no `run_action`.
- 0f6439d: docs(skills): the `notify` selectors say when `org:members` reaches nobody, and show the computed `owner_of:` form
  
  Clause-②: no
  Metadata-protocol: none
  
  `objectstack-automation` § `notify` said `org:members` reaches every member of the run's organization, else that of the record the notification is about, and was silent on a run with neither. There the resolver warns in the server log and returns nobody while the node still succeeds: under the `single` posture, a `schedule` flow that declares no start-node `organization` and has no record hits it (under `group` the notification write itself is refused and the node fails). The line now says so, matching `content/docs/automation/flows.mdx`, and says the warning for an unrecognised `org:` value is a server-log one too. The `owner_of:OBJECT:ID` line now shows the form a flow needs, an envelope that builds the string from a computed id (`source: "'owner_of:crm_case:' + record.case_id"`). Paid for in the same file, no ceiling moved: the `NotifyConfigSchema` `strictObject` clause that restated "an undeclared key is a named parse error", three ADR asides, and the pointer that sends side effects to an object hook, which the skill's own description and objectstack-data already carry. No schema or runtime change.
- 426bf65: docs(skills): the object `enable` capability table names `aiReadable`
  
  Clause-②: no
  Metadata-protocol: none
  
  `skills/objectstack-data/SKILL.md` gains one row in the Object Capabilities (`enable`) table: `aiReadable` opens read-only AI access (query, get one, aggregate, describe, list; never a write) on a platform `sys_*` object, never on the stored-metadata family (`sys_metadata`, `sys_metadata_history`). An app object never declares it: any declared value, `false` included, is refused at parse (`aiReadExposureRefusal` in `@objectstack/spec/data`). No schema or runtime change.
- 539f2d1: docs(skills): a suite composes under `manifest: 'preserve'`; a flat composition with two or more apps under one app or module package id is refused
  
  Clause-②: no
  Metadata-protocol: none
  
  `objectstack-platform` `references/bootstrap.md` § Multi-App Composition said no app in this repo uses `composeStacks()` and gave no strategy for a suite. It now says that a suite (an app package plus module packages, one app each) composes with `composeStacks(stacks, { manifest: 'preserve' })`, which keeps each package's own id, as `examples/app-multi-package` does, and that a flat `manifest` (`'last'`, the default, `'first'` or an index) keeps one manifest, so two or more apps under one `app` or `module` package id are refused with `STACK_SINGLE_APP_VIOLATION` (422). `objectstack-ui` `SKILL.md` § App Navigation names the same remedy for a suite's further apps. Both files pay for the new text by deleting restatements in the same file; their token counts stay under their ceilings. No schema or runtime change.
- b5f2f51: docs(skills): a vetted hook template refuses two records of one owner over overlapping time
  
  Clause-②: no
  Metadata-protocol: none
  
  The platform has no declarative way to say "two leave requests of one person may not overlap": a validation rule sees one record and a unique index compares equal values only. That rule stays in a hook script for now, and the published data skill now carries the form to copy.
  
  - **`@objectstack/skills`** (`objectstack-data`, `references/data-hooks.md`): Common Patterns gains pattern 5, a `beforeInsert` + `beforeUpdate` hook with a sandboxed `body`. On update it merges the stored row under the patch and leaves the record itself out of the count; it names the ignored statuses with `$nin`, so a status added later, or a row with no status, still counts; `datetime` ranges are half-open, so 18:00–21:30 and 21:30–23:00 do not overlap, and for `date` fields the author sets `DATE_ONLY`, which counts the end day as booked; it declares `runAs: 'system'`, so the count also sees rows the saver cannot read; and it refuses through a declared `refusals` entry (`OVERLAP`, `409`). Its known limits are stated next to it: two concurrent saves can both pass, a recycle-bin restore runs no insert hook, an import with automations off skips hooks, rows of one bulk insert or update do not see each other, and a row with no start or end is neither checked nor counted. The `object`, `events`, `priority`, `async` and `onError` subsections under Key Properties, and the `previous` example and the Cross-Object API note under Hook Context API, are removed: each restated the comments of the `defineHook` example, the sandbox `ctx` table, the `ctx.api.object(name)` section, the Before vs After table or Best Practices. No schema, runtime or behaviour changes.
  - The record hooks page (`content/docs/automation/hooks.mdx`) carries the same template with the reason for each line and the same limits.
- f588614: docs(skills): the formula skill's Want/Write table names the hours-between form
  
  Clause-②: no
  Metadata-protocol: none
  
  `skills/objectstack-formula/SKILL.md` gains one row, "Hours between" → `double((datetime(record.end_at) - datetime(record.start_at)).getMinutes()) / 60.0`, beside `daysBetween` (whole days), and the date-arithmetic note names that form as the hours exception. It is the same form the date-subtraction refusals now name (#32980's fix); no authorable surface changes.
- 8e63ed8: docs(skills): the security rules teach a position rename through `renamedFrom`
  
  Clause-②: no
  Metadata-protocol: none
  
  `skills/objectstack-data/rules/security.md` § Renaming or removing a shipped access item gains one paragraph: a renamed position declares its earlier names in `renamedFrom: ['old_name']` and is never deleted and re-added, since holders name a position by its bare name and a deleted one leaves them granted nothing. At boot the security plugin moves the old name's holders (`sys_user_position`) to the new name in every organization, idempotently. It moves holders only: sharing-rule, queue and record-share recipients, pending approvers and invitations that name the old name are listed in the boot log for an administrator. The paragraph names the claims it does not carry: an old name still a position anywhere, claimed twice, recorded under another package in the activation ledger, switched off, or claimed by a disabled package. The file pays for the paragraph in place (no ceiling change): it drops the illustrative `com.acme` and `hr` / `ops` package examples, two of the three example wildcard sets, the `sys_secret` storage sentence (encryption at rest is taught in `rules/field-types.md`), the adapter-written-rows aside, and three short asides. No schema or runtime change.
- 6a28a27: docs(skills): the navigation rule teaches the approvals inbox entry the way the platform's Account app writes it, gated on the approvals service
  
  Clause-②: no
  Metadata-protocol: none
  
  `objectstack-ui`'s navigation rule taught the approvals entry as a `type: 'object'` item on `sys_approval_request` gated by `requiresObject: 'sys_approval_request'`. An app that copied it hid the entry from every non-administrator approver until some approval request already involved them: the object metadata read answers 404 to them until then, and the console prunes a `requiresObject` entry against the objects it is served. The rule now teaches the inbox component, `{ type: 'component', componentRef: 'approvals:inbox', requiresService: 'approvals' }` (the shape of `nav_account_approvals` in `@objectstack/platform-objects`), which the server keeps in the served navigation whenever plugin-approvals registers its `approvals` service, and says in one line why `requiresObject` is wrong here. The matching eval expects the same shape. No schema or runtime change.
- 6d14603: docs(skills): a hook that enforces a business rule declares `refusals` and refuses by code, not with a free-text throw answered `HOOK_ABORTED`
  
  Clause-②: no
  Metadata-protocol: none
  
  `objectstack-data/references/data-hooks.md` § Declared refusals now opens with the rule: a hook that enforces a business rule declares a `refusals` catalogue, one code per rule, and its body throws the code; a throw with no code is answered with the platform's `HOOK_ABORTED`, which is for failures nobody planned. The section's example is now a cross-object state guard (only an in-stock asset can be checked out, `ASSET_NOT_IN_STOCK` at 409). It also says which hook form can declare `refusals` today: only a sandboxed `js` `body`; a `handler` hook, an inline TS one included, is refused at save. It says how the refusal reaches the wire: the status's `code` (default 400), with the hook's code as `declaredCode`. Best Practices and the Error Handling intro point to it. Common Patterns' delete guard (`crm_protect_strategic_accounts`) declares `STRATEGIC_ACCOUNT` and `OPEN_OPPORTUNITIES` and throws them instead of two free-text errors; the second message no longer carries the count, since a catalogue message takes no parameters. `objectstack-data/rules/validation.md` § External / Custom Validation now teaches the same thing: its tax-ID hook declares `TAX_ID_BLOCKED` and throws it instead of `new Error('Tax ID is blocked')`. Both files pay for the new lines by deleting restatements in the same file. No schema, accept set or behaviour changes.
- 3968a57: docs(skills): the `controlled_by_parent` authoring guidance teaches `sharing.controlledByParent.writeRequiresMasterRead`
  
  Clause-②: no
  Metadata-protocol: none
  
  The data skill's relationship rules said every write of a `controlled_by_parent` detail needs edit on its master, with `ownerMayEdit` as the only opt-in. They now teach the second opt-in as well: with `writeRequiresMasterRead: true` on the detail, whoever can read the master inserts, updates and deletes detail rows under the detail's own object permissions, row-level security and field-level security, on re-points and on each opted-in chain hop too; an on-behalf-of write needs both users to read the master, and the platform ownership floor still binds predicate and on-behalf-of updates and deletes. The rules name its parse refusals (beside `ownerMayEdit: true`, off a `controlled_by_parent` object, one level up) and that `security-controlled-by-parent-owner-policy-without-opt-in` stays silent on such a detail. Without the key every write still needs edit on the master. The optional-master paragraph says setting or emptying a master asks read under the opt-in. One eval prompt covers the opt-in. The lookup and junction examples drop their boilerplate parent objects to pay for the new text inside the file's token ceiling.
- ccf2899: docs(skills): `objectstack-data` evals 11, 12 and 14 carry their own `must_contain` literals in the reference answer
  
  Clause-②: no
  Metadata-protocol: none
  
  In `objects-fields-relationships.json`, three evals listed `must_contain` literals that their own `expected_output` described only in prose, so the reference answer failed its own grader: eval 11 (`type: 'select'`, `type: 'state_machine'`), eval 12 (`type: 'summary'`, `type: 'formula'`) and eval 14 (`label: '公司名称'`, `value: 'active'`). Every literal is the spelling the data skill teaches on `main`, so the reference answers now spell them; eval 14's options are written in the skill's `{ label, value }` shape. No assertion, schema or runtime change.
- d4e3dcc: docs(skills): an owner, assignee or 负责人 in a request is the injected `owner_id`, never a second same-label field
  
  Clause-②: no
  Metadata-protocol: none
  
  objectstack-data teaches that a request's owner, assignee, 负责人 or 处理人 is the platform's injected `owner_id`, not a second person field beside it. A handler the request names apart from the owner is a `user` field that grants no access, with a label no other visible field carries, the injected `owner_id` (Owner, 负责人), `created_by`, `updated_by`, `created_at` and `updated_at` included. To pay for the text inside the file's token ceiling, SKILL.md drops a ruling date, four ADR asides, two zod pointers that `references/_index.md` already carries, an internal constant name, a sentence restating its heading and a link the Quick Reference list already gives. The Quick-Start Template's support case no longer declares an `assigned_to` user field, and a new eval asks for a ticket app with a 负责人.
- b070e1c: fix(core): a data import resolves a lookup cell naming a detail record within the master the same row names (#33523)
  
  Clause-②: yes (narrowing) — widening: a row whose master identifies one of several same-named details now resolves it, where it was refused `reference_ambiguous`; `@objectstack/core` exports `referenceScopeSources` and the types `ReferenceMaster` and `ReferenceScopeSource`, `RefResolver` and `coerceFieldValue` take an optional scope, `coerceRow` an optional source row, `CoerceContext` an optional `referenceMasters`, and `ExportFieldMeta` an optional `dependsOn`. Narrowing: a row that names a master and a detail only another master carries is refused `reference_not_found`, where the detail was linked across masters; and a caller who cannot read the target's master field (or a `dependsOn` `param` field) is refused `reference_not_found` for a scoped lookup cell that the unscoped lookup resolved, because the scope puts that field into the caller's own filter and a filter on a field the caller cannot read is refused.
  Metadata-protocol: none
  Skills-docs: `content/docs/data-modeling/import-mappings.mdx` gains "A lookup cell is resolved within the row's own master"; `skills/objectstack-data/rules/relationships.md` names the scoping under `master_detail`.
  
  <!-- adr-0087: not-required (no-migration-prescription) No key of any authorable schema is added, removed, renamed or re-shaped. `master_detail` and `dependsOn` are read as declared; the change is in how the import runtime resolves a cell, and no stored row is rewritten. -->
  
  **What changes.** A detail's name is often unique only inside its master: two contracts can each carry an "Advance 30%" billing milestone. The import resolved a lookup cell across every record of the target, so a row naming contract B and "Advance 30%" failed with `reference_ambiguous`. A lookup cell is now resolved within the row's own master when either:
  
  - the lookup's target declares a `master_detail` field, and exactly one other single-value reference column of the row points at that master object and is filled in; or
  - the lookup field declares `dependsOn`, and the row fills in the sibling field it names (the string form compares the target field of the same name; `{ field, param }` compares `param`). This is the filter the record form's picker applies; the `master_detail` inference above has no counterpart in the picker, so for a lookup without `dependsOn` the import is stricter than the form.
  
  Inside that scope a tie is `reference_ambiguous`, and a name that only another master carries is `reference_not_found`; it never resolves to another master's record. The same holds for the match-key pass of an update or upsert import, so a key column naming a detail is grouped by the value the row's own pass resolves, for one level of master: a master column outside the key columns is resolved unscoped in that pass, so in a chain such as account → contract → milestone the two passes can differ.
  
  **What stays.** A row that leaves the master blank is resolved across the whole target as before, `reference_ambiguous` on a tie. Two columns of the row pointing at the master object (a bill-to and a ship-to account) do not say which one is the master, so neither scopes; `dependsOn` says it. A master cell that fails its own lookup scopes nothing. Every lookup still reads as the importing caller: the scope only adds conditions to the same read, so a record the caller cannot read never matches.
  
  **Field permissions.** Because the scope is part of the caller's own filter, a caller who cannot read the target's master field, or the field a `dependsOn` entry names as `param`, has every scoped candidate refused, and the cell answers `reference_not_found` even for a detail the caller can read and whose name is unique. The same row resolved before this change. It fails closed and discloses nothing.
  
  **Remedy for a narrowed row.** A pasted id is scoped too, so a row that means another master's detail has no way through in one import. Correct the master cell; or, when the cross-master link is intended, leave the master column out of the import and set it in a second update. For the field-permission case, grant the importing caller read access to that field, or leave the master column (or the `dependsOn` sibling) out in the same way.
  
  **Docs.** `content/docs/data-modeling/import-mappings.mdx` describes the scoping under cell coercion; the data skill's relationships rule names it under `master_detail`.
- 412fbf7: skills(objectstack-ui, query, automation): examples name the injected `owner_id` as the record owner, not an `assigned_to` / `assignee` field
  
  objectstack-data teaches that a request's owner, assignee, 负责人 or 处理人 is the platform's injected `owner_id`. The other skills still taught a separate `assigned_to` / `assignee` field as the owner, so an agent loading both got conflicting teaching. Now the objectstack-ui list-view columns, the "mine" filter, the kanban and gantt columns, the reassign action's param and the dashboard metric filter use `owner_id`. The column that relabelled `assigned_to` as "Owner" is gone. The "mine" filter links to objectstack-data § Relationship Patterns. The objectstack-query `expand` example and the objectstack-automation `notify` recipients do the same. Evals: objectstack-ui views evals 1 and 12 and objectstack-query eval 4 now expect `owner_id`. Views eval 2's reference answer no longer spells the `requiresObject` literal its own assertion forbids.
  
  Clause-②: no
  Metadata-protocol: none
- b4698f7: docs(skills): the automation skill says what a clashing flow function name really does: the later package installs, and none of its functions or hooks bind
  
  Clause-②: no
  Metadata-protocol: none
  
  Item 3 of "Valid-but-silently-wrong" in `objectstack-automation` said a second package holding a function name of the same namespace (or of none) is "refused at install". No install door judges a function. The hook binder's bind refuses it (`claimBareNameFunctions`), the runtime binder logs `Failed to bind declarative hooks` at `error`, and the package installs anyway with every function and hook of that owner unbound, the names that do not clash included. The skill now says that, keeps the remedy (rename, or another namespace), and splits the two moments it used to merge: a pair both held at boot warns `Bare-name conflict at boot`; a holder bound after the boot is the one left unbound. This corrects the "refused at install" sentence of the `32522-skills-automation-function-name-per-namespace` entry. To stay within the file's token budget, two restatements are shortened: the flow door's `400 FLOW_FAILED` answer (taught in `objectstack-api`) and the `outputVariable` explanation (shown by the example under it). No schema, accept set or behaviour changes.
- 5abcad0: docs(skills): four automation, query and ui evals spell their own `must_contain` literals in the reference answer
  
  Clause-②: no
  Metadata-protocol: none
  
  Four evals listed a `must_contain` literal that their own `expected_output` did not contain, so the reference answer failed its own grader and the eval could not tell a right answer from a wrong one. In each the literal is what the skill teaches and the reference answer named it in prose, so the reference answer now spells it: `objectstack-automation` `flows-triggers-approvals` case 20 writes the node as `type: 'subflow'`; `integrations-declared` case 2 writes the two `update_record` fields as `{ dialect: 'cel', source: … }` envelopes, as the Stripe recipe in `references/integration-recipes.md` does; `objectstack-query` `filters-pagination-search` case 2 says `keyset` in lower case; `objectstack-ui` `analytics-inline-vs-dataset` case 1 says each widget names the dataset in `dataset`. No assertion, prompt, schema or runtime change.
- 3be1347: docs(skills): the platform Driver Selection Guide says Memory and MongoDB may refuse a query capability SQL serves
  
  Clause-②: no
  Metadata-protocol: none
  
  `objectstack-platform`'s Driver Selection Guide now opens with one sentence: Memory and MongoDB may loudly refuse a query capability the SQL drivers serve. Query capabilities are built for the SQL drivers first, at their fastest shape, and no slower path is built only to keep the other drivers in step. To pay for the sentence, the same section drops the replaced lead "Drivers are the storage layer:", the SQL row's "Knex.js under the hood" aside, and the "no example app does" aside on keeping drivers out of `plugins:`. No schema or runtime change.
- 8b6c145: docs(skills): the data-hooks query example filters on the injected `owner_id`, not a hand-named `owner`
  
  Clause-②: no
  Metadata-protocol: none
  
  The `ctx.api.object(name)` query-shape example in objectstack-data's `references/data-hooks.md` now filters `task` on `{ owner_id: uid }`. The old `{ owner: uid }` named a field the object does not have unless an author hand-adds a second owner beside the injected one; on an object without it the query is refused with `400 INVALID_FILTER`. The objectstack-data eval about a required `user` field with `deleteBehavior: 'restrict'` now names that field `reviewer`, a role apart from the record owner, instead of an `owner` field that holds the ticket.
- b440ffb: The data-hooks reference names the two body doors, `ctx.email.send` (`email.send`) and `ctx.activity.append` (`activity.append`), in its sandbox `ctx` table and capability list. A hook body cannot send mail; mail on a record change goes through an action, a job or a flow. An activity entry's `type` is the app's own value, never a platform type, and the call stays outside `ctx.api.transaction`.
  
  Clause-②: no
  Metadata-protocol: none
- 81371e1: docs(skills): the automation skill says an email-template hole's `default:` argument is literal text, never a path (#32678); the administrator guide says an in-app message that reached nobody is refused 409/503 instead of confirmed (#32825).
  
  Clause-②: no
  Metadata-protocol: none

## 18.4.0

### Minor Changes

- d59a1eb: feat(spec): a `page:header` declares `placedActions: true`, the explicit opt-in to draw every action of the bound object placed at `record_header` / `record_more`, read live (#30018)
  
  Clause-②: yes (widening)
  Metadata-protocol: added
  
  - **`placedActions`** on a `page:header` component's `properties` (`PageHeaderProps`, the `ComponentPropsMap['page:header']` row): `true` asks the header to draw every action of the page's object whose `locations` include `record_header` or `record_more`, read live from the object's metadata, in place of an authored `actions` id list. An action another package places on the object is then drawn without editing the page. Optional with no default: an unset key stays unset in the parsed output.
  - **The `actions` list keeps its meaning.** An authored list is the whole set the header draws, and a header with neither `actions` nor `placedActions: true` draws none of the object's actions. `placedActions: false` beside a list is accepted and changes nothing.
  - **Refused together.** `placedActions: true` beside an authored `actions` list, an empty one included, is refused at `properties.placedActions` by `os validate`, `os build`, `os lint` and the page save door (`component-props-invalid`, an error). The message names both keys and asks the author to keep one: `actions` for a curated list that is the whole set, or `placedActions: true` for every placed action. Nothing that parsed before is refused: until this release `placedActions` was an unknown key on the closed shape.
  - **Declared ahead of its reader.** The console's header renderer does not read the key yet, so a header that sets it draws what the same header without it draws (none of the object's actions unless `actions` names them). The key's describe opens with `[PLANNED — not yet rendered]` until the renderer reads it.
  - The published JSON Schema `ui/PageHeaderProps` still accepts the pair: the rule depends on the value `true`, which no projected refinement pattern states, so the parse refuses it and `dropped-refinements.baseline.json` records the site.
  - `@objectstack/skills`: `objectstack-ui` `rules/pages.md` names the key in the component catalogue, marked not drawn yet, and drops a refused-shape clause from the print-page paragraph that the sentence before it already states.
- 45916c9: docs(skills): the data skill teaches a field rename through `renamedFrom`
  
  Clause-②: no
  Metadata-protocol: semantic
  
  `objectstack-data`'s schema-evolution table gives a field rename its own row (declare `renamedFrom: ['old_key']` on the new key; the sync carries the column's values), and its evals ask for one.

### Patch Changes

- 1c34fd7: docs(skills): an objectstack-data eval checks that a vendor field is relabelled with `fieldPatches`, never redeclared in `fields`
  
  Clause-②: no
  Metadata-protocol: none
  
  `skills/objectstack-data/evals/objects-fields-relationships.json` gains case 7: an author wants HotCRM's `crm_account.industry` to read "Sector" instead of "Industry". The accept set requires `fieldPatches` on a `defineObjectExtension` authored in `hotcrm.custom` (an option's label keyed by its stored value where the field declares its own options); it refuses `industry` redeclared in `fields`, which takes the field over and cuts it off from HotCRM's upgrades. No skill text changes.
- 7c1eeb1: docs(skills): the objectstack-data skill now leads a hook author to the save notice
  
  Clause-②: no
  Metadata-protocol: none
  
  The `objectstack-data` rule index described `rules/lifecycle.md` as retention-only, and `references/data-hooks.md` listed no `notice` member, so an author writing a save hook from this skill never found `ctx.notice(message)`. The index entry now names the save notice, and the sandbox `ctx.*` table and the `HookContext` listing each carry a `notice` row that points at `rules/lifecycle.md` § Save Notice. Growth is paid by same-file deletions of restated prose; both token-ratchet rows are re-locked down at the landed counts.
- bc9eaf6: docs(skills): the automation skill's OAuth recipe teaches the installer-supplied client
  
  Clause-②: no
  Metadata-protocol: none
  
  Recipe 6 of `objectstack-automation/references/integration-recipes.md` now shows `clientSource: 'installer'` beside a declared `clientId` + `credentialRef`, with when to use which: a declared client for an app its publisher deploys, the installer form for one installed on deployments the publisher never sees. The administrator registers a client with the vendor against the `redirectUri` the connection's status read answers, connects with `{ clientId, clientSecret }` (no secret for a public client; a reconnect naming no client keeps the stored one), and the connection reads back `client: { source: 'installer', clientId, hasSecret }`, never the secret.
- 0d40aa1: docs(skills): with no `searchableFields` declared, a field marked `searchable: true` joins the default search set
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** `objectstack-data`, `objectstack-query` and the `objectstack-ui` list-views rule taught the record-search auto-default as type-only: the name field plus the text-like and `select` columns. A field marked `searchable: true` was described as doing nothing, and a `$searchFields` override naming one as refused.
  - **Now.** Each says what the platform resolves: with no `searchableFields` declared, the set `search` scans, and the set a `$searchFields` override may name, is the type-based default plus every field marked `searchable: true`, of any type except `secret`, `password`, `vector` or a virtual `formula`. Each also says what does not change: `searchable: false`, the default, never removes a field the type default scans, and declaring `searchableFields` chooses the set. The enum half of the type default is spelled `select` alone, as the resolver has it.
  - No schema, key or behaviour changes.
- 89803c5: docs(skills): the platform skill teaches the `contributions` member of the package customizations read
  
  Clause-②: no
  Metadata-protocol: none
  
  `skills/objectstack-platform/SKILL.md` now names `contributions` beside the overrides, extensions and switched-off items that `GET /packages/<id>/customizations` lists: one entry per item another package adds to the base, stamped with its `packageId`; a `field` or `flow` entry names the base's `object` it is on, a `nav` entry names the base's `app`, its `group` when it targets one, and the item id as `name`; `counts.contributions` counts items, not packages. The text is paid for by deleting three restatements in the same file, so the token ceiling is unchanged.
- 322b6bf: docs(skills): objectstack-automation says a flow's record nodes treat a computed filter operand as a value, never as a query operator
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Now.** § Filter operands states the rule from the service-automation change: a computed operand is a string, number, bigint, boolean or date, or at an `$in` / `$nin` / `$between` comparand a list of them with no empty entry. Anything else fails the node as a guard before the query runs. The fix: make the expression evaluate to the compared value (for a record, its `id`), and write conditions in the filter itself. The table of failures a `fault` edge does not route now names that refusal beside the `null` operand.
  - `SKILL.md` stays under its token ceiling (no ceiling moves). No schema, key, command or behaviour changes.
- dd9add6: docs(skills): objectstack-platform says the D11 close refuses a package-less write only where the row moves as a declared override, and an added email-template locale keeps that write
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** The ADR-0146 customization paragraph said a pre-D11 unbound Setup row's package-less save, reset and rollback are refused once it is movable. That is false for a row of an email-template locale the base does not ship: `os migrate packageless-overlays` moves it as the pair's own member (`addedMember`, no `overrides`), and the close judges only the declared-override move, so that row's package-less write stays open before and after its move. The clause also left out publish, which the close refuses too.
  - **Now.** The clause says the close covers a row movable as a declared override, lists save, publish, reset and rollback, and says an email-template row at a locale the base does not ship moves as the pair's own member and keeps that write. The file stays at its token ceiling: a duplicate "CLI Commands" pointer section is cut, its home the Part 3 pointer to `references/operations.md`. No rule is removed; no schema or behaviour changes.
- 987ff33: docs(skills): teach that a save and `os validate` refuse `titleFormat`
  
  Clause-②: no
  Metadata-protocol: none
  
  - `objectstack-data` (object properties table) and `objectstack-formula` (template carriers) no longer call `titleFormat` deprecated: since #29499 the metadata save gate and `os validate` refuse an object that declares it (`title-format-retired`), and it moves to `nameField`. The formula skill drops the sentence that restated the template grammar cell beside it.
  - ADR-0079 D3 gains a dated amendment note citing ruling 6574393684 and #29499; the decision is unchanged.
- cde9a80: docs(skills): the automation skill teaches that an approval's decision outputs are enforced at the decision
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** `skills/objectstack-automation/references/state-machines-and-approvals.md` said only that a typed `decisionOutputs` entry renders the matching record picker in the decision dialog (`multiple` collects an id array). An agent writing an approval flow from it could read `type` and `multiple` as widget hints and not know that a value the next step cannot use is refused.
  - **Now.** The *Recording a decision* section says what the approvals service enforces, on approve and reject alike and before any write: a picker value must resolve through the `expression` approver's resolvers (`user` by any account's record id, `department` by record id in the request's organization, `team` by record id not owned by another organization, `position` by the machine name of a position someone in that organization holds); `multiple: true` takes a list of distinct values for every kind, bare keys included, and without it one value; any other non-blank value is refused with `400 VALIDATION_FAILED` naming `outputs.KEY`. The Console sends a list for a `multiple: true` text output. The existing `lead_review` node is the example. The file stays within its token ceiling (5724 of 5730).
- 3abe011: docs(skills): the automation skill's OAuth recipe names a stdio MCP server's credential route as `transport.credentialEnv`
  
  Clause-②: no
  Metadata-protocol: none
  
  Recipe 6 of `objectstack-automation/references/integration-recipes.md` said a `stdio` server's credentials ride `transport.env` — the literal-in-metadata route the `connector-credential-literal` advisory warns against. It now says what the `mcp` provider does: the grant-bearing kinds stay `http` only; a `stdio` server takes a static `auth: { type: 'bearer', credentialRef }`, handed to the child process in the variable `transport.credentialEnv` names, never a literal in `transport.env`. Paid inside the file's token ceiling by dropping the opening paragraph's restatement of two facts that keep their homes: the packaged spec (SKILL.md § Integrations are declared, not coded) and where an `api` hook's secret goes (SKILL.md's `secretRef` row and recipe 4). No eval asserted the old route; none changes.
- 6a4737a: docs(skills): objectstack-data teaches `relatedList` placement by each value's role, not by record-page tabs or columns
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** `rules/relationships.md` said `relatedList: 'primary'` draws "a full-width table in the details column after the first field section (in the Details tab, no tab of its own)" and that `true` / omitted is "a side card (the shared **Related** tab)". The spec's `relatedList` describe no longer names any tab or column, so the skill taught a page layout the record page does not draw.
  - **Now.** The three bullets follow the spec describe: `'primary'` is part of the record's main content, a full-width table in the record's detail body (still the default for an inline-edited `master_detail` FK); `false` means the child object is not shown on the parent record page; `true` or omitted is an auxiliary panel on the record page. Layout stays ADR-0085's to define.
  - The file gets smaller and stays under its token ceiling; no ceiling moves, no schema, key or behaviour changes.
- 7bafab3: docs(skills): `objectstack-ui` no longer says `page:header`'s `placedActions: true` is not drawn, and an eval exercises it (#29951)
  
  Clause-②: no
  Metadata-protocol: none
  
  - `rules/pages.md`: the component catalogue's `page:header` row says `placedActions: true` draws every placed action, read live. The console's header renderer reads the key since #29951's ui half, so the "not drawn yet" qualifier #30018 wrote is dropped.
  - `evals/record-page.json`: a third case asks for a custom full record page whose header shows every action packages place on the object; the expected answer keeps the page and its tab strip and sets `placedActions: true` on the `page:header` node, with no `actions` id list beside it.
- b83e1d0: test(skills): the platform skill's evals ask for push notifications on an `os serve` deployment
  
  Clause-②: no
  Metadata-protocol: none
  
  `skills/objectstack-platform/evals/config-plugins-ops.json` gains case 12: the prompt asks to turn on push notifications for an `os serve` deployment, and the expected answer declares `requires: ['push']` with a top-level `push:` key on the stack definition and writes no secret inline (the APNs signing key and the Firebase service-account JSON are named by reference). The assertions stay with what `objectstack-platform/SKILL.md` teaches today, the `push` token and the top-level key; the push block's transport and vendor shape are not asserted until the skill teaches them.
- 0ce44c9: docs(skills): the i18n skill lists a lookup or master-detail field's translatable `relatedListTitle`
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** The `objectstack-i18n` object-level table listed `label`, `help`, `placeholder`, `options` and `inlineTitle` under `fields.{field_name}`, so an author had no word that the related-list title on a parent's record page is translatable.
  - **Now.** The row adds `relatedListTitle`: the title of the related list a `lookup` or `master_detail` field draws on its parent's record page. The key sits on the child object's field, and an untranslated title keeps its authored text, never the child's label.
  - The paragraph under *Diff & Coverage Schemas* saying `getCoverage()` / `suggestTranslations()` have no shipped implementation is cut; *Service Contract* in the same file says the same, and the section's opening sentence now names the two schemas as those methods' return shapes. No schema, key or behaviour changes.
- f9e5bef: feat(trigger-api): an `api` hook verifies the vendor signature its start node declares (`config.signature`)
  
  Clause-②: yes (widening)
  Metadata-protocol: none
  
  - **`@objectstack/trigger-api`.** `start()` reads the hook's one verifier with `apiTriggerVerifierOf(binding.config)` (`@objectstack/spec/automation`). A start node that declares its sender's scheme (`config.signature`: DocuSign Connect's base64 `X-DocuSign-Signature-1`, a Stripe-style `t=…,v1=…`, a GitHub-style `sha256=`) now admits a correctly signed post that was answered `401` before. That scheme REPLACES the `x-objectstack-signature` check for its hook: the declared header is read on both faces of the door (the self-hosted mount and `handleInboundHook`) with `Headers.get`, so a repeated field is its one joined value; the HMAC-SHA256 is computed under the key `config.secretRef` names (read at every post through the engine's reader, `503` while it has no value), over the raw body or `<t>.<raw body>`; each digest is decoded strictly to 32 bytes and compared with `timingSafeEqual`, any one of several `v1` elements matching (a key roll); and a timestamped scheme is held to `HTTP_SIGNATURE_TOLERANCE_SECONDS` from `@objectstack/core`. A body-only scheme has no replay window, as the contract states. A valid `x-objectstack-signature` admits nothing on such a hook, and a post without the declared header is refused. A declaration the spec answers `unusable` arms a hook that refuses every post before any secret is read and never falls back to `x-objectstack-signature`; a declared scheme bound without the engine's `config.secretRef` reader is refused at `start()`. Every failure is the same `401 INVALID_SIGNATURE` with its own cause in the server log (`declared-header-absent`, `declared-header-malformed`, `declared-prefix-missing`, `declared-no-digest`, `declared-mismatch`, `declared-outside-window`, `declared-unusable`), never the key, the header value or the body. A hook that declares no scheme is verified exactly as before.
  - **`@objectstack/lint`.** `validateFlowApiTriggerSecret` grades an `api` hook by that same reader: a usable declaration is ready on its `config.secretRef` alone, and an unusable one is the new error `flow-api-trigger-signature-unusable` (with its `os explain` entry), located at the key the spec refuses. It fires only on a declaration the flow parse already refuses, so no stack that passed before is refused now.
  - **`@objectstack/skills`.** The automation and api skills teach `config.signature` where they said a vendor-signed callback cannot be admitted.
- 07595c0: docs(skills): the `page:header` title row drops the retired `breadcrumb` and names the live `placedActions: true`
  
  Clause-②: no
  Metadata-protocol: none
  
  - `skills/objectui/guides/page-builder.md`: the `page:header` sentence named `breadcrumb` among the title row's keys. `PageHeaderProps.breadcrumb` is a `retiredKey` tombstone since @objectstack/spec 17 (ADR-0087 D2), and the props lint refuses an authored one. The row now lists `title`, `subtitle`, `actions` or `placedActions: true`; the last two are refused together.
- 1f92c72: docs(skills): objectstack-platform teaches the stack's `push` block in `references/operations.md` (Mobile push): `transport: 'direct'` with `apns` / `fcm` blocks is the transport served today, each secret is named by `credentialRef` and never written inline, and the hosted relay (also what `{}` reads as) is refused at boot until its sender ships; the `requires` table points `push` at it, and the push eval case asserts the shape
  
  Clause-②: no
  Metadata-protocol: none
- 0e42aef: docs(skills): the platform skill names every type a pair's declared override is served for, and that removing the pair's item serves the base's again
  
  Clause-②: no
  Metadata-protocol: none
  
  `skills/objectstack-platform/SKILL.md`, the "Customizing an installed package (ADR-0146)" paragraph: a `.custom` pair's declared override is served for a view, dashboard, report, email_template, translation, flow, page, app, dataset, doc, book or mapping (the paragraph named six), and removing the pair's item (`DELETE …?package=hotcrm.custom`) serves the base's document again (ADR-0146's revert, which the paragraph did not say). The package's evals gain a dataset-and-page override case and a removal case.
- 83fc231: docs(skills): a `notify` node that writes no link opens the record that started the run
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** The `objectstack-automation` skill's `notify` example commented its click-through keys as "a PAIR, else dropped", so a record-triggered flow's notification looked like it linked nowhere unless the author wrote `sourceObject` + `sourceId: record.id`.
  - **Now.** The example says what the runtime does: a node that writes none of `sourceObject`, `sourceId` and `actionUrl` links to the run's trigger record when it has one (a record change other than a delete, a time-relative sweep's row, an action started on a record). An explicit pair or `actionUrl` wins; half a pair is still dropped; a run with no trigger record links nowhere. A new eval asks for a record-triggered notification that opens its record and expects no source keys written.
  - No schema, key or behaviour changes.
- 43ae284: docs(skills): `objectstack-platform`'s plugin-development reference no longer teaches the removed `feature_flags` settings namespace
  
  Clause-②: no
  Metadata-protocol: none
  
  The "Feature Flags" section listed a `feature_flags` settings manifest with `ai_enabled` / `beta_*` toggles and `OS_FEATURE_FLAGS_*` env overrides. That namespace was removed from `@objectstack/service-settings` (reading it is refused with `SETTINGS_UNKNOWN_NAMESPACE`, and the env vars do nothing). The bullet now gives the live answer: a plugin that needs an org toggle declares its own `SettingsManifest` and registers it on the `settings` service.
- 4cfb351: docs(skills): an object extension that renames `label` without `pluralLabel` clears the base plural
  
  Clause-②: no
  Metadata-protocol: none
  
  `objectstack-data` § Object Extension Model still says an extension can add but never remove, and now names the one exception the object fold has: an extension that sets a new `label` and no `pluralLabel` takes the base's `pluralLabel` off the served object unless a tenant authored that plural, so an author who renames an object sets both to keep a plural. An extension that repeats the label it extends removes nothing. The Lifecycle Hooks pointer line drops its second link to `references/data-hooks.md`, which the catalog list and the backfill paragraph already link. No schema, key or behaviour changes.
- 6a983a1: docs(skills): the platform skill teaches the declared action override and its access-widening refusal
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** `objectstack-platform`'s customization paragraph (ADR-0146) listed the types a `.custom` pair's declared override is honoured for without `action`, and `content/docs/concepts/metadata-lifecycle.mdx` said an `action` override was not served yet. Both have been false since `action` opened (ADR-0146 D9).
  - **Now.** The skill lists `action` and says what an action override may change: it keeps the base's `objectName` (the doors match the base's action as `OBJECT:NAME`, and moving it to another object is refused `declared_package_ships_no_such_item`), and it replaces the behaviour (`type`, `body`, `label`, `visible`, …) whole for whoever could already run the base. Dropping a `requiredPermissions` entry, turning `ai.exposed` on or `ai.requiresConfirmation` off is refused `403 NOT_OVERRIDABLE` with rule `declared_action_widens_access`. The docs page says the same, and the skill's evals gain a case for it.
  - No schema, key or behaviour changes.
- a4c3246: docs(skills): teach an action param's `widget` key in the action dialog
  
  Clause-②: no
  Metadata-protocol: none
  
  - `objectui` (`rules/protocol.md`, inline params): the widget-config list gains `widget`. It names a registered field widget that draws the param instead of its `type` widget (`'permission-ref'` on a `text` param is the permission-set picker); an unregistered name keeps the `type` widget, and the selection bar's bulk dialog does not read it. The server still validates the submitted value by `type`.
  - `objectstack-ui` (`rules/actions.md`, field-backed params): a field-backed param inherits the field's `widget` only while it keeps the field's `type` or restates it; a param that overrides `type` names its own `widget`.
  - Paid inside the token ceilings by removing restatements in the same files. No schema, key or behaviour changes.
- 6b2129f: docs(skills): the objectui project-setup guide names where uploads live now that `@object-ui/providers` is gone
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** `objectui/guides/project-setup.md` sent a third-party app to `@object-ui/providers` for `UploadProvider` / `useUpload`, in the provider-stack list and in the decision matrix. That package is retired and gets no further release.
  - **Now.** `UploadProvider` / `useUpload` come from `@object-ui/fields`; the ObjectStack storage adapter `createObjectStackUploadAdapter` comes from `@object-ui/data-objectstack`; the `UploadAdapter` / `UploadOptions` / `UploadResult` contract is `@object-ui/types`'s, re-exported by `@object-ui/fields`.
  - The troubleshooting section drops two monorepo-only tips (the Turbo cache block and the "downstream packages need built `dist/`" line), which a third-party app consuming published packages never needs.
  - No schema, key or behaviour changes.
- 254f2ec: docs(skills): objectstack-i18n teaches the five-step locale ladder that `resolveLocaleAmong` runs (exact, case-insensitive, same platform-table language, base language, first registered variant), so a `zh-TW` request is taught to reach a registered `zh-Hant` bundle rather than the first `zh-*` one
  
  Clause-②: no
  Metadata-protocol: none
- af1d59b: docs(skills): objectstack-api's Metadata API section teaches the `/meta/:type` list door's `?names=a,b,c` filter (one comma-separated value; an unknown name absent, an empty value refused `400`, the `package` list refuses the key) and its closed query set (`package`, `preview`, `object`, `include`, `id`, `names`, `locale`; any other key `400 VALIDATION_ERROR`)
  
  Clause-②: no
  Metadata-protocol: none
- dfa179a: docs(skills): the automation skill teaches the mail `option` formatter for a notice's select label, and that a user target owns a row only while an active member
  
  Clause-②: no
  Metadata-protocol: none
  
  Two lines in `objectstack-automation/SKILL.md`, each following a platform change that landed before it. In the `notify` section: an option label in a notice is written in the mail `template` as `{{ stage | option:opportunity.stage }}`, which prints the label in each recipient's language and is mail-only (refused in an inline `title` / `message`) — never `label()` in `templateData`, which is evaluated once per run, before recipients fan out. In "Assignment rules": `assignTo: { type: 'user', value: '<id>' }` names an owner who holds the row only while an active member of its organization, else the row is written ownerless. Eval 15 of `evals/flows-triggers-approvals.json` grades the notice case. The docs page `automation/queues-and-assignment-rules` gains the organization-authored `sys_assignment_rule` rules beside the declared ones: evaluated first, by `sort_order` then name, first match wins, a failed read of the organization's rules routes nothing, and the active-member rule for a `user` target. Paid inside the skill by deleting the CRM Automation Blueprint section (the `src/flows` layout objectstack-platform's bootstrap reference carries) and two restatements.
- 8ddb6b7: docs(skills): the `objectstack-data` record-currency backfill hint names `--org` and `--all-organizations`
  
  Clause-②: no
  Metadata-protocol: none
  
  `skills/objectstack-data/rules/field-types.md` pointed an agent that switched a stored currency field to `'record'` at `os migrate record-currency-codes` with no flag. Since #30737 that command fills one organization's rows with `--org ID`, writes the one code into every organization only with `--all-organizations`, and refuses a run with neither on a database whose rows belong to more than one organization. The hint now says so. To stay inside the file's token ceiling, a sentence in the autonumber delimiter rule that restated the rule's own heading is removed.
- 3479c33: docs(automation): the notify click-through default says a before-create run links to its record only when the caller wrote the id
  
  Clause-②: no
  Metadata-protocol: none
  
  A `notify` node that writes none of `sourceObject`, `sourceId` and `actionUrl` links to the run's trigger record when the run has one. Four texts enumerated that run as "a record change other than a delete", which includes a before-create run (`record-before-create`, or the insert leg of `record-before-write`). On that run the record is the write's input, and the driver issues the id at the write, after the hook, so the input carries an id only when the caller wrote one; with no id the notification links nowhere. The runtime is unchanged. The texts now say "a record change other than a delete or a before-create", and that a before-create run links only when the caller wrote the id:
  
  - the `NotifyConfigSchema` docblock and the `sourceObject` / `sourceId` descriptions in `@objectstack/spec`, and the reference page generated from them;
  - the `notify` node's docblock and config descriptions in `@objectstack/service-automation`, which is the wording source;
  - the Flows guide and the automation skill's `notify` example.
  
  The same texts said that a `sourceId` evaluating to `null` "leaves the key unset". It is a written key: the node then writes a half pair, which is dropped rather than defaulted to the trigger record. The node's failure text, the guide and the schema say so.
  
  A test pins that a notify on a `beforeInsert` run whose record carries no id writes no `source_object` / `source_id`, and that one whose caller wrote the id links to it. No key, shape, default or refinement changes.
- 1120389: docs(skills): objectstack-platform's `references/operations.md` spells `os package install`'s server flag `-u/--url` (in place of the removed `-r/--runtime`) and names the new `-t/--token` (env `OS_RUNTIME_TOKEN`) beside `--email/--password` as the target runtime's credential, matching the CLI
  
  Clause-②: no
  Metadata-protocol: none
- 0e73de8: docs(skills): the authoring skills teach one naming rule, every metadata name a package authors starts with its namespace
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** `objectstack-platform` stated the prefix rule for objects only, and claimed `os lint` warns on bare app, page, dashboard, flow, action, report and dataset names whenever a namespace is set. The examples across the skills named flows, actions, hooks, pages, dashboards, reports, datasets, queues, positions, permission sets, assignment rules, agents and skills bare (`lead_conversion`, `sales_rep`, `support_intake`).
  - **Now.** `objectstack-platform` states the rule once, beside the object rule: every metadata name a package authors starts with its namespace (`crm_send_email`, `crm_sales_rep`). The exceptions are fields, object extensions, container views and translations (`<ns>_<locale>`). It also says what is enforced today: `defineStack` refuses a bare object name, `os build` refuses a bare doc name, and `os lint`'s `naming/namespace-prefix` warns only on a name one package declares twice. Every example and eval that showed or generated a bare non-object name now carries `crm_` (or its package's namespace where the snippet has one), cross-references included.
  - Connector ids, the inbound api flow whose name is part of its webhook URL, and the datasource whose name keys its password variable keep their names. No schema, key or behaviour changes.
- 253eab0: docs(skills): the data skill's Field Groups section teaches a group's `visibleWhen` and `requiresFeature`
  
  Clause-②: no
  Metadata-protocol: none
  
  `skills/objectstack-data/references/examples-objects.md` now names the two ways a whole field group (header included) is hidden: `visibleWhen`, a CEL predicate over the record that hides the group when FALSE or when it faults, and `requiresFeature`, a deployment feature flag from the `PUBLIC_AUTH_FEATURES` set, refused when unknown, lowered at parse into the group's `visibleWhen` and stripped, AND-combined after an authored `visibleWhen`; both are presentation only. The real example is `sys_organization`'s Group Structure section, hidden on a single-organization deployment with `requiresFeature: 'multiOrgEnabled'`. The text is paid for by deleting restatements in the same file (the intro sentence, the migrations paragraph, the deprecated-flag aside, the strictness sentence under Metadata Protection, a dangling "see above" and a path comment), so the file's token ceiling moves down, not up.
- 95ba410: docs(skills): the `objectstack-data` field-types formula row says a formula is no dataset or cube dimension (group key) either
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** The `formula` row of `skills/objectstack-data/rules/field-types.md` said a formula is virtual and not aggregatable, and that a dataset measure needs a stored field. It said nothing about grouping by one, so an AI author reading the row had nothing telling it not to declare a dataset or `analyticsCubes` dimension over a formula.
  - **Now.** The row says a formula is neither aggregatable nor a dataset or cube dimension (group key), and that both need a stored field — what the platform refuses today: the authoring rule `dimension-virtual-field-refused`, the dataset compile's `400 DATASET_INVALID`, and every analytics query grouping by one, `400 INVALID_FIELD`.
  - `skills/objectstack-ui/rules/dashboards.md` (Dataset-Bound Widgets, the row's pointer): the multi-value breakdown bullet now names a `formula` beside the multi-value types as refused for a dataset or cube dimension and `groupBy`, so the reader lands on the dimension refusal too.
  - No schema, key or behaviour changes; the skill text only states refusals that already ship.
- 630a0ba: Clause-②: no
  Metadata-protocol: none
  
  `objectstack-api` now teaches the recycle bin's doors as they shipped: a by-id
  delete answers `recycleBinEntryId`; `POST /api/v1/data/{object}/recycle-bin/:entryId/restore`
  restores one entry (`allowRestoreOwnDeleted` for the caller's own deletes,
  `manageRecycleBin` for anyone else's); `GET` lists, `DELETE …/:entryId` purges
  and `DELETE …/recycle-bin` empties (all `manageRecycleBin`); a refused restore
  answers `409` with one of the four `RESTORE_*` codes. `restore` / `purge` are
  taught as derived from `delete` instead of "never derive". The api skill's
  "undelete invoices" eval grades the new teaching.
- d0ebb8f: Clause-②: no
  Metadata-protocol: none
  
  The platform skill's operations reference now says what the official image does on `main`: it refuses to start unless `OS_DATABASE_URL`, `OS_AUTH_SECRET` and `OS_SECRET_KEY` are set at runtime (an explicit `file:` URL on a mounted volume passes), and a Common ops pitfalls row tells an upgrade to keep the values an old container generated (`auth-secret`, `dev-crypto-key`, `data/objectstack.db` under `/home/node/.objectstack`) rather than set fresh ones, which would leave every saved credential unreadable.
- dc3adf3: docs(skills): the `objectstack-ai` skill's MCP tools table now teaches that `delete_record` needs `confirm: true` — a call without it is refused with `ACTION_CONFIRMATION_REQUIRED` (428), so the agent asks the human first, then retries. The row said only that `delete_record` is annotated destructive, so an agent following it was refused since the MCP tool started requiring confirmation.
  
  Clause-②: no
  Metadata-protocol: none
- cef3b8f: docs(skills): three skills describe a bare field ref in a predicate as the fault it is today, not a silent `null`
  
  Clause-②: no
  Metadata-protocol: none
  
  `objectstack-platform/references/operations.md`, `objectstack-data` and `objectstack-ui` said a bare field ref (`done` instead of `record.done`) "evaluates to `null`" and silently hides or never fires. It faults. On the server an `error` validation rule and a `requiredWhen` refuse the write and name the rule, an option `visibleWhen` refuses only a write that picks that option (forms still offer it), a `readonlyWhen` field stays editable on the form while the server drops the change with a warning and the save succeeds, and a formula reads `null` with a logged warning. In the console an action's `visible` hides it, its `disabled` greys it out, and a field `visibleWhen` shows the field, each with a console warning. The data skill no longer lists RLS / sharing predicates here: their compiler reads a bare name as the column. The prevention advice (`os validate` / `os build`, `record.<field>`) is unchanged. Growth is paid by same-file deletions of restated prose.
- 33bc8ae: docs(skills): the `fieldPatches` example relabels HotCRM's `industry` and patches options only on a field that declares its own
  
  Clause-②: no
  Metadata-protocol: none
  
  The `objectstack-data` skill's one `fieldPatches` example patched an option of `crm_account.industry`. HotCRM binds that field to the shared `industry` picklist, so a verbatim copy was refused at install and by `os validate` (`picklist-option`). The example now sets `industry`'s `label` only and patches an option of `type`, which declares its own `options` (`customer` → `Client`). The added bytes are paid by deleting a restatement in the same file: the `.custom` paragraph's closing clause "a base field changes only through `fieldPatches`", whose facts the relabel paragraph above it already states. No token ceiling moves. No schema, key or behaviour changes.
- dbf5c8d: docs(skills): more of objectstack-automation's self-contained examples are type-checked by `check:skill-examples`
  
  Clause-②: no
  Metadata-protocol: none
  
  Six more fenced TypeScript blocks in `skills/objectstack-automation/` carry the opt-in check marker, so 9 of its 19 are now compiled against the spec. In `SKILL.md` the `notify` node is typed `FlowNode` (`@objectstack/spec/automation`). In `references/examples-flows.md` the time-relative sweep is wrapped in `defineFlow`. In `references/state-machines-and-approvals.md` the `state_machine` rule is typed `StateMachineValidation` (`@objectstack/spec/data`) and the discount approval flow is wrapped in `defineFlow` with `cel` imported. In `references/integration-recipes.md` recipes 4 and 5 import `defineFlow` / `defineConnector` from `@objectstack/spec`. No example was wrong. Of the ten left unmarked, the trigger start node in `SKILL.md` and recipes 1 to 3 in `references/integration-recipes.md` compile with a wrapper but do not fit their file's token ceiling; the rest are fragments, or, for two `SKILL.md` blocks, fences indented inside a list item, which the check does not read. The marks are paid inside each file by removing restatements whose rule lives on elsewhere in the skill; every cross-reference stays, and no rule's teaching changes.
- 09df571: docs(skills): more of objectstack-data's self-contained examples are type-checked by `check:skill-examples`, and the `Field.*` factory example imports from the subpath that exports it
  
  Clause-②: no
  Metadata-protocol: none
  
  Fourteen more fenced TypeScript blocks in `skills/objectstack-data` carry the opt-in check marker, so 25 of its 95 are now compiled against the spec: 8 of 10 in `rules/indexing.md` (index lists typed as `ObjectIndex[]` from `@objectstack/spec/data`), 4 more in `references/data-hooks.md` (the full `defineHook` definition and three pattern hooks, which gain their `defineHook` import), and one each in `rules/lifecycle.md` and `rules/field-types.md`. One example was wrong: `rules/field-types.md` imported `Field` from `@objectstack/spec`, which does not export it (the spec root has no namespace exports); it now imports from `@objectstack/spec/data`, and the prose no longer names the root. The ✅ script example in `rules/validation.md` gains the `name` every validation rule requires. The rest stay unmarked: fragments, shapes, ❌ examples, and the blocks whose file had no token headroom left to pay for a wrapper. No rule's teaching changes.
- 24213a9: docs(skills): objectstack-data and objectstack-upgrade SKILL.md replace their "moved verbatim" stubs with index entries
  
  Clause-②: no
  Metadata-protocol: none
  
  `skills/objectstack-data/SKILL.md` and `skills/objectstack-upgrade/SKILL.md` still carried eight "→ Moved verbatim to …" lines left by the split that moved worked examples into `references/`, and the runs of `---` around them. Each line said where a section went and linked only the top of the file. In objectstack-data, four of them are now entries in § Quick Reference, with a fragment where the target is a section: Quick-Start Template, Metadata Protection, Seed Data & Fixtures, and Linting & Generation Quality. The Lifecycle Hooks stub is gone, because the index already has a Lifecycle Hooks entry pointing to `references/data-hooks.md`. In objectstack-upgrade, the three stubs are one-line entries in place, linking §2.3 (the worked R1), §3.4 (the report template) and the v17-canonical shapes block by their headings. The orphaned `---` lines are removed. No rule's teaching changes.
- bda38ab: docs(skills): more of objectstack-formula's self-contained examples are type-checked by `check:skill-examples`
  
  Clause-②: no
  Metadata-protocol: none
  
  Five more fenced TypeScript blocks in `skills/objectstack-formula/SKILL.md` carry the opt-in check marker, so 6 of its 9 are now compiled against the spec: the coalesced text formula and the guarded divisor gain `import { F }`, the dynamic seed values gain `import { cel }` and a `const`, and both `previous`-transition predicates gain `import { P }`, all from `@objectstack/spec`. No example was wrong. The three ❌ blocks stay unmarked on purpose, and the file now says so once. The marks are paid inside the file by removing restatements: the intro's "canonical reference" sentence (the frontmatter description says it), the ISCHANGED sentence (the translation table's `ISCHANGED(x)` row says it), and the list of field rule keys before `conditionalRequired` (the Surfaces table's `Field` row lists them). No rule's teaching changes.
- b369596: docs(skills): objectstack-platform's manifest example is type-checked, and the plugin-development examples compile against the kernel's Plugin contract
  
  Clause-②: no
  Metadata-protocol: none
  
  `skills/objectstack-platform/SKILL.md` § Manifest Reference showed a bare `manifest: { … }` fragment. It is now a `defineStack({ manifest: { … } })` call under the opt-in check marker, so `check:skill-examples` compiles it against `@objectstack/spec`. The comment on `engines` that restated the paragraph below it is gone, and `description` is still marked optional. In `references/plugin-development.md`, the complete audit-plugin example set `type: 'plugin'` on a kernel plugin object. That value is outside the closed `PluginType` set (`'standard'` plus the core plugin types), so it does not compile, and `kernel.use()` refuses it at boot with `PLUGIN_CONTRACT_VIOLATION`. The example now sets `type: 'standard'`. The Plugin Interface overview imported the `Plugin` it then declares, and used `PluginType` without importing it. It now imports `PluginContext` and `PluginType`. No other rule changes. The other platform blocks in these four files stay unmarked. Each one needs `@objectstack/core`, a runtime package or a project-local module, or it is a fragment, and the checker resolves `@objectstack/spec` only.
- a923d47: docs(skills): the Plugin Interface overview in objectstack-platform's plugin-lifecycle rule imports what it uses
  
  Clause-②: no
  Metadata-protocol: none
  
  `skills/objectstack-platform/rules/plugin-lifecycle.md` § Plugin Interface imported the `Plugin` type it then declares, and used `PluginType` without importing it. It now imports `PluginContext` and `PluginType` from `@objectstack/core`, the same shape as the overview in `references/plugin-development.md`. No rule changes. The other blocks in the two platform rules files stay unmarked: each needs `@objectstack/core` or a project-local name, or is a fragment, and the example checker resolves `@objectstack/spec` only.
- 45f5712: docs(skills): objectstack-platform service-registry examples now call the service contracts they use
  
  Clause-②: no
  Metadata-protocol: none
  
  `skills/objectstack-platform/rules/service-registry.md` had two examples that typed a service by its contract and then called a method the contract refuses. Basic Usage read the `objectql` service as `IDataEngine` and called `db.object('account').find()`, which `IDataEngine` does not declare; it now calls the engine's own `db.find('account')`. Optional Services read `realtime` as `IRealtimeService` and called `publish('my-event', data)` with two arguments, where `publish` takes one `RealtimeEventPayload`; it now awaits `publish({ type, payload, timestamp })` with the payload's three required keys. The ❌/✅ pair under "No Error Handling for Optional Service" made the same two-argument `publish` call and now passes the same one-payload shape; the pair still teaches the try/catch. The API section's intro now counts the four methods its block lists. No rule's teaching changes. None of the 40 fenced TypeScript blocks in `rules/plugin-lifecycle.md`, `rules/service-registry.md` and `references/plugin-hooks.md` carries the opt-in check marker, before or after: every one needs `@objectstack/core` (the runtime `PluginContext`, `Plugin` or kernel), which `check:skill-examples` cannot resolve because it compiles against `@objectstack/spec` only.
- e516cf2: docs(skills): objectstack-query's self-contained examples are now type-checked by `check:skill-examples`
  
  Clause-②: no
  Metadata-protocol: none
  
  Twenty of the forty-two fenced TypeScript blocks in `skills/objectstack-query` carry the opt-in check marker: 8 of 14 in `SKILL.md`, 8 of 11 in `rules/aggregation.md`, 4 of 10 in `rules/pagination.md`. Engine calls gain a two-line `IDataEngine` declaration from `@objectstack/spec/contracts`, and standalone query literals are typed as `QueryInput` from `@objectstack/spec/data`, so a renamed key, a removed key (`cursor`, `array_agg`) or an unknown option now fails the gate instead of shipping. Every marked example compiled as written; none needed a correction. The rest are left unmarked and each file says so once: the bare `{ where: … }` option fragments in `SKILL.md`, all seven `where` fragments in `rules/filters.md`, and the ❌/✅ pairs whose ❌ half is wrong on purpose. No rule's teaching changes.
- 3d744f1: docs(skills): the `conditionalRequired` → `requiredWhen` rule and the flow `runAs` rule for `readonly` fields each keep one home
  
  Clause-②: no
  Metadata-protocol: none
  
  The removed `conditionalRequired` alias was stated in three skills. `objectstack-data` § Conditional Field Rules keeps it. `objectstack-formula` § 3 Predicate drops its copy for a one-line link to that section, and `objectstack-ui` § Field Conditional Rules in Forms drops its copy and turns its existing plain-text pointer to the same section into a real link. The rule that a flow maintaining a `readonly` field runs `runAs: 'system'`, and that `os validate` / `os build` fail a `runAs: 'user'` `update_record` writing one, was stated in `objectstack-data` and `objectstack-automation`. `objectstack-automation` § Failure routing & `runAs` keeps it, and the `readonly` bullet in `objectstack-data` now links there. The data bullet keeps what only it says: REST/UI writes are stripped too, system hooks, seeds, imports and migrations are exempt, and the field stays `readonly` when automation maintains it. No rule's teaching changes.
- 5d8e559: docs(skills): more of objectstack-ui's self-contained examples are type-checked by `check:skill-examples`
  
  Clause-②: no
  Metadata-protocol: none
  
  Ten more fenced TypeScript blocks in `skills/objectstack-ui` carry the opt-in check marker, so 25 of its 33 are now compiled against the spec: the new-tab `defineAction` in `rules/actions.md` and the `kind: 'html'` page in `rules/pages.md` gain their import; the styled pricing card and the doc navigation item in `rules/pages.md` are typed as `PageComponent` and `NavigationItem[]`; four widget examples in `rules/dashboards.md` are typed as `DashboardWidget` (or its `options`); and the kanban and gantt examples in `rules/list-views.md` are typed as `ListView`, all from `@objectstack/spec/ui`. No example was wrong. The rest stay unmarked: bare-key fragments, the blocks whose file had no token headroom left for a wrapper, and the `SKILL.md` subform example, whose fence is indented inside a list item where the gate does not read it. No rule's teaching changes.
- 4941c40: docs(skills): the operations reference's `os generate <kind>` row names every kind the CLI scaffolds
  
  Clause-②: no
  Metadata-protocol: none
  
  `skills/objectstack-platform/references/operations.md`: the `os generate <kind>` row listed four kinds in prose ("an object / view / flow / skill"); it now lists all ten `GENERATORS` keys (`object` `view` `action` `flow` `dashboard` `app` `skill` `picklist` `permission` `dataset`). The liveness gate now holds that row exhaustive against `GENERATORS` minus `RETIRED_GENERATORS`, so a new generator without a row, or a retired one (`agent`, `schema`) listed again, reds. Two restating clauses in the same file's port table ("so several example apps run side-by-side", "It never silently drifts") were deleted to pay the token ratchet for the longer row.
- 383c353: docs(skills): objectstack-automation carries the flow-authoring judgment the hosted build agent learned — option values in conditions and writes, a named hour with its time zone, who an approval-outcome cascade runs as
  
  Clause-②: no
  Metadata-protocol: none
  
  Card 1 of the cloud#3659 ruling A split, the `objectstack-automation` port — the judgment the schema cannot express and the published skill did not yet state. `SKILL.md` § Valid-but-silently-wrong: a `select` is compared and written by its option `value`, never the label the request speaks, in the start `condition` and every `fields` / `filter` entry. `references/examples-flows.md`: a wall-clock hour the request names is written as said with its IANA `timezone` on the start node's `config.schedule`, never converted to UTC by hand (a bare expression runs in UTC and records no zone); the schedule example carries one. `references/state-machines-and-approvals.md`: a flow reacting to the mirrored `approvalStatusField` runs as the person who acted and stays `runAs: 'user'`; only the SLA auto-decision and the dead-run release carry no user, so a flow that must react to those declares `runAs: 'system'` — the hosted corpus's blanket "declare system" is corrected against the approval service on `main`. The same file's three Chinese glosses are gone: the shipped skill text is English-only. Three eval cases pin the teachings (flows-triggers-approvals 17–19).
- 0e13561: docs(skills): objectstack-data carries the metadata-authoring judgment the hosted build agent learned — booleans, people fields, dynamic defaults, process modelling, roll-up qualifiers, seed values, labels, sharing posture
  
  Clause-②: no
  Metadata-protocol: none
  
  Card 1 of the cloud#3659 ruling A split: one source of metadata-authoring knowledge for every build channel. This is the `objectstack-data` port — the judgment the schema cannot express and the published skill did not yet state. `SKILL.md`: a yes/no flag is `{ type: 'boolean', defaultValue: false }` and never `required` ("must be accepted" is a validation rule); a person on the record is `type: 'user'`, optional unless asked; a dynamic default resolves on save and is described as such; record status is a `select` with a `state_machine`, never a status table; approvals, routing and audit trails are not objects; the record owner is the platform `owner_id`, never a hand-added lookup, and `ownership: 'none'` is only for catalogs and junctions; the `sharingModel` posture is chosen from the request; a `state_machine` declares `initialStates` whenever the status has a real start. `rules/relationships.md`: pick the roll-up function from the words, put every qualifier in `summaryOperations.filter` (dropped, it is a plausible wrong total), a rate is a formula over a working summary, and the recompute runs only on a child write — a summary declared after its rows exist is backfilled by `os migrate summary-nulls --apply`; its examples take the posture the paragraph teaches. `rules/validation.md`: the canonical `state_machine` example declares `initialStates`. `rules/naming.md`: labels follow the user's language. `references/seeds.md`: seed values may be fictional, never malformed — `os validate` / `os build` refuse a malformed one first. Eight eval cases pin the teachings (objects-fields-relationships 10–14, hooks-security-seeds-datasources 14–16).
- a61ddc9: docs(skills): objectstack-ui carries the view and action judgment the hosted build agent learned — a view added beside the list, the empty board over a just-added group field, an operation is an action whose body writes, the view kind the request names
  
  Clause-②: no
  Metadata-protocol: none
  
  Card 1 of the cloud#3659 ruling A split, the `objectstack-ui` port (the last of three) — the judgment the schema cannot express and the published skill did not yet state. `rules/list-views.md`: "add a kanban / calendar / gallery / gantt view" is a NEW `listViews` entry whose key encodes its kind, the default `list` untouched; a view's kind changes in place only on an explicit ask; a board grouped by a field added in the same change opens with every existing record in the trailing `Uncategorized` lane, and the hand-over says so — with the correction that on a SQL datasource a literal `defaultValue` is emitted as the added column's DEFAULT, so there existing rows read it. `SKILL.md`: an operation on a record is `defineAction` metadata, never a view; a write button's body must call `ctx.api.object(OBJ).update` with `language: 'js'` and `api.write` — a body that only returns the new values writes nothing; a named view kind (gallery, gantt, kanban) is kept, never downgraded to `grid`. The two Chinese fragments left in `rules/navigation.md` and `rules/record-page.md` are English now: the shipped skill text is English-only. Three eval cases pin the teachings (views-apps-actions-pages 13–15).
- c0068ed: docs(skills, spec): the approval-flow example and the `HookSchema.condition` example guard their nullable `amount` comparison with `record.amount != null`
  
  Clause-②: no
  Metadata-protocol: none
  
  The publish-time null-guard rule refuses an ordering comparison on a declared-nullable field in a hook `condition` and in a record-triggered flow's start, edge and `decision` conditions unless an explicit `!= null` test dominates it. Two published examples compared `record.amount` without one:
  
  - `skills/objectstack-automation/references/state-machines-and-approvals.md`: the approval flow's start condition now reads `record.amount != null && record.amount > 100000`. What the start condition proves non-null is presumed at every edge and `decision` branch, so the `e1`, `e4` and `e5` edge conditions pass as written, and a null `amount` never launches the flow.
  - `packages/spec/src/data/hook.zod.ts`: the `condition` `@example` and `.describe()` text now read `record.status == 'closed' && record.amount != null && record.amount > 1000`, and the generated `content/docs/references/data/hook.mdx` row follows.
  
  The spec change is description text only: no schema shape changes, and no accept set moves.
- d443658: docs(skills): the platform skill says how `os deploy` exits 1 on a self-hosted runtime target
  
  Clause-②: no
  Metadata-protocol: none
  
  `objectstack-platform`'s operations reference scopes its `os deploy` exit-1 paragraph to ObjectOS Cloud and adds one for a target `os environments use-runtime` remembered: it asks for no cloud login, and it exits 1 on a failed build, a dry run the runtime refuses, cannot serve or ignores (an older runtime installed anyway), an install refusal (rerun with the `--confirm-access-upgrade` or `--confirm-upgrade` token it printed), or a package the running kernel did not load (live after a restart). The `os deploy` row's use-runtime tail moves into that paragraph, and a pitfalls row that only pointed to the data skill's permission-set assignment is cut. The CLI behaviour already shipped; this release only teaches it.
- bc3d8c6: fix(skills): eval cases no longer forbid a string their own reference answer writes
  
  Clause-②: no
  Metadata-protocol: none
  
  A `must_not_contain` assertion fails an answer that contains the string anywhere, including a sentence naming it as the form to avoid. Fourteen eval cases across `objectstack-api`, `objectstack-data`, `objectstack-query`, `objectstack-ui`, `objectstack-upgrade` and `objectui` forbade a string their own `expected_output` uses, so an answer written like the reference answer failed. Each entry is now the shape a wrong answer writes: a key with its colon (`fuzzy:`, `valueField:`, `submitLabel:`, `$or:`), a call with its paren (`definePage(`), a quoted literal (`'http.server'`, `type: 'many_to_many'`), the inline object form (`{ type: 'password'`, `slots: { tabs`, `distinct: true,` / `distinct: true }`), the path a request writes (`object?ids=`), the operator followed by its operand (`?? `), and the quoted `"props": {` envelope for `objectui`'s `props.value` / `props.label`. No skill text changes.
- 3d73c1d: docs(skills): the platform skill names the installation-wide uniques stop on a self-hosted `os deploy`
  
  Clause-②: no
  Metadata-protocol: none
  
  `objectstack-platform`'s operations reference: a `use-runtime` target's install refusal now also covers the installation-wide `unique` constraints stop, with its two ways on: rerun with `--confirm-global-uniques` when those constraints are meant platform-wide, else set them `unique: 'organization'`. `os deploy` already accepts the flag; this release only teaches it. Two logger and metrics restatements whose home is `references/plugin-development.md` are cut.
- d53131b: docs(skills): the platform skill's Seed Data line no longer marks seed mode `replace` as data loss
  
  Clause-②: no
  Metadata-protocol: none
  
  `replace` inserts every record with no match and deletes nothing, so a replay over a table nobody cleared leaves the existing rows as they are and adds the dataset's records again. The platform skill now says so (never deletes, duplicates), as the `SeedMode` comment and the data skill's seeds reference already did. The `PLATFORM_ALWAYS_ON_CAPABILITIES` comment in `@objectstack/spec` also says what `--preset minimal` still mounts: `job` and `queue` when `email`, `approvals` or `auth` is present, and `email` when `auth` is.
- 3806a5a: docs(skills): the objectstack-ui actions rule teaches that a param's `helpText`, like `description`, takes a sentence or an inline locale map, and that the map is how a page button's inline `action` writes its hint per locale
  
  Clause-②: no
  Metadata-protocol: none
  
  The skill taught a param's `helpText` as a sentence only, so an agent writing a page button's inline `action`, which no translation bundle reaches, left its hint in one language. `{{ record.* }}` holes work in either form, as `content/docs/protocol/objectui/actions.mdx` and the action param schema say.
- 9885be2: docs(skills): teach dataset member `synonyms` and `description` (ADR-0149 D1)
  
  Clause-②: no
  Metadata-protocol: none
  
  `skills/objectstack-ui/rules/dashboards.md`'s `defineDataset` example now writes a measure's `synonyms` (the words a question uses for the member, every language in one list, matched and never translated, and never equal to another member's name, label or synonym in the same dataset) and its `description` (a plain-language business definition, never a prompt, translated like `label`). `skills/objectstack-i18n/SKILL.md` names the translation keys `datasets.{dataset}.{dimensions,measures}.{member}.{label,description}` and says `synonyms` carry no key. The new bytes are paid inside each file by deleting sentences the same file already states.
- d9a232f: feat(spec,cli,skills)!: behavioural metadata names stay short — spec declares the namespace address grammar, the AI face derivation and the namespace/object-name predicate, refuses a `_`-led name of a bucket 2/3 type, and `os lint` and the skills stop asking for the namespace prefix on flows, actions, pages, tools and the rest (ADR-0150 child P)
  
  Clause-②: yes (narrowing) — `defineStack`, `os validate` and the schema-validated save path refuse a tool, skill, agent, flow, hook, connector, sharing rule, job, analytics cube or api endpoint whose `name` starts with `_`, which those ten name schemas used to accept (`^[a-z_][a-z0-9_]*$` → `^[a-z][a-z0-9_]*$`); the message names the router-reserved prefix (ADR-0150 D5). The widening half: `@objectstack/spec/kernel` exports the address grammar (`NAMESPACE_PATTERN`, `ENVIRONMENT_ADDRESS_SEGMENT`, `ROUTER_RESERVED_NAME_PREFIX`, `ROUTER_ADDRESSABLE_NAME_PATTERN`, `NAMESPACE_POSITION_LITERALS`, `NAMESPACE_REFUSED_LITERALS`, `validateNamespaceNotAddressLiteral`, `readNamespacePositionSegment`) and `findNamespaceObjectNameClashes`; `@objectstack/spec/ai` exports `deriveAiFaceName` with its four constants, `MCP_ACTION_NAMESPACE_MEMBER`, `McpActionNamespaceSchema` and `McpListedActionAddressSchema`. Nothing wires them to a door here.
  Metadata-protocol: narrowed
  Skills-docs: updated here — `skills/README.md` and `skills/objectstack-platform/SKILL.md` now say objects, docs, capabilities and positions carry the namespace and every other name stays short, with no `_`-led name; two eval expectations drop the prefix they asked for; `content/docs/ui/doc-pages.mdx` no longer says the lint holds every name to the prefix.
  
  <!-- adr-0087: registered bucket-two-three-name-underscore-led-refused -->
  
  **BREAKING** accept-set narrowing in `@objectstack/spec`: a `_`-led name of ten bucket 2/3 types is refused.
  
  - **Before.** A tool, skill, agent, flow, hook, connector, sharing rule, job, analytics cube or api endpoint could be named `_sync`, because its name schema admitted a leading `_`. Every other bucket 2/3 type (action, app, page, permission set, …) already refused it through `SnakeCaseIdentifierSchema`.
  - **Now.** Those ten refuse it too, at `defineStack`, `os validate` and wherever the body is parsed against its schema. A by-name door reads a `_`-led segment as the router's own (`_env` for an environment item, `_status`, `_activation`, `_drafts`), so an item spelled like one would be unreachable on the qualified address, or would shadow it. The save door's item-name grammar already refused a `_`-led name in the URL. Measured: no first-party item of the ten types is `_`-led, here or in HotCRM.
  - **Not changed.** Every letter-led name parses byte-identically, prefixed (`crm_send_email`) or short (`send_email`). Object names, field names and flow variables keep their own grammars.
  
  **The remedy.** Rename the item without its leading underscores (`_sync` → `sync`) and update every reference to it in the same change.
  
  **Also in this change, not breaking.**
  
  - **`os lint`** — `naming/namespace-prefix`'s bare-name warning now judges only capabilities and positions, the names that keep the literal prefix (ADR-0150 D1, D7). A short flow, action, hook, app, page, dashboard, report, dataset, permission set, tool, skill, agent or other bucket 2–4 name no longer warns, and a prefixed one stays valid. The intra-package duplicate warning is unchanged.
  - **Skills** — the instruction to prefix every non-object name is retired. `os generate` still writes `<ns>_` names for its scaffolds; that spelling stays valid.
  - **Spec helpers, unwired** — the address grammar the qualified doors will read (`/automation/:ns/:name`, `/actions/:ns/:object/:action`, `/meta/:type/:ns/:name`, the `_env` segment), the AI face derivation (`NS-NAME`, `OBJECT-ACTION`, an environment item's bare `NAME`; past 64 characters, 55 characters, `-` and 8 hex of FNV-1a 32 over the whole uncut face), the MCP `namespace` member for `run_action` and `list_actions`, and the predicate that refuses a namespace equal to an object name and an object short-named `custom`. The doors, the MCP server and the install gate adopt them in their own changes.
- 4640647: docs(skills): the automation skill no longer says a flow name two packages hold is never armed
  
  Clause-②: no
  Metadata-protocol: none
  
  The `subflow` row of `skills/objectstack-automation/SKILL.md` ended its two-holder case with the remark "an older clash, never armed". That remark is false, since two packages' flows of one name can each be armed, and it is removed: the parenthetical now reads `(package / package-less caller)`. Nothing is said in its place about whether the two flows are armed. The refusal the row teaches is unchanged: a caller that names neither package is refused, naming both. No other text changes.
- cd6c807: docs(skills): objectstack-data `security.md` teaches that a package's sharing rule resolves its queue recipient from its own package
  
  Clause-②: no
  Metadata-protocol: none
  
  `skills/objectstack-data/rules/security.md` now states the rule the sharing plugin enforces since ADR-0150 E4: a declared sharing rule's `sharedWith: { type: 'queue', value }` reads the name as its own package's queue, else the one holder in the package's declared `dependencies` closure plus `sys`, else (no package or environment item declares the name) an organization's `sys_queue` row. Three refusal codes are taught, each with an example: `outside-closure` (the only holder is a package the rule's package does not depend on, or an environment-authored item), `ambiguous-in-closure` (two dependencies hold the name) and `ambiguous-in-environment` (the holder the rule reaches, its own package or one dependency, and a non-dependency both hold it). A refused rule grants no one new and is warned as `RESOURCE_CONFLICT`; it loads, so nothing earlier tells the author. `evals/hooks-security-seeds-datasources.json` gains case 18, which requires the queue recipient plus a manifest `dependencies` entry on the queue's package and refuses redeclaring the queue in the rule's package.
  
  The file sits at its token ceiling, so the new bullet (446 bytes) is paid for by these cuts in the same file (459 bytes; the file goes from 15069 to 15056 bytes):
  
  - `(PermissionSetSchema.rowLevelSecurity)` after "permission set / profile" (41 B); the same sentence names `rowLevelSecurity` on a permission set.
  - "(the tenant wall still applies)" in the RLS default-deny sentence (32 B); the Layer 0 bullet says the wall is AND-composed ahead of all business RLS.
  - The sentence that a legacy SQL-style `=` / `IN (...)` predicate still compiles through a deprecated bridge (98 B). This is not a restatement: the file now teaches canonical CEL only.
  - The four "(for `IN`)" notes in the `current_user.*` table (42 B); the predicate list above it spells `field in current_user.ARRAY`.
  - The membership-key section intro, shortened to "Declare the set on the roster object, not one policy per record." (80 B); the section heading and the "Choose by" bullet's "a named record → a membership key" carry the rest.
  - "(`isDefault` sets)" after the `everyone` baseline in the Positions section (19 B); the `isDefault: true` bullet defines that baseline.
  - The admin-only recipe's `tenancy` comment "not a tenant object → Layer 0 contributes nothing" (55 B); the blockquote below it explains the key.
  - The blockquote's "it is the half that holds however permissive the grants" (59 B); the `requiredPermissions` paragraph calls it an AND-gate, strictest-wins over field grants.
  - "(`@objectstack/plugin-security`)" after `sys_user_permission_set` (33 B); a package pointer an author never writes.
  
  The `(definePermissionSet)` example comment and the field-lock recipe docs link stay.
- ef194d7: docs(skills): objectstack-automation says how a `subflow` / `map` child flow name resolves, and when it is refused
  
  Clause-②: no
  Metadata-protocol: none
  
  The `subflow` and `map` rows of `skills/objectstack-automation/SKILL.md` now teach the engine's bare-name rule for `config.flowName` (ADR-0150 D3): a package's flow reaches its own package's flow, else the one holder in its declared `dependencies` closure plus `sys` packages; a package-less flow reaches the environment's flow, else the one package holder. Anything else passes `os validate` and fails the node at run time with the resolver's sentence naming every candidate and no error code: `outside-closure` (only an undeclared package or an environment-authored flow holds the name), `ambiguous-in-closure` / `ambiguous-in-environment` (two packages hold it; only a clash older than install's one-holder refusal, and such a name is never armed). A `map` fails at its first item. The automation evals gain a case that declares the dependency on the child flow's package.
  
  Paid for by nine restatements cut from the same file, each keeping its other home:
  
  1. The `screen` row's "never hand-roll a button label or step counter into `fields`": the same cell's "Next / Submit and Step N of M are not authored".
  2. The `script` example's "function returns values → outputVariable → update_record persists" comment: the prose sentence above it.
  3. The "CEL values or literals" comment on `script` `inputs`: Valid-but-silently-wrong #1, which lists `script` `inputs.*` as a value slot.
  4. "Do not remove `readonly` instead": objectstack-data's `readonly` bullet ("not by removing `readonly`").
  5. The `loop` row's sample envelope: #1's `{ dialect: 'cel', source: '…' }`.
  6. "never a reason to write code" in Integrations: the same paragraph's "Never a plugin" and "the app still writing none".
  7. References' "Read the source for exact field shapes; never rely on memory": `references/_index.md` ("Read them directly from `node_modules`").
  8. "hooks get `ctx.api`": the hook `runAs` paragraph ("that hook's `ctx.api` data operations").
  9. When to Use's "(auto-launched, screen, scheduled)" and "record-change": the Flow Types table and the frontmatter description.
  
  The remaining 41 tokens move the file's ceiling 6527 -> 6568 under the standing ruling 「A:先削重复,余额按实测提高」 (ruling record 6513306068, letter B), pinned at the measurement.
- e27efff: docs(skills): objectstack-data `security.md` teaches how a package's position resolves the permission sets it names
  
  Clause-②: no
  Metadata-protocol: none
  
  `skills/objectstack-data/rules/security.md`, section "Positions grant only what they name", now states the rule the security catalog enforces since ADR-0150 E3: a package's position reads each `permissionSets` name as its own package's set, else the one holder in its declared `dependencies` closure plus `sys`. Otherwise the name is refused. Two refusals are taught, each with an example: `outside-closure` (only a package the position's package does not depend on holds the set, or only the environment does, such as a set authored in Setup) and `ambiguous-in-closure` (two holders it reaches; a second package shipping a set name is already refused at install). A refused name still loads; the boot's catalog reference report logs it with every candidate, and the position grants nothing through that name while its other sets still grant. Stored grants, environment-authored positions, administrator overlays of a package position and the `everyone`/`guest` anchors still resolve across the whole environment. `evals/hooks-security-seeds-datasources.json` gains case 19, which requires the position's `permissionSets` entry plus a manifest `dependencies` entry on the set's package and refuses redeclaring the set in the position's package.
  
  The file sat 16 bytes under its token ceiling. One restatement is cut in the same file: the `secret` paragraph's "**Fail-closed:** with no crypto provider, writes throw rather than persist cleartext." (86 B), which survives as "fail-closed (ADR-0100)" in the `secret` row of `rules/field-types.md`. The remainder raises the ceiling under standing ruling 6513306068, letter B: 「A:先削重复,余额按实测提高」. The file goes from 15056 to 15834 bytes, and the ceiling from 3768 to 3959 tokens, pinned at the measurement.
- b5d945b: docs(skills): objectstack-automation says which queue a packaged assignment rule or approval step names, and what a refusal does
  
  Clause-②: no
  Metadata-protocol: none
  
  `skills/objectstack-automation/SKILL.md` § Assignment rules now teaches how a packaged rule's `assignTo: { type: 'queue', value }` resolves (ADR-0150 D3): the package's own queue, else the one holder in its declared `dependencies` closure plus `sys`. Otherwise the name is refused, `outside-closure` (only an undeclared package or the environment declares it) or `ambiguous-in-closure` (two holders in the closure), and the row is written ownerless, in no queue, with a warning in the server log once per rule and organization. An organization's `sys_assignment_rule` row and a rule no package ships still read environment-wide (two package holders: `ambiguous-in-environment`). A name no `queues` entry declares still reads the organization's `sys_queue` row.
  
  `references/state-machines-and-approvals.md` teaches the same for a packaged flow's `queue` approver, read from the package whose flow body runs: a refusal leaves the node unopened with `APPROVER_DIRECTORY_UNREADABLE` naming every candidate, `retryable: false`, and no fallback slate. A deployment-authored flow or a `.custom` override reads environment-wide. The automation evals gain a case whose package declares the dependency on the queue's package.
  
  Paid down first by cutting eight restatements, each keeping its other home:
  
  1. SKILL.md, the `api` flow-type row's "needs a start-node `secretRef`": § Inbound webhook triggers, the `secretRef` / `secret` row.
  2. SKILL.md, the `approval` node row's "suspends the run … `approve` / `reject` branch": the reference's § Approvals (Flow Nodes) opening paragraph.
  3. SKILL.md, § Assignment rules' `approvers: [{ type: 'queue', value: 'crm_support_intake' }]` literal: the reference's Approver Types `queue` row, which the kept link reaches.
  4. SKILL.md, § Trigger Configuration's "This is the start node alone, not a whole flow": the section heading ("on the `start` node").
  5. The reference's "e.g. `previous.status != 'escalated' && record.status == 'escalated'`": SKILL.md § Trigger Configuration's start-node example.
  6. The reference's "approval flows live in your normal `flows: [...]`": § Approvals (Flow Nodes), "authored as an Approval node on an ordinary flow".
  7. The reference's "— you opt in, edge by edge": the same item's "This is the only thing that legalizes the cycle".
  8. The reference's "(flow conditions: the trigger snapshot; hook conditions: the stored record overlaid with the write's payload)": the time-word cheat sheet's flow-condition row, and objectstack-data `references/data-hooks.md` for hook conditions.
  
  The remainders move the ceilings under the standing ruling 「A:先削重复,余额按实测提高」 (ruling record 6513306068, letter B), pinned at the measurement: SKILL.md 6568 -> 6687 (+119), the reference 5825 -> 5916 (+91).
- 2bdf74c: docs(skills): the objectstack-data field-types rule teaches a line amount that follows its `master_detail` parent's currency
  
  Clause-②: no
  Metadata-protocol: none
  
  `skills/objectstack-data/rules/field-types.md` § Currency taught `currencyField` only as a sibling code field, so an author building an invoice with line items gave each line its own code. It now teaches the two-segment form `'<master_detail field>.<parent code field>'` with one invoice and line-item example: one hop through a `master_detail` (a `lookup` path is refused) to the parent's `iso_4217_currency` field; a blank parent code refuses the line amount (`ERR_CURRENCY_CODE_REQUIRED`) and the code backfill refuses a path; a `sum`/`min`/`max`/`avg` roll-up through that `master_detail` declares `currencyConfig: { currencyMode: 'record', currencyField: <parent code field> }`; and once a line follows, the parent's code cannot change (`VALIDATION_FAILED`, a first code over a blank one passes) until no line follows it. Growth is paid first by same-file deletions of restated text: the dataset-measure `currency` sentence (home: objectstack-ui § Dashboards), the autonumber "Incorrect vs Correct" pair (home: § Autonumber rules 1 and 2) and the `user` row's `deleteBehavior` parenthetical (home: `rules/relationships.md` § Delete Behaviors).
- d48fb15: docs(skills): the automation skill teaches that a `script` node's function resolves from the calling flow's package
  
  Clause-②: no
  Metadata-protocol: none
  
  Silently-wrong item 3 of `skills/objectstack-automation/SKILL.md` now says how a `script` node's `config.function` is resolved since the node reads functions by package (ADR-0150 D3): from the calling flow's package, as `subflow`'s `flowName` is, with the platform's owner-less function in every flow's reach, and a `.custom` override reading as a package-less flow. Two packages that both ship `normalize_phone` each run their own (the boot still warns about the shared name). If the flow's package holds none, two holders in reach, or one only outside its `dependencies` closure, fail the step as a guard (`$error.code: 'RESOURCE_CONFLICT'` in a `try_catch`); a flow door (trigger, resume, `/actions`, a declared `type: 'flow'` endpoint) answers `400 FLOW_FAILED` with `error.details.innerRefusal` naming each holder. The fix is to declare the dependency, or rename.
  
  Paid first by one same-file restatement: the item's `defineStack({ functions: { my_fn: (ctx) => … } })` example, whose shape the same item's `'helpdesk.aiTriageStub'` block still shows. The automation SKILL.md token-ratchet row rises by the measured remainder only, 6687 → 6861.
- 9b434a8: docs(skills): a total over a computed value is taught through a stored computed field, not a hook
  
  Clause-②: no
  Metadata-protocol: none
  
  The skills now teach the way to a total the platform's own refusal names. A `sum`, `avg`, `min` or `max` over a `formula` field stays refused, and its fix line reads "make it a field of its return type with the same `expression` (computed and stored on write) and aggregate that". Three places said something else:
  
  - **`objectstack-ui` → `rules/dashboards.md`, "Total over a computed value".** It told the author to store the number "user-entered, a `summary` rollup, or hook-kept", and its leave-days example kept a `number` in step with a `beforeInsert` / `beforeUpdate` hook. It now carries the refusal's sentence, and the example is a `readonly` `number` field with the formula's `expression`, summed by the same measure. A hook is code, which an author on a hosted tier may not be able to add; the field's declaration needs none.
  - **`objectstack-data` → `rules/field-types.md`, the `formula` row.** "both need a stored field" now names which one: a stored field of the formula's return type with the same `expression`. That is the answer for a group key (a dataset or cube dimension) as well as for an aggregate.
  - **`objectstack-ui` eval 6** (`evals/analytics-inline-vs-dataset.json`). The expected answer is the `readonly` `number` field carrying the same expression, and an answer that writes a `beforeUpdate` hook no longer passes.
  
  **The known limit rides in the same `dashboards.md` sentence.** The engine computes such a field when a row is written, so rows that existed before the field was declared stay empty until each is written again, and a total over them reads low. `os migrate stored-expressions --apply` fills them where the operator has the database URL; a hosted tenant has no way to run a backfill yet. The skill says both halves in its own words: "existing rows stay empty until rewritten, no hosted backfill yet".
  
  The "Computed column" bullet of `dashboards.md` also drops its aside "not a hook-kept number": the `duration` measure it prescribes is unchanged.
  
  No skill grows: `dashboards.md` and `field-types.md` stay at their token ceilings and their line counts. Nothing an author writes is accepted or refused differently.
- 6a9b1fd: docs(skills): the data skill teaches the permission-set grant's four-column key and when a grant names `permission_set_package`
  
  Clause-②: no
  Metadata-protocol: none
  
  `objectstack-data` → `rules/security.md`, "Assigning a permission set to a user", still said one grant per user, set and organization is enforced by a `unique: 'organization'` index, and never named `permission_set_package`. The sentence now states what the platform enforces since a permission set became identified by its package and its name:
  
  - the grant's unique key is `(user_id, permission_set, permission_set_package, organization_id)`;
  - a guard index holds grants that name no package to one per user, set and organization, and `driver-memory` builds no such guard;
  - a grant names `permission_set_package`, on insert, when two packages hold the set's name; without it that grant is refused `409 RESOURCE_CONFLICT`, and the message names each holder.
  
  Nothing an author writes is accepted or refused differently: the text follows behaviour already shipped, and claims no more than that change declared (the guard is absent on `driver-memory`).
  
  The file does not grow. The four new lines are paid for by deleting restatement in the same file, each fact kept where it already lives: the `enable.apiMethods` bullet (`objectstack-data` SKILL.md, the `apiMethods` row), the lead-in above the `current_user.*` table (the table's own header), a repeated `// in a permission set` comment, the `readonlyWhen` aside on the field-lock choice (`objectstack-data` SKILL.md, the `readonlyWhen` bullet), the `secret` paragraph's "Encrypted-at-rest values" label (the `secret` row of `rules/field-types.md`), and a phrase in the `requiredPermissions` paragraph that repeated its own bold label. The file moves from 15834 to 15828 bytes (3959 to 3957 tokens, ceiling 3959 unchanged) and from 328 to 327 lines.
- 522882a: docs(skills): objectstack-automation teaches the namespace-qualified inbound hook of a flow name two packages hold
  
  Clause-②: no
  Metadata-protocol: none
  
  `skills/objectstack-automation/SKILL.md` § Inbound webhook (`api`) triggers gains one line. For a flow name two packages hold, the bare hook `POST /api/v1/automation/hooks/:flowName/:hookId` answers `401 INVALID_SIGNATURE` to every post, whatever the signature, and the cause goes to the server log only. Each package's flow is reached only at `POST /api/v1/automation/hooks/:namespace/:flowName/:hookId`, where `:namespace` is its package's `manifest.namespace`; `_env` in that position names a flow no package ships. A name one package holds is served at the bare hook as before, and the line does not say otherwise.
  
  Paid for inside the file's token ceiling, which does not move (6854 -> 6854 of 6861), by nine restatements cut from the same file, each keeping its other home:
  
  1. The `parallel` row's "no split/join pair to mis-wire": the same cell's "joined implicitly at block end", and the `parallel_gateway` / `join_gateway` row ("Not author-facing … author the container").
  2. The `connector_action` row's "nothing sent": the same sentence's "judged against the action's `inputSchema` … before dispatch: a breach fails the step".
  3. The fault-edge note's "`type: 'fault'` is what routes": the sentence before it ("`{ source, target, type: 'fault' }` routes a failed node to a handler").
  4. The `readonly` note's "the value never lands": the same sentence's "the engine strips it" and "the drop is named in the step's warnings".
  5. Filter operands' "a literal or a CEL envelope": Valid-but-silently-wrong #1 ("A value slot takes a literal or a CEL envelope"), which lists every CRUD `filter` operand as a value slot.
  6. Valid-but-silently-wrong #2's "writes the whole record object": the item's opening sentence ("holds the created RECORD, not its id").
  7. The `defineStack({ functions })` example's "declared writer" comment: the sentence above the block ("A function that writes where the platform cannot see declares it") and the `effect: 'writes'` it annotated.
  8. Valid-but-silently-wrong #4's "write the `value` in the `condition` AND every `fields` / `filter` entry": the item's opening sentence ("compared and written by its option `value`, never its label") and its `condition` and `fields` / `filter` examples.
  9. Integrations' "(OpenAPI, remote MCP, plain REST)": the same sentence's `provider: 'openapi' | 'mcp' | 'rest'`.
  
  No rule's teaching changes.
- 20f8621: docs(skills): objectstack-automation teaches the `notify` audience selectors, `org:members` included
  
  Clause-②: no
  Metadata-protocol: none
  
  `skills/objectstack-automation/SKILL.md`'s `notify` section taught a recipient as an id, a list, an envelope or `emailField` only, so an agent asked for an announcement listed users by hand. It now names the three selectors a recipient string may be, written or evaluated: `team:ID` (that team's members), `owner_of:OBJECT:ID` (that record's owner) and `org:members` (every member of the run's organization, else that of the record the notification is about; any other `org:` value reaches nobody, with a warning).
  
  `skills/objectstack-automation/evals/flows-triggers-approvals.json` gains case 22: an administrator-started announcement to the whole organization. The accept set requires `recipients: 'org:members'` and refuses a `get_record` over `sys_member` or `sys_user`.
  
  The new lines are paid for in the same file by deleting restatement, so the file stays under its token ceiling.
- 2d52e29: docs(skills): the objectstack-ui skill states the one-app-per-package rule for app and module packages alike
  
  Clause-②: no
  Metadata-protocol: none
  
  `skills/objectstack-ui/SKILL.md` § App Navigation said `defineStack` refuses a second app "in a `type: 'app'` package", which let an author conclude that a `type: 'module'` package may carry several apps. `defineStack` refuses a second app in a module package too (`STACK_SINGLE_APP_VIOLATION`, ADR-0019 (app-as-consumer-unit) D3 as amended), so the paragraph now names both package types and the remedy: each further app goes in a module of its own with the objects it shows. Growth is paid in the same file by deleting the restated tail of Common Pitfalls 2; the file's token count is unchanged at its ceiling.
- b71efec: docs(skills): objectstack-formula teaches that a `date` / `datetime` field is its ISO text, so a timestamp-only call takes it through `date()` first
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** The Dates table said only "Text in? `isoDate(date(s))`" and never said that a date or datetime field is text, so an agent wrote `isoDate(record.start_at)` or `record.start_date.getFullYear()`, which the authoring gate now refuses as `date-text-call` (#32595).
  - **Now.** One note under the Dates table: a `date` / `datetime` field is its ISO text; the build refuses it in a timestamp-only call or method (`date-text-call`); wrap it first, `isoDate(date(record.start_at))`, `date(record.start_date).getFullYear()`; `+` with text and ordering against a text literal take the text as is. One eval prompt expects `isoDate(date(record.start_at))`.
  - The note is paid by cuts of sentences the same file states elsewhere; the file gets smaller and no ceiling moves. No schema, key or behaviour changes.
- c1a645e: docs(skills): objectstack-automation's readonly-field callout states the limit a flow started from a button has
  
  Clause-②: no
  Metadata-protocol: none
  
  The callout "Writing a `readonly` field? Set `runAs: 'system'`" in `skills/objectstack-automation/SKILL.md` § Failure routing & `runAs` gains one sentence, in the words of `os explain flow-update-readonly-field`. A button or action does not let a user start an `autolaunched`, `record_change` or `schedule` flow declared `runAs: 'system'`: it answers 403 `PERMISSION_DENIED`. For a flow a user starts from a button, the elevated routes are a `screen` or `api` flow declared `runAs: 'system'`, or a user-run flow whose `subflow` node calls the elevated flow. Before this, an agent following the callout alone declared the button's `autolaunched` flow `runAs: 'system'` and the button answered 403.
  
  Paid for inside the file's token ceiling, which does not move (6854 -> 6852 of 6861), by seven cuts from the same file. Cut 1 also relaxes one rule; the other six keep their content in another home:
  
  1. The callout "Elevate the write, not the flow" loses "A `screen` flow stays `runAs: 'user'`; a step that must write a `readonly` field moves into a dedicated `runAs: 'system'` flow called from a `subflow` node": the new sentence directly above it names that route ("a user-run flow whose `subflow` node calls the elevated flow"). **One rule is relaxed here:** "A `screen` flow stays `runAs: 'user'`" was an order and is now a preference, "Prefer the `subflow` route — raising a whole `screen` flow silently elevates every other write in it". The reason is unchanged. An elevated `screen` flow is a legitimate route, gated by the flow's own `requiredPermissions`.
  2. The `notify` section heading's "— the most-used node type": a tagline that states no rule.
  3. The start-node example's comment "gates whether the flow launches on the event": Valid-but-silently-wrong #4 ("`condition: …` parses, matches no row: the flow stages clean and never fires").
  4. The `get_record` row's "(that name has no executor and throws)": the same cell's "there is no `query_record` node".
  5. Valid-but-silently-wrong #3's "Keep data effects on the flow graph (visible, governed, build-checkable)": the clause before it ("a later declarative node persists it") and the paragraph's opening ("it does NOT read/write the database").
  6. The `schedule` row's "see *Time-relative triggers*": the pointer under Trigger Configuration ("references/examples-flows.md § Time-relative triggers").
  7. The `screen` row's "(wizards, forms)": the skill description ("interactive screen flow / wizard") and the `screen` node row ("Display a UI form to the user").
  
  No other rule's teaching changes.
- e0cba9d: docs(skills): objectstack-api and objectstack-i18n teach the request-locale `userMessage`
  
  Clause-②: no
  Metadata-protocol: none
  
  `objectstack-api` § Error Envelopes now states the `userMessage` language rule as `ApiErrorSchema.userMessage` declares it: the text is in the request's locale; platform-composed text follows one ladder over the platform locale table (the locale the request names, else the workspace default, else `en`, each code read whole and then one subtag shorter at a time); app-authored text is served from the app's own translations and otherwise as declared, with no `en` floor. It also says that an entry of the save / publish doors' `advisories[]` and of the 422 `issues[]` (`RuntimeAuthoringIssueSchema`) carries an optional `userMessage` beside the stable `rule`, while `message` / `hint` stay developer-facing English. `objectstack-i18n` gains a short section with the same ladder and the `hooks.<hook>.refusals.<CODE>.message` key an app translates its catalogued refusals under. Growth is paid by same-file deletions of restated prose: both files read fewer tokens than before, and no ratchet ceiling moves.
- 0a50357: Clause-②: no
  Metadata-protocol: none
  
  objectstack-automation: the readonly-field callout now names all four doors that refuse a user's start of an elevated `autolaunched` / `record_change` / `schedule` flow (a button, an action, an endpoint or the trigger route), and says what the `api` route costs when its only caller is a button — a webhook secret and an inbound door — so the agent prefers the `subflow` route.
  
  Paid for by two same-file restatement cuts, no ratchet raise: the "Who may START a flow" callout no longer repeats its own door list (it points back to the four entrances named in the readonly-field callout), and the "Inbound webhook (`api`) triggers" section drops "An `api` flow is bound to an inbound HTTP endpoint", which restated its heading and the Flow Types `api` row.
- 8e3d4a5: docs(skills): the `objectstack-ai` MCP tool table teaches that an AI service account is refused a confirmation-gated action whatever it sends (#32936)
  
  Clause-②: no
  Metadata-protocol: none
  
  The `list_actions` / `run_action` / `resume_run` row kept `confirm: true` after the human approves as the retry, and that retry is still right for a person and for a delegated agent. It now adds the rule the runtime already enforces (ADR-0151 D3 rule 3): under an AI service account's own key (an agent acting for itself, for no person) the call is refused `428 ACTION_CONFIRMATION_REQUIRED` whatever it sends and nothing runs, so the action is handed to a person, or its author declares `ai.requiresConfirmation: false` when it is safe unattended. Funded by trimming the pitfall line that restated the tool-level `requiresConfirmation` retirement already given under `ToolSchema`.
- 0306761: docs(skills): objectstack-api no longer teaches that `DELETE` is a hard delete with no recycle bin: a by-id delete keeps a business object's rows in `sys_recycle_bin` (30 days by default; not `multi: true` deletes, platform rows or rows deleted before the bin existed), and nothing lists or restores it over the API yet; eval case 5 expects that teaching instead of a hard delete
  
  Clause-②: no
  Metadata-protocol: none
- 719a502: docs(skills): the objectstack-automation skill names the `save_notice` flow node and points to the save notice's one home
  
  Clause-②: no
  Metadata-protocol: none
  
  `skills/objectstack-automation/SKILL.md` listed no `save_notice` node, so an author designing a "sent for approval" flow from this skill never found it. Its Data Operations table now carries a `save_notice` row that points at `objectstack-data` `rules/lifecycle.md` § Save Notice, which stays the one full teaching. That section gains what the code does and it lacked: a hook's `ctx.notice` message is shown untranslated; a `save_notice` message translates under `flows.<flow>.notices.<node_id>.message` in the saver's locale; the node refuses by name in a `subflow` / `map` child, and a flow with one after a `subflow` / `map` whose child can pause is not armed (`unboundCause: 'notice_after_suspending_subflow'`). `evals/flows-triggers-approvals.json` gains case 16. Growth in both files is paid by same-file deletions of restated text; no ratchet row moves.
- aa3e21c: docs(skills): the data skill teaches `controlled_by_parent` with an optional master
  
  Clause-②: no
  Metadata-protocol: none
  
  `objectstack-data` now teaches "a rep sees the contacts of the accounts they own; a contact need not have an account" as a `controlled_by_parent` detail whose only `master_detail` is declared `required: false` (an optional master), not as an owner field copied by hooks. A row with no master is its owner's: the owner or View All on the detail reads it, the owner or Modify All writes it, an insert naming no master is admitted, setting a master asks edit on it, emptying one asks edit on the stored master (`ownerMayEdit` does not cover that), and a chain hop with no master ends there under the same rule. The `relationship/master-detail-required` lint row names the optional master. The platform behaviour shipped earlier in `@objectstack/spec`, `@objectstack/lint` and `@objectstack/plugin-security`; this release only teaches it.
- 37e2c14: docs(skills): the data skill teaches "the person is a record", a membership key with `valueField: 'id'`
  
  Clause-②: no
  Metadata-protocol: none
  
  `objectstack-data`'s security rule now teaches the membership key whose `valueField` is `id`, the roster's own primary key: on an `employee` roster, `my_employee_ids: { userField: 'user', valueField: 'id' }` is the ids of the caller's own employee rows, and a `leave_request` policy reads `employee in current_user.my_employee_ids`. It grants nothing by itself, and a policy that tests it against a column not referencing the roster, or another object's `id`, is refused (`rls-predicate-membership-key-target`). The rule no longer says `valueField` can never be `id`; that was true before the platform change and is corrected here, including the earlier note in this release. A new eval case exercises it. The platform behaviour is the `@objectstack/spec`, `@objectstack/lint` and `@objectstack/plugin-security` change in this same release; this note covers only the teaching.
- 8acbfab: docs(skills): objectstack-ai's MCP tools table teaches `run_action` / `resume_run`'s confirmation gate and the `delete_records` tool
  
  Clause-②: no
  Metadata-protocol: none
  
  The table taught the `confirm: true` gate for `delete_record` only. It now says that an action flagged `ai.requiresConfirmation` is refused by `run_action` and `resume_run` with `428 ACTION_CONFIRMATION_REQUIRED` unless the call sends `confirm: true`, and lists `delete_records`: up to 200 records of one object per call, by `where` or `recordIds`, whose unconfirmed call is the preview and deletes nothing, and which needs `data:read` and `data:write` over OAuth.
- 226c988: docs(skills): the objectui i18n guide teaches the platform locale table's tags (`zh-Hans`, `zh-Hant`, `pt-BR`) for the built-in packs, a language switcher fed by `PLATFORM_LOCALES`, and the read aliases that keep a stored `zh` / `zh-CN` / `zh-TW` / `pt` resolving
  
  Clause-②: no
  Metadata-protocol: none
- e863251: Clause-②: no
  Metadata-protocol: none
  
  `objectstack-platform`: § Seed Data now names `ignore` as the seed `mode` default (`SeedMode` defaults to `ignore`, not `upsert`), and § `requires:` says that `--preset minimal` keeps `job` and `queue` when `email`, `approvals` or `auth` is present instead of dropping every always-on token. `objectstack-automation`'s DocuSign eval case no longer forbids a string its own model answer uses, and its model answer now verifies DocuSign Connect's own signature header through `config.signature` instead of polling.
- e2b5773: docs(skills): objectstack-data's datasources rule states the organization scope an external object declares under a walled tenancy posture
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** The datasources rule taught `external` bindings, `columnMap`, auto-connect and credentials, and said nothing about what an external object's rows are to the organizations of a walled deployment.
  - **Now.** One bullet under *Federated (external) objects*: under `OS_TENANCY_POSTURE` `isolated`/`group` every external object states its organization scope — its own `organization_id` field (or `columnMap` onto it), `tenancy: { enabled: false }` (shared), or `systemFields: { tenant: false }`; none refuses the boot by name, and `tenancy.tenantField` is refused there too. Paid within the file's token ceiling (910 → 908 of 911) by trimming the auto-connect footnote, the managed-datasource sentence and the credentials paragraph; no ceiling moves.
- 5277855: docs(skills): the automation skill lists `job`, `queue` and `messaging` only under `--preset minimal`, and the platform skill names the `mcp` and `pinyin-search` host defaults
  
  Clause-②: no
  Metadata-protocol: none
  
  `objectstack-automation`'s prerequisite table marks `job`, `queue` and `messaging` with ° and says they are always-on, so they need listing in `requires:` only under `--preset minimal`; the symptoms in their rows are what a minimal boot shows without them. The `timeRelative` example and the Stripe and carrier-callback recipes no longer put `'job'` or `'queue'` in `requires:`. `objectstack-platform`'s `### requires:` lead now says the host defaults are mounted under every preset: `mcp` unless `OS_MCP_SERVER_ENABLED=false`, and `pinyin-search` when the stack's `i18n` names a `zh-*` locale, with `OS_SEARCH_PINYIN_ENABLED` overriding that. The automation evals for inbox notifications and the nightly Stripe sync no longer expect those tokens in `requires:`. The platform behaviour already shipped; this release only teaches it.
- 007fdb1: docs(skills): teach the hook `body` first in `objectstack-data`'s data-hooks reference, guard nullable hook-condition and formula predicates, link Connector recipes
  
  Clause-②: no
  Metadata-protocol: none
  
  `references/data-hooks.md` now teaches the sandboxed `body` in its schema example, its implementation section and the cross-object pattern; the inline `handler` appears only as the deprecated form (the read-masking pattern stays one, since a `body` writes back only `ctx.input`). Its `body` examples key the row on `ctx.previous.id`: a body's `ctx.input` carries `id` only when the payload does, so a bulk, by-`where` or delete dispatch would otherwise scope a write or a count to every row. Its repository table and `api.write` row drop `upsert` / `updateMany` / `deleteMany`, which a hook's `ctx.api` does not implement, and teach `update` / `delete` with `{ where, multi: true }` as the bulk form. Two hook `condition` examples and one `objectstack-formula` predicate gain the `!= null` guard the publish gate requires, and § Capabilities links the Connector recipes reference. The platform behaviour already shipped; this release only teaches it.
- 042172a: docs(skills): objectstack-data teaches `lifecycle.seal`, audit ledger sealing
  
  Clause-②: no
  Metadata-protocol: none
  
  `rules/lifecycle.md` gains a § Sealing (`seal`) beside retention, ttl and archive: what `seal` opts an `audit` object into (hourly signed checkpoints chained per organization, `valueFields` entering as salted commitments), the parse-time refusals, why an object parses but is not sealed (no declared `id` or `tenant_id`, a column type with no canonical rule, no crypto provider), and the two limits today: no verifier reads the checkpoints back yet, so a break is recorded but not reported, and the sweeper still deletes sealed rows until expiry ships. Two parse-time ❌ examples that restated the page's class table and duration grammar are dropped, with the intro clause the first sentence already says. `objectstack-data` evals gain a sealing case.
- 2178d80: docs(skills): the objectstack-data seeds reference now teaches the seed modes the loader runs: `ignore` is the default (create-only), `replace` deletes nothing (it inserts into a table the caller cleared), and `insert` duplicates on each replay. It also says that AppPlugin's boot and organization replays do not re-insert a seed row a person deleted (a publish or package install keeps no record, so the row comes back there), and that `seed-replayer` with `{ reseed: true }` restores it. The data-modeling seed guide teaches the same rule and names the loads that keep no record.
  
  Clause-②: no
  Metadata-protocol: none
- cbe20ab: docs(skills): validation examples guard nullable fields, hooks teach `body`, the `requires:` table names `mailbox` and `package-registry`, `os generate` drops `agent`
  
  Clause-②: no
  Metadata-protocol: none
  
  `objectstack-data` `rules/validation.md` now guards every ordering or arithmetic operand in its examples with `!= null` (the due-date, date-range, amount, discount and order-total predicates) and states the rule once: an unguarded `<` or `+` on a field with no `required: true` / `defaultValue` is refused at publish. Its external-validation hook and the `examples-objects.md` lifecycle hook are written as a sandboxed `body`, and the `SKILL.md` index names the inline `handler` only as the deprecated form; the validation section says a `body` has no outbound HTTP, so an external-API check goes through a Connector recipe. `objectstack-platform` lists `mailbox` (`@objectstack/service-mailbox`) and `package-registry` (`@objectstack/service-package`) in the `requires:` table, and `references/operations.md` no longer offers the retired `os generate agent`. The platform behaviour already shipped; this release only teaches it.
- da13003: docs(skills): objectstack-i18n teaches the action `cancelText` key and the dialog-key host refusals
  
  Clause-②: no
  Metadata-protocol: none
  
  - `skills/objectstack-i18n/SKILL.md`'s `_actions.{action_name}` row names `cancelText`: the dismiss button of the confirm or param dialog, only under an action that declares `confirmText` or a non-empty `params`.
  - The `translation-target-unknown` paragraph adds `submitText` under an action with no non-empty `params`, and `cancelText` under an action that declares neither `confirmText` nor a non-empty `params`.
  - Nothing to do on upgrade: the key is already accepted, checked and read by the console; this only teaches it.
- bf44caa: docs(skills): objectstack-i18n teaches the action `preflight.fields.{path}` translation key
  
  Clause-②: no
  Metadata-protocol: none
  
  - `skills/objectstack-i18n/SKILL.md`'s `_actions.{action_name}` row names `preflight.fields.{path}`: only under an action that declares `preflight`, keyed by a field's literal `path` in its `preflight.fields[]`, its value a plain string; any other key under `preflight` (a `title`, for example) is refused when the bundle is parsed.
  - The `translation-target-unknown` paragraph adds a `preflight.fields` path the action does not declare, including under an action with no `preflight`.
  - Nothing to do on upgrade: the key is already accepted, checked and read by the console; this only teaches it.
- 658d84f: docs(skills): the platform skill's `requires:` table marks the always-on tokens
  
  Clause-②: no
  Metadata-protocol: none
  
  `objectstack-platform`'s `### requires:` no longer calls every listed service opt-in. The table marks each token of `PLATFORM_ALWAYS_ON_CAPABILITIES` (`queue`, `job`, `cache`, `settings`, `email`, `storage`, `sms`, `sharing`, `messaging`, `analytics`, `package-registry`) with °, and the lead says every boot mounts them, listed or not, while `--preset minimal` drops exactly those. The `auth` → `email` rule now says it holds under `--preset minimal` too, and the `triggers` + `job` pairing is scoped to `--preset minimal`. The `queues` / `assignmentRules` paragraph no longer says `sharing` must be in `requires:`. The skill's evals for silent scheduled flows and notifications, and for an ownership queue, no longer expect `job`, `messaging` or `sharing` in `requires:`, and a new eval case asks whether an always-on service must be listed. The platform behaviour already shipped; this release only teaches it.
- 53b8b46: docs(skills): objectstack-platform names every cloud-only capability token
  
  Clause-②: no
  Metadata-protocol: none
  
  - `skills/objectstack-platform/SKILL.md`, § `requires:`: the **Enterprise / cloud** bullet now names `audit-compliance` and `access-policy-console` beside `ai-seat` and `governance` as the tokens resolved only by cloud's objectos-runtime, matching `PLATFORM_CAPABILITY_TOKENS` and `PLATFORM_CAPABILITY_PROVIDERS` (`package: null`, `edition: 'cloud'`).
  - Two clauses that restated the section's lead-in ("not in that map") are cut: "have no provider entry" on the tier-gated bullet and "has no open-edition provider" on the enterprise bullet.
  - Nothing to do on upgrade: both tokens are already accepted by `defineStack`; this only teaches them.
- e0b8c2c: docs(skills): the platform skill teaches `os deploy`, the managed-package dev loop
  
  Clause-②: no
  Metadata-protocol: none
  
  `objectstack-platform/references/operations.md` gains an `os deploy` row in "Environments & deploy": use it to see an edit on the organization's ObjectOS Cloud environment (also `npm run deploy` in a scaffolded project, or `d` in `os dev`); it builds, publishes `<manifest.version>-dev.<timestamp>`, installs that version and waits until the environment serves it. The row names how the environment is picked (`--env`, else the one `os environments switch` recorded, kept across `os cloud login`, else the organization's only one) and the `--no-wait` and `--wait-timeout` flags. A short paragraph reads an `os deploy` exit 1: a refusal before any write (with no environment at all, create one in the ObjectOS Cloud console), the environment's own build failure, and the wait timeout, each with the next step. `SKILL.md`'s Part 3 pointer names `os deploy`. Eval 17 of `evals/config-plugins-ops.json` asks how to see a change on the environment and expects `os deploy`. Paid inside `operations.md` by deleting four restatements (the `os dev` row's platform-admin sentence, the `os validate` row's gate summary, the "Both run the same gates:" lead-in, the Docker row's list of the official image's three required variables); the remainder raises that file's token ceiling by the measurement.
- a5e280f: docs(skills): the platform skill teaches `os environments use-runtime` and `os mcp connect`
  
  Clause-②: no
  Metadata-protocol: none
  
  `objectstack-platform`'s operations reference gains two rows and two clauses. `os environments use-runtime <url> --token <key>` makes a self-hosted runtime the deploy target: the key is tried on the runtime first (`--no-verify` skips that), kept in `~/.objectstack/cloud.json` (0600) across cloud login and logout, and `--forget` or `os environments switch` targets the cloud again. The `os deploy` row says how it deploys to that runtime (build, dry-run plan, inline install, live on `hotLoaded`, `--confirm-access-upgrade`), and the `os package install` row says it falls back to that runtime with no `-u`. `os mcp connect` registers an environment's MCP server with Claude Code, `--url` for a self-hosted or local server (named `objectstack`), `--name`, `--print`, and stores no token. Paid by cutting restatement in the same file and two rows that misstated `os login` and `os register`. Two new eval cases cover the commands. The CLI behaviour already shipped; this release only teaches it.
- 620b6e6: docs(skills): drop the "separate objectui repo" teaching, list objectui in the catalog index, repair three dead anchors, and author `sharingModel` in the object examples
  
  Clause-②: no
  Metadata-protocol: none
  
  - `objectui`: the README installs the skill from `@objectstack/skills` with the pinned `experimental_sync` command the catalog README teaches, instead of `npx skills add objectstack-ai/objectui`, and its source link and `page-builder.md`'s `plugin-gantt` link point at `ui/` in this repository. The catalog README's "Related repositories" entry points there too.
  - The generated skill index in `skills/README.md` and the docs Skills reference now list `objectui` (eleven skills). The generator admits every skill directory with a `SKILL.md` that is not `metadata.internal`, instead of only `objectstack-*` names.
  - Dead links fixed: `data-hooks.md`'s reference to a hooks section the data `SKILL.md` no longer has is removed, and `plugin-lifecycle.md` / `service-registry.md` point at `references/plugin-development.md`, where the Complete Plugin Example and the Well-Known Plugin Names table live.
  - `bootstrap.md`'s starting `package.json` pins `18.3.0`, the version every skill now carries.
  - Every complete `ObjectSchema.create` example in `relationships.md`, `lifecycle.md` and `datasources.md` authors `sharingModel`, because a publish without one is refused with `security-owd-unset`. Master-detail children use `controlled_by_parent`, and the read-only external object uses `public_read`.
  - `indexing.md`: the tenant column is `organization_id`, injected by `systemFields.tenant`, not an authored `tenant_id`.
  - `objectstack-query`: teaches `$empty`, the is-empty-by-declared-type operator that the view filters `is_empty` / `is_not_empty` lower to.
  - `objectstack-upgrade`: the `skills remove` roster also removes a 17.x `objectui` install (sourced from `objectstack-ai/objectui`), and says `objectstack-pm-dispatch` is not in the 18 catalog.
  - New eval cases cover the authored `sharingModel`, the `organization_id` tenant index and `$empty`. The touched files stay inside their token ceilings by removing restatements in the same files. No schema, key or behaviour changes.
- 7e8b31c: docs(skills): objectstack-ui teaches the action `preflight` read
  
  Clause-②: no
  Metadata-protocol: none
  
  - `skills/objectstack-ui/rules/actions.md` gains one bullet beside `submitText`: `preflight` sends one same-origin `GET` before submit and shows the answer above the params, with its shape, the three holes it accepts, `fields` rows as in `resultDialog.fields`, `seed` filling a read-only param (seeded once, no default or carry-over, read by no hole), and where it is refused (no `params`, `execution: 'aggregate'`).
  - The `views-apps-actions-pages` eval gains a case for a param dialog that reads a plan before submit and submits its token through `seed`.
  - Nothing to do on upgrade: the key is already accepted and drawn by the console; this only teaches it.
- cc543b4: docs(skills): objectstack-ui teaches who sees an app (`tabPermissions`) and who may open it (app `requiredPermissions`)
  
  Clause-②: no
  Metadata-protocol: none
  
  `objectstack-ui` `rules/navigation.md` gains § Who sees or opens an app. A permission set's `tabPermissions: { APP_NAME: 'hidden' }` takes an app off its holders' Home tiles, App Switcher and `app:launcher` block (`GET /api/v1/me/apps` drops it); `/api/v1/meta/app` still serves it and its URL still opens, so it is visibility, not access. Any other value for that app on another set the person holds (`visible`, `default_on`, `default_off`) outranks `hidden`, so the set everyone holds must carry no `tabPermissions` entry for it. Access is the app's `requiredPermissions` plus a `systemPermissions` grant on the holders' permission set, and administrators need that grant too. The app's own `hidden: true` keeps it off the switcher for everyone. There is no per-position default app: an app's `isDefault` is global. `SKILL.md` § App Navigation points at the section, `objectstack-data` `rules/security.md` gains one line under permission sets, and the `objectstack-ui` evals gain a case.
  
  The new text is paid for inside each file: the `hidden` and `defaultAgent` comments of the `App.create` example (the first now lives in the new section, the second is taught by `objectstack-ai`), and sentences that repeated a rule stated beside them.
- 6be1d17: docs(skills): objectstack-ui teaches at most one app per package, and that a module package may carry its own app
  
  Clause-②: no
  Metadata-protocol: none
  
  `objectstack-ui` `SKILL.md` § App Navigation no longer says more audiences are "never a second app". It now states the rule of ADR-0019 (app-as-consumer-unit) D3 as amended: at most one app per package, and `defineStack` refuses a second app in a `type: 'app'` package. A suite (an app package plus its modules) may surface more than one app: a `type: 'module'` package may carry its own app, which is served under the module's package id and is gone when the module is disabled. Audiences that share one product and its objects stay `requiredPermissions`-gated groups inside one app. The `objectstack-ui` eval about a second app for the support team now grades that rule.
  
  The new text is paid for inside `SKILL.md` by deleting asides that carried no rule: the brand comparison in the line-item grid paragraph, the lead-in sentence above the CRM UI Blueprint table, and two parenthetical notes in the `position` pitfall.

## 18.3.0

### Minor Changes

- a9f654e: feat!: ownership queues: records wait in a queue until a member claims them, and assignment rules route new records (ADR-0142)
  
  Clause-②: yes (narrowing)
  Metadata-protocol: narrowed
  
  <!-- adr-0087: registered object-queue-field-reserved -->
  
  **BREAKING** for one shape only: an object whose records have a user owner (`ownership: 'user'`, the default) can no longer declare its own field named `queue`. The platform now injects a `queue` column on every such object, and `registerObject` refuses the declaration with `422 INVALID_METADATA` (`ObjectQueueColumnRefusedError`), naming the object. An `objectExtensions` entry that declares `queue` on such an object is not refused, because an extension is folded over its object at read time: its `queue` is ignored, the platform's column stands, and a warning names the extension. The remedy: rename the business field (for example `support_queue`) and copy its data across, or, when the object's records have no user owner, declare `ownership: 'business_unit'`, `'org'` or `'none'`. The upgrade guide entry is `object-queue-field-reserved`.
  
  Beside that, two enum additions: `ShareRecipientType` gains `queue` (a sharing rule can now name a queue as its recipient), and the `queue` approver type is authorable again (it leaves `NON_AUTHORABLE_APPROVER_TYPES`, so it is no longer marked deprecated). Two metadata types are new: `queue` and `assignment_rule`.
  
  - **`@objectstack/spec`**: new `queue` and `assignment_rule` metadata types (`QueueSchema`, `AssignmentRuleSchema`) and the stack keys `queues` and `assignmentRules`. A declared queue's members are positions. New `IOwnershipQueueService` contract, registered under `ownership-queue`. `queue` joins the injected system columns of `ownership: 'user'` objects and `PUBLIC_FORM_SERVER_MANAGED_FIELDS`. `APPROVER_VALUE_BINDINGS.queue` reads both a declared queue and an organization's `sys_queue` row, and `APPROVER_ORG_SCOPED.queue` is `true`. The explain rule kinds `queue_membership` and `queue_claim` are new. `QUEUE_NOT_FOUND` (422) is registered under plugin-security.
  - **`@objectstack/objectql`**: objects with `ownership: 'user'` get a system-managed `queue` column beside `owner_id`. Declaring your own `queue` field on one is refused at registration (`INVALID_METADATA`), and an extension's own `queue` field on one is ignored with a warning. An update can carry a write precondition: when it no longer matches, the update answers `409 CONCURRENT_UPDATE`. Declared assignment rules run once for each inserted row that has no owner and no queue after the `beforeInsert` hooks. A rule can park the row in a queue, or pick a member by `round_robin` or `least_loaded`. Assignment never refuses an insert. `kernel:ready` refuses to boot a stack that declares queues or assignment rules when no `ownership-queue` service is registered.
  - **`@objectstack/metadata-core`**: `queue` is classified as an injected system column.
  - **`@objectstack/metadata`**: the artifact door registers a stack's `queues` and `assignmentRules`, so an artifact-only runtime serves them.
  - **`@objectstack/plugin-sharing`**: three new objects, `sys_queue`, `sys_queue_member` and `sys_assignment_cursor`, and the `ownership-queue` service. The service resolves a queue name from the registry first, then from the organization's own rows, and has one member expander. A record with no owner that sits in a queue can be read and edited by the queue's members, never deleted. The `queue` sharing recipient grants matched records to the queue's members, and its grants are recomputed when membership changes or the queue is switched on or off.
  - **`@objectstack/plugin-security`**: the owner gate handles `queue`. A **claim** sets `owner_id` from empty to yourself, by id. It is admitted when the sharing model allows you the record, and only one claimant wins: the loser gets `409`. A **release** gives your own record back to its home queue. A **move** to another queue needs the transfer grant, and a queue name that does not resolve is refused with `422 QUEUE_NOT_FOUND`. An insert that names a queue needs the transfer grant or membership of that queue. A guest can supply neither. Explain reports the queue reasons on the sharing layer.
  - **`@objectstack/plugin-approvals`**: a `queue` approver resolves to the queue's members when the step opens. An empty queue adds nobody and logs a warning. The `queue:<name>` placeholder is never written again.
  - **`@objectstack/lint`**: a queue-only approval node is reported `approval-approvers-may-resolve-empty`, and the org-axis red line admits the queue recipient. Two new advisory rules come with `os explain` entries: `assignment-rule-user-target` (warning) and `assignment-rule-queue-unstaffed` (info).
  - **`@objectstack/cli`**: the organization-ownership inventory lists `sys_queue`, `sys_queue_member` and `sys_assignment_cursor`, so `os migrate organization-ownership` plans them instead of refusing.
  - **`@objectstack/runtime`**: `POST /security/_activation/:type/:name` also switches a declared `queue` or `assignment_rule` on and off.
  - **`@objectstack/platform-objects`**: the two new metadata types' labels, and the queue recipient option, are translated in zh-CN, ja-JP and es-ES.
  - **`@object-ui/app-shell`**: the flow designer no longer warns that a queue approver resolves to nobody.
  - **`@objectstack/skills`**: the platform skill lists `queues` and `assignmentRules` among the stack's top-level keys.
  
  What to do: rename any `queue` field on a user-owned object, or in an extension of one, as above. Every other existing stack behaves as before. To use queues, declare `queues` and `assignmentRules` in your stack, and make sure plugin-sharing is installed: it registers the `ownership-queue` service.
- e3470ed: feat(security)!: `current_user.queues` is resolved by the platform from the ownership-queue service, and `queues` joins the reserved `current_user` keys (#27016)
  
  Clause-②: no (narrowing) — `queues` joins `RESERVED_RLS_MEMBERSHIP_KEYS`, so an object's `membershipKeys` may no longer declare a key named `queues`, and a registered membership resolver's `queues` answer is screened off. Nothing is widened past what the platform itself resolves: where no app supplied the key, a policy reading `current_user.queues` matched no rows before, and now it matches the caller's own queues.
  Metadata-protocol: narrowed
  
  <!-- adr-0087: not-required (no-migration-prescription) No key, export or type is removed or renamed: one name is added to the reserved list, which makes a membership key of that name refused at parse. The replacement name is the author's to choose, so there is no mechanical rewrite to prescribe and no tombstone. -->
  
  **BREAKING** accept-set narrowing in `@objectstack/spec` (`MembershipKeyNameSchema`, read through `ObjectSchema.membershipKeys`) and at the membership resolver screen in `@objectstack/plugin-security`.
  
  - **Now.** A row-level security policy can read `current_user.queues`: the machine names of the ownership queues the caller belongs to in the active organization, directly or through a position, team or unit, as each queue's members define. The security plugin resolves it from the ownership-queue service's `queuesOf`, the same membership answer the claim gate's `isMember` reads, once per request and only when a policy about to compile reads the key. For example `owner_id == null && queue in current_user.queues` lets queue members read the unowned records sitting in their queues.
  - **One source.** No other source can supply the key. A registered `rls-membership-resolver` that answers `queues` has that answer dropped with a WARN, a `rlsMembership` bag entry or a `queues` field on the execution context is never read, and a context copied for another user or organization does not carry the set. With no signed-in user, no ownership-queue service, or a membership read that fails, the key stays unresolved and every policy reading it matches no rows.
  - **Who moves.** An object that declares `membershipKeys: { queues: … }`, or a membership resolver that lists `queues` among its keys. Census on this repository at 7eb613c3: none in `packages`, `examples`, `qa`, `skills` or `content`.
  
  **The remedy.** Rename the membership key. `queues` is resolved by the platform; choose a name that says what your set holds.
- 6dbff8e: feat(spec,ui)!: the record page's `slots.tabs` is retired — a slotted page fills six slots, and a page that needs its own tab strip is `kind: 'full'`
  
  Clause-②: no (narrowing)
  
  Metadata-protocol: narrowed (`page.slots.tabs` is a tombstone that refuses every value; `slots.related` / `slots.relatedLists` are refused by name instead of being read as `tabs`)
  
  <!-- adr-0087: registered page-slots-tabs-removed, page-slots-tabs-retired -->
  
  **BREAKING** accept-set narrowing on the record page (`@objectstack/spec`), with the console following it in the same release.
  
  The record page composes its tabs and columns from the object's roles and relationship flags. An authored `tabs` slot replaced that whole strip, so a page that used it lost every synthesized related list and its wide-screen columns. The slot is gone; the six live slots (`header`, `actions`, `alerts`, `highlights`, `details`, `discussion`) are unchanged.
  
  - **FROM → TO.** `slots: { tabs: … }` on a `kind: 'slotted'` page → delete the key. To change which related lists appear or their order, set `relatedList` / `relatedList: 'primary'` on the child's reference field; to replace the Details body, author `slots.details`; a page that needs its own strip is `kind: 'full'` and authors its header, highlights, `page:tabs` strip and `record:discussion` in `regions`, drawn as authored.
  - **The one-line fix.** `os migrate meta --from 17` lists the edit for existing sources, and `--write` applies it. A stored `sys_metadata` page is converted when it is read (the `page-slots-tabs-removed` conversion): the slot is dropped, and a page whose only slot it was becomes an empty slotted page, which renders the synthesized default. Whether such a page should become `kind: 'full'` is a judgement the conversion cannot make; the upgrade guide entry `page-slots-tabs-retired` lists it.
  - **What the parse says.** `slots.tabs` is refused with its prescription ("`page.slots.tabs` was removed in @objectstack/spec 18.3.0 (ADR-0085) — …") at `defineStack` as `STACK_SCHEMA_INVALID` / 422, and at the metadata save door. `slots.related` and `slots.relatedLists` are refused by name with the same remedy. TypeScript rejects `tabs` in a `definePage` slot map.
  - **The pair check.** `checkPageSlotPair` (the `details` + `tabs` refusal) is removed from `@objectstack/spec/ui` with the slot it paired; the `page-slots-details-beside-tabs-refused` upgrade entry is folded into `page-slots-tabs-retired`.
  
  The four in-repo pages that authored `slots.tabs` are rebuilt as `kind: 'full'` pages that render the same nodes in the same order: `sys_user_detail` and `sys_organization_detail` (`@objectstack/platform-objects`), `sys_approval_request_detail` (`@objectstack/plugin-approvals`) and the showcase `showcase_project_detail`.
  
  The console (`@object-ui/*`): `buildDefaultPageSchema` composes from the six slots only, and `RecordDetailView` lays every slotted page out by width (three columns from 1280 px), since none can opt out with an authored strip any more. `@object-ui/types` drops the pair check from its page schemas and types `PageSlotMap.tabs` as `never`. The Studio slot canvas lists six slots.
  
  `@objectstack/skills`: the UI skill says a slotted page has no `tabs` slot and how to shape the strip instead.
- c63ce2a: feat(spec): an object declares the business order of its related lists (`relatedLists`), and `relatedList: 'primary'` places a list instead of ordering it
  
  Clause-②: yes (widening)
  Metadata-protocol: semantic
  
  The order of a record page's related lists was not authorable: owned (`master_detail`) children came first and lookup children after, each in the order the packages declared them, so a lead's related lists were in an order nobody chose.
  
  - **`@objectstack/spec`**: `ObjectSchema` gains `relatedLists?: string[]`, beside `highlightFields`. It is an ordered list of inbound relationships, most important first. Each entry is a child object name (`'task'`, every list of that child) or `object.field` for one FK when the child points at this object through several (`'event.related_to'`). Listed lists come first in that order, and the rest follow in the old derived order. `defineStack`, and so `os validate` and `os build`, refuses an entry that matches no inbound `lookup` / `master_detail` field with `STACK_CROSS_REFERENCE_INVALID`, naming the entry and the relationships that do exist. A child declared only by a sibling package, or a platform object, is not judged there. The runtime publish door gives the same verdict on an object write (`related-list-ref-unknown`, HTTP 422 `INVALID_METADATA`), judged against the objects the registry and the stored rows hold, so a Studio, REST or MCP author is refused too. `ObjectFieldGroupSchema` gains `relatedList?: string`, spelled the same way: a group that carries it stands for that list's table in the record's details column instead of a section of fields, and a field that names such a group as its `group` is refused at parse. The record page v3 layout draws that placement; until then such a group is not drawn, as any group without fields is not. The Studio object form offers both keys.
  - **`relatedList: 'primary'` changes meaning.** It no longer orders lists; `relatedLists` does. It now says where a list is drawn: in the record's body as a full-width table rather than as a side card, which on today's tabbed record page is still its own tab. And a `master_detail` FK that sets `inlineEdit` (any arm) and declares no `relatedList` is now `'primary'` by default, so inline-edited line items get their own tab on the tabbed page. Write `relatedList: true` on that FK to keep the old placement in the shared Related tab. `relatedList: false` still hides a list whatever `relatedLists` says.
  - **`@object-ui/app-shell`**: `deriveRelatedLists` resolves the order in one pure function, `resolveRelatedListOrder`, and marks the inline-edit default as `isPrimary`. Studio's related-list control on a relationship field reads that default too: an inline-edited `master_detail` with no `relatedList` shows as Primary, and picking Show there writes `relatedList: true`.
  - **`@objectstack/lint`**: new reference-integrity member `validateRelatedListRefs` (rule `related-list-ref-unknown`, `error`), on the CLI and on `object` writes at the runtime publish gate. A child the snapshot does not hold is refused only when no package closure is in force; under a closure it is not judged.
  - **`@objectstack/metadata-core`**: the served object's field-level-security scrub classifies `relatedLists` and a field group's `relatedList` as relationship names, not fields of the object, so a caller denied a field still receives them.
  - **`@objectstack/platform-objects`**: the two new form rows are labelled in en, zh-CN, ja-JP and es-ES.
  - **`@objectstack/skills`**: objectstack-data's relationship rules teach `relatedLists` and the placement reading of `'primary'`; objectstack-ui's related-list bullet follows.
  
  In this repo three record pages move on merge, each gaining its own line-items tab out of the shared Related tab: `crm_opportunity` (its `crm_opportunity_line_item.opportunity` FK), `showcase_invoice` (`showcase_invoice_line.invoice`) and `showcase_expense_report` (`showcase_expense_line.expense_report`). Each FK sets `inlineEdit: 'grid'` and declares no `relatedList`.
  
  What to do: nothing, unless an object has a `master_detail` child with `inlineEdit` that should stay in the shared Related tab; write `relatedList: true` on that FK. To choose the order of an object's related lists, declare `relatedLists` on it.
- 73b7270: feat(spec): `currencyConfig.homeAmount: { field, rateDate, rateField }` — a record-mode amount declares its stored home-currency amount by pointer (ADR-0144 D5)
  
  Clause-②: yes (widening)
  Metadata-protocol: added
  
  ⛔ Not released alone: this ships in the same release as the write-time home-currency projection that fills these fields (ADR-0144 D9, release R2: "the `homeAmount` key never ships ahead of the engine").
  
  An amount in `currencyMode: 'record'` can now declare where its value is stored after conversion into the organization's home currency (the `localization.currency` setting), which date picks the exchange rate, and where the rate used is stored. Consolidated totals then aggregate the home field like any other stored currency field.
  
  ```ts
  fields: {
    currency_code: Field.text({ label: 'Currency', valueDomain: 'iso_4217_currency' }),
    invoice_date: Field.date({ label: 'Invoice date' }),
    amount: Field.currency({
      label: 'Amount',
      currencyConfig: {
        currencyMode: 'record',
        currencyField: 'currency_code',
        homeAmount: { field: 'amount_home', rateDate: 'invoice_date', rateField: 'amount_rate' },
      },
    }),
    amount_home: Field.currency({ label: 'Amount (home)', readonly: true }),
    amount_rate: Field.number({ label: 'Rate used', readonly: true }),
  }
  ```
  
  - **Three required pointers.** When `homeAmount` is declared, `field`, `rateDate` and `rateField` must all be given, and none may be empty. There is no default, no injected column and no fixed field name. The document date is never taken from `created_at`. `homeAmount` is refused under `dynamic` and `fixed`.
  - **What the pointers name, refused at parse with a remedy and the object's candidates.** Each refusal is located at `fields.AMOUNT.currencyConfig.homeAmount.POINTER`.
    - `field` must name another `currency` field of the same object in `dynamic` mode (it displays in the home currency, so metadata never names that currency). No other amount may already store into it.
    - `rateDate` must name a `date` or `datetime` field.
    - `rateField` must name a `number` field. Two amounts may share it only when they have the same `currencyField` and `rateDate`.
    - The amount itself must be a stored `currency` field. A `formula` amount is refused.
  - **The home and rate fields are written by the platform only.** They must declare `readonly: true`, the existing mark that drops a client's write of the field, and no `expression`.
  - **Skills:** `objectstack-data/rules/field-types.md` teaches `homeAmount`. Its field names (`amount_home`, `amount_rate`) are examples, not a contract.
  - **Nothing to migrate.** `homeAmount` is new, and no existing config changes meaning.
- fbb8bec: fix(spec): a count roll-up saves without `summaryOperations.field`
  
  Clause-②: yes (widening)
  Metadata-protocol: added
  Skills-docs: updated here — `skills/objectstack-data/rules/field-types.md` spells `field?` in the `summary` config row, with "(omit for `count`)"; the same file's `sum` example drops its now-duplicate "ignored for count" comment, so the file's size is unchanged.
  
  The description of `summaryOperations.field` always said it is ignored for `count`, yet the schema required it for every function, so a count roll-up with no child field was refused (`422 INVALID_METADATA` at `fields.<name>.summaryOperations.field`, "expected string") and Studio's author had to pick an arbitrary child field to save one. The schema now follows its own description:
  
  - **`count` may omit `field`.** A count counts the matching child rows and reads no field, so `{ object, function: 'count' }` parses and saves as written. A count that carries a `field` is still accepted, and the field is still ignored.
  - **Every other function still needs it.** `sum`, `min`, `max` and `avg` without `field` are refused at `summaryOperations.field`, and the message names the function and the fix: name the child field to aggregate, or use `function: 'count'`.
  - **One rule, read twice.** `summaryFunctionReadsField(fn)` (exported from `@objectstack/spec/data`) is where "does this function read a child field" is written. The schema's refusal reads it, and Studio's roll-up editor reads it: for a count the editor offers no "Child field to aggregate" control, only a note that a count needs none, and saves the roll-up without `field`.
  - **The engine counts it.** The roll-up index carries no source field for such a count (`SummaryDescriptor.sourceField` is now optional), and the recompute and bulk-insert paths count child rows without reading one, as they already did for every count.
  - **Published JSON Schema.** `summaryOperations.field` is no longer in `required`; the "required unless `count`" rule is a refinement the JSON Schema does not state, so `summaryOperations` joins the dropped-refinements ledger at each schema that embeds a field.
  - **Metadata forms.** The `field` sub-row of the roll-up composite (field editor and object quick-add grid) is no longer marked required; its help text, "ignored for count", is unchanged.

### Patch Changes

- 09abc05: docs(skills): the objectui testing guide stops teaching msw and shows a fetch double over the real adapter
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** `skills/objectui/guides/testing.md` taught "MSW for API mocking in integration tests" with `import … from 'msw'` and `msw/node`. No package in this stack declares `msw` any more, so a test written from the guide cannot resolve its imports.
  - **Now.** The subsection shows the pattern this repository's own integration tests use: a `vi.fn` passed as the `fetch` of a real `ObjectStackAdapter`, so the adapter and client run and only the wire is faked. It names one real test as the worked example. The guide stays within its token ceiling (3101 of 3101).
- 4df40e2: docs(skills): objectstack-upgrade says a stored row in a ≤16.x shape stops being rewritten at read on 18.3, and teaches the stored pass on 18.2 or earlier first
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** § "Stored rows" said every stored-row rehydration replays the conversion chain including entries retired from the load path, so "a row written under protocol 16 therefore rehydrates in its protocol-17 shape without anybody editing it", and offered `os migrate meta --stored --apply` only as a way to make that durable. § 3.6 called the read-time rehydration "still the guarantee", the report template marked the stored pass optional ("rows rehydrate correctly today"), and eval 4 expected the same answer. On 18.3, which drops every conversion retired at or below 16.x, that advice leaves such a row unconverted for good.
  - **Now.** The section says rehydration replays only the conversions the installed release still carries, that 18.3 drops those retired at or below 16.x, and to run the stored pass on the release being left (18.2 or earlier for such a row) before moving; § 3.6 says the `os migrate meta --stored --json` exit `0` counts only on the release being left, because one that dropped a row's conversions answers `0` without recognising the row; the report template's stored-pass line says it is owed before any release that drops the rows' conversions. Eval 4's expected answer says the same, and new eval 5 asks the 18.1 → 18.3 question directly.
  - `SKILL.md` and `references/examples-upgrade.md` stay under their token ceilings (no ceiling moves). No schema, key, command or behaviour changes.
- 501bfc6: docs(skills): objectstack-data, -automation and -platform teach ownership queues and assignment rules (ADR-0142 phase 2), one eval each
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** The `queue` and `assignment_rule` metadata types, the `queues` / `assignmentRules` stack keys, the reserved `queue` column, the claim / release / move verbs, the `queue` sharing recipient and the `queue` approver type shipped in the spec and the docs, but no published skill taught them — `objectstack-platform` listed the two keys without a sentence, and no eval exercised any of it. An agent authoring an app from the skills could route an ownerless record only by hand-rolling it: a per-record picklist, a round-robin counter field, or a hook that picks an owner.
  - **Now.** `objectstack-data` gains *Ownership queues — park a record for a team to claim* (the injected `queue` column, a compiled `defineQueue` example, claim / release / move in one sentence each) and `rules/security.md` the `queue` sharing recipient and the `current_user.queues` placeholder; `objectstack-automation` gains *Assignment rules — route a new record to a queue or a person* (a compiled `defineAssignmentRule` example with `criteria`, `assignTo: { type: 'queue' }`, `strategy` and `load`, and the `queue` approver pointer); `objectstack-platform` says what `queues` and `assignmentRules` are and that both need `sharing` in `requires`. One eval per skill asserts the declared shape and refuses the hand-rolled alternatives.
  - Every file stays at or under its token ceiling: the new text is paid for by folding sentences the same skill's `rules/**` and `references/**` already hold, and by tightening existing eval model answers. No ceiling moves, no frontmatter changes, no schema, key or behaviour changes.
- f986702: docs(skills): objectstack-automation says a `runAs: 'system'` flow is refused identity-assignment writes, and names the remedy
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** The `runAs: 'system'` guidance called system context the trusted-writer channel and never said that a system flow's insert, update, delete, transfer, restore or purge of `sys_user_position`, `sys_user_permission_set`, `sys_invitation` or `sys_member` is refused with `PERMISSION_DENIED`. An agent following the skill wrote a system flow to grant a permission set and met the refusal at run time.
  - **Now.** A paragraph beside "Elevate the write, not the flow" states the refusal, says a dedicated system subflow does not lift it, and gives the remedy the refusal prescribes: grant positions and permission sets from a flow whose `runAs` is `'user'`, judged by the delegated-administration gate as the user it acts for; change invitations and memberships through the organization endpoints. Eval 11 in `evals/flows-triggers-approvals.json` checks that an answer routes such a grant through a `runAs: 'user'` flow.
  - No schema, key or behaviour changes.
- a76f811: fix(skills): objectstack-automation eval fixtures 5, 7 and 8 agree with their own assertions
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** Three ideal answers in `evals/flows-triggers-approvals.json` failed the assertions that grade them: eval 5 spelled the negated error-label string inside its answer, eval 7 never spelled the `type: 'position'` approver it requires and spelled the negated positions check, eval 8 never spelled the `type: 'screen'` flow kind it requires. Graded against those assertions, a correct answer scored wrong.
  - **Now.** The three ideal answers say each negation in words, eval 7 names `approvers: [{ type: 'position', value: 'finance_manager' }]`, and eval 8 opens with the flow kind. No fixture added or removed; the assertions and the skill's teaching are unchanged.
  - No schema, key or behaviour changes.
- b1b153a: docs(skills): objectstack-ui gains an eval for a report's `dateRange` and `exportOptions`
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** The skill taught a report's `dateRange` in `rules/dashboards.md`, but no eval checked that an agent authoring a report reaches for `dateRange` on a `type: 'date'` dataset dimension and for `exportOptions` with `csv` / `xlsx`. An agent could hand-roll a `runtimeFilter` window on the date column, invent a report permission key for export, declare a second preset table, or place either key on a `joined` container, and nothing scored that wrong.
  - **Now.** A third eval file, `evals/report-period-export.json`, carries one report-authoring prompt whose assertions require `dateRange: { dimension, defaultRange }` and `exportOptions` with `'csv'` / `'xlsx'`, name the existing permission-set `allowExport` as the only export gate, and refuse a `joined` container, a `close_date` filter window, a `presets:` table and an invented permission key. `evals/README.md` lists the file.
  - No schema, key or behaviour changes.
- e269d3b: docs(skills): objectstack-automation says a paused screen's Next / Submit and step count are engine-served, never authored
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** The `screen` node row described the fields an author declares and said nothing about the primary button or the step counter. An agent writing a wizard from the skill could hand-roll a "Submit" label or a "Step 2 of 4" into `fields`, or try to author `progress` on the screen node, and the skill did not say that the runtime answers both from the flow graph.
  - **Now.** The `screen` node row says that Next / Submit and "Step N of M" are not authored: when a screen pauses the engine reads the graph and serves `progress` (`nextScreen: 'none' | 'possible' | 'certain'`; `step` / `stepCount` only when every path agrees), and the runner labels the button and draws the counter from that alone. A `decision`, a `fault` edge, a loop back, a non-screen pause (`approval`, `wait`) or a `subflow` after a screen answers `possible`, which shows "Next" with no count. A `progress` key in the node `config` is refused; a hand-rolled label or counter in `fields` is wrong.
  - No schema, key or behaviour changes. No eval prompt: `evals/flows-triggers-approvals.json` sits at token-ratchet headroom 0.
- 4b8f8cd: docs(skills): the i18n skill's group table names `fields.{field}.inlineTitle` and `reports.{report}.blocks.{block}.{label,description}`
  
  Clause-②: no
  Metadata-protocol: none
  
  `skills/objectstack-i18n/SKILL.md` did not name two keys the 18.2 translation bundle already accepts and the runtime already serves, so an AI author writing a bundle from the skill left a master-detail field's inline child-grid heading and a joined report's block headings in the authoring language. The `fields.{field_name}` row now names `inlineTitle` (addressed on the child object that owns the field; untranslated it keeps its authored text, with no fallback to the child's plural label), the `reports` sentence names `reports.{report}.blocks.{block_name}.{label,description}` (keyed by the block's required `name`), and one example row each, spelled as the shipped `app-crm` and `app-showcase` bundles spell them, follows the group table. The eval file gains one prompt covering both keys.
- 40264be: docs(skills): objectstack-formula evals check that a record name built from a select field reaches for `label(record.kind)`, and that a predicate never calls `label()`
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** `skills/objectstack-formula/SKILL.md` teaches `label(record.f)`, but no eval in `evals/cel-predicates-formulas.json` exercised it: an agent authoring a record name from a select field could hand-roll a ternary over the stored value with hard-coded English or Chinese strings, and nothing caught it; nor did anything catch `label()` written into a validation rule, where it faults and aborts every write.
  - **Now.** Eval 6 asks for a `contract_version` name built from its `kind` select and expects `label(record.kind)` in an `F` formula, refusing a `== 'clean' ?` ternary. Eval 7 asks for a validation rule and a `visibleWhen` on the same object and refuses `label(` in either, expecting predicates over the stored value. Four sentences in evals 1, 2, 3 and 5 that restated their own `must_not_contain` assertions are gone; every fact and assertion stays.
  - No schema, key or behaviour changes.
- d7dd47a: docs(skills): the objectstack-platform skill teaches the `demoStaff` `manager` key — another entry's email, written as `manager_id` by the development boot (#26764)
  
  Clause-②: no
  Metadata-protocol: none
  
  The Demo accounts section of `objectstack-platform/SKILL.md` now names a line manager in its `demoStaff` example and says how the key behaves: `manager` is another entry's `email`; `os dev` writes `sys_user.manager_id` itself once every demo account exists and keeps a manager someone set by hand, so no seed hook writes it; a display name, an address no entry has, the entry itself or a loop is refused at load. One eval case in `evals/config-plugins-ops.json` expects the key and forbids a seed writing `manager_id`. Three restatements elsewhere in the skill were cut against the addition, each rule keeping its other home in the file; the remainder raises the file's token ceiling by the measurement.
- 4889e22: docs(skills): the objectstack-ui report example declares its download in `exportOptions` under the base object's `allowExport`
  
  Clause-②: no
  Metadata-protocol: none
  
  `rules/dashboards.md` 〈Report Configuration〉 taught a report's `dateRange` and not its `exportOptions`: the example now declares `exportOptions: { formats: ['csv', 'xlsx'] }` (optional `includeHeaders` / `fileNamePrefix`) and the note says who may download is the base object's permission-set `allowExport` and that a `joined` report takes neither key, paid for by folding the `dateGranularity` and `drilldown` restatements that the same file already teaches under Server-side date bucketing and Drilldown.
- e6e0faa: docs(skills): the actions rule, its eval and the i18n skill teach an action's `disabledReason`
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** `ActionSchema.disabledReason` (the display-only sentence a greyed action shows beside its `disabled` predicate) was on the protocol, but no published skill named it. An agent authoring an action from the skill left the console's default "Not available for this record" in place, or wrote the reason into `description`.
  - **Now.** `objectstack-ui/rules/actions.md` has one bullet beside `disabled`: an I18nLabel, display-only, never a predicate or a gate; omitted keeps the console's default, a blank one is refused, and `disabledMessage` / `disabledTooltip` / `disabledHint` / `disabledText` are refused naming the key; the ReassignLead example carries it beside `disabled`. Eval 9 in `evals/views-apps-actions-pages.json` expects `disabledReason` beside a `disabled` predicate and forbids the reason in `description`; cases 5 and 8 are reworded so neither spells its own `must_not_contain` string. The `objectstack-i18n` group table lists `disabledReason` under `_actions.{action_name}` (and so under `globalActions.{action_name}`) beside `confirmText` / `successMessage`.
  - No schema, key or behaviour changes.
- 1bd7574: docs(skills): objectstack-formula eval case 4's reference answer names the refused date forms without spelling its own `must_not_contain` strings
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** Case 4 of `skills/objectstack-formula/evals/cel-predicates-formulas.json` refuses `new Date(` and `today() + ` in an answer, yet its own `expected_output` spelled both (`` `new Date()` `` and `` `today() + 45` ``), so a reference-grade answer was graded wrong.
  - **Now.** The reference answer says "never a JS `Date` / `Date.now()`" and "never date arithmetic on `today()` (it faults)", as case 7 names "the `label` macro". Every assertion and every fact stays: the CEL envelope seed, the determinism gate, `daysBetween(today(), record.close_date)`, the `{}` duration trap. A per-case cross-check (no `must_not_contain` string inside its own `expected_output`, every `must_contain` string present) reports 0 failures over all 7 cases; the file keeps its byte size, so its token-ratchet row does not move.
  - No schema, key or behaviour changes.
- 857cd3c: docs(skills): objectstack-i18n teaches the `books` translation group, with an eval for a two-language doc book
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** The top-level group list in `skills/objectstack-i18n/SKILL.md` named fourteen of the bundle's fifteen groups and left out `books`, the group the spec added so a doc book's title and section titles follow the reader's locale. An agent writing a zh-CN bundle from the skill left the docs sidebar in one language or invented a key under `pages`.
  - **Now.** The list names `books` with its three keys — `books.{book}.label` / `.description` by `Book.name` and `books.{book}.groups.{group_key}.label` by each group's stable `key` — says the pages themselves localize through `doc.translations` and that a book's inline `translations` map stays retired; `os i18n extract --no-objects-only` seeds the group like every other. Eval 9 in `evals/bundles-locales-coverage.json` checks that an answer for a two-language manual spells the book label and a group label by key and never a `pages.*` key. Five eval sentences that restated a rule the skill already teaches were cut to pay for it.
  - No schema, key or behaviour changes.
- 5fe0b96: docs(skills): an objectstack-data eval asks for a hook's `refusals` catalogue instead of a sentence thrown from the body
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** `references/data-hooks.md` teaches a hook's declared `refusals` catalogue (the body throws `{ code }`, the message is translated under `hooks.HOOK.refusals.CODE.message`), but no eval in `evals/hooks-security-seeds-datasources.json` exercised it: an agent asked for a refusal in a multi-language app could still write an English sentence into `throw new Error(...)`, which reaches zh-CN users untranslated, and nothing scored that wrong.
  - **Now.** Eval 7 asks for an `order` save refused over the account's credit limit in an app serving English and Chinese users, and expects `refusals: { CREDIT_LIMIT: { message } }` on the hook, a `language: 'js'` body that throws `{ code: 'CREDIT_LIMIT' }`, and the zh-CN sentence under the bundle's `hooks: { HOOK: { refusals: { CREDIT_LIMIT: { message } } } }`; it refuses a sentence on the throw (`new Error('`) and a `handler:` (a catalogue without a `js` body is refused at save). Five sentences in evals 1–5 that restated their own `must_not_contain` assertions are gone; every fact and assertion stays.
  - No schema, key or behaviour changes.
- f6e1db1: docs(skills): objectstack-formula gains an eval for a mail amount shown in each record's own currency (`currency:@path`)
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** The skill taught `{{ amount | currency:@currency_code }}` for a mail template that shows each record's amount in that record's own currency, but no eval checked that an AI author reaches for it. An author could write a bare path after the colon (refused at authoring), hard-code one currency code for every record, or leave the argument out (the organization's default currency for every record), and nothing scored that wrong.
  - **Now.** Case 8 of `evals/cel-predicates-formulas.json` asks for an `email_template` that mails one overdue notice per contract with the amount in that contract's own currency. Its reference answer names the marked form, that only a mail template may read the code from the send's data, that the stored code is three capitals exactly as stored, and that a declared `variables` list must name the path or a root above it; the assertions require `currency:@` and refuse the bare path, a hard-coded code and the no-argument form. Six reference answers of existing cases are shortened where they restated a point they already make, with every assertion and fact kept.
  - No schema, key or behaviour changes.
- f7188b5: Clause-②: no
  Metadata-protocol: none
  
  objectui: the guides teach only what ships. `guides/project-setup.md`'s sample
  `package.json` no longer installs `@object-ui/plugin-ai` (retired; `18.2.0` was its
  last release), the AI row of `guides/page-builder.md`'s plugin catalog lists
  `plugin-chatbot` alone, and the README's package snapshot drops `plugin-ai` from the
  plugin list (18, not 19) and `vscode-extension` from the tooling line (the extension
  left the workspace). `evals/project-setup.json` case 1 (the full Vite + React setup)
  now fails an answer that installs the retired package.
- efb1620: docs(skills): objectstack-ui teaches the record page as the Console ships it, in one ordered rules file from the object's declarations to the reader's own choices
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** `SKILL.md` described a record page with Details / Related / Timeline tabs and a shared Related tab for side cards, `rules/pages.md` and `rules/navigation.md` each carried a sentence of it, nothing taught `relatedListFilter`, the inherited row order, the six slots, `isDefault` or which record-page choices are the reader's, and an agent asked to "put the tasks first on the lead page" reached for a full page.
  - **Now.** `rules/record-page.md` says, in order: the object's declarations (`nameField`, `highlightFields`, `stageField`, `fieldGroups`, `relatedLists`, `editMode`) produce the page and the surface's width lays it out (two columns from 760 px, three field columns from 1120 px, a tab row that enlarges one panel); the relationship flags shape the related column (`relatedList`, `relatedListTitle`, `relatedListColumns`, `relatedListFilter`, rows in the child's default list-view sort); a `slotted` page overrides one of six slots and has no `tabs` slot; `kind: 'full'` is the escape hatch; a record opens in the drawer unless the object's list view declares `navigation: { mode: 'page' }` (`modal` / `split` / `popover` are refused); and the reader's Open-records choice, ⊟ right column, panel order and pane width are never metadata. `SKILL.md`, `rules/pages.md` and `rules/navigation.md` keep one pointer each, and `evals/record-page.json` grades the lead-page task as `relatedList: 'primary'` and the full-page ask as the list view's declaration.
  - The package's hand-authored markdown grows by 39 lines against a budget of 40, paid with the tab sentences the record-page retirements made false; the docs' "How a list opens a record" names the live modes and the reader's choices. No schema, key or behaviour changes.
- 7587fd4: docs(ui): package homepages and README links point at objectstack.ai/docs; objectui.org is retired
  
  Clause-②: no
  Metadata-protocol: none
  
  The ObjectUI documentation site at objectui.org is retired. Its pages now live in the ObjectStack docs, mostly under [User Interface](https://objectstack.ai/docs/frontend). Every `@object-ui/*` package's `homepage` and README links now go to the matching page there, and the old objectui.org addresses answer with a permanent redirect to the same page. The `description` fields spell the product name "ObjectUI". The `@objectstack/skills` bundle's ObjectUI skill links to the same pages. Nothing else changes in what these packages ship.
- a33fce2: feat(spec,plugin-form)!: `ObjectForm` lays a form out and no longer picks its container; the `object-form` block drops `formType: 'split'` and `SplitForm` retires, while the block keeps opening `drawer` and `modal` forms itself
  
  Clause-②: no (narrowing)
  
  Metadata-protocol: narrowed (the `object-form` block's `formType` refuses `split`; its `splitDirection`, `splitSize`, `splitResizable` and `sections[].pane`, the `object-master-detail-form` block's `sections[].pane`, and `FormViewSchema.splitDirection`, are tombstones)
  
  <!-- adr-0087: not-required (already-registered form-view-presentation-types-removed, ui-form-view-type-layout-only) 18.3.0 is unreleased, so this change widens those two entries in place: the conversion now strips splitDirection and reaches object-form page blocks, four new RETIRED_KEYS_BY_MAJOR rows record the tombstoned keys, and the D3 entry names the block -->
  
  **BREAKING** accept-set narrowing on the `object-form` page block and the form view (`@objectstack/spec`), and a removed export (`@object-ui/plugin-form`). ADR-0050, the renderer half of #27155.
  
  The model: a form's `formType` says how it lays out its sections. Where it opens is the caller's. On the `object-form` block the caller is the block itself, so `drawer` and `modal` stay there as the two containers the block opens; `split` drew two panes and had no other reader, so it leaves with its renderer.
  
  - **FROM → TO (block).** `formType: 'split'` → `formType: 'tabbed'` (one tab per section) or delete the value for `simple`; delete each section's `pane` and the block's `splitDirection` / `splitSize` / `splitResizable`. To edit child records beside the parent, use an `object-master-detail-form` block. `formType: 'drawer'` and `formType: 'modal'` are unchanged. The `object-master-detail-form` block's parent `sections` share the shape, so delete each section's `pane` there too.
  - **FROM → TO (form view).** `splitDirection` on a form view → delete it. It joins `splitSize` and `splitResizable`, which left in the same release.
  - **The one-line fix.** Delete the retired value and keys. `os migrate meta --from 17` lists the edits for existing sources, and `--write` applies them. A stored page or view row is converted when it is read (the `form-view-presentation-types-removed` conversion now reaches `object-form` page blocks, the section `pane` of `object-master-detail-form` blocks, and `splitDirection` too), so a block saved with `split` keeps loading as a `simple` form.
  - **What the parse says.** `formType: 'split'` is refused by name with its prescription ("'split' was removed from the `object-form` `formType` enum in @objectstack/spec 18.3.0 (ADR-0050) — …"); each tombstoned key is refused on every `formType`. TypeScript rejects each at the authoring site.
  - **`@object-ui/plugin-form`.** `ObjectForm` renders the `simple`, `tabbed` and `wizard` layouts only; a `formType` of `drawer` or `modal` on a node handed straight to `<ObjectForm>` now renders the inline form, and the host opens its own drawer or dialog around it (the console's New and Edit dialogs already mount `ModalForm` themselves). The registered `object-form` block routes `drawer` and `modal` through the new internal `ObjectFormContainer`, which hands the node to `DrawerForm` or `ModalForm` as before. `SplitForm`, `SplitFormProps` and `SplitFormSchema` are no longer exported, and the block no longer publishes the `splitDirection`, `splitSize` and `splitResizable` inputs. FROM `import { SplitForm } from '@object-ui/plugin-form'` → TO a `TabbedForm`, or the `form` renderer's `fieldPanes` for a host that composes panes itself.
  - **`@object-ui/types`.** `ObjectFormSchema.formType` is `'simple' | 'tabbed' | 'wizard' | 'drawer' | 'modal'`, and its `splitDirection` / `splitSize` / `splitResizable` are the spec's tombstones by reference; the section `pane` member is gone.
  - **Console.** Studio's page-block inspector no longer offers `Split` for an `object-form` (its `engine.inspector.pageBlock.option.formType.split` string is removed from `@object-ui/i18n`), the record page passes no split keys, and a view whose `type` is not one of the three form layouts is no longer taken for a form (`@object-ui/console`).
  - **Supersedes one line of the form view `type` entry (#27155).** That entry says `splitDirection` stays declared; in this release it leaves too.
  - **Unchanged.** `drawerSide`, `drawerWidth`, `modalSize` and `modalCloseButton` keep their readers: the block's drawer and modal containers. The enforce-or-remove question for `drawerSide` / `drawerWidth` on form views stays on #27153.
- 1e45a4e: docs(skills): the dashboards guide says how a record-currency amount behaves in a dataset measure; the code field's name is a convention
  
  Clause-②: no
  Metadata-protocol: none
  
  ⛔ Not released alone: this ships in the same release as the `currencyMode: 'record'` mode, its refusals and its per-row display (ADR-0144 D9, release R1).
  
  - **`objectstack-ui/rules/dashboards.md`**: a measure over a `currencyMode: 'record'` amount refuses a measure `currency` and an ungrouped `sum` / `avg` / `min` / `max`. Grouped by the amount's code field, its result column carries `currencyField`, which names the per-row code column, and a `count` column never does.
  - **`objectstack-data/rules/field-types.md`**: a record-mode amount's code field is named `currency_code` by convention, not by contract; any `text` field with `valueDomain: 'iso_4217_currency'` that `currencyField` names will do.
- b4eecd5: docs(skills/objectstack-ui): `pages.md` 〈Inline metadata views〉 states the embed scope `os build` enforces — this package or a package of the same artifact it declares in `manifest.dependencies`
  
  Clause-②: no
  Metadata-protocol: none
  
  The build-lint sentence said a `metadata` fence's referenced object-rule / flow / permission set "must exist in this package". `docs/metadata-embed-ref` judges an embed against the package that ships the doc plus the packages of the same artifact that it declares in `manifest.dependencies` (direct only; one-way), so the rule the skill teaches now matches: an embed may name such a declared package's item, and anything else fails the build. No platform behaviour changes.
- 0dd93f2: Clause-②: no
  Metadata-protocol: none
  
  objectstack-automation: integrations are declared, not coded. The `connector_action`
  node row no longer calls a connector "pre-built"; a new SKILL.md section states the
  declarative-connector-first rule (a vendor system over HTTP is a `connectors:` entry
  with `provider: 'openapi' | 'mcp' | 'rest'`, a packaged spec and `auth.credentialRef`,
  dispatched by `connector_action`; a vendor callback is an `api` flow), the five cases
  that justify platform code, and that a document the loader cannot take yet is a gap to
  name — never a reason to write a plugin. `references/integration-recipes.md` carries one
  recipe per archetype with the author / administrator credential hand-off and today's
  limits (`connectorConfig.input` is sent as written; no `oauth2`; no vendor-signed
  callbacks). `evals/integrations-declared.json` adds the DocuSign, Stripe-read and
  vendor-without-spec cases; the DocuSign case fails any answer that proposes a plugin.
- c2716f8: docs(skills): the objectui action-block rule teaches `variant: 'danger'` for a destructive action and that `destructive` is the Button primitive's word, refused on an action block
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** `rules/protocol.md` taught `action:button` without its `variant`. An agent that wanted a red delete button had only the Button primitive's `destructive` to copy from the React examples, and `variant: 'destructive'` on an action block is refused at save with the rename to `danger`.
  - **Now.** The "Actions Are Node Types" rule carries one line: `"variant": "danger"` draws the action block red and asks its `confirmText` question through the destructive confirm button; `destructive` stays the Button primitive's word (`variant="destructive"` in React) and is refused on an action block. Paid in the same file: a provenance sentence about the retired `dataSource` measurement route and a sentence restating the `props` envelope rule, both stated elsewhere in the file, are gone.
  - **Eval.** `evals/page-builder.json` gains a case that asks for a destructive delete action: it must spell `action:button`, `"variant": "danger"` and `confirmText`, and fails on `"variant": "destructive"`. The three existing cases are tightened with every assertion kept, and the file's ratchet ceiling moves 560 → 684 tokens, the measured remainder (ruling 2026-10-27, 「A:先削重复,余额按实测提高」).
  - No schema, key or behaviour changes.
- 96d12ec: docs(skills): the `os package publish` row of objectstack-platform's operations reference points app authors at the Marketplace handbook
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** The platform skill's operations reference described `os package publish` as an upload to the cloud catalog and nothing more. An agent authoring an app from the skills never found the page that says what a listing is made of (`objectstack.manifest.json`, the README), what review checks, and what the customer's administrator goes through after installing.
  - **Now.** That row names the listing file, the README, review and the administrator's screens, and links `https://objectstack.ai/docs/deployment/marketplace-handbook`.
  - Paid for under the skills token ratchet by deleting the cloud-connection note's tail (the `LocalManifestSource` ledger and runtime-identity bind v2), plugin internals an app author never acts on. The file stays under its ceiling; no ceiling moves, no frontmatter, schema, key or behaviour changes.
- dbf576b: feat(spec): an inline `object-metric` tile declares `polarity`, so a lower-is-better KPI draws a rise red
  
  Clause-②: yes (widening)
  Metadata-protocol: added (object-metric polarity)
  
  A dataset measure has declared `polarity` since the dataset-bound KPI tile learned to colour its delta by it, but a page-level `object-metric` tile aggregates a field, not a dataset measure, so it had nothing to attach to and coloured its trend badge by direction alone: an average turnaround that rose 23% was drawn green.
  
  - **Spec.** `ObjectMetricPropsSchema` (`ComponentPropsMap['object-metric']`) declares an optional top-level `polarity`, the dataset measure's own `DatasetMeasurePolarity` by reference: `higher`, `lower` or `neutral`. Any other value is refused at the key. `betterWhen`, `goodDirection` and `trendDirection` are pointed at `polarity`; a top-level `direction` is answered with both keys it could mean (`trend.direction` for the static badge's arrow, `polarity` for good news); `higherIsBetter` / `lowerIsBetter` get the three values.
  - **Renderer.** `ObjectMetricWidget` forwards `polarity` to `MetricWidget`, which colours the badge it draws, the `compareTo`-derived one or the static `trend`, by the same rule the dataset-bound tile uses (`deltaToneClass`, now one shared helper): `lower` draws a rise red and a fall green, `neutral` draws it muted. The arrow always shows which way the number moved. The `object-metric` registration publishes the input.
  - **Undeclared keeps today's colours exactly**: a rise green, a fall red. Nothing infers a polarity from the aggregated field's name.
  - **Skills.** `objectstack-ui` `rules/dashboards.md` says an inline `object-metric` declares its own `polarity`.
  
  Nothing to do for existing tiles. To use it, add `polarity: 'lower'` to an `object-metric` node whose number is better when it falls.
- 3a09125: docs(skills): objectstack-ui and objectstack-data teach a primary related list as a body table in the Details tab, and the relatedLists refusal with its package boundary
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** Both skills said a `relatedList: 'primary'` child gets its own tab on the record page, `objectstack-ui` described one tab per primary list plus a shared Related tab and an app-level `relatedLayout` override, and `objectstack-data` said a `relatedLists` name matching no inbound FK is refused, with no boundary.
  - **Now.** A primary list is a full-width body table in the details column after the first field section (inside the Details tab, no tab of its own); every other list is a side card in the shared Related tab; field changes join the Timeline tab under its Changes filter. A `relatedLists` child in the stack with no inbound FK is refused everywhere; one that exists nowhere is refused by `os validate` / `os build` and by a metadata write naming no package, while a write into a package stores it and the page places nothing. No ceiling moves; no schema, key or behaviour changes.
- 4fa4f2c: docs(spec,skills): an `object-metric` tile's `polarity` is declared against the aggregate before `invert`, and `pages.md` points at it
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** The `polarity` description said the badge arrow shows which way the number moved. Under `invert: true` the tile shows `1 - value`, so there are two numbers, and the text did not say which one the arrow and `polarity` read. The `objectstack-ui` skill's `rules/pages.md` taught the inline `object-metric` without naming `compareTo` or `polarity`.
  - **Now.** The `polarity` description (and the reference page generated from it) says the badge and `polarity` read the aggregated value before `invert`, so `polarity` is declared against the raw value: an error rate shown as uptime is `lower`. The `object-metric` row in `rules/pages.md` names `polarity` and links to the `compareTo` section of `rules/dashboards.md`. The pointer is paid for by deleting three restatements in the same file; the file stays at its token count and no ceiling moves.
  - **Unchanged.** No schema, accepted value, default or renderer behaviour moves.
- 6892888: fix(skills): four objectstack-platform eval cases agree with their own `must_not_contain` assertions
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** In `skills/objectstack-platform/evals/config-plugins-ops.json`, four cases refused a string their own `expected_output` spelled: eval 1 `tableName`, eval 2 `data:beforeInsert` and `onInstall`, eval 4 `@objectstack/adapter-`, eval 7 `role:` and `admin_full_access`. Graded against those assertions, the reference answer itself scored wrong, so the eval could not tell a good configuration, plugin or operations answer from a bad one.
  - **Now.** Judged per case from the skill text. Eval 1 narrows its assertion to the key spelling `tableName:` (the skill's own warning, "never set `tableName`", names the bare word; the wrong form is the key beside `workflows:` / `approvals:`). Eval 2 says "a `data:*` kernel hook registers and never fires" and "no install / enable / disable hooks" instead of spelling the phantom hook and method. Eval 4 says "no `adapter-*` packages exist". Eval 7 names the refused alias as `role` (the key spelling `role:` stays refused) and says "no platform set" (the skill's term for a set such as the refused platform-admin one). No assertion is deleted, no case added or removed; the file shrinks by 13 tokens under its unchanged ceiling.
  - No schema, key or behaviour changes.
- 72b08ee: docs(skills): hand-written inventory counts are deleted; the names and the source of truth stay
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** `objectstack-data` counted its field types ("49") in SKILL.md and in `rules/field-types.md`, and its lifecycle events ("8") in SKILL.md and `references/data-hooks.md`; `objectstack-automation` counted its built-in node types ("20"); `objectui/README.md` counted its plugins ("18"); `objectui/guides/schema-expressions.md` counted the formula registry ("30 functions"); `objectstack-query` counted the aggregate functions ("six"). No gate reads any of those numbers against the tree, so each one goes wrong the moment the inventory moves, and a wrong count misleads the reader more than no count.
  - **Now.** The numbers are gone; every enumeration that taught something (the node-type tables, the plugin names, the function table, the aggregate names) stays, and each page still points at the file or schema that is the source of truth. Deletion only: every touched file shrinks under its unchanged token ceiling.
  - The same deletion in shipped READMEs and one shipped source comment: `@objectstack/spec` (a `//` comment in `src/kernel/metadata-plugin.zod.ts`, which ships), `@objectstack/metadata` (README), and the `@object-ui/*` READMEs of i18n, plugin-grid, components, fields, types, plugin-form and console. No schema, key or behaviour changes.
- 9122271: docs(skills): objectui teaches CEL for a bare-string predicate, with a FROM → TO list for the JavaScript spellings
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** `skills/objectui` taught bare predicates in the legacy JavaScript grammar: `"hidden": "data.status === 'draft'"` in `rules/protocol.md`, `data.status === 'active'` and `data.status !== 'active'` in `guides/schema-expressions.md`, and an operator list (`===`, `!==`, `.includes()`, `.length`) that read as condition syntax. Since #27584 the console reads a bare string in a predicate key as CEL, as the spec defines it and the server reads it, so an agent following the skill wrote a gate that faulted and hid the node.
  - **Now.** Every bare-predicate example is CEL. The guide says a bare condition string is CEL on `@objectstack/formula` and that the operator list is the `${…}` template grammar only, and it gives a FROM → TO list measured on the console's evaluator: `===` / `!==` → `==` / `!=`; `list.includes(x)` → `x in list`, `s.includes('x')` → `s.contains('x')`; `list.length` → `size(list)`; a `data.*` key the scope may lack → `has(data.x) && …`, because CEL faults on a missing key. The row-predicate bullet says only a `${…}` condition still reads on the legacy engine. Eval 2 in `evals/schema-expressions.json` hands over a JS-syntax predicate and expects the CEL rewrite.
  - No schema, key or behaviour changes.
- d4064cc: docs(skills): objectstack-ui and objectui teach the report-index navigation item beside the named report
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** The skills taught only the named report item, `{ type: 'report', reportName }`. Since PR #27566 a `type: 'report'` item with no `reportName` opens the app's report index (`/reports`), and the console no longer adds an index entry on its own, so an agent following the skills shipped an app with no report index entry.
  - **Now.** The `objectstack-ui` navigation item table marks `reportName` optional and says what omitting it opens; `rules/navigation.md` shows the index entry beside the named one and says the console adds none itself; the `objectui` app-composition route table lists `{type:'report'}` → `/reports`. A new eval case (10 in `evals/views-apps-actions-pages.json`) asks for an app's report index entry and expects `{ type: 'report' }` with no `reportName`.
  - No schema, key or behaviour changes.
- 61c3fdd: docs(skills): objectstack-data teaches that a `secret` / `password` column is queried only for presence, with one eval
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** The engine refuses a credential column (`type: 'secret'` / `type: 'password'`) as a filter key, a sort key, a group-by or min/max key and an import `matchFields` key with `400 INVALID_FIELD`, and its search scan never reads one. `objectstack-data`'s `rules/security.md` taught the credential types but said nothing about querying them, so an agent following it could still write a view filter, sort, report or import mapping that the runtime refuses.
  - **Now.** `rules/security.md` states the rule next to the `secret` example: the only condition allowed on a credential column asks whether it has a value (`null`, `$null`, `$exists`, `$empty`); everything else is refused; search never scans it, so it does not belong in `searchableFields`. One eval asks for a list view filtered on a `secret` field and expects the redirect to the view's `is_not_null` rule.
  - The new text in `rules/security.md` is paid for by folding sentences the package already holds elsewhere (the `secret` type's purpose and encryption in `rules/field-types.md`, the queue parking rule in `SKILL.md`), and the remaining balance on it and on the eval file is raised by measurement, at zero headroom. The example shows the has-a-value check in both spellings: `where` / hook `query.filter`, and a list view's `filter` rule (`operator: 'is_not_null'`). No schema, key or runtime behaviour changes.
- 9b85162: docs(skills): the objectui data-integration guide stops teaching the MSW plugin removed in 12.0
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** `skills/objectui/guides/data-integration.md` taught a frontend-first setup built on the MSW plugin package, removed in 12.0 (its last npm release is 11.0.0, so the install still succeeds and pulls an 11.x plugin into the current stack), and eval 2 of `evals/data-integration.json` rewarded that answer.
  - **Now.** The section "Frontend-first development" names the two supported paths: a static scope with no backend, or the real server run locally with `os dev` behind a Vite `/api` proxy. It states that `os dev` persists to SQLite, that `--fresh` gives a throwaway database, and that the retired in-memory driver is refused. Eval 2 grades `os dev`, `proxy` and `objectstack.config`, and refuses the MSW setup. Net -35 lines in the guide.
  - **Console.** `VITE_USE_MOCK_SERVER`, which no source reads, leaves `.env.development`, `.env.production` and the Vercel build command. The `mockServiceWorker.js` rewrite exclusion and the `vendor-msw` chunk row in `docs/deployment.md` go too. No runtime behaviour changes.
- 8ebdd28: fix(data-objectstack): `ObjectStackAdapter` reaches discovery from a `baseUrl` that ends in `/api/vN`, and the objectui skill teaches the server origin
  
  Clause-②: no
  Metadata-protocol: none
  
  `new ObjectStackAdapter({ baseUrl: '/api/v1' })` — the form the published `objectui` skill taught — asked for `/api/v1/api/v1/discovery`, so `connect()` failed and every read and write that awaits it failed with it. The adapter's own search, data, export and meta reads already dropped a trailing `/api/vN`; discovery and the wrapped `ObjectStackClient` did not.
  
  - The adapter now reads `baseUrl` as the server origin once, where it and its client are built: a trailing slash and a trailing `/api/vN` are dropped, so `''`, `http://host:3000`, `/api/v1` and `http://host:3000/api/v1` all reach `/api/v1/discovery` and the same `/api/v1/...` routes, through the client and through the adapter's raw reads alike. The five per-call suffix checks are gone; nothing else about the URLs changes.
  - `skills/objectui` (`guides/data-integration.md`, `guides/auth-permissions.md`) and the package README teach the origin form the console passes (`''` behind a same-origin proxy, or the server origin), and the data-integration eval refuses an answer that writes `baseUrl: '/api/v1'`.
- e9caebe: docs(skills): objectstack-data teaches `external.connector`, the datasource credential channel that borrows a declared connector instance's credential, beside `credentialsRef`
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** A datasource can name a declared connector instance in `external.connector` and borrow that instance's credential (ADR-0015 amendment D7), so one credential serves the connector's flow actions and an API-backed datasource's records. `objectstack-data`'s `rules/datasources.md` taught only `credentialsRef`, so an agent following it bound a second copy of a vendor credential the stack already held, and had no way to know the key exists or where it is refused.
  - **Now.** The rule's credentials section names the two channels and that exactly one is written: `credentialsRef`, a secret-store handle resolved at connect; or `connector`, for a datasource on a plugin driver such as `@objectstack/driver-odata`, naming a `connectors` instance with a `provider` and an `auth` other than `none`, shown as `schemaMode: 'external', external: { connector: 'erp_api' }`. It says where `connector` is refused (beside `credentialsRef`, on a built-in driver, on a `managed` datasource, and naming an undeclared instance, at `defineStack` or else at connect), that a disabled instance or a stack with no automation service leaves the datasource unconnected with the reason, and that a connector credential not set yet answers `503` per request instead of failing the connect.
  - The new text is paid for inside the same file: the `field.columnName` history clause, the auto-connect lead-in and the escape-hatch note are shortened, and phrases that restated their neighbours (the `columnMap` direction the example already shows, the mapping-routing tail, the write-gate tail) are dropped. The file stays under its token ceiling, which does not move. No schema, key or runtime behaviour changes.
- 99fa527: docs(skills): the automation skill teaches `connector_action`'s `connectorConfig.input` as an evaluated value slot, and the `openapi` provider's `providerConfig.include`
  
  Clause-②: no
  Metadata-protocol: none
  
  - **`connectorConfig.input` is a value-slot map**, like `subflow` `input`: a top-level CEL envelope is evaluated in the run's scope, so a per-record payload (`{ dialect: 'cel', source: 'record.stripe_id' }`) is a declarative dispatch now. Any other value is sent as written; a `{…}` or `{{ }}` in it is literal text. The skill says plainly that `os validate` does not judge this slot yet, so a malformed envelope fails the step at run time.
  - **`providerConfig.include` exists on the `openapi` provider**, with the `mcp` provider's allowlist meaning: absent exposes every operation, and a non-array or an unknown entry is a fatal configuration fault. Trimming the document is still taught, as the way to keep the package small, not as the only allowlist.
  - The `integrations-declared` eval's first case follows: it no longer grades either stale limit.
- 21b2a10: docs(skills): a dataset measure's `currency` no longer "always wins" over a `fixed` field; the skills teach the two `fixed` refusals
  
  Clause-②: no
  Metadata-protocol: none
  
  - `objectstack-data` `rules/field-types.md` (Currency resolution) and `objectstack-ui` `rules/dashboards.md` (the dataset currency comment) taught that a measure's own `currency` wins under `fixed`. Dataset compile now refuses, with `DATASET_INVALID` / 400, a measure `currency` that differs from its field's `fixed` code (delete it; restating the code is accepted) and a derived measure whose monetary operands resolve to two different `fixed` codes (derive from measures in one currency, or drop the operand in the other). Both files now say so, and keep the not-judged cases explicit: a `fixed` code against the tenant currency, and a measure `currency` over a `dynamic` field.
  - Paid for inside each file by deleting a restating code comment; the remainder raises the two token-ratchet rows on the standing path.
  - No schema, key or behaviour changes.
- 3fd8033: docs(skills): the automation guide says a `connector_action` input is judged against the action's `inputSchema` before dispatch
  
  Clause-②: no
  Metadata-protocol: none
  
  This text shipped in PR #28170 (#28041 / #28162), which missed its `@objectstack/skills` changeset; this entry carries it.
  
  - **`objectstack-automation/SKILL.md`**: once evaluated, a `connector_action`'s `connectorConfig.input` is judged against the action's `inputSchema` (`required`, `type`, `properties`, `items`) before dispatch, and a breach fails the step `VALIDATION_ERROR` (`fault`-routable) with nothing sent. `registerFlow` and `os validate` refuse a `{…}` template token at `connectorConfig.input.<key>`.
  - **`objectstack-automation/references/integration-recipes.md`**: a record value reaches the payload through a CEL envelope (`{ dialect: 'cel', source: 'record.<field>' }`), and the recipes say that envelope is judged against the `inputSchema`.
- 36436fa: docs(skills): the skills teach the third `fixed`-currency refusal, a derived measure's own `currency` against its operands' one `fixed` code
  
  Clause-②: no
  Metadata-protocol: none
  
  - `objectstack-data` `rules/field-types.md` (Currency resolution) and `objectstack-ui` `rules/dashboards.md` (the dataset currency comment) taught two `fixed` refusals and missed the third: a derived `sum` or `difference` whose monetary operands all resolve to one `fixed` code refuses another `currency` at dataset compile, with `DATASET_INVALID` / 400. Both files now teach it beside the other two, with the shipped prescription: delete the measure's `currency` (the column takes the operands' code), or restate that code.
  - Paid for inside each file: `field-types.md` drops the `currency_code` naming convention its own example already shows; `dashboards.md` drops the retired `categoryGranularity` parenthetical, which the parse refusal and the Dataset-Bound Widgets paragraph already carry. Neither ratchet row moves.
  - No schema, key or behaviour changes.
- 3fd8033: docs(skills): the field-types guide teaches `homeAmount.rateDate` as a `date` or `datetime` field and lists all four `currencyConfig` keys
  
  Clause-②: no
  Metadata-protocol: none
  
  - **`objectstack-data/rules/field-types.md`**: the `homeAmount` paragraph says `rateDate` names a `date` or `datetime` field (it said `date` only; the spec accepts both). The Numbers table `currency` row lists `currencyConfig` as `currencyMode`, `defaultCurrency`, `currencyField` and `homeAmount` (it named the first two only).
- 22663ca: docs(skills): objectstack-data teaches the code-defined datasource credential route (`OS_DATASOURCE_<NAME>_PASSWORD`, behind the host switch)
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** `rules/datasources.md` taught `credentialsRef` and `connector` as the only credential channels. A datasource defined in code has no `sys_secret:` handle to point at (the Setup form refuses a code-origin datasource, and nothing else mints one), so an agent following the rule wrote a reference the connect could never resolve.
  - **Now.** The credential section says a code-declared datasource reads its password at connect from `OS_DATASOURCE_<NAME>_PASSWORD` (the name upper-cased) while the host switch `OS_DATASOURCE_ENV_CREDENTIALS` is `on`; that `os serve`, `os start` and `os dev` default it on, a library composition leaves it off, and the switch takes `on` or `off` only; that a declared `credentialsRef` or `connector` still wins and never falls back to the variable; and the operator's caution that an installed package may declare a datasource of any free name and so read that variable.
  - The file stays under its token ceiling: the new text is paid for by deleting restatements in the same file (the field-reference pointer the references index already carries, the `writable` and `columnMap` restatements of their own sections, the `datasource` field default the SKILL.md field table carries, and two detail clauses). No ceiling moves, no frontmatter, schema or behaviour changes.
- 3fd8033: docs(skills): the integration recipes say the connector `auth` union declares `oauth2` and `app-credential`, held degraded until a server runs the grant, and that `signed` signs `aliyun-acs3` and `tencentcloud-tc3` requests
  
  Clause-②: no
  Metadata-protocol: none
  
  This text shipped in PR #28290 (#28226), which carried a changeset for `@objectstack/lint` only and missed its `@objectstack/skills` one; this entry carries it.
  
  - **`objectstack-automation/references/integration-recipes.md`**: an OAuth-protected vendor declares `oauth2` (`authorization_code` / `client_credentials`) or `app-credential` (`feishu` / `dingtalk` / `wecom`), but no server runs the grant yet, so the instance is held degraded and calls no upstream. `signed` on `openapi` / `rest` (scheme `aliyun-acs3-hmac-sha256` or `tencentcloud-tc3-hmac-sha256`, with a `keyId`) signs each request; an RSA-signing vendor (Alipay, WeChat Pay) stays blocked on the request-signing card.
- 3b45d4a: docs(skills): objectstack-ui and objectstack-i18n teach six keys the platform already draws — `pressed`, the `{{ }}` copy slots `description` / `helpText` / `outcomeMessages`, the param dialog's `submitText` and its translation slot, the form thank-you translation keys, `kanban.lanes` and report chart `seriesBy`
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** Each key shipped in the spec and the console drew it, but no published skill taught it: an agent authoring from the skills wrote a toggle header action with no `pressed`, spelled the dialog line, a param hint or a per-outcome toast with `${…}` holes that `os validate` refuses, left the param dialog's button at "Confirm", translated no thank-you panel, could neither order kanban lanes nor drop an always-empty one, and split a chart by a second dimension with a `matrix` workaround.
  - **Now.** `objectstack-ui/rules/actions.md` teaches `pressed` (display-only reader state over an `attachedOnRead` block; a boolean literal is refused), names all five `{{ }}` copy slots with one example each, and teaches `submitText` beside `params` (with the `confirmText` contrast and the refused spellings); its `ReassignLeadAction` example sets `submitText`, and eval 11 asks for a param dialog whose button reads the verb. `rules/list-views.md` shows `kanban.lanes` in the kanban example — a choice of lanes and their order, not a record filter. `rules/dashboards.md` sets `seriesBy` on the report chart example and says where it is refused (an undeclared dimension, the `xAxis` dimension, a single-series type). `objectstack-i18n/SKILL.md` lists `_views.{view}.submitBehavior.title` / `.message` and `_actions.{action}.submitText`.
  - Every file stays at or under its token ceiling: the actions, list-views and dashboards additions are paid for by condensing text in the same file (the `ctx` section's blessed-name code block, which restates the objectstack-data hooks reference; two ADR-0047 renderer notes folded into the code comments they repeat; two engine- and Studio-facing notes that told an author nothing to write). No ceiling moves, no frontmatter changes, no schema, key or behaviour changes.
- 56bd596: docs(skills): objectstack-data rules/lifecycle.md teaches the save notice
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** A hook can tell the person who made a create or update what the save set in motion (`ctx.notice(message)`, answered as the create/update `notice`), and a flow a record create/update trigger starts can set the same message with a `save_notice` node, but no published skill taught it, so an AI author writing a save hook from `objectstack-data` kept reaching for a `record:alert` banner.
  - **Now.** `objectstack-data/rules/lifecycle.md` gains *Save Notice — what the save set in motion*: the `ctx.notice` spelling for inline `handler` and sandboxed `body` alike (no capability), info severity and the distinction from validation `warnings` and from a `record:alert` banner, one message per write with the last call winning, the dispatches that carry it, the non-string refusal, and the flow face (`save_notice`, refused outside a create/update record trigger and after an `approval` / `wait`).
  - The file stays under its token ceiling: the new text is paid for by deleting the Decision Tree (which restated the class table and the syntax examples), the telemetry-growth anecdote and a Safety Semantics restatement. No ceiling moves; no schema, key or behaviour changes.
- 1f1a369: docs(skills): the objectstack-data field-types rule teaches `percentDisplay` and `lookupAutofill`
  
  Clause-②: no
  Metadata-protocol: none
  
  - The `percent` row of the field-type table lists `percentDisplay`: unset or `'bar'` draws the progress bar, `'plain'` prints the number alone, for a rate or a probability.
  - The Relational section teaches `lookupAutofill: [{ target, source, overwrite? }]` on a single-value `lookup` / `master_detail`: which targets a pick may fill, which sources it may copy, the overwrite rule, that the fill is client-side only, and how it relates to a line-item grid column's `autofill`.
  - Paid inside the file's token ceiling: the `Select with Default`, `Email with Uniqueness` and `Lookup (Many-to-Many)` examples go (each restated a rule the skill carries elsewhere), and the `vectorConfig` trap folds into the invented-key list at the top of the file.
- 3eb6dfc: docs(skills): objectstack-automation teaches `oauth2` and `app-credential` as a served recipe now that the built-in connector providers run the grant
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** `references/integration-recipes.md` filed the OAuth-protected vendor under "Not yet": `auth` could declare `oauth2` and `app-credential`, but "no server runs the grant yet", so the integration was to be marked blocked. Eval 1 (DocuSign) graded that answer, and `SKILL.md` listed OAuth among the documents the loader cannot take.
  - **Now.** The built-in `rest`, `openapi` and `mcp` providers ask the per-dispatch credential handle, so both kinds are served. Recipe 6 teaches the three `auth` shapes (`authorization_code`, `client_credentials`, `app-credential` with `feishu` / `dingtalk` / `wecom`), where the token is held, that `client_credentials` and `app-credential` dispatch once the ref is set, and how an administrator holding `manage_connector_connections` connects an `authorization_code` instance once per organization (`POST /api/v1/automation/connectors/:name/connection`, the vendor's redirect to the callback, status, revoke). The warning against parking a short-lived token behind a `bearer` ref stays. Eval 1 now expects that recipe and names one remaining gap (the vendor-signed webhook); `SKILL.md`'s loader-gap line no longer names OAuth. WeChat Pay stays under "Not yet" (no `signed` scheme).
  - The file's token ceiling moves to the measured count after two same-file restatement cuts; no schema, key or behaviour changes.
- f116f38: docs(skills): objectstack-data eval case 3 answers the code-defined datasource credential route and pins it
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** `evals/hooks-security-seeds-datasources.json` case 3 (a read-only `legacy_customer` object over the `customers` table of a Postgres reporting database) answered "a `defineDatasource` entry (`credentialsRef`, never inline credentials)". `rules/datasources.md` now teaches that a datasource defined in code reads its password at connect from `OS_DATASOURCE_<NAME>_PASSWORD` behind the host switch `OS_DATASOURCE_ENV_CREDENTIALS`, and that nothing mints a `sys_secret:` handle for one; the eval's `must_contain` pinned neither route, so the eval stayed green while its model answer taught a handle the connect could never resolve.
  - **Now.** The model answer names the environment route the rule teaches (`OS_DATASOURCE_REPORTING_PASSWORD` for a datasource named `reporting`, the switch and the hosts that default it on), `schemaMode: 'external'`, the object's `datasource` / `external.remoteName` / `columnMap` binding and the closed write gate (`allowWrites`, `writable`). `must_contain` keeps `defineDatasource`, `datasource`, `remoteName`, `columnMap` and `schemaMode` and adds `OS_DATASOURCE_ENV_CREDENTIALS` and `_PASSWORD`, so an answer that teaches only the old route goes red.
  - Eval fixtures are measured but not ratcheted; no SKILL.md, rules, references, schema, key or behaviour changes.
- f662c71: Clause-②: no
  Metadata-protocol: none
  
  objectstack-ui `rules/list-views.md` § Filtering teaches the view filter any-of group `{ or: [rule, ...] }` (`ViewFilterOrGroupSchema`): an element of the `filter` list that matches when any of its flat rules does, still ANDed with the elements beside it; no group in a group, no empty `or`; the Console builder saves its OR toggle as one group and shows a group beside other elements read-only. One eval case asks for an either-of list in one view.
  
  Token ratchet: the growth is paid by deletion in the same file (the flat-view and data-source blockquotes, the `tabs`-on-object and omit-`userFilters` bullets, the search-blast-radius and toolbar-search prose, the kanban intro).
- 35b178b: docs(skills): the objectstack-data field-types rule states a percent field's storage scale
  
  Clause-②: no
  Metadata-protocol: none
  
  The `percent` row of the field-type table no longer says "Percentage values (0-100)". It states the storage rule the platform applies: a `percent` field stores a fraction (0-1) unless it declares `max` above 1 (for example `max: 100`), in which case it stores whole percentage points; seeds, defaults and API values use that stored scale. An author who followed the old text seeded `25` on a field without `max` and read back `2500%`. Paid inside the file's token ceiling by deleting the `Vector (AI Embeddings)` example, whose one fact (`dimensions` is the flat key) the Enhanced Types row already states.
- 8de519f: docs(skills): objectstack-platform teaches the one effective read of a `.custom` declared override (ADR-0146 D8)
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** The `overrides: { package, basedOn }` declaration takes effect on every read of a name an installed package ships (ADR-0146 D8), but no published skill mentioned `.custom`, `overrides` or `basedOn`. An agent customizing an installed package (HotCRM) was still taught the Setup overlay row as the only path, which the read now treats as a package-unbound row awaiting migration, or wrote an undeclared same-name item that the layered read reports as an orphan.
  - **Now.** `objectstack-platform`'s Manifest Reference says where a customization lives (the paired `<base>.custom` package), what an author writes (the same-named item with `overrides: { package, basedOn }`, the base's `manifest.id` / `manifest.version`), where the declaration is honoured (only from the pair; today only for a view, dashboard, report, email_template or translation, the other overridable types waiting for their doors; `basedOn` never judged; any other package's declaration ignored) and what the read serves (every read agrees; one item per name in the environment-wide list; orphans in the layered read's `overlay`; a withdrawn public form never re-opened; the pair's export carries the declaration). One eval asserts the declared shape and refuses the Setup-write alternative.
  - The file stays under its token ceiling: the new text is paid for by deleting restatement in the same file (the CLI cheat sheet `references/operations.md` already holds, the seed `object`-is-derived sentence `objectstack-data`'s `seeds.md` holds, a table restating its own paragraph, two doubled rules). The `os migrate` row of `references/operations.md` takes back the `apply` rule the cheat sheet carried (loosens only; `--allow-destructive` for drops/tightenings). The SKILL.md ceiling lowers to its new measurement; no ceiling rises, no frontmatter, schema or behaviour change. The docs site gains the same facts on the metadata-lifecycle page and one sentence on the forms page.
- bc02a77: fix(metadata-protocol)!: a write naming no package onto an installed package's view, dashboard, report, translation or email template is refused where `os migrate packageless-overlays` can move its row as a declared override, naming the base's `.custom` pair and the command
  
  Clause-②: yes (narrowing) — the metadata save, publish, delete and rollback doors refuse a write that names no package onto an item of the five overlay types that one installed read-only package ships, where the ceremony would classify the row (or the first write's body) `movable` and its move as a declared override can succeed; they accepted it before as a package-unbound Setup row. Every row the ceremony lists and does not move keeps that write. One write is widened: a rollback of the `.custom` pair's own declared row of an item its base ships (#28644 item 1) is judged as the pair's declared override, where the store sealed it as an artifact override before, on every type the pair can override (a page or flow pair row included).
  
  Metadata-protocol: narrowed (the `allowEnvironmentOverlay` flag of `view`, `dashboard`, `report`, `translation` and `email_template` no longer opens a package-less write onto a packaged item the ceremony can move as a declared override; it stays the predicate the migration ceremony, the read of an unmigrated row and every row the ceremony leaves use)
  
  Skills-docs: updated here — `skills/objectstack-platform/SKILL.md`'s ADR-0146 paragraph said "a package-unbound Setup row still wins over the base's until D11"; it now says such a row from before D11 wins over the base's until `os migrate packageless-overlays` moves it, and that its package-less save, reset and rollback are refused once the command can move it. To stay under the bundle's token ceiling, the same paragraph drops "the base's is unchanged" after the export sentence (which "replaces the base's document whole" already implies) and the aside that the other overridable types wait for their doors (the sentence already names the six types the read honours today).
  
  <!-- adr-0087: registered packageless-overlay-write-closed -->
  
  **BREAKING** write narrowing at the metadata doors (`@objectstack/metadata-protocol`), shipped as `minor` during the launch window.
  
  **Upgrade, then run the ceremony.** The command ships in this release. On each deployment with Setup customizations of a package's items, upgrade, run `os migrate packageless-overlays` (preview) with the flags and environment the deployment boots with (`--preset` and `--dev` mean what they mean to `os serve`), then `os migrate packageless-overlays --apply`. Nothing breaks at the upgrade: between the upgrade and `--apply`, every customization is served as before, and the package-less save, reset, publish and rollback of one the command moves as a declared override are refused, naming the command (one it moves as the pair's own member keeps that write, see `movable` below). Done when the preview lists no movable row.
  
  The preview lists five dispositions; only `movable` rows are moved, and every other row keeps its package-less write:
  
  - `movable`: `--apply` moves it into the pair, as the base's declared override (outcome `moved` with its `basedOn`). A row of an `email_template` locale the base does not ship (the preview lists it as the pair's own member; `--json` carries it as `addedMember`) moves instead as the pair's own member at that locale, declaring nothing (outcome `moved` with that `addedMember` in place of a `basedOn`), since a declared override of a locale the base does not ship is refused; its package-less write stays open, before and after the move. A move that ends `failed` keeps the row as it was; fix what the error names and re-run. When the error names the pair (it cannot be ensured, or it refuses the row) or, for a declared override, the base's missing version, the row also keeps its package-less write and may be left.
  - `multi_shipped` (several packages ship the name): delete it naming no package, then save it into the pair of the package it customizes if it is still wanted (the pair's override is then served at that base's address, `?package=<base>`; a read naming no package is not pinned to it while several packages ship the name).
  - `no_pair` (the base's id forms no pair): nothing to do.
  - `foreign_declaration` (its `overrides` names another package): remove the key with a save naming no package, then re-run: the move declares the right override. (A package-less save that keeps a corrected `overrides` is refused by the override write gate.)
  - `shadowed` (the pair already holds the item; the pair's row is served when it declares the override, otherwise this row still is): nothing to do to keep the pair's declared override; or restore the package original (`DELETE …?package=<base>.custom`) and re-run to move this one.
  
  ### Migration: FROM → TO
  
  FROM, a customization of the installed package `com.acme.crm`'s view written with no package:
  
  ```http
  PUT /api/v1/meta/view/account_list
  { "name": "account_list", "label": "My accounts" }
  ```
  
  TO, the same customization written into the base's paired `.custom`, declaring what it overrides:
  
  ```http
  PUT /api/v1/meta/view/account_list?package=com.acme.crm.custom
  { "name": "account_list", "label": "My accounts", "overrides": { "package": "com.acme.crm", "basedOn": "1.4.0" } }
  ```
  
  To restore the package original, FROM `DELETE /api/v1/meta/view/account_list` TO `DELETE /api/v1/meta/view/account_list?package=com.acme.crm.custom`. `basedOn` is the base's installed `manifest.version`. The pair is created by `os migrate packageless-overlays --apply`, or by Studio's Customize. A locale of an email template the base does not ship is the pair's own member, not an override: write it into the pair with no `overrides` (one declaring the base is refused), and `DELETE …?package=<base>.custom&member=<locale>` removes it (with no `member`, the delete addresses the canonical locale).
  
  - **Now refused.** A save (draft or publish mode), a publish, a delete of the active item, or a rollback whose restored row is package-less, with no `?package=` (or an empty one), of a `view`, `dashboard`, `report`, `translation` or `email_template` that exactly one installed read-only package ships, where the item's stored package-less row in that state (or, with none, the saved body) is one the ceremony classifies `movable`, the pair can be ensured (the base has a namespace and a SemVer version), and the override write gate admits that row, declared as the base's override, into the pair (so not an `email_template` locale the base does not ship: see **Still open**). This covers an unmigrated `movable` row, and the first package-less write of an item the pair already holds (a moved one). Each answers `403 NOT_OVERRIDABLE`, writes nothing, and its message names the item, the shipping package, the pair (`?package=<base>.custom`), the `overrides` declaration and `os migrate packageless-overlays`; a rollback's message says to save a version from before the move into the pair, declaring it. The metadata item page shows that message as sent when its URL holds no `?package=`. The refusal comes before every gate that reads a stored row's lock, so it is the same with or without `overrides` in the body.
  - **Still open.** Every write naming `?package=<base>.custom` (the pair's save, publish, delete and rollback, judged by the override write gate as before); a rollback of the pair's own declared row, which is judged as the pair's override; a write of a name no installed package ships (environment metadata); and every package-less write the ceremony would not move, as before this release: a name several read-only packages ship (`multi_shipped`); a base whose id forms no pair (`no_pair`); a base whose pair cannot be ensured (no namespace, or a version that is not SemVer); a stored package-less row whose `overrides` names another package (`foreign_declaration`) or beside the pair's row of the item (`shadowed`; its package-less writes are addressed to the pair's row as before, so its package-less delete restores the package original). Every package-less write of an `email_template` locale the base does not ship stays open too, before and after the ceremony moves its row as the pair's own member (#28904): the close judges only the declared-override move, and the override write gate refuses a declared override of that locale (#28777). Discarding a draft stays open.
  - **Unchanged.** A package-less row stored before this release is still served exactly as before, by every read. The ceremony still moves it: it writes into the pair, never package-less.
  - **Studio.** The read-only item notice no longer links to the package-less Setup overlay (`@object-ui/app-shell`).
  - **Removed with it.** #28413's interim allowance, by which a package-less save that landed on a moved row kept that row's `overrides` block, is gone: such a save is refused like any other.
- 504ba51: docs(skills): the ADR-0126 §1.3 promise pages and the skills teach what ADR-0146 D2 delivers — customizations in `.custom`, `__c` fields, the flow override and "new similar", no package-less overlay
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** The skills taught the pre-epic paths: `objectstack-data` named no home for a customer's extension of a shipped object and no `__c` rule, and its lock table still called an edit of a shipped item an "overlay"; `objectstack-automation` said nothing about a flow an installed package ships, so an agent cloned it (two copies running) or edited it in place (refused); `objectstack-platform` taught the declared override's read but not who may declare it, how the pair is created, or what the three non-overridable types do. The docs promise pages (`capabilities/integrations`, `build-without-code`) still said views and dashboards are "yours to edit directly" and sent readers to a Setup packaged-automation page to switch off and clone a flow.
  - **Now.** `objectstack-data` says an object an installed package ships is extended from the base's paired `.custom` package, every added field ends in `__c`, the suffix is refused anywhere else and an unsuffixed field is refused in the pair, a base field changes only through `fieldPatches`, and Studio's Add field writes the same extension; its lock table reads "Edit", not "Edit (overlay)". `objectstack-automation` says a packaged flow is customized by a same-named declared override in the pair (armed in the base's place, one activation switch, a suspended run finishes on the body it started on), that an undeclared same name is refused at publish, and that the clone door is "new similar": a copy under a new name, switched off, in the pair, never package-less. `objectstack-platform` adds the ensure door and its two manifest facts, the customizations read, the uninstall refusal, the write gate's one rule for dependents (rename), and "new similar" for permission sets, positions and capabilities. One eval per skill asserts the taught shape and refuses the old one.
  - Every file stays under its token ceiling: the new text is paid for by deleting restatement in the same file (a layout tree the Template section and the Naming table already state; a search-mirror maintenance table and a formula aside restating the sentence above them; the dates and money legacy → CEL rows `objectstack-formula`'s table holds; the CEL callout restating that skill's pointer; two `runAs` notes and a `readonly` note tightened, no rule removed). The touched ceilings lower to their new measurements; no ceiling rises, no frontmatter, schema or behaviour changes. The docs site's promise pages, install modes, object extensions, metadata lifecycle, permission sets, CLI and metadata API pages gain the same facts.
- 28f2e99: docs(skills): the automation skill's `mcp` recipe teaches the `providerConfig.toolsSnapshot` pin
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** `providerConfig.toolsSnapshot` (a sha256 pin per MCP tool, checked on every materialization) shipped in `@objectstack/connector-mcp` and on the connectors page, but no published skill named it. An agent authoring an MCP connector app from the skills declared `include` alone, with no protection against a server silently rewriting a tool's description or `inputSchema`.
  - **Now.** `skills/objectstack-automation/references/integration-recipes.md`, recipe 2 (remote MCP), gains one paragraph: what `toolsSnapshot` pins and that a pinned name `include` leaves out is refused at boot; where the digests come from (`computeMcpToolsSnapshot(tools)`, or the served digest the degraded reason prints against a placeholder pin); what an author sees when a pin no longer matches (the instance degraded with no actions, `CONNECTOR_UPSTREAM_CHANGED`, the reason on `GET /api/v1/automation/connectors` naming each tool and the digest it now serves), and the link to the connectors page's pin section.
  - The file stays under its token ceiling: the paragraph is paid for by deleting restatements in the same file that keep a home elsewhere (the `connector_action` row of `SKILL.md`, its `api`-trigger *Signature* bullet, the objectstack-platform skill's `plugins:`/`requires` rule, and the connectors page). No ceiling moves, no frontmatter, schema, key or behaviour changes.
- 00918c8: docs(skills): objectstack-data teaches an object extension's `fieldPatches` — relabel a vendor field without redeclaring it in `fields`
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** `ObjectExtensionSchema.fieldPatches` is applied by the registry merge and refused at install and by `os validate` when it names nothing, but the published `objectstack-data` skill's *Object Extension Model* taught only `fields` / `priority`, so an agent that wanted a vendor field to read "Sector" instead of "Industry" redeclared the field in `fields` and took it over.
  - **Now.** The section carries one paragraph on `fieldPatches`: display keys only (`BASE_FIELD_DISPLAY_WHITELIST` — `label`, `description`, `inlineHelpText`, `placeholder`, and an option's `label` keyed by its stored `value`), type / values / rules stay the owner's, a tenant's edit wins, the higher `priority` wins between extensions, a patch naming a missing field or option is refused at install and by `os validate`, a `picklist`-bound field's options are not patchable — with the `crm_account.industry` example.
  - The file stays under its token ceiling: the new text is paid for by deleting restatement in the same file (the search section's second refusal paragraph, folded into its first; the index blockquote and the validation type list, each already carried by `rules/indexing.md` / `rules/validation.md`). No ceiling moves, no frontmatter, schema, key or behaviour changes.
- 7f4cbc9: docs(skills): objectstack-platform says an email-template override names a locale its base ships; a new locale carries no `overrides`
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** The ADR-0146 customization paragraph taught that a same-named item in the paired `.custom` package with `overrides` replaces the base's item, and listed `email_template` among the honoured types, but said nothing about the locale. An email template is one item per `(name, locale)`, and the override write gate refuses a declared override of a locale the base does not ship (`declared_package_ships_no_such_item`), so an author following the skill could declare `overrides` on a locale the base never shipped and be refused.
  - **Now.** One sentence in that paragraph: an email template is one item per (name, locale), an override names a locale the base ships, and a locale the base does not ship is added without `overrides`. The file stays at its token ceiling: the sentence is paid for by naming the not-yet-honoured types as the rest of `OVERRIDABLE_METADATA_TYPES` instead of enumerating them, and by dropping four filler intro clauses. No rule is removed, no frontmatter, schema or behaviour changes.
- 2c70f65: docs(skills): objectstack-platform says a locale added in the `.custom` pair is served on the base's address, and a locale a dependent adds under the base's name stays under its own package
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** The ADR-0146 customization paragraph said a locale the base does not ship is added in the pair without `overrides`, and stopped there: nothing said where that added locale is served, and nothing said what a dependent package's added locale under the base's name reaches. The reads of a base's address now decide an email template member by member, so an author could expect the pair's added locale to stay under `hotcrm.custom` only, or a dependent's to answer on the base's address.
  - **Now.** One sentence beside that rule: the base's address serves the pair's added locale too (both lists, the execution list, a send in that locale), and a locale a dependent adds under the base's name is served only under its own `?package=`, never by a base-named or package-less read. The file stays under its token ceiling: the sentence is paid for by tightening four restating clauses elsewhere in the file (one intro clause, one explanatory aside, one restated driver rule, one filler template bullet). No rule is removed, no frontmatter, schema or behaviour changes.
- b5e7ba5: feat(spec)!: a form view no longer declares `drawerSide` / `drawerWidth`; no form view opens in a drawer, so neither key was ever read there
  
  Clause-②: no (narrowing)
  
  Metadata-protocol: narrowed
  
  Skills-docs: regenerated here — `skills/objectstack-ui/references/react-blocks.md` (`gen:react-blocks`) lists `<ObjectForm>`'s `drawerSide` / `drawerWidth` as binding props from the block's overlay instead of data props from the form view schema, with the same types; `drawerWidth`'s description drops the form view's `[DEPRECATED → size buckets]` tag (the block's drawer has no size bucket) and says the value is the drawer's width, or its height from the top or bottom edge; no hand-written file under `skills/**` teaches either key on a form view (a `git grep` of `skills/` names only that contract and `rules/record-page.md`'s list-drawer width on `navigation`, which this does not touch).
  
  <!-- adr-0087: registered form-view-drawer-keys-removed, ui-form-view-drawer-keys-retired -->
  
  **BREAKING** accept-set narrowing on the form view surface (`@objectstack/spec`), ADR-0049 enforce-or-remove.
  
  `type: 'drawer'` left the form view earlier in this release, so no form view opens in a drawer. No form-view surface read the two keys either: the console's form page, its New and Edit dialogs, the record form page and Studio all ignored them, so a form view saved with `drawerSide: 'left', drawerWidth: '480px'` was accepted, served and drawn exactly as one without them.
  
  - **FROM → TO.** `form: { …, drawerSide, drawerWidth }` (and `formViews.<key>`, a form view item's `config`) → `form: { … }`. Nothing on the form view replaces them. A list opens a clicked record in its drawer (`navigation.mode`) and sizes it with the `navigation.size` bucket; a React page that opens a form in a drawer writes the props on the block, `ObjectForm` with `formType='drawer'`.
  - **The one-line fix.** Delete `drawerSide` and `drawerWidth` from the form view. `os migrate meta --from 17` lists the edits for existing sources, and `--write` applies them. A stored `sys_metadata` row is converted when it is read (the `form-view-drawer-keys-removed` conversion), so a form view saved with the keys keeps loading, and nothing a reader sees changes.
  - **What the parse says.** "`view.form.drawerSide` was removed in @objectstack/spec 18.3.0 (ADR-0049) — no form view opens in a drawer, so no form view ever read it. …" (and the same for `drawerWidth`), at every form view door (a view's `form` and `formViews.*`, a form view item record, a flattened form overlay) and at `defineStack` as `STACK_SCHEMA_INVALID` / 422. TypeScript rejects the keys at the authoring site.
  - **Unchanged.** The React `ObjectForm` block still takes `drawerSide` / `drawerWidth` for the drawer it opens with `formType='drawer'`: the react-tier contract now declares them on the block itself, with the same types and descriptions. The `object-form` page block keeps both in its own props. `modalSize` stays on the form view; the console's record dialog reads it.
- 74a19dd: docs(skills): objectstack-formula says the build refuses date subtraction (`end - start`), and the skills stop describing a stored formula that subtracts dates
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** The "No date arithmetic" note in `objectstack-formula` said `end - start` "does not fault — it yields a `duration` stored as `{}`", which read as a shape that builds. `objectstack-ui` `rules/dashboards.md` and an analytics eval described a leave-days formula written as `end - start`, and a formula eval explained `record.close_date - today()` as "a duration stored as `{}`".
  - **Now.** The note says the build refuses both `date + n` and `end - start`: a date or date-time mixed with a number, or minus another, reads `null`, and `today()` / `now()` minus a date field reads `{}`. It prescribes `daysBetween(a, b)` and keeps the Want / Write table. The leave-days formula is written `daysBetween(start, end)` in the dashboards rule and `daysBetween(record.start_date, record.end_date)` in the eval prompt, and the formula eval says the build refuses `record.close_date - today()`.
  - The formula gate change itself ships in `@objectstack/formula` (`formula-date-subtraction-refused`). `SKILL.md` and `rules/dashboards.md` stay under their token ceilings (no ceiling moves). No schema, key, command or behaviour changes.
- e82bf64: docs(skills): objectstack-formula names action `visible` / `disabled` as the sparse, client-side exception to the total-record rule, and teaches the `has()` guard that surface needs
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** The "`has()` is NOT a null check" section said every predicate reads a `record` that is total over the object's declared fields, so `has(record.<declared_field>)` is always `true` and tells you nothing. An agent following it dropped the `has()` guard from an action's `visible` predicate on a `list_item` location, where the row can lack the key: the predicate faults `No such key` and the button silently vanishes. The Surfaces table listed only `Action.disabled`.
  - **Now.** The total-record statement is scoped to the server-evaluated surfaces (validation rules, `requiredWhen`, option `visibleWhen`, `readonlyWhen`, hook `condition`, the flow trigger record), where `!= null` is the whole guard. A new paragraph says action `visible` / `disabled` bind the row the client already holds, which lacks a key when the column is outside the view's projection, refused by field-level security, or never written (the mongo and memory drivers), and teaches the guard: `has(record.x) && record.x != null`; `has()` alone beside a literal `==` / `!=`; one `has()` per segment of a nested path. The Surfaces table lists `visible` beside `disabled`, marked client-side and sparse.
  - `SKILL.md` stays under its token ceiling (no ceiling moves). No schema, key, command or behaviour changes.
- 5a2bdf9: docs(skills): the record-page rule names drawer and full page as the reader's only Open records choices
  
  Clause-②: no
  Metadata-protocol: none
  
  The console retired the split pane beside the list: a list record opens in the drawer (the default) or as the full page, and the Display menu's Open records offers those two only. `skills/objectstack-ui/rules/record-page.md` rule 6 still taught "split beside the list — the default — or drawer, or full page", so an agent reading it told authors that records open beside the list and offered a choice that no longer exists. Rule 6 now names the two choices and says the split beside the list is retired; the drawer's dragged width and ⤢ stay reader preferences. Eval 2's expected answer says the same: a pane beside the list is no longer offered, nothing is authored for it, and the contract object keeps `navigation: { mode: 'page' }`.
- 00f72f9: docs(skills): the formula skill teaches the null-guard gate on a record-triggered flow's conditions
  
  Clause-②: no
  Metadata-protocol: none
  
  The publish-time null-guard gate (`os validate` / `os build` / `os lint` and the runtime publish gate) has judged a record-triggered flow's start `config.condition`, every edge `condition` and every `decision` branch `expression` since the lint change that widened it; the formula skill now says so where it teaches the gate: which slots are judged, that a `count` / `sum` roll-up is always valued while `min` / `max` / `avg` stay nullable, that a bare field name in a flow condition is the field and is judged alike, that a guard in the start condition holds at every edge and branch and is spelled `record.<field> != null` so both doors accept it, and that an unguarded null fails the run while the write that fired it still lands. One eval exercises a refused flow edge. The flows docs page carries the same rule where edge and decision conditions are taught.
- 69ce01d: docs(skills): the field-types guide names the backfill for an amount switched to record mode; the dashboards guide says a record-mode amount aggregate is served only grouped by its code field
  
  Clause-②: no
  Metadata-protocol: none
  
  - **`objectstack-data/rules/field-types.md`**: an amount field with stored rows that is switched to `currencyMode: 'record'` is backfilled with `os migrate record-currency-codes`. The derived-measure sentence moves out of this guide; it already sits in the dashboards guide, which the line now points to.
  - **`objectstack-ui/rules/dashboards.md`**: a record-mode amount refuses `sum` / `avg` / `min` / `max` unless grouped by its code field. The old "ungrouped" read as if any grouping would do.

## 18.2.0

### Minor Changes

- 493a6c4: feat(spec,metadata-protocol): a seed dataset column can be written only when its row is created (`columns.FIELD.applyOn: 'create'`)
  
  Clause-②: yes
  Metadata-protocol: added
  
  A seed is replayed on every dev-server boot and every package re-publish, and an `upsert` replay re-asserts every column a record declares on the row it matched. That reverts the columns an app's own jobs write after the first seed (a status a payment job advances, a flag a renewal job sets), so a re-run undid the jobs' work with nothing in the log.
  
  A seed dataset now takes a per-column write policy, keyed by field name:
  
  ```ts
  defineSeed(Instalment, {
    externalId: 'code',
    columns: {
      status:      { applyOn: 'create' },
      is_expiring: { applyOn: 'create' },
    },
    records: [{ code: 'INS-001', amount: 1200, status: 'pending', is_expiring: false }],
  });
  ```
  
  - **`applyOn: 'create'`** writes the column when the seed creates the row and leaves it out of every write to a row the seed matched by its `externalId`: an `upsert` replay over an existing row, and every row of an `update` dataset. The matched row keeps the value it holds, while the `always` columns are refreshed. A row whose only differences are create-only columns is not written at all. A create-only reference column on a matched row is not resolved and not deferred to pass 2, so nothing later in the load writes it back. A column of the `externalId` is the key the row was matched by and stays in its update. `insert`, `ignore` and `replace` never update a matched row, so nothing changes on those modes.
  - **`applyOn: 'always'`** (the default, and every column without a `columns` entry) is the behaviour before this change.
  - The values, the default and the meaning are those of the import door's `FieldMappingEntry.applyOn`. Both doors now read one enum, exported as `ColumnApplyOnSchema` from `@objectstack/spec/data`. `SeedColumnSchema` (with `SeedColumn` / `SeedColumnParsed`) is the per-column shape.
  - A `columns` key must name a column the object has: a declared field, or a system column the platform injects on it such as `owner_id`. `defineSeed` refuses one that does not when it runs (and at compile time for an object literal), naming the key with a near miss. The seed loader logs an `error` naming the column, once per dataset, whenever it loads a seed that names one, since a stored seed never passes through `defineSeed`. The rows still load.
  - `SeedSchema` refuses an unknown key on a column (`unrecognized_keys`), and a dataset-level `applyOn` is pointed at `columns`.
  
  `@objectstack/skills` only regenerates its schema reference indexes, which now list `SeedColumnSchema` and `ColumnApplyOnSchema`.

### Patch Changes

- f3d0eab: docs(skills): the objectstack-automation capability table says a declared webhook or auto-launched flow is refused without its `requires` pair, not silently undelivered
  
  Clause-②: no
  Metadata-protocol: none
  
  The 〈Prerequisite — declare the capabilities your nodes need〉 table in `objectstack-automation/SKILL.md` said that without `webhooks` in `requires` "nothing [is] delivered outbound", and that without `triggers` "flows register, never fire". Neither is what `defineStack` does: a declared webhook while `requires` omits `webhooks`, `realtime` or both is refused with `STACK_WEBHOOK_CAPABILITY_REQUIRED` (422), and an auto-launched flow while `requires` omits `triggers`, `automation` or both is refused with `STACK_TRIGGER_CAPABILITY_REQUIRED` (422) — at `os validate`, `os build`, `os dev` and `os serve` alike. The two rows now name the pair each surface owes and the refusal code; the lead-in says the refusal is at load time and that neither token implies the other. The `requires: [...]` example block under the table is folded into the lead-in to keep the skill within its token ceiling.
- 061cc94: docs(skills): the objectstack-platform bootstrap example pins every `@objectstack/*` dependency to one exact version
  
  Clause-②: no
  
  The 〈Complete Working Example〉 `package.json` in `objectstack-platform/references/bootstrap.md` gave `^17.0.0` for its five `@objectstack/*` packages, a major behind and a caret range the v18 docs advise against. It now gives `18.1.0` for each, the exact form `create-objectstack` writes, with all of them on one version.
- 992a7e1: docs(skills): the objectstack-platform stack-config example declares `engines: { protocol: '^18' }`, the major the 18.x boot handshake accepts
  
  Clause-②: no
  Metadata-protocol: none
  
  `objectstack-platform/SKILL.md` taught `engines: { protocol: '^17' }` in its `defineStack` manifest example while `PROTOCOL_VERSION` is `18.0.0`, so a config copied from the skill was refused at boot (`OS_PROTOCOL_INCOMPATIBLE`). The example, the eval that pins it (`evals/config-plugins-ops.json`, prompt and expected output together) and the `objectstack-upgrade` sentence describing what the scaffold writes now all say `'^18'`, matching `create-objectstack` and every example app. The `'^17'` → `--from 17` worked example in `objectstack-upgrade` is unchanged.
- d0eac35: docs(skills): the automation skill's inbound-hook table names `config.secretRef`, the form a package ships instead of a literal secret
  
  Clause-②: no
  
  Metadata-protocol: none
  
  The `objectstack-automation` skill's start-node table said an `api` flow needs a non-blank literal `secret`, or the flow is refused at registration. An `api` flow's start node may now name its secret instead, with `secretRef: 'NAME'`: the deployment fills that name (an environment variable in the open tier, never `OS_*`), and the engine reads it at every post, answering `503` while the name is unfilled. The row now says either one is required, and that a package ships `secretRef` and never commits a literal. The signature line names the `x-objectstack-signature` header the row used to carry.
- 8f35ffc: docs(skills): object-level `composite` / `repeater` are untyped JSON — a typed list is a child object
  
  Clause-②: no
  Metadata-protocol: none
  
  The `objectstack-data` field-types table said a `composite` carries "declared sub-fields". An object field has no member that declares them: `fields`, `subFields` and `columns` are refused on the field. The two rows now say the types are untyped JSON and that a list needing typed columns is a child object with a `master_detail` field (`inlineEdit: 'grid'` edits it inline on the parent's form).
  
  What to do: nothing. No key, value or behaviour changes.
- d65cbb6: docs(skills, spec): state that every published package declares exactly one anchor-safe `isDefault: true` permission set
  
  Clause-②: no
  Metadata-protocol: none
  
  `objectstack-data/rules/security.md` said what `isDefault: true` means (the `everyone` baseline, ADR-0090 D5) but not that a published package must declare one. Its `isDefault` bullet now states the requirement as a check an author can run: exactly one such set, anchor-safe, meaning `describeAnchorForbiddenBits(set, 'everyone')` from `@objectstack/spec/security` returns `null`; otherwise lint rule `security-anchor-high-privilege` and the binding refuse it. It also says what happens without one (invited members get nothing until an admin assigns a set to each) and that no gate counts the sets. The Marketplace Protocol header in `marketplace.zod.ts`, which the generated marketplace reference page renders, gains a matching "What a published package declares" section. No lint rule or schema changes. To stay within the skill file's token ceiling, three source-path asides, a section reference and one sentence are trimmed in the same file.
- a8f2afa: docs(skills): the `objectui` skill joins the published catalog, so `@objectstack/skills` ships the `@object-ui/*` authoring skill beside the `objectstack-*` ones
  
  Clause-②: no
  Metadata-protocol: none
  
  - **What ships.** `skills/objectui/` (its `SKILL.md`, 11 guides, 3 rules, 11 evals and a README) moves in from the objectui repository's own `skills/` tree. A project that syncs `@objectstack/skills` now gets an `objectui` skill in its agent directory, and `npx skills add objectstack-ai/objectstack/skills` lists it on the `next` channel.
  - **Stamped like the others.** Its `compatibility:` line now reads `Requires @objectstack/spec 18.x`, and `metadata.version` carries the workspace version, as on every catalog skill.
  - **Content changes on the way in.** The guides use the platform's vocabulary: expression examples gate on `data.status` or a user position, not on a `role` field, and the expressions guide gates a combined condition with `visibleWhen` instead of the deprecated `visibleOn`. The `@object-ui/permissions` example keeps its real `roles` keys, and the plugin guide's color input passes `value ?? ''` instead of a hard-coded black fallback.
- 2409c9c: chore(packages): ship a LICENSE in the 14 published packages that had none
  
  Clause-②: no
  Metadata-protocol: none
  
  npm packs a package's own `LICENSE` whatever its `files` says, and nothing in the release tooling copies the repository's root `LICENSE` into a package, so these 14 published tarballs carried no licence text at all while declaring `"license": "Apache-2.0"`. Each now carries a byte-for-byte copy of the root `LICENSE`, the same file the other 59 published packages already ship. With this, every one of the 73 published packages outside `ui/` ships a LICENSE and a README.
- 8061f33: chore(packages): publishing metadata — per-format types in `exports`, declared `sideEffects`, and a README for the 18 published packages without one
  
  Clause-②: no
  Metadata-protocol: none
  
  Measured on a fresh `origin/main` build of all 73 published packages outside `ui/`, each staged as `npm pack` would ship it, with publint 0.3.25 and @arethetypeswrong/cli 0.18.5. Before: 73 of 73 packages carried at least one publint message and 48 carried an attw problem. After: 3 packages carry a publint message and 16 carry an attw problem, each remaining class needing a change this one deliberately does not make — an export-map shape change, or a dual-build fix in `@objectstack/core`.
  
  - **Types per module format.** On 38 manifests one `types` entry served both formats, so a TypeScript consumer importing the ESM build was handed the CJS declarations — every one of attw's 38 `FalseCJS`. Each `{types, import, require}` entry becomes `{import: {types, default}, require: {types, default}}` pointing at the declaration file the same tsup run already emits for that format. No subpath is added or removed, and no JavaScript target moves. `@objectstack/core` keeps its single `types` entry: its `.d.ts` and `.d.cts` declare the same classes with private members, so serving them per format gives a consumer that reaches `core` through both resolution modes two incompatible `ObjectKernel` types, which is `@objectstack/plugin-dev`'s declaration build (it awaits `import('@objectstack/objectql')` inside a CommonJS build). Its `FalseESM` therefore stays, measured and unfixed here.
  - **`sideEffects` on the 72 manifests that declared none**, read per package rather than set in bulk: `@objectstack/service-cluster-redis` registers its `redis` cluster driver at module load and `create-objectstack`'s bin reaches its program through a bare import, so both declare their entry files side-effectful; everything else is `false`.
  - **`publishConfig: { access: 'public' }`** on the 17 that had none, the value the other 56 already declare.
  - **`type`** on the 39 that shipped `.js` without declaring a format — every `.js` under their `dist/` was read first and is CommonJS, which is what the absent field already meant — **`engines.node >= 22.0.0`** on the 22 that had no `engines`, and **`repository.url`** as the full `git+https://` git URL on 71.
  - **A README for 18 published packages that had none**: one paragraph, the first import a reader writes, and a link to the package's docs page. They are the pages npm renders, and for these 18 npm rendered nothing.

## 18.1.0

### Patch Changes

- c0cde8b: docs(skills): the npm page and the catalog's front page give the install line for the project's own package manager
  
  Clause-②: no
  
  `README.md` (the npm page) and `dist/skills/README.md` (the catalog's front page, copied from the repository's `skills/README.md`) printed `npm install --save-dev "@objectstack/skills@$(node -p …)"` as the only install line. In a pnpm-installed project that line exits `1` with `npm error Cannot read properties of null (reading 'edgesOut')` and writes nothing, and `create-objectstack` installs with pnpm when it is available, so a scaffolded project is commonly a pnpm project.
  
  - **Both pages** now print `pnpm add -D "@objectstack/skills@$(node -p "require('@objectstack/spec/package.json').version")"`, with the npm and yarn spellings on a comment line beside it, and the rule: add the package with the manager that installed the project. The `objectstack-upgrade` skill's re-install step, which an agent follows for this exact move, prints the same line.
  - **The npm page** names pnpm's `ERR_PNPM_NO_MATCHING_VERSION` beside npm's `ETARGET` for a project on `@objectstack/spec` 17.x, and runs `npx skills list` before `npx skills remove --all`, which removes every installed skill without asking.
- 7f5b19d: docs(spec, skills): the `titleFormat` description and the objectstack-data skill no longer steer a composite record title that must be queried into a formula field
  
  Clause-②: no
  Metadata-protocol: none
  
  The `titleFormat` description (and its generated copies on the object, metadata and migration reference pages) and the `objectstack-data` skill's `nameField` and `titleFormat` rows told an author to migrate a composite record title to a `formula` field with `returnType: 'text'` designated as `nameField`. A formula value is computed on read and stored nowhere, so a sort by it is refused, search never reaches it, and an import cannot match a lookup cell against it. Both now say what the record-title lint and ADR-0079 D3 already say: a composite title that import, sort or search must match is a stored computed field, a non-`formula` field that declares an `expression`, which the engine computes and stores on every write, designated as `nameField`; a text formula designated as `nameField` stays legal for a title shown for display only.
  
  The same skill's "Computed column" bullet (`rules/relationships.md`) said a stored field's `expression` is a client compute hint and the sent value is stored verbatim. The engine computes the expression from the row the write stores and stores the result, so a client-sent value never stands; the bullet now says so.
  
  No key, type, default or accepted value changes; only the text an author reads changes.
- cb38a8c: docs(skills): the objectstack-data skill's `current_user` placeholder table names a declared membership key
  
  Clause-②: no
  
  The security rules' table of the `current_user.*` placeholders the RLS compiler resolves listed only the kernel's keys. It now has a row for `current_user.KEY`, the set an object's `membershipKeys.KEY` declares (for `IN`), so an author reading the catalog alone learns that a declared key resolves.
- 0949fe5: docs(skills): objectstack-data's security rules name the risk of renaming or removing a shipped access item in a later package version
  
  Clause-②: no
  Metadata-protocol: none
  
  `skills/objectstack-data/rules/security.md` gains a closing section, "Renaming or removing a shipped access item". Administrators act on a package's permission sets, positions, sharing rules and capabilities by name: they switch them off, clone them, and name the package's objects, fields and capabilities in their own sets. The section says what a rename, a removal or an added field deny does to those choices on upgrade, asks authors to keep shipped names stable and, when such a change is genuinely needed, to say in the release notes what changed and what an administrator should re-check. It is guidance only: no gate and no behaviour change.
  
  The file stays under its token ceiling. The new text is paid for by deleting restatements elsewhere in the same file: the stack-key bullet that repeated the code sample's comment, the assignment payload that repeated the row's columns, a code comment that repeated the sentence above it, the `viewAllRecords` corollary sentence, and the callout's repeats of the Layer 0 bullets and of a citation made two paragraphs earlier. No rule changes meaning.

## 18.0.0

### Minor Changes

- 165587e: New published package `@objectstack/skills`: the ObjectStack skills catalog (`skills/**` of the repository), shipped in the changeset `fixed` group so it always carries the version of the `@objectstack/*` packages it teaches. Its build copies the catalog into `dist/skills/<skill>/…` byte for byte (the layout the skills CLI's `experimental_sync` reads from `node_modules`), and `files` lists only that tree. The repository's `skills/**` stays the one source of truth and the documented `next` channel; nothing a consumer writes changes.
  
  `@objectstack/spec`: `llms.txt`'s package-ecosystem count reads 69 with `@objectstack/skills` joining the scope.

### Patch Changes

- f4755a6: docs(skills): `objectstack-data` says which hook doors provide `ctx.title` — a `body` has it, a deprecated `handler` gets it at runtime without `HookContext` declaring it, and `ql.registerHook` and a bare `ObjectQL` `bindHooks` do not provide it (#24289)
  
  Clause-②: no
  
  `skills/objectstack-data/references/data-hooks.md` listed `ctx.title(field?)` in the sandbox `ctx` table with no qualifier, so it read as a member of every hook context. It is not: a sandboxed `body` has it (the recommended form); an inline or named `handler`, which is deprecated, is handed it at runtime when the runtime binds the stack's hooks, but `HookContext` does not declare it, so a handler annotated with that type fails to compile; a hook registered with `ql.registerHook(...)`, or bound through `ObjectQL.bindHooks` with no runtime, gets no `ctx.title` at all. The row now says so. Text only; nothing an author writes changes, and no hook context changes.
- e4a770d: docs(skills): the `objectstack-ai` skill names the `agent` type's environment-overlay switch by its protocol-18 spelling, `allowEnvironmentOverlay:false` (#22340 S3)
  
  Clause-②: no
  
  `skills/objectstack-ai/SKILL.md`'s "Platform agents — reference only" section said the `agent` type is closed with `allowOrgOverride:false`. That key was renamed to `allowEnvironmentOverlay` in protocol 18 (ADR-0131 D6 retired the per-organization overlay axis, so the key names the one scope it governs; the old key stays on the registry entry schema only as a tombstone that refuses at parse with the new name in its prescription), so the published line now reads `allowEnvironmentOverlay:false`. The value, the `allowRuntimeCreate:false` beside it and the ADR-0063 §2 citation are unchanged; nothing an author writes changes. The same rename is recorded in `AGENTS.md` rule 7 and as header amendment notes on ADR-0005 and ADR-0010, none of which publishes.
- 44cadd3: fix(skills): the automation skill teaches flow value slots as a CEL envelope or a literal and text slots as `{{ }}` holes; the single-brace `{…}` dialect leaves the catalog text
  
  Clause-②: no
  
  The `objectstack-automation` skill no longer lists `{$User.<path>}`, `{NOW()}` / `{TODAY() ± N}` or any other single-brace `{…}` token as a spelling a flow value slot still reads, and the remedies it gives no longer pass through a refused spelling. What the skill now teaches is what the platform accepts:
  
  - A value slot — `assignments.*`, `fields.*`, a `subflow` / `map` `input.*`, a `script` `inputs.*`, a `loop` / `map` `collection`, a notify node's `recipients` / `templateData.*` / `sourceId`, an `http` node's `body`, each CRUD `filter` operand — takes a CEL value envelope `{ dialect: 'cel', source: '…' }` or a literal. A `{…}` token there is refused at `objectstack validate` (`expression-invalid`), `registerFlow` and the executor, naming its CEL spelling.
  - A text slot — notify `title` / `message` / `actionUrl`, screen `title` / `description`, end `message`, `http` `url` and `headers` — renders `{{ }}` holes.
  - The run user is `current_user.id`, guarded as `current_user != null ? current_user.id : null` in a flow that can run without a user; the date macros are `isoDate(today())`, `isoDate(daysFromNow(N))` / `isoDate(daysAgo(N))`, `isoDatetime(now())` and `isoDatetime(addDays(now(), N))`.
  - A CRUD `filter` operand that is a whole-string query placeholder (`{current_user_id}`, `{today}`) passes through to the query engine untouched; an operand that evaluates to `null` refuses the node.
  - A notify `recipients` value is one id, a list, or an envelope that evaluates to one, a list or `null` — a comma-separated string is one recipient.
  
  The `objectstack-query` skill's filters rule names the value-slot judge (`expression-invalid`) in place of the retired lint rule `flow-filter-token-unknown`, and the automation eval set's two expected outputs that spelled a retired token move with the text.
- 197fbe2: docs(skills): both READMEs the package ships install the catalog from `@objectstack/skills` at the installed `@objectstack/spec`'s version, and name the GitHub path only as the `next` channel (#22668)
  
  Clause-②: no
  
  `README.md` (the npm page) and `dist/skills/README.md` (the catalog's front page, copied from the repository's `skills/README.md`) are the two READMEs this package ships. Both now give the same two-step install the docs give: `npm install --save-dev "@objectstack/skills@$(node -p "require('@objectstack/spec/package.json').version")"`, then `npx skills experimental_sync --agent claude-code -y` — the catalog's version is then the installed spec's.
  
  Before: the npm page taught a bare `npm install --save-dev @objectstack/skills`, which on a project depending on `@objectstack/spec` 17.x installs `18.0.0-next.0`, the next major's catalog (the registry's `latest`); its example named `@objectstack/skills@17.7.0`, a version that was never published; and it did not say that the sync skips every skill a `skills add` installed, which is every project `create-objectstack` scaffolded through `18.0.0-next.0`. The catalog's front page still taught `npx skills add objectstack-ai/objectstack/skills …` as the install command for existing projects.
  
  Both pages now state which versions exist (published from `18.0.0-next.0` on; no 17.x, so step 1 answers `ETARGET` there), the update story (bump `@objectstack/skills` with the other `@objectstack/*` packages, then re-run the sync), and the GitHub path once, as the `next` channel: the unreleased `main`, for trying the next version's skills, not for a released project. Nothing under `dist/skills/*/` changes.
- 179f7bf: fix(skills): the `objectstack-data` field-types rule names all five formula `returnType` members, `'currency'` included, and the `currencyConfig` a currency formula carries (#22743)
  
  Clause-②: no
  
  `skills/objectstack-data/rules/field-types.md` taught a formula's `returnType` as the four-member set `'number' | 'text' | 'boolean' | 'date'`, and its formula example said `(no 'currency')`. `@objectstack/spec`'s `FieldSchema.returnType` is the five-member enum `'number' | 'text' | 'boolean' | 'date' | 'currency'`, and a formula whose `returnType` is `'currency'` carries its currency in its own `currencyConfig` — `CurrencyConfigSchema`, the same shape a `currency` field declares; absent, the mode is `dynamic`, the tenant default currency. The `formula` table row and the formula example now both state the five-member set and name `currencyConfig` as the carrier. The example's `CEL — record. prefixes required` comment, which restated the table cell above it, is removed to pay the skill's token ratchet. Nothing is said about how a currency formula renders.
- eed637c: docs(automation): every text that teaches a sender of an inbound `api` hook teaches the timestamped `x-objectstack-signature` form only — `t=<unix seconds>,v1=<hex>`, the HMAC-SHA256 of `<t>.<raw body>` under the flow's secret, refused when `t` is more than 300 seconds from the server clock
  
  Clause-②: no
  
  The inbound hook door has accepted the timestamped form since `signHttpBodyAt` landed in `@objectstack/core`, and it is the only form that stops a captured post from verifying forever; the published teaching still showed the body-only `sha256=<hex>` form. The guidance converges first; the door's refusal of the body-only form is a later change of its own.
  
  - **`@objectstack/skills`.** The `objectstack-automation` skill's Inbound webhook section teaches `t=<unix seconds>,v1=<hex>`: `v1` is the HMAC-SHA256 of `<t>.<raw body>` under the start node's `secret`, and the door refuses a `t` more than 300 seconds from its clock. The body-only form is no longer shown.
  - **`@objectstack/lint`.** The hint of `flow-api-trigger-secret-missing` and its `os explain` entry describe the same form. The rule's id, severity, verdict sentence and judgement are unchanged.
  - The showcase example's comment and the platform checklist's intake recipe sign the same way.
  
  **Nothing to migrate for an author.** A sender that already signs with `signHttpBodyAt` is unchanged. **The outbound contract stays as published:** the messaging outbox and the flow `http` node keep signing body-only (`signHttpBody`) for third-party receivers, and the inbound door's accept set is not changed by this release.
- e9e10fd: docs(skills): the `objectstack-data` indexing rule's partial-index example teaches the rule with an application-shaped index instead of restating the platform's overlay uniqueness key (#23039)
  
  Clause-②: no
  
  `skills/objectstack-data/rules/indexing.md`'s "Access methods and partial indexes" section illustrated a partial index with the platform's own overlay-uniqueness DDL and said that was what `ensureOverlayIndex` runs. The quoted key had four parts; the platform's runtime key has carried a fifth, `bundle_member`, since protocol 18, so the sentence stated something the platform no longer runs. The example is re-cut to an application-shaped partial index — one *active* subscription per account, the coarse `{ fields: ['account_id'] }` declared in metadata and the unique partial form built in a migration — so the rule is taught without restating a platform key that changes on its own schedule. The rule itself is unchanged: declare the coarse index (or none) in metadata, build the partial form as raw SQL in a runtime migration, fall back to a plain index on a dialect that rejects the predicate. Nothing an author writes changes.
- 11d4c5a: docs(skills): the `objectstack-data` lint-rule reference drops `security-external-wider-than-internal`, retired with `externalSharingModel` (#23268)
  
  Clause-②: no
  
  The row named a rule `@objectstack/lint` 18 no longer has, and nothing an author writes changes.
- 713f231: docs(skills): the upgrade skill's preflight re-installs the catalog from `@objectstack/skills` when a 17.x project moves to 18, and both READMEs give the scaffolder's pinned `--copy` sync (#23276)
  
  Clause-②: no
  
  `objectstack-upgrade`'s §0 Preflight gains one step for the skills themselves. A 17.x project's skills were installed with `skills add` from the repository's `main`; their `skills-lock.json` entries read `sourceType: github`, and `experimental_sync` skips them (it prints `Skipped … installed with skills add` and exits 0), so a project that only bumps its packages keeps its 17.x-era skill text. The step removes the eleven `objectstack-*` skills the catalog carried during 17.x (a name not installed is skipped; `--all` when they are the project's only skills), installs `@objectstack/skills` at the installed `@objectstack/spec`'s version, and copies it with `npx skills@1.7.2 experimental_sync --agent claude-code --copy -y` — the command `create-objectstack` runs. The step is paid under the token ratchet by deleting text the same file restates elsewhere; the ceiling is unchanged.
  
  `README.md` (the npm page) and `dist/skills/README.md` (the catalog's front page, copied from the repository's `skills/README.md`) replace the unpinned linked sync (`npx skills experimental_sync --agent claude-code -y`) with that pinned `--copy` spelling and say why: without `--copy` the sync writes links into `node_modules`, which a clone of a project that commits its skills does not have.
- 68e64dd: fix(skills): the automation skill's two reference files write a CRUD `filter` operand as a CEL value envelope or the `{today}` query placeholder; the single-brace `{…}` filter spelling leaves them
  
  Clause-②: no
  
  `skills/objectstack-automation/references/examples-flows.md` and `references/state-machines-and-approvals.md` no longer teach `'{TODAY()}'`, `'{TODAY() + N}'` or `'{record.id}'` at an `update_record` filter operand — spellings the platform refuses (`expression-invalid`) at `objectstack validate`, `registerFlow` and the executor, so an author who copied the example got a refused node. The examples now write what the platform accepts: the query placeholder `'{today}'` for today's date, a CEL value envelope `{ dialect: 'cel', source: 'isoDate(daysFromNow(N))' }` for a one-day window at a date offset, and `{ dialect: 'cel', source: 'record.id' }` for the triggering record's id. The prose names the CEL value envelope where it named a template token (and no longer says a CEL envelope is compared as a literal at a filter operand), and the time-word cheat sheet names the CEL envelope and the `{{ }}` text hole where it named the retired `{…}` template.
- 46ca793: docs(skills): the `objectstack-ui` pages rule says what a page type, template and region name run (#23610)
  
  Clause-②: no
  
  `skills/objectstack-ui/rules/pages.md` taught `home` as the app's landing page, `utility` as a floating utility panel, templates `two-column` / `single-column` and regions `left_sidebar` / `right_sidebar`, and `kind: 'jsx'` as a live alias of `html` — none of which the console draws or the spec accepts. The rule now states the declared contract: `home` is the widest region page and not a landing (an app opens on its first navigation item; `isDefault` on it is refused), `utility` is a narrow inline region page with no floating or docked shell slot, `template` is one of `default`, `header-sidebar-main`, `three-column` or `dashboard` with the regions each one places (`sidebar` left, `aside` right; `full-width` retired), a region the template does not place or a second region for a filled slot is refused at its `name`, and `kind: 'jsx'` is refused with the prescription `html`. Skill text only; nothing an author writes changes.
- 5477020: docs(skills): the `objectstack-data` security rule states a grant's uniqueness as the declared `unique: 'organization'` index holds it, in place of the retired `permission_set_id` column (#23615)
  
  Clause-②: no
  
  `skills/objectstack-data/rules/security.md`'s grant paragraph closed with "`permission_set_id` is a legacy column: do not write it." The grant object `sys_user_permission_set` no longer declares that column, so a write naming it is refused `400 INVALID_FIELD` as an undeclared field, and the sentence taught an AI author a key the declared shape does not have. The sentence is replaced by the rule the declared shape holds: one grant per user, set and organization, enforced by the join object's `unique: 'organization'` index on (`user_id`, `permission_set`, `organization_id`). The by-name reference — `permission_set` takes the set's `name` — and its refusals are unchanged. No behaviour changes; nothing an author writes changes.
- b711056: docs(skills): the `objectstack-ui` navigation rule states the derived record surface per flow — viewing routes to a page, creating or editing opens a modal bounded on desktop and full-screen on mobile, a light record uses a drawer (#23753)
  
  Clause-②: no
  
  `skills/objectstack-ui/rules/navigation.md`'s Surface bullet said a field-heavy object opens create/edit/detail as a full page and that mobile always pages. The platform's derivation (`deriveRecordFlowSurface` in `@objectstack/spec`) routes only the `view` flow to a page; the create, edit and child task flows never route — a field-heavy record, or any record on mobile, opens them in a modal that is bounded on desktop and full-screen on mobile, and a light record on desktop opens every flow in a drawer. The bullet now states that mapping and names the override only where the spec declares it: `navigation.mode` on the list view (`navigation` is not an object key). Text only; nothing an author writes changes.
- 2fdfb5d: docs(skills): the `objectstack-data` datasources rule states that `default` is host-reserved — the host connects it from `OS_DATABASE_URL`, and a stack that declares a datasource named `default` is refused (#23768)
  
  Clause-②: no
  
  `skills/objectstack-data/rules/datasources.md`'s opening paragraph read "Most apps need only the `default` datasource; declare more to read/write a separate or external database." "Declare more" implied that `default` is declared too, and a stack whose `datasources` collection carries an entry named `default` is refused at `defineStack`, `os validate`, publish and boot: the host declares and connects `default` itself. The sentence is replaced by the rule the spec and runtime hold: `default` is host-reserved, the host connects it from `OS_DATABASE_URL`, a stack that declares a datasource named `default` is refused, and a datasource is declared under its own name only to read/write a separate or external database. The added words are paid for inside the same file by deleting two restatements of the field reference: "`external` settings are required when `schemaMode !== 'managed'`" (the schema refuses the omission itself) and "Set `autoConnect: true` to force a live connection" (the auto-connect list two lines above already names it). No behaviour changes; nothing an author writes changes.
- 49700e4: docs(skills): the `objectstack-api` skill stops teaching an app to mount routes on `http.server` — an app declares `apis:`, computes in a flow, and registers code as a stack function or a connector (#23787)
  
  Clause-②: no
  
  `skills/objectstack-api/SKILL.md`'s decision table sent an endpoint that needs code to an imperative `http.server` mount on `kernel:ready`, and its "Code routes" section taught that mount. Ruling C′ item 2 on #23128 retired the mount as an app-author surface: the `http.server` service is the platform plugins' own door-building primitive. The table now points code at a `type: 'flow'` endpoint whose `script` node runs a stack function (`defineStack({ functions })`) or whose `connector_action` node calls a declared connector, names the inbound `type: 'api'` flow hook for a webhook signed with ObjectStack's own `x-objectstack-signature`, and states the three cases that have no app surface today (a third-party callback verified by its own signature over the raw body, a streaming response, a protocol the platform does not speak) instead of inventing one. The "Code routes" section is deleted, and eval 3 expects that answer. Skill text only; nothing an author writes changes.
- f1c0b57: docs(skills): `objectstack-data` and `objectstack-formula` state that `previous` is `null` on insert — `previous == null` judges an insert, a column read off it there faults, and only a write to an existing row whose prior state is not in hand leaves it unbound (#23983)
  
  Clause-②: no
  
  `skills/objectstack-data/references/data-hooks.md` and `skills/objectstack-formula/SKILL.md` said `previous` is unbound on insert events and told authors to write insert-event conditions over `record` alone. Since `@objectstack/objectql` binds `previous` to `null` on insert in validation rules and declarative hook conditions (the binding a flow's start condition already had), that text was false: `previous == null || …` judges an insert and `previous != null && …` skips one; only a column read off `previous` on insert (`previous.status`) still has no value and still fails the write, and only a write to an existing row whose prior state is not in hand leaves `previous` unbound, failing closed. The bullet, the scope-table row, the abort note and the legacy-translation note now state that binding and the `null` guard; the `record`-alone advice stays correct and is no longer presented as the rule. Text only; nothing an author writes changes, and a hook's `ctx.previous` is unchanged.
- 53ef752: docs(skills): `objectstack-api` states that a public form's submit is authorized by the form's own `publicFormGrant`, and that the `guest_portal` name on the submit context admits nothing and needs no permission set (#24239)
  
  Clause-②: no
  
  `skills/objectstack-api/SKILL.md` described the anonymous form endpoints as running under a synthetic `{ permissions: ['guest_portal'], anonymous: true }` execution context and named nothing else, so an author reading it inferred that a `guest_portal` permission set authorizes the submit and declared one, or concluded that the form falls open without one. Neither is true: the submit is authorized by the form's own declaration (ADR-0056 Option A) — the route hands the engine a `publicFormGrant` scoped to the form's target object, which admits the create and the read-back of the row it made and nothing else, decided before any permission set resolves. The `guest_portal` name on the context admits nothing; where a deployment registers a set under it, that set only feeds the grant's result masker. The passage now says so, matching `content/docs/ui/public-data-collection.mdx` and the `registerFormEndpoints` docstring in `@objectstack/rest`. Text only; nothing an author writes changes, and the form routes' behaviour is unchanged.

## 18.0.0-next.5

No changes in this release.

## 18.0.0-next.4

### Patch Changes

- f1c0b57: docs(skills): `objectstack-data` and `objectstack-formula` state that `previous` is `null` on insert — `previous == null` judges an insert, a column read off it there faults, and only a write to an existing row whose prior state is not in hand leaves it unbound (#23983)
  
  Clause-②: no
  
  `skills/objectstack-data/references/data-hooks.md` and `skills/objectstack-formula/SKILL.md` said `previous` is unbound on insert events and told authors to write insert-event conditions over `record` alone. Since `@objectstack/objectql` binds `previous` to `null` on insert in validation rules and declarative hook conditions (the binding a flow's start condition already had), that text was false: `previous == null || …` judges an insert and `previous != null && …` skips one; only a column read off `previous` on insert (`previous.status`) still has no value and still fails the write, and only a write to an existing row whose prior state is not in hand leaves `previous` unbound, failing closed. The bullet, the scope-table row, the abort note and the legacy-translation note now state that binding and the `null` guard; the `record`-alone advice stays correct and is no longer presented as the rule. Text only; nothing an author writes changes, and a hook's `ctx.previous` is unchanged.
- 53ef752: docs(skills): `objectstack-api` states that a public form's submit is authorized by the form's own `publicFormGrant`, and that the `guest_portal` name on the submit context admits nothing and needs no permission set (#24239)
  
  Clause-②: no
  
  `skills/objectstack-api/SKILL.md` described the anonymous form endpoints as running under a synthetic `{ permissions: ['guest_portal'], anonymous: true }` execution context and named nothing else, so an author reading it inferred that a `guest_portal` permission set authorizes the submit and declared one, or concluded that the form falls open without one. Neither is true: the submit is authorized by the form's own declaration (ADR-0056 Option A) — the route hands the engine a `publicFormGrant` scoped to the form's target object, which admits the create and the read-back of the row it made and nothing else, decided before any permission set resolves. The `guest_portal` name on the context admits nothing; where a deployment registers a set under it, that set only feeds the grant's result masker. The passage now says so, matching `content/docs/ui/public-data-collection.mdx` and the `registerFormEndpoints` docstring in `@objectstack/rest`. Text only; nothing an author writes changes, and the form routes' behaviour is unchanged.

## 18.0.0-next.3

### Patch Changes

- 46ca793: docs(skills): the `objectstack-ui` pages rule says what a page type, template and region name run (#23610)
  
  Clause-②: no
  
  `skills/objectstack-ui/rules/pages.md` taught `home` as the app's landing page, `utility` as a floating utility panel, templates `two-column` / `single-column` and regions `left_sidebar` / `right_sidebar`, and `kind: 'jsx'` as a live alias of `html` — none of which the console draws or the spec accepts. The rule now states the declared contract: `home` is the widest region page and not a landing (an app opens on its first navigation item; `isDefault` on it is refused), `utility` is a narrow inline region page with no floating or docked shell slot, `template` is one of `default`, `header-sidebar-main`, `three-column` or `dashboard` with the regions each one places (`sidebar` left, `aside` right; `full-width` retired), a region the template does not place or a second region for a filled slot is refused at its `name`, and `kind: 'jsx'` is refused with the prescription `html`. Skill text only; nothing an author writes changes.
- b711056: docs(skills): the `objectstack-ui` navigation rule states the derived record surface per flow — viewing routes to a page, creating or editing opens a modal bounded on desktop and full-screen on mobile, a light record uses a drawer (#23753)
  
  Clause-②: no
  
  `skills/objectstack-ui/rules/navigation.md`'s Surface bullet said a field-heavy object opens create/edit/detail as a full page and that mobile always pages. The platform's derivation (`deriveRecordFlowSurface` in `@objectstack/spec`) routes only the `view` flow to a page; the create, edit and child task flows never route — a field-heavy record, or any record on mobile, opens them in a modal that is bounded on desktop and full-screen on mobile, and a light record on desktop opens every flow in a drawer. The bullet now states that mapping and names the override only where the spec declares it: `navigation.mode` on the list view (`navigation` is not an object key). Text only; nothing an author writes changes.
- 2fdfb5d: docs(skills): the `objectstack-data` datasources rule states that `default` is host-reserved — the host connects it from `OS_DATABASE_URL`, and a stack that declares a datasource named `default` is refused (#23768)
  
  Clause-②: no
  
  `skills/objectstack-data/rules/datasources.md`'s opening paragraph read "Most apps need only the `default` datasource; declare more to read/write a separate or external database." "Declare more" implied that `default` is declared too, and a stack whose `datasources` collection carries an entry named `default` is refused at `defineStack`, `os validate`, publish and boot: the host declares and connects `default` itself. The sentence is replaced by the rule the spec and runtime hold: `default` is host-reserved, the host connects it from `OS_DATABASE_URL`, a stack that declares a datasource named `default` is refused, and a datasource is declared under its own name only to read/write a separate or external database. The added words are paid for inside the same file by deleting two restatements of the field reference: "`external` settings are required when `schemaMode !== 'managed'`" (the schema refuses the omission itself) and "Set `autoConnect: true` to force a live connection" (the auto-connect list two lines above already names it). No behaviour changes; nothing an author writes changes.
- 49700e4: docs(skills): the `objectstack-api` skill stops teaching an app to mount routes on `http.server` — an app declares `apis:`, computes in a flow, and registers code as a stack function or a connector (#23787)
  
  Clause-②: no
  
  `skills/objectstack-api/SKILL.md`'s decision table sent an endpoint that needs code to an imperative `http.server` mount on `kernel:ready`, and its "Code routes" section taught that mount. Ruling C′ item 2 on #23128 retired the mount as an app-author surface: the `http.server` service is the platform plugins' own door-building primitive. The table now points code at a `type: 'flow'` endpoint whose `script` node runs a stack function (`defineStack({ functions })`) or whose `connector_action` node calls a declared connector, names the inbound `type: 'api'` flow hook for a webhook signed with ObjectStack's own `x-objectstack-signature`, and states the three cases that have no app surface today (a third-party callback verified by its own signature over the raw body, a streaming response, a protocol the platform does not speak) instead of inventing one. The "Code routes" section is deleted, and eval 3 expects that answer. Skill text only; nothing an author writes changes.

## 18.0.0-next.2

### Patch Changes

- 11d4c5a: docs(skills): the `objectstack-data` lint-rule reference drops `security-external-wider-than-internal`, retired with `externalSharingModel` (#23268)
  
  Clause-②: no
  
  The row named a rule `@objectstack/lint` 18 no longer has, and nothing an author writes changes.
- 5477020: docs(skills): the `objectstack-data` security rule states a grant's uniqueness as the declared `unique: 'organization'` index holds it, in place of the retired `permission_set_id` column (#23615)
  
  Clause-②: no
  
  `skills/objectstack-data/rules/security.md`'s grant paragraph closed with "`permission_set_id` is a legacy column: do not write it." The grant object `sys_user_permission_set` no longer declares that column, so a write naming it is refused `400 INVALID_FIELD` as an undeclared field, and the sentence taught an AI author a key the declared shape does not have. The sentence is replaced by the rule the declared shape holds: one grant per user, set and organization, enforced by the join object's `unique: 'organization'` index on (`user_id`, `permission_set`, `organization_id`). The by-name reference — `permission_set` takes the set's `name` — and its refusals are unchanged. No behaviour changes; nothing an author writes changes.

## 18.0.0-next.1

### Patch Changes

- 44cadd3: fix(skills): the automation skill teaches flow value slots as a CEL envelope or a literal and text slots as `{{ }}` holes; the single-brace `{…}` dialect leaves the catalog text
  
  Clause-②: no
  
  The `objectstack-automation` skill no longer lists `{$User.<path>}`, `{NOW()}` / `{TODAY() ± N}` or any other single-brace `{…}` token as a spelling a flow value slot still reads, and the remedies it gives no longer pass through a refused spelling. What the skill now teaches is what the platform accepts:
  
  - A value slot — `assignments.*`, `fields.*`, a `subflow` / `map` `input.*`, a `script` `inputs.*`, a `loop` / `map` `collection`, a notify node's `recipients` / `templateData.*` / `sourceId`, an `http` node's `body`, each CRUD `filter` operand — takes a CEL value envelope `{ dialect: 'cel', source: '…' }` or a literal. A `{…}` token there is refused at `objectstack validate` (`expression-invalid`), `registerFlow` and the executor, naming its CEL spelling.
  - A text slot — notify `title` / `message` / `actionUrl`, screen `title` / `description`, end `message`, `http` `url` and `headers` — renders `{{ }}` holes.
  - The run user is `current_user.id`, guarded as `current_user != null ? current_user.id : null` in a flow that can run without a user; the date macros are `isoDate(today())`, `isoDate(daysFromNow(N))` / `isoDate(daysAgo(N))`, `isoDatetime(now())` and `isoDatetime(addDays(now(), N))`.
  - A CRUD `filter` operand that is a whole-string query placeholder (`{current_user_id}`, `{today}`) passes through to the query engine untouched; an operand that evaluates to `null` refuses the node.
  - A notify `recipients` value is one id, a list, or an envelope that evaluates to one, a list or `null` — a comma-separated string is one recipient.
  
  The `objectstack-query` skill's filters rule names the value-slot judge (`expression-invalid`) in place of the retired lint rule `flow-filter-token-unknown`, and the automation eval set's two expected outputs that spelled a retired token move with the text.
- 197fbe2: docs(skills): both READMEs the package ships install the catalog from `@objectstack/skills` at the installed `@objectstack/spec`'s version, and name the GitHub path only as the `next` channel (#22668)
  
  Clause-②: no
  
  `README.md` (the npm page) and `dist/skills/README.md` (the catalog's front page, copied from the repository's `skills/README.md`) are the two READMEs this package ships. Both now give the same two-step install the docs give: `npm install --save-dev "@objectstack/skills@$(node -p "require('@objectstack/spec/package.json').version")"`, then `npx skills experimental_sync --agent claude-code -y` — the catalog's version is then the installed spec's.
  
  Before: the npm page taught a bare `npm install --save-dev @objectstack/skills`, which on a project depending on `@objectstack/spec` 17.x installs `18.0.0-next.0`, the next major's catalog (the registry's `latest`); its example named `@objectstack/skills@17.7.0`, a version that was never published; and it did not say that the sync skips every skill a `skills add` installed, which is every project `create-objectstack` scaffolded through `18.0.0-next.0`. The catalog's front page still taught `npx skills add objectstack-ai/objectstack/skills …` as the install command for existing projects.
  
  Both pages now state which versions exist (published from `18.0.0-next.0` on; no 17.x, so step 1 answers `ETARGET` there), the update story (bump `@objectstack/skills` with the other `@objectstack/*` packages, then re-run the sync), and the GitHub path once, as the `next` channel: the unreleased `main`, for trying the next version's skills, not for a released project. Nothing under `dist/skills/*/` changes.
- 713f231: docs(skills): the upgrade skill's preflight re-installs the catalog from `@objectstack/skills` when a 17.x project moves to 18, and both READMEs give the scaffolder's pinned `--copy` sync (#23276)
  
  Clause-②: no
  
  `objectstack-upgrade`'s §0 Preflight gains one step for the skills themselves. A 17.x project's skills were installed with `skills add` from the repository's `main`; their `skills-lock.json` entries read `sourceType: github`, and `experimental_sync` skips them (it prints `Skipped … installed with skills add` and exits 0), so a project that only bumps its packages keeps its 17.x-era skill text. The step removes the eleven `objectstack-*` skills the catalog carried during 17.x (a name not installed is skipped; `--all` when they are the project's only skills), installs `@objectstack/skills` at the installed `@objectstack/spec`'s version, and copies it with `npx skills@1.7.2 experimental_sync --agent claude-code --copy -y` — the command `create-objectstack` runs. The step is paid under the token ratchet by deleting text the same file restates elsewhere; the ceiling is unchanged.
  
  `README.md` (the npm page) and `dist/skills/README.md` (the catalog's front page, copied from the repository's `skills/README.md`) replace the unpinned linked sync (`npx skills experimental_sync --agent claude-code -y`) with that pinned `--copy` spelling and say why: without `--copy` the sync writes links into `node_modules`, which a clone of a project that commits its skills does not have.
- 68e64dd: fix(skills): the automation skill's two reference files write a CRUD `filter` operand as a CEL value envelope or the `{today}` query placeholder; the single-brace `{…}` filter spelling leaves them
  
  Clause-②: no
  
  `skills/objectstack-automation/references/examples-flows.md` and `references/state-machines-and-approvals.md` no longer teach `'{TODAY()}'`, `'{TODAY() + N}'` or `'{record.id}'` at an `update_record` filter operand — spellings the platform refuses (`expression-invalid`) at `objectstack validate`, `registerFlow` and the executor, so an author who copied the example got a refused node. The examples now write what the platform accepts: the query placeholder `'{today}'` for today's date, a CEL value envelope `{ dialect: 'cel', source: 'isoDate(daysFromNow(N))' }` for a one-day window at a date offset, and `{ dialect: 'cel', source: 'record.id' }` for the triggering record's id. The prose names the CEL value envelope where it named a template token (and no longer says a CEL envelope is compared as a literal at a filter operand), and the time-word cheat sheet names the CEL envelope and the `{{ }}` text hole where it named the retired `{…}` template.

## 18.0.0-next.0

### Minor Changes

- 165587e: New published package `@objectstack/skills`: the ObjectStack skills catalog (`skills/**` of the repository), shipped in the changeset `fixed` group so it always carries the version of the `@objectstack/*` packages it teaches. Its build copies the catalog into `dist/skills/<skill>/…` byte for byte (the layout the skills CLI's `experimental_sync` reads from `node_modules`), and `files` lists only that tree. The repository's `skills/**` stays the one source of truth and the documented `next` channel; nothing a consumer writes changes.
  
  `@objectstack/spec`: `llms.txt`'s package-ecosystem count reads 69 with `@objectstack/skills` joining the scope.

### Patch Changes

- e4a770d: docs(skills): the `objectstack-ai` skill names the `agent` type's environment-overlay switch by its protocol-18 spelling, `allowEnvironmentOverlay:false` (#22340 S3)
  
  Clause-②: no
  
  `skills/objectstack-ai/SKILL.md`'s "Platform agents — reference only" section said the `agent` type is closed with `allowOrgOverride:false`. That key was renamed to `allowEnvironmentOverlay` in protocol 18 (ADR-0131 D6 retired the per-organization overlay axis, so the key names the one scope it governs; the old key stays on the registry entry schema only as a tombstone that refuses at parse with the new name in its prescription), so the published line now reads `allowEnvironmentOverlay:false`. The value, the `allowRuntimeCreate:false` beside it and the ADR-0063 §2 citation are unchanged; nothing an author writes changes. The same rename is recorded in `AGENTS.md` rule 7 and as header amendment notes on ADR-0005 and ADR-0010, none of which publishes.
- 179f7bf: fix(skills): the `objectstack-data` field-types rule names all five formula `returnType` members, `'currency'` included, and the `currencyConfig` a currency formula carries (#22743)
  
  Clause-②: no
  
  `skills/objectstack-data/rules/field-types.md` taught a formula's `returnType` as the four-member set `'number' | 'text' | 'boolean' | 'date'`, and its formula example said `(no 'currency')`. `@objectstack/spec`'s `FieldSchema.returnType` is the five-member enum `'number' | 'text' | 'boolean' | 'date' | 'currency'`, and a formula whose `returnType` is `'currency'` carries its currency in its own `currencyConfig` — `CurrencyConfigSchema`, the same shape a `currency` field declares; absent, the mode is `dynamic`, the tenant default currency. The `formula` table row and the formula example now both state the five-member set and name `currencyConfig` as the carrier. The example's `CEL — record. prefixes required` comment, which restated the table cell above it, is removed to pay the skill's token ratchet. Nothing is said about how a currency formula renders.
- eed637c: docs(automation): every text that teaches a sender of an inbound `api` hook teaches the timestamped `x-objectstack-signature` form only — `t=<unix seconds>,v1=<hex>`, the HMAC-SHA256 of `<t>.<raw body>` under the flow's secret, refused when `t` is more than 300 seconds from the server clock
  
  Clause-②: no
  
  The inbound hook door has accepted the timestamped form since `signHttpBodyAt` landed in `@objectstack/core`, and it is the only form that stops a captured post from verifying forever; the published teaching still showed the body-only `sha256=<hex>` form. The guidance converges first; the door's refusal of the body-only form is a later change of its own.
  
  - **`@objectstack/skills`.** The `objectstack-automation` skill's Inbound webhook section teaches `t=<unix seconds>,v1=<hex>`: `v1` is the HMAC-SHA256 of `<t>.<raw body>` under the start node's `secret`, and the door refuses a `t` more than 300 seconds from its clock. The body-only form is no longer shown.
  - **`@objectstack/lint`.** The hint of `flow-api-trigger-secret-missing` and its `os explain` entry describe the same form. The rule's id, severity, verdict sentence and judgement are unchanged.
  - The showcase example's comment and the platform checklist's intake recipe sign the same way.
  
  **Nothing to migrate for an author.** A sender that already signs with `signHttpBodyAt` is unchanged. **The outbound contract stays as published:** the messaging outbox and the flow `http` node keep signing body-only (`signHttpBody`) for third-party receivers, and the inbound door's accept set is not changed by this release.
- e9e10fd: docs(skills): the `objectstack-data` indexing rule's partial-index example teaches the rule with an application-shaped index instead of restating the platform's overlay uniqueness key (#23039)
  
  Clause-②: no
  
  `skills/objectstack-data/rules/indexing.md`'s "Access methods and partial indexes" section illustrated a partial index with the platform's own overlay-uniqueness DDL and said that was what `ensureOverlayIndex` runs. The quoted key had four parts; the platform's runtime key has carried a fifth, `bundle_member`, since protocol 18, so the sentence stated something the platform no longer runs. The example is re-cut to an application-shaped partial index — one *active* subscription per account, the coarse `{ fields: ['account_id'] }` declared in metadata and the unique partial form built in a migration — so the rule is taught without restating a platform key that changes on its own schedule. The rule itself is unchanged: declare the coarse index (or none) in metadata, build the partial form as raw SQL in a runtime migration, fall back to a plain index on a dialect that rejects the predicate. Nothing an author writes changes.
