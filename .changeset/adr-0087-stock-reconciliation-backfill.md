---
"@objectstack/spec": minor
---

chore(spec): backfill nine ADR-0087 ledger entries the v17 stock was missing (#6350)

The #6148 completeness gate is deliberately **diff-only** — it judges what a PR
adds, never the inventory, because auditing stock in CI would turn the repo red on
adoption day and bill main's history to current authors (#6129). The cost of that
choice is that every breaking changeset already in the v17 train was never compared
against the ledger. This is the one-time manual reconciliation the maintainer ruled
for, not a change to the gate: `check-adr-0087-registration.mjs` still judges diffs
only, and nothing in CI starts auditing inventory.

Measured today over the stock: **274 declared-breaking changesets**, 106 in the
residue (published break + a real FROM → TO prescription, so only `registered` or
`already-registered` remain), **61 of them flagged** as never having touched a
ledger file. Judging those 61 by hand found nine genuinely missing entries, now
registered as D3 semantic migrations:

| entry | face | issue |
| --- | --- | --- |
| `runtime-httpserver-wrapper-retired` | the exported `HttpServer` delegating wrapper | #5122 |
| `record-details-sections-object-form` | `RecordDetailsProps.sections` shape + `hideFields` | #5611 |
| `data-driver-query-omit-object` | `IDataDriver`'s query parameter contract | #5181 |
| `sort-node-direction-rejected` | `orderBy[].direction` → `order` | #4721 |
| `tool-requires-confirmation-retired` | `tool.requiresConfirmation` | #3715 |
| `export-axis-opt-in` | `allowExport` unset flips to deny | #3544 |
| `apimethod-enum-shrink` | `enable.apiMethods` legacy values | #3543 |
| `sharing-rule-recipient-reconcile` | sharing-rule `group` / `guest` / owner-type rules | #1878 |
| `client-delete-result-success` | `DeleteDataResult.deleted` → `success` | #5638 |

Two of them had already shipped **half** a retirement: `tool.requiresConfirmation`
carries a live `retiredKey()` tombstone in `ai/tool.zod.ts` and `SortNodeSchema`
carries `aliases: { direction: 'order' }`, but neither had the ledger half. A
tombstone is the proof the removal was declared; the ledger entry is what
`spec-changes.json`, the upgrade guide and `os migrate meta` project to consumers,
and a retirement needs both.

Each of the nine stock changesets now carries its `<!-- adr-0087: registered … -->`
disposition marker, so the judgement is recorded where the next auditor reads
rather than only in a PR body. `spec-changes.json` and
`docs/protocol-upgrade-guide.md` are regenerated from the registry.
