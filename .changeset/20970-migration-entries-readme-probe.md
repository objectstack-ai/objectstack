---
'@objectstack/spec': patch
---

docs(spec): the shipped `src/migrations/entries/README.md` "Reproduce any row" recipe now fetches both commits into the driver-less bare clone before `merge-tree`, and reads exit 1 with no tree id as a missing object, never a conflict (the old `--shared --no-local` form misread a clean pair as conflicted) (#20970)

Clause-②: no
