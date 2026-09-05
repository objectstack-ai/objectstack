---
"@objectstack/cli": patch
---

`os lint` and `os i18n extract` no longer count one translation key twice.

A translation key is derived from *where a string is addressed*, not from *which declaration was being read* when the walk reached it — and two declarations can address one bundle slot. `collectExpectedEntries` emitted one entry per declaration, so a key reachable twice became two expected entries. Two families were measured, with different causes:

- **Two carriers, one action.** The normalized config attaches an object's actions to `obj.actions` *and* to the top-level `actions` list — the same object reference, not a copy — so both action branches emitted `objects.OBJECT._actions.ACTION.*`. This is the family the coverage report shows: 70 of 691 baselined units across `app-todo` (40), `app-showcase` (29) and `app-crm` (1).
- **Two declarations, one form field.** `deleteBehavior` is declared twice in each of the `field` and `object` metadata forms, gated on `visibleWhen` (`lookup` vs `master_detail`); both render into one key. Config-independent — it duplicated six entries on every config, including an empty one.

Neither is an authoring mistake, and neither is fixable where it originates: both are two correct declarations of one displayed string. So the walker now collapses entries that address the same path, keeping the first emission.

What that corrects, in both directions:

- **`os lint`'s i18n findings.** The same missing key was reported twice, byte-identically. `pnpm check:i18n-coverage` ratchets the finding *count* while its report calls the number "untranslated declared strings", so translating one key moved the ratchet by two and the frozen debt was ~11% larger than the work it described. The three coverage baselines are regenerated in this change and fall by exactly 70 (691 to 621): `app-crm` 102 to 101, `app-showcase` 443 to 414, `app-todo` 146 to 106. The ratchet's direction, monotonicity and failure text are unchanged — only the population it counts.
- **`os i18n extract`'s reported counts.** `totalExpected` and the per-locale `counts` counted emissions while the skeleton itself had already collapsed the duplicates on the way in, so extract over-reported what it wrote — 1632 claimed against 1531 keys written on `app-showcase`, 894 against 870 on `app-todo`, 930 against 925 on `app-crm`. Those numbers now match the skeleton.

No generated bundle changes: every duplicate pair measured carries a byte-identical record, so de-duplication removes copies and never a demand. All nine `translations/*.generated.ts` packages stay in sync.
