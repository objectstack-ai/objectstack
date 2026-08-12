---
"@objectstack/spec": minor
---

chore(spec): register the #4001 unknown-key strictness wave as one v17 ADR-0087 entry (#7630)

PR #7624's stock reconciliation judged **eleven** declared-breaking v17 changesets
*owed* an ADR-0087 ledger entry and deliberately did not write one — the grouping
was the open question, and the registries are consumed as a **set**, so a wrong
grouping produces no error anywhere. It would simply be wrong, silently, in the
artifact whose entire purpose is to be the trustworthy record. The maintainer ruled
on #7630 (2026-08-12): **one entry per major**, mirroring the registry's only two
precedents of this shape — `ui-schemas-strict-unknown-keys` (15) and
`dashboard-widget-strict-unknown-keys` (16) — against the alternatives of eleven
entries or a per-surface grouping.

So the eleven batches fold into a single D3 semantic migration,
`authoring-schemas-strict-unknown-keys`. An upgrader reads one prescription covering
the whole wave; the per-batch trace is written **inside** the entry, so an
archaeologist still walks it batch by batch:

| batch | closed |
| --- | --- |
| `unknown-key-strictness-tier-a` | `security/permission.zod.ts`; `automation/flow.zod.ts`'s four outer shapes |
| `unknown-key-strictness-step2` | `security/rls.zod.ts`, `security/sharing.zod.ts`, `identity/position.zod.ts` |
| `strict-automation-control-flow-state-machine` | five `control-flow` + six `state-machine` shapes |
| `unknown-key-strictness-automation-batch11` | flow's six nested blocks, time-relative trigger, flow function, webhook |
| `unknown-key-strictness-ui-batch13` | all four shapes in `ui/responsive.zod.ts` |
| `unknown-key-strictness-ui-batch15` | `ui/theme.zod.ts` 14/14, `ui/chart.zod.ts` 5/7 |
| `unknown-key-strictness-ui-batch16` | `AriaPropsSchema`, carried on ~30 live shapes |
| `view-subblock-strictness-batch18` | fifteen `ui/view.zod.ts` sub-blocks |
| `rare-jars-shave` | `ViewItemSchema` split into a strict authoring gate + `.strip()` wire variant |
| `user-filters-allow-add-tab-promote-and-close` | `userFilters` promoted then closed; the three page-only keys |
| `view-union-identity-precondition` | the `view` union stops matching every object |

Each of the eleven stock changesets now carries its
`<!-- adr-0087: registered … -->` disposition marker, so the judgement is recorded
where the next auditor reads rather than only in a PR body. `spec-changes.json` and
`docs/protocol-upgrade-guide.md` are regenerated from the registry.

Measured with `check-adr-0087-registration.mjs --audit-stock` on a full (unshallow)
history, before → after: **answered 51 → 62, residue 97 → 86, flagged (`!`) 52 →
41**. The two adjacent seams stay exactly as recorded on #7630 and are **not**
touched here: the 45 `~` rows (a ledger file was touched by some commit, which does
not prove the entry covers that face) and the 7 borderline candidates PR #7624
judged not-owed.

No runtime behaviour changes and no schema changes — this is the ledger half of
breaks that already shipped.
