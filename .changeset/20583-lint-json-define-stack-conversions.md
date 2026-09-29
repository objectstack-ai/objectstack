---
"@objectstack/cli": patch
---

**`objectstack lint --json` now reports the ADR-0087 conversions `defineStack` applied, as `objectstack validate` and `objectstack build` already do.**

`defineStack` rewrites a deprecated metadata spelling to its canonical shape when the config loads and prints one `defineStack: PATH: 'OLD' → 'NEW' (converted at load; conversion 'ID', retires in protocol N)` line on stderr. `objectstack lint` filled its `conversions` list only from its own conversion pass over the loaded config, which a `defineStack` default export hands over already converted. So `--json` answered `conversions: []` for a config carrying a retiring spelling, such as `description` on a `page:header` component, and the notice reached stderr alone.

`objectstack lint` now adds the conversions the stack producer recorded on the default export to that list right after the config loads, and its own pass still reports what the producer never saw: an unbuilt default export, or a key merged in from a named export of the config module. Each conversion is listed once. The text face prints the same notices in its warning block.

What `objectstack lint` accepts does not change: it still lints an unbuilt default export (a plain object literal), whose conversions come from its own pass as before. The exit code, `passed`, `issues` and the counts are unchanged, because a conversion notice is not a lint finding.

Clause-②: no
