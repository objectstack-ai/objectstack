---
"@objectstack/lint": patch
---

fix(lint): 15 author-time rule ids print a `fix:` line of one remedy sentence, and `os explain <rule-id>` carries what those lines used to enumerate

Clause-②: no

- **Shorter fix lines.** Each finding of these 15 rule ids now carries a `hint` (the CLI's `fix:` line, the runtime issue's `hint`) of one remedy sentence of at most 200 characters (the lengths here are the `hint` alone; the CLI prints it after `fix: `). Before, the longest of each ran from 128 to 2,280 characters. The ids:
  - sharing rules: `sharing-rule-runtime-variable-condition` (2,280 → 195) and `sharing-rule-unlowerable-condition` (968 → 199);
  - approvals: `approval-approvers-may-resolve-empty` (its `manager` arm 2,243 → 198, its group arm 440 → 200);
  - RLS predicates: `rls-predicate-unenforceable` (1,056 → 191), `rls-predicate-over-budget` (1,044 → 197) and `rls-predicate-unknown-field` (766 → 154);
  - filters: `filter-empty-combinator` (764 → 154);
  - permission sets: `permission-retired-lifecycle-residue` (681 → 14: `Delete the key`);
  - view visibility: `visibility-predicate-over-budget` (651 → 179);
  - hook bodies: `hook-api-update-readonly-field` (647 → 182);
  - flows: `flow-time-relative-descriptor-invalid` (342 → 176);
  - pages: `component-type-unknown` (229 → 158), `react-chart-aggregate-invalid` (363 → 191) and `react-chart-drilldown-invalid` (128 → 181: longer, because it now carries the remedy instead of a pointer);
  - fields: `field-no-consumers` (on `os validate` of the showcase app, 624 → 199).
- **Four fix lines pointed at text the verdict no longer carries.** `component-type-unknown` said "Apply the prescription above", `react-chart-drilldown-invalid` and `react-chart-aggregate-invalid` said "the rejection above carries the fix", and `flow-time-relative-descriptor-invalid` said "satisfies each message above", after earlier releases cut those verdicts to one sentence. Each now names the remedy itself: the retired component type's "Delete the …" sentence cut from `RETIRED_PAGE_COMPONENT_TYPES` (for example `Delete the \`element:form\` component and use the object-bound \`object-form\` block instead`), the schema refusal's rename or the layer a misplaced key belongs to, and the descriptor key the verdict names.
- **Enumerations are cut to the first item and a count.** `field-no-consumers` names the first carrier site and counts the rest (`… together with its 16 carrier site(s): translations[0].en.objects.showcase_account.fields.website (and 15 more)`), where it listed every one. `rls-predicate-unenforceable` gives the first faulty site's rewrite and counts the rest; for a bare `current_user` it names the key slot (`current_user.<key>`) instead of listing every kernel key. `rls-predicate-unknown-field` no longer lists every field of the object: the verdict's "Did you mean" already names the nearest one. `permission-retired-lifecycle-residue` carries the retirement's own "Delete the key" sentence, cut from the tombstone's prescription, not the whole prescription.
- **`os explain <rule-id>` carries the rest.** What the fix lines stopped saying is each id's `RULE_EXPLANATIONS` entry in `@objectstack/lint`, which `os explain <rule-id>` prints: the lowerable predicate subset and its traps, the comparison classes with the declared types each holds, the rule each `current_user` holding breaks, which mechanism replaces a `current_user` read on which sharing model (an RLS policy narrows only `public_read` / `public_read_write`; it grants nothing on `private`), the graded routes that populate `sys_user.manager_id`, the four ways to shrink an oversized RLS predicate (and why a top-level `&&` must never be split), and the declared "match nothing" filter spelling. The entries already existed; they gain paragraphs.
- **Where the new fix lines print.** On the CLI: the `fix:` line under each finding of `os validate`, `os build` (and `os compile`, which `os dev` runs at startup and, under `--verbose`, on each watch recompile), the scaffold check `os init` runs, and `os verify`'s refusal list; `os lint` prints it as `→ fix:` under `--fix` and as `fix` in `--json`; `os validate --json` (`errors`) and `os build --json` (author-time `issues`) carry it on an error-severity finding; their `warnings` carry an advisory as one `where: message` string, without it. At the runtime publish gate (Studio, REST `PUT /api/v1/meta`, and the MCP and AI authors that write through that door), the `hint` FROM → TO, measured at the door:
  - a `flow` write: `flow-time-relative-descriptor-invalid` (422 `issues[].hint`, 342 → 176), `filter-empty-combinator` (422, 647 / 764 → 134 / 154) and `approval-approvers-may-resolve-empty` (2xx `advisories[].hint` and the `[Protocol] authoring advisory` log line, 2,243 / 440 → 198 / 200);
  - a `permission` write: `rls-predicate-unenforceable` (422, 912 / 312 → 186 / 121), `rls-predicate-unknown-field` (422, 708 → 154), `rls-predicate-over-budget` (422, once the platform CEL bounds refuse) and `permission-retired-lifecycle-residue` (2xx advisory, 573 / 681 → 14);
  - a `view` write: `visibility-predicate-over-budget` (422, 651 → 179).

  Studio's save-advisory toast prints an advisory's `hint` after its message, so the approval and residue toasts shorten; no Studio, REST or MCP reader in this repository or in objectui matches on `hint` text. A tool that did should match on `rule` and `path` instead.
- **Never at the runtime gate:** the two sharing-rule ids, `field-no-consumers`, `component-type-unknown`, the two `react-chart-*` ids and `hook-api-update-readonly-field` run on the CLI only.
- **Unchanged:** every `message` (the verdict), rule id, severity and `path`, and what each rule accepts or refuses.
