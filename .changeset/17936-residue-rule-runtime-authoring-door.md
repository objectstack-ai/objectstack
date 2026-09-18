---
"@objectstack/lint": minor
---

`validateRetiredPermissionResidue` now runs at the runtime authoring door on `permission` writes, at advisory tier — so a Studio / REST `/meta` / MCP author who writes `allowRestore: false` or `allowPurge: false` and never runs `os lint` is told the line has no effect (#17936, out of #17425 ruling D).

Clause-②: no

The rule was registered `CLI_ONLY` on an open question its own `surfaceReason` recorded: does the gate's `body` reach it BEFORE the per-type `safeParse`, whose residue stage strips the only evidence it reads? Wiring it without that reading would have published a phantom check. **Measured: it does reach it.** `saveMetaItem` keeps the AUTHORED body verbatim on purpose — `parsed.data` would strip the Studio-only auxiliary fields an overlay rides with — and grafts back exactly two normalizations (filter `operator` spellings, the form `groups` → `sections` key move), each a walk over the authored keys that adds and removes nothing else. So `assertRuntimeAuthoringRules` is handed the raw document, the gate passes it through as `item`, and the residue is present in the snapshot the rule reads.

What changes for a caller:

- A `permission` publish carrying either retired key **still succeeds** and now returns one `advisories[]` entry per occurrence, in the door's existing six-key diagnostics envelope (`{severity, rule, where, path, message, hint}`) — the shape Studio and MCP already render for a 422's `issues[]`. `rule` is `permission-retired-lifecycle-residue`, `path` is the name-keyed `permissions.<set>.objects.<object>.<key>`, and `hint` is the tombstone's own prescription, read from the schema rather than retyped.
- ⛔ **Never a refusal.** The rule is advisory tier; the accept set is untouched, and a value that is *not* the retired default (`true`, `0`, `null`) is still refused by the tombstone at the parse, with its prescription attached, exactly as before.
- **Draft saves are unchanged** (#4463 D1), and so is every other metadata type: `permission` is the only declared `runtimeTypes` member, because `stack.permissions` is the only collection the rule reads.
- **The CLI door is unchanged** — `os validate` / `os build` / `os lint` run the rule exactly as they did, with the same positional `permissions[i]…` path. The name-keying is the runtime gate's wire rewrite and does not reach the commands.
