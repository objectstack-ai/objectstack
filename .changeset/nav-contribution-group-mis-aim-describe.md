---
"@objectstack/spec": patch
---

`navigationContributions[].group` now documents the mis-aimed case, not only the omitted one (#14925)

The `describe()` on that key said what happens when `group` is **omitted** and nothing about what happens when it is **present and names no group the target app declares** — which is the case that actually bites. A contributing package cannot see the target app's group ids at authoring time (the target app belongs to another package), so a wrong id is undetectable by reading the contributor's own source; and the platform **relocates** the items to the app's top level rather than refusing them, so the menu renders, a smoke test passes, and the information architecture has silently changed.

The description now names that third case: it is **not refused**, the items are appended at the app top level anyway, and a `nav_contribution_group_missing` diagnostic is emitted — by the runtime at `warn`, and by **both** `os build` and `os validate` at compile time, in each command's `--json` payload under the existing `warnings` key.

Prose only. `group` remains `SnakeCaseIdentifierSchema.optional()`, the accept set is unchanged and nothing is refused that was not refused before; the recorded authorable key surface (`authorable-surface.json`) and the schema manifest (`json-schema.manifest.json`) are byte-identical. What moves is the string an author reads: the generated reference rows in `content/docs/references/ui/app.mdx` and `content/docs/references/kernel/manifest.mdx`, and the `description` on the published JSON Schemas that embed `NavigationContribution` (its own schema, the bundled `objectstack.json`, and 22 `json-schema/api/*` and `json-schema/kernel/*` package envelopes).
