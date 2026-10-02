---
'@objectstack/spec': patch
---

The `kernel/cli-extension` module documentation no longer tells plugin authors to run `os plugins install`. Step 2, "Discover", said the plugin is listed in `@objectstack/cli`'s `oclif.plugins` array, or that users install it with `os plugins install`. Neither is true: `@objectstack/cli` declares no `oclif.plugins` and ships no plugin manager, so `os plugins` is not a command. The step now says what loads a plugin: oclif loads a plugin that the CLI's own `package.json` lists in both `oclif.plugins` and `dependencies`. To add a plugin's commands to `os`, build an `os` distribution whose own `package.json` lists the plugin in both places. The generated reference page carries the same text.

Clause-②: no

Documentation only. No schema, export or type changes.
