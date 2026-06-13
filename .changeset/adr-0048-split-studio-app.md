---
"@objectstack/studio": minor
---

feat(apps): extract Studio into its own `@objectstack/studio` app package (ADR-0048)

ADR-0048 "one app per package": Studio gets a distinct package id
(`com.objectstack.studio`) and namespace (`studio`) so `/apps/<packageId>`
resolves unambiguously instead of being lost inside a multi-app package.

This change adds the package skeleton (`packages/apps/studio`) with a thin
registration plugin. Transitional: `STUDIO_APP` is still imported from
`@objectstack/platform-objects/apps`, and the package is not yet wired into the
dev/serve plugin set — that boot-path switch (and dropping the app from
`plugin-auth`'s manifest) lands in a follow-up so it can be verified against a
live `os dev` boot.
