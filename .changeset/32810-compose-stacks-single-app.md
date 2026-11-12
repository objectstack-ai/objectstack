---
'@objectstack/spec': minor
---

feat(spec)!: `composeStacks` refuses a flat composition that puts two or more apps under one `app` or `module` package id, and `defineStack` and `composeStacks` judge every `packages[]` body by the same rule (ADR-0019 D3 as amended: a suite may surface several apps, one per package) (#32810)

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Skills-docs: follow-up owed — skills/objectstack-platform/references/bootstrap.md, skills/objectstack-ui/SKILL.md

<!-- adr-0087: registered compose-stacks-flat-second-app-refused -->

**BREAKING** accept-set narrowing in `composeStacks` and `defineStack` (`@objectstack/spec`, the root export), and so in `os validate`, `os build` and every config or test helper that calls them.

- **Before.** `defineStack` held each authored `app` or `module` package to at most one app, but a flat `composeStacks` (the default `manifest: 'last'`, `'first'` or an index) keeps ONE manifest and concatenates every input's `apps` under it, and nothing judged the result. An app package and a module package with one app each, composed without `manifest: 'preserve'`, became one package id with two apps — the shape the rule removes: the Console opens only the first app of a package id, the package read by its id answers as absent, and the apps can no longer be disabled one module at a time. A hand-assembled `packages[]` body with two apps was judged by no door either.
- **Now.** `composeStacks` refuses such a composition with `STACK_SINGLE_APP_VIOLATION` (422), header `composeStacks single-app validation failed`, one finding that names the package, each app with the input it came from, and the `manifest: 'preserve'` remedy. `defineStack` (strict) and `composeStacks` also judge every `packages[]` body by its own `type`, id and apps. The `defineStack` finding now names `manifest: 'preserve'` in its remedy too.
- **Unchanged.** A suite composed under `manifest: 'preserve'` with at most one app per package; a flat composition whose inputs bring one app or none; a single-input composition (handed back untouched); a flat composition whose selected manifest is not an `app` or `module` package (`plugin`, `driver` and the rest are not judged); a stack with no manifest; and `defineStack(…, { strict: false })`, which skips the check at `defineStack` as before (a `packages[]` body it carries is still judged when it is composed).
- **Fix.** Compose a suite's packages with `composeStacks(stacks, { manifest: 'preserve' })`: each keeps its own package id and its own app, and the artifact's `manifest` is still the last input's. Code that composed the same stacks flat only to read every collection at the top level — a test view of the whole suite, for example — composes under `'preserve'` and reads each `packages[]` body for its collections instead, through the public reader of a composed artifact's collections that #32827 adds (no copy of that merge in app code). A package body that itself defines two apps keeps one and moves each other app into a `type: 'module'` package of its own, or folds them into one app whose navigation groups hold each former app's entries.
