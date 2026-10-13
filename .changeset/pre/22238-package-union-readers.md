---
"@objectstack/cli": patch
---

`os validate`, `os build`, `os lint` and `os i18n check` now judge a multi-package app by its package bodies. A multi-package app that passed with a required capability that has no installable provider in this edition, or with a missing translation, now fails, as the same app shipped as one package always did.

Clause-②: no

An app composed with `composeStacks([a, b], { manifest: 'preserve' })` carries its metadata, its `translations` and its `requires` only inside each package's body, and nothing a package owns at its top level. These readers looked at the top level alone, so on such an app they found nothing to judge and answered clean:

- **The capability preflight** (`os validate`, `os build`) now reads each package body's `requires` when the top level declares none. A capability with no installable provider in this edition fails the run with exit 1, and each finding names its package: `package 'com.acme.service' — Capability "ai" resolves to …`. The advisory for an installable but absent provider (for example `hierarchy-security`) comes back the same way. A top-level `requires` is read exactly as before, so a single-package app prints the same text it always did.
- **Translation coverage** (`os lint`, `os i18n check`) now expects the keys of every package, so a missing translation in any package is reported. Under `os lint --strict` it fails the run again.
- **`os i18n extract`** now extracts every package's keys, where it extracted none.
- **The undeclared-authoring-key warnings** that `os validate --json` and `os build --json` carry in `warnings` now cover items inside package bodies too.

A `packages` value that is present but is not an array is now refused by `os validate`, `os i18n check` and `os i18n extract` with `INVALID_ARTIFACT_PACKAGES`, as the other readers already refuse it. `os i18n check` and `os i18n extract` used to accept such a config with exit 0 and zero keys; `os validate` refused it from the schema parse instead.

Apart from that refusal, no accepted input, exported symbol or `--json` field changes. A single-package app's output is unchanged.
