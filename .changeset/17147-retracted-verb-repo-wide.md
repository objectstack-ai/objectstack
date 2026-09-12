---
'@objectstack/core': patch
---

Sweep the retracted "enforces exactly the consented surface" phrasing repo-wide, not just in the file it shipped on.

The #17147 pin read one file, and a post-merge sweep found what that missed: `artifact-granted-permissions.test.ts` carried the retracted sentence as a CASE TITLE — "a CONSENTED entry enforces exactly the consented surface" — beside a sibling titled "registered, and denies". Neither case asserts a refusal; both read a permission bag and check what it answers. But a case title is read as evidence (ADR-0033), and those two said the platform confines plugins while nothing on the tree queries the registry at all.

Both titles now name what they assert, the file carries a verb-discipline note (`answers` / `registered` / `bound`; ⛔ never `enforces` / `denies` / `gates` / `refuses` / `blocks` until the seam exists), and the pin's negative assertion is a repo-wide `git grep` excluding only its own specimen — with an anti-vacuity limb so a broken scan cannot read as a clean one.

No behaviour, no assertion semantics, and no accept/reject changes.
