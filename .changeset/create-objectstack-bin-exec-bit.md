---
"create-objectstack": patch
---

Fix the declared bin (`bin/create-objectstack.js`) being tracked non-executable
in git. It carries a `#!/usr/bin/env node` shebang and is pnpm's link target
for the `create-objectstack` command, but was committed `100644` instead of
`100755` — matching the sibling declared bin `packages/cli/bin/run.js`, which
was already tracked executable.

Patch bump: this is a packaging-mode correction with no content, API or
behavior change (the blob hash is identical) — it only fixes how the file is
tracked in git and therefore how it is packed for npm.
