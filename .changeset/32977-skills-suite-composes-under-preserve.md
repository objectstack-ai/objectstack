---
'@objectstack/skills': patch
---

docs(skills): a suite composes under `manifest: 'preserve'`; a flat composition with two or more apps under one app or module package id is refused

Clause-②: no
Metadata-protocol: none

`objectstack-platform` `references/bootstrap.md` § Multi-App Composition said no app in this repo uses `composeStacks()` and gave no strategy for a suite. It now says that a suite (an app package plus module packages, one app each) composes with `composeStacks(stacks, { manifest: 'preserve' })`, which keeps each package's own id, as `examples/app-multi-package` does, and that a flat `manifest` (`'last'`, the default, `'first'` or an index) keeps one manifest, so two or more apps under one `app` or `module` package id are refused with `STACK_SINGLE_APP_VIOLATION` (422). `objectstack-ui` `SKILL.md` § App Navigation names the same remedy for a suite's further apps. Both files pay for the new text by deleting restatements in the same file; their token counts stay under their ceilings. No schema or runtime change.
