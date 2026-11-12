---
'@objectstack/spec': minor
---

feat(spec)!: `defineStack` refuses a `type: 'module'` package that defines more than one app, as it already refused an app package with two (ADR-0019 D3 as amended: a suite may surface several apps, one per package) (#32586)

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Skills-docs: follow-up owed — skills/objectstack-ui/SKILL.md

<!-- adr-0087: registered module-package-second-app-refused -->

**BREAKING** accept-set narrowing in `defineStack` (`@objectstack/spec`, the root export), and so in `os validate`, `os build` and every host config that calls it, for a stack whose `manifest.type` is `'module'`.

- **Before.** The single-app rule judged `type: 'app'` packages only. A module package that defined two apps built clean, and then broke what the amended D3 relies on: the Console addresses an app by its package id and opens the first app that carries it, so the second was reachable only by name; read by its package id, such a package answers as absent; and disabling the module removed both apps at once.
- **Now.** A module package is held to at most one app too. `defineStack` refuses the stack with `STACK_SINGLE_APP_VIOLATION` (422), one finding that names the package id, every app found and the remedy. The app package's refusal is the same code and now names its package id too, and its finding cites the amended D3.
- **Unchanged.** A module package with one app or none, an app package with one app or none, every other package type (`plugin`, `driver` and the rest are not judged), a stack with no manifest, and `strict: false`, which skips the check as before. A suite of one app package and several module packages, each with at most one app, composed under `manifest: 'preserve'`, builds as before.
- **Fix.** Keep one app per package: leave one app in the module and move each other app, with the objects it shows, into a `type: 'module'` package of its own, then compose the packages into one artifact with `composeStacks(stacks, { manifest: 'preserve' })`. Or fold the apps into one app whose navigation groups hold each former app's entries.
