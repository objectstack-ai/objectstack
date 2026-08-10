---
"@objectstack/spec": patch
---

refactor(spec): split the migration registry's three append tables into per-entry files (#7297)

`packages/spec/src/migrations/registry.ts` carried three hand-authored **append**
tables — each protocol step's `semantic` list, `RETIRED_KEYS_BY_MAJOR` and
`RETIRED_DEFS_BY_MAJOR`. Every retirement card appended to the same tail line of the
same two of them, so two cards in one window were a textual conflict by construction.
Measured on #6957 over 2026-08-06..10: `step17`'s semantic list and
`RETIRED_KEYS_BY_MAJOR[17]` conflicted in **6 of 11** contended re-merge laps, for 613
hand-resolved lines of conflict markers in four days.

Wall-clock was never the reason to fix it. **Both tables are consumed as sets**, so a
conflict resolution that drops a sibling's entry produces **no error anywhere**: the
tombstone `check:authorable-surface` was waiting for never arrives, and the D3
prescription leaves the upgrade guide without a trace.

Per the maintainer ruling on #6957 (2026-08-10, option (a)), the entries now live one
file per entry under `packages/spec/src/migrations/entries/`, concatenated into
`registry.ts`'s `<os-generated …>` regions by `gen:migration-registry` and verified by
`check:migration-registry` (wired into `check:generated`). The filename is a pure
function of the entry id, so two cards registering different entries write different
files and merge clean, while two cards editing one entry collide in git — which is
correct and must stay true. Order is derived (sorted by id); there is deliberately no
index file. `scripts/adr-anchors/` (#7301) is the pilot this mirrors.

**No behaviour change and no acceptance movement.** Every exported value is identical
entry-for-entry — proved before and after by deep-comparing `MIGRATIONS_BY_MAJOR`,
`RETIRED_KEYS_BY_MAJOR` and `RETIRED_DEFS_BY_MAJOR` across the change. What moved is
order: `spec-changes.json` and `docs/protocol-upgrade-guide.md` now list the 59
semantic migrations sorted by id rather than in append order, a one-time reorder whose
line multiset is byte-identical to before. Twelve prose cross-references that pointed
at a neighbour by POSITION ("the entry above", "the trio at the top of this list") were
rewritten to name the entry, since position is no longer stable.

⚠️ Honest limit, carried from #6957: this removes the conflict **resolution**, not the
regeneration **lap**. `spec-changes.json` and the upgrade guide are still committed
projections (option B was rejected — the review diff is worth the laps it costs), so a
retirement card is not faster, only much harder to lose.
