---
'@objectstack/cli': patch
---

feat(cli): `os meta register --mode draft` stages a draft for review and prints its publish verdict, and `os lint --item <file> --type <type>` judges one item

Clause-②: yes (widening)
Metadata-protocol: none

For a developer or an AI client that authors metadata item by item from the command line against a self-hosted runtime (signed in with an API key), with no project on disk:

- **`os meta register <type> --data <file> --mode draft`** saves through the same door with `?mode=draft`: the item is stored as a pending draft and nothing is published until a person publishes it in Studio's Changes. A draft names its package with `--package <id>`: Studio lists drafts per package, so `--mode draft` without `--package` is refused before any request, and the command prints that package's Changes route. After the save it reads the draft back (`GET /meta/<type>/<name>?package=<id>&state=draft`) and prints the publish verdict the runtime serves on it: `valid`, its errors (each with its rule code) and its warnings, also as `publishVerdict` on `--format json|yaml`. A `valid: false` verdict is printed, not turned into a failed run: the draft is stored either way. `--mode publish` is the default spelled out and sends exactly the request an unflagged run sends (an active save, no query string, no read after it).
- **`os lint --item <file> --type <type>`** lints the JSON body `os meta register --data` takes, alone. It runs the shared author-time rule table (the one `os build` and `os validate` run) and `os lint`'s per-entry naming, label and structure conventions over a stack holding only that item. A rule whose verdict needs the rest of the stack is not run and is named: each rule is measured, on that item, by the top-level stack keys it reads, and a rule that read anything beside the item's own collection is listed under `notJudged` with those keys instead of reporting findings. `os lint`'s namespace-prefix, i18n-coverage and (for objects) data-model families are listed under `familiesNotRun`. The exit code reads as a project run's, `--strict` included. `--item` refuses to combine with a configuration path, `--score` or `--eval`, and `--type` without `--item` (or the reverse) exits 1.
