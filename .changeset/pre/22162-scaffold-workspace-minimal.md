---
"create-objectstack": patch
"@objectstack/cli": patch
---

A new project's `pnpm-workspace.yaml` is now a short settings file: one comment line above each block instead of 57 to 66 lines of version history and measurements. `npm create objectstack`, `objectstack init` and a standalone `objectstack create` now write the same 21-line file.

Clause-②: no

- The settings are unchanged: `packages: []`, the same `onlyBuiltDependencies` and `allowBuilds` lists, and the same `peerDependencyRules.allowedVersions` entries, in the same order. A project installs exactly as before.
- Each block keeps one line that says why it is there: which pnpm versions read each build-approval key, and that the peer rules only silence a warning that was measured harmless.
- The measurements behind each setting now live in the `@objectstack/cli` source next to the values they explain, so they are kept up to date there instead of in every project.
- Already-scaffolded projects are not touched. Their longer comments can be deleted or kept; the settings are identical.
