---
'@objectstack/runtime': patch
'@objectstack/metadata': patch
---

`os serve <config>`: a multi-package config now serves the top-level metadata no package declares, under the stack's `manifest.id`, and the boot says so, as an artifact boot of the same project already did

Clause-②: no

A config boot (`os serve objectstack.config.ts`, with or without `--dev`, and no compiled artifact) of a stack that carries `packages[]` registers each package body and never the stack's top level. A top-level item that no package body declares was served by no door, and the boot said nothing. Three shapes reached it: flat `src/docs/*.md` pages when the stack's `manifest.id` names no `packages[]` entry, inline `docs` spread onto a composed stack's top level, and any other top-level collection (objects, views, …) that no package carries. `os build` of the same project, booted as an artifact, registered those items under the stack's `manifest.id` and warned.

- **What changes.** The config boot now runs the same residual rule as the artifact boot, `MetadataPlugin.registerUnclaimedTopLevel`. Every top-level item no package body declares is registered under the stack's `manifest.id`, and the boot prints one `warn` line with the count: `config stack '<id>' carries N top-level metadata item(s) that none of its M package bodies declare`, followed by the remedy. `GET /api/v1/meta/<type>` lists those items under that id, as on an artifact boot of the same project. This includes the flat `src/docs/` pages of a stack whose `manifest.id` names no package, which a config boot did not list before.
- **The remedy the line names.** Declare each such item inside the `packages[]` entry of the package that owns it. A flat `src/docs/` page moves under `src/<package>/docs/`, where `<package>` is the package id or its last dot-separated segment.
- **What stays the same.** An artifact boot registers the same items and prints the same line, byte for byte. A single-package config (no `packages[]`) has no residual and is unchanged. A composed stack whose top level repeats its package bodies, as `composeStacks([…], { manifest: 'preserve' })` writes it, registers nothing extra and prints nothing.
- **What the residual is, on both doors.** It is metadata: a residual object is listed on `GET /api/v1/meta/object` under the stack's `manifest.id`, and `GET /api/v1/data/<object>` still answers `404`. That was already true on an artifact boot, and the config boot now gives the same answer.
