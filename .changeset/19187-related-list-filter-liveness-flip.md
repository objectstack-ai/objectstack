---
"@objectstack/spec": patch
---

`liveness/field.json` — `field.relatedListFilter` is `live`, and drops the `authorWarn` that had become a false sentence.

Clause-②: no — no schema key moves, no accept set widens or narrows, no export changes. `FieldSchema.relatedListFilter` accepts exactly what it accepted before; what changes is the ledger's verdict about it and the author-facing advisory the ledger drives.

The ledgers ship inside this package (`files[]` includes `liveness`), so the changed tarball bytes are the ledger row, the generated `liveness/state-counts.md` counts and the `liveness/README.md` Notes cell.

- **The row falsified itself.** #8704 seeded `relatedListFilter` `planned` + `authorWarn` as the contract-first spec half of objectui#4664, and wrote the flip condition into its own note: flip to `live` and drop `authorWarn` when that consumer lands. It landed — objectui `d796c8dde` (objectui PR #6946), which `git merge-base --is-ancestor d796c8dde 53ded82bf7` places inside this repo's `.objectui-sha` pin. Both pointers were re-measured AT THAT PIN, the #10068 discipline, not on objectui main: `deriveRelatedLists` puts the authored value on the derived descriptor as `filter`, and `RecordDetailView` writes it onto the synthesized `record:related_list` node, which AND-composes it with `{ [referenceField]: parentId }` while the tab strip's count probe composes the same pair.
- **For an author, the practical read: nothing you write changes, and one warning stops.** `os lint` had been saying 「the auto-derived related list does not apply this filter yet」 about a key the pinned console applies — a true warning costs an author nothing, a false one steers them off a usable key. Authors who trimmed a `relatedListFilter` on that advice can put it back.
- **A `planned` row fails in the one direction no citation check can see.** A `live` row rots when its pointer moves and the gate's file/line/symbol/key-mention checks catch that. A `planned` row cites no consumer, so nothing can rot and nothing re-asks; only the consumer landing falsifies it, and only a reader who follows the sibling repo notices. That asymmetry, not this one key, is what the flip records.
- **`field` now carries no `authorWarn` row at any depth**, which gates `packages/lint`'s field walk off entirely (`if (fieldWarn.size > 0)`). The two ledger-driven pins that used this key as their witness are re-dispositioned in the same change: a silence pin plus an anti-vacuity guard for the verdict case, and a narrowed claim on the #11385 field-walk case.
