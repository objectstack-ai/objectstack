---
'@objectstack/scenarios': patch
---

feat(scenarios): a scenario card declares which seed fields hold a user handle and which seed row each scoped persona is, and a refused seed row takes out only the turns whose answer it changes

Clause-②: yes (narrowing) — the published card schema (`ScenarioCardSchema` in the `.` entry) gains `run.userHandleFields` and `personas[].record`, and the loader (`loadScenarios`, `loadScenarioFile`) refuses a card it loaded before: a persona `scope` rule ending on a field that is neither `id`, a declared lookup or select, nor a declared user-handle field, and a scoped persona that names no person. `truthsOver` is a new export of the same entry.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) The card format is QA tooling in a devx package, not the metadata protocol: no key of any platform schema is added, removed, renamed or re-shaped, and nothing an app author writes is refused. What moves is which scenario cards the loader accepts; a card author adds the two declarations the refusal names, and there is nothing for a metadata migration to rewrite. -->

**BREAKING** accept-set narrowing at the scenario card loader (`@objectstack/scenarios`): a card that leaves the runner to infer what a scope value names is refused until it declares it. All nine cards in `docs/qa/scenarios/` carry the declarations and load as before.

- **User-handle fields, declared.** `run.userHandleFields: [{ object, field }]` lists the seed fields whose text stands for a user (`account.owner` = `u_sam`). The runner loads each such cell with the user's id, and `userHandleFields` (runner `prompts.ts`) reads this list instead of inferring it from what the card does not declare. The loader refuses a scope rule whose last field is none of `id`, a declared lookup, a declared select or a declared handle field, and a handle declaration on the row id, a lookup, a select or a field no seed row carries. The run record's `seed.rewritten` lists the fields the seed rewrote. Across the nine cards the rewritten set is unchanged: `account.owner`, `invoice.owner`, `task.assignee`.
- **The person a persona is.** `personas[].record: { object, id }` names the seed row that is this person (`{ object: "employee", id: "e06" }`). It is required for a persona with a `scope`, unless the persona is named by a direct scope rule on a declared handle field (the three control cards), and optional for a global persona. The loader refuses a record that names no seeded row. The person object's user field is `user` by name. The runner does not read `record` yet.
- **Seed dependence per turn.** When the app refuses a seed row, the runner computes each question's truth again over the seed less the refused rows and their children (`truthsOver`, the loader's own rules), and marks not measured only the turns whose expected answer changes. Before, every question on an object holding a refused row was not measured. On `crm_account_with_contacts`, refusing contact `ct4` now leaves `contacts_per_account` as `sdr` (whose scope never reads it) measured.

**Who moves.** An author of a scenario card in a private overlay: add `run.userHandleFields` for each field holding a user handle, and `record` on each scoped persona that is a seed row.
