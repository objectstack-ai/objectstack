---
"@objectstack/cli": patch
---

fix(cli): `os create example` now scaffolds a manifest the protocol schema accepts

The `objectstack.config.ts` that `os create example <name>` wrote declared
three manifest keys — `name`, `version`, `description` — and nothing else.
`ManifestSchema` requires `id` (the reverse-domain package id) and `type`
(`app` | `plugin` | …), and `namespace` is the mandatory prefix of every object
name, which decides each object's table name and REST path. Parsed against the
schema, the emitted block answered `success: false` with
`invalid_type@id · invalid_value@type`.

`defineStack` throws on exactly that, so the project a documented command had
just created refused to load on its first run — before the author had written a
line. The three `os init` templates all stamped the identity block; this was
the one scaffold that had drifted, and nothing noticed because no test looked
at these templates as data.

The template now stamps what `os init` stamps: `id`, `namespace` (derived from
the project name with `init`'s own `sanitizeNamespace`, so both scaffolders
answer the same way for the same input), `type: 'app'` and
`engines.protocol`, alongside the `version`, `name` and `description` it
already carried. `engines.protocol` is stamped from `PROTOCOL_MAJOR` — the same
constant `init` stamps — and ships with the same self-contained comment
explaining what the range is and when to move it.

A pin sweeps both scaffolders: every `init` and `create` template that emits an
`objectstack.config.ts` is rendered through its own emitter, loaded back, and
its `manifest` parsed through the real `ManifestSchema`. The population is
derived from the two template maps rather than listed, so a template added
later is swept the day it is added.

`os create` itself is untouched — it is not removed, deprecated, or redirected
at `os init`. Whether the two scaffolders should stay separate is a CLI-surface
decision, not this fix.
