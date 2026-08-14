---
'create-objectstack': minor
---

Retire the five remote content templates from the scaffolder's catalog.

`todo`, `compliance`, `content`, `contracts` and `procurement` were delisted
from the official ObjectStack template marketplace and are no longer
maintained, but the CLI carried its own hardcoded catalog and never learned
that: `--help` recommended all five by name with marketing descriptions, and
the `Available:` line on a bad `-t` offered them too.

- `blank` (bundled, offline) is now the whole catalog, so the help text
  advertises only what is actually supported.
- Asking for one of the five by name — `-t todo` in an old script or tutorial —
  is refused with a message that says the template was retired, instead of the
  generic "Unknown template" error that reads as a typo.
- The GitHub tarball-fetch path that served the remote templates is removed
  along with its `tar` dependency; nothing else reached it.

Note this corrects the catalog at HEAD only. Already-published versions keep
advertising the retired templates until a new version of `create-objectstack`
is released.
