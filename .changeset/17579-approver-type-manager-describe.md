---
'@objectstack/spec': patch
---

`ApproverType` qualifies `manager` in its `.describe()` instead of offering it as a bare allowed value

`ApproverType` carried **no** `.describe()` at all, so the generated reference
page rendered `## ApproverType` with nothing but an `### Allowed Values` list:
`manager` — the one rung an author cannot operate on a stock install — read
exactly like the nine members that work. `{ type: 'manager' }` resolves
`sys_user.manager_id`, and that column still has no product write surface
(re-measured on this tree: the identity write guard's managed-update whitelist
for `sys_user` is `{name, image, locale}`; the column carries `readonly: true`;
no `packages/plugins/plugin-auth` source writes it). An author who chose it got
a chain that passed `validate` and `lint` and then stalled on its first
submission.

The new describe says what is true about `manager` and **points** at the remedy
rather than restating it: `MANAGER_ONLY_REMEDY` / `MANAGER_ONLY_ROUTES` in
`packages/lint/src/validate-approval-approvers.ts` remain the single
authoritative copy of the population routes, and that file's `DEPENDENCY`
docblock now names this new string among the lines that go stale if the column
ever gains a write surface. A pointer cannot drift into disagreement with what
it points at, which is why no third copy of the 667-character remedy was added.

⛔ No member is added, removed or renamed, and no behaviour changes: the enum's
accept set is byte-identical and `check:api-surface` is green on the rebuilt
`dist/*.d.ts`.

**Why this ships, and why `patch`.** `@objectstack/spec`'s published `files[]`
carries `dist`, `json-schema` and `src/**/*.zod.ts`, and the new string is
measured in all three on the built tree — `dist/automation/index.js` and
`.mjs` (2 files, against a lit control of an existing describe from the same
module, also 2), four `json-schema/` documents (`ApproverType.json`,
`ApprovalNodeApprover.json`, `ApprovalNodeConfig.json`, `objectstack.json`) and
the shipped `approval.zod.ts` source. Prose only, no surface widening ⇒
`patch`.

The `packages/lint` half is a docblock comment and is deliberately **not**
graded: that package publishes `dist` only, and the new sentence is absent from
it (0 files) while a runtime string from the same source file is present in 4
and a pre-existing comment from the same docblock is absent in 0 — so comments
are stripped by construction and nothing published moves there.
