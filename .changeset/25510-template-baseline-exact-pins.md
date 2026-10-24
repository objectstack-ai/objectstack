---
'create-objectstack': patch
---

fix(create-objectstack): the bundled blank template pins every `@objectstack/*` dependency at the exact release version

Clause-②: no
Metadata-protocol: none

The `blank` template's committed `package.json` now lists each `@objectstack/*` package at the exact version of the `create-objectstack` release that ships it (`18.1.0`, a prerelease verbatim), instead of `^18.0.0`. A scaffolded project already received exact pins, because the scaffolder rewrites these entries at scaffold time; the template a reader opens in the tarball or on GitHub now says the same thing, which is what the v18 docs prescribe ("Pin exact versions").

The template manifest's `specVersion` stays a range (`^18.0.0`): it names the `@objectstack/spec` line the template is authored against, not a build. The release-time version pass keeps both values current — the exact version in the dependencies, the major's range in `specVersion`.

No action is needed in an existing project.
