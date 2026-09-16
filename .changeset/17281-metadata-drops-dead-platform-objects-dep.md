---
'@objectstack/metadata': patch
---

`@objectstack/metadata` no longer declares `@objectstack/platform-objects`.

The dependency was the retired `adr-0030-notification-event` migration runner's,
and that runner was its only consumer. Nothing under `packages/metadata/src`
carries a `@objectstack/platform-objects` specifier any more, so the declaration
described an edge the package no longer has. The two test-tooling entries that
existed only to serve it go with it: the `@objectstack/platform-objects/system`
alias in `vitest.config.ts` (whose comment still cited the retired migration's
receipt cases as its reason) and the matching `paths` mapping in `tsconfig.json`.

## What an installing consumer should check

⚠️ This is a **published** package dropping a declared dependency, so it changes
what an install tree contains, not just what this repo builds. If you import
`@objectstack/platform-objects` **without declaring it**, and it resolved for you
only because `@objectstack/metadata` hoisted it, that resolution is gone — the
fix is one line, and it is the supported spelling either way:

```
pnpm add @objectstack/platform-objects     # or npm/yarn equivalent
```

`@objectstack/platform-objects` is published on its own and is unchanged by this;
nothing is renamed, removed or re-exported.

⛔ Nothing `@objectstack/metadata` itself ships is affected. Measured rather than
asserted: its built `dist/` (30 files, 10 declaration files) carries **zero**
occurrences of `platform-objects`, against a positive control in which all nine
of its other declared dependencies appear in four to twelve dist files each. No
runtime import and no type reference reaches it, so no consumer can arrive at it
through anything this package publishes.

Grade `patch`, measured rather than defaulted: no export moves, no accept-set
widens, no runtime behaviour changes. Not `skip-changeset` either — `package.json`
is shipped by `npm pack`, and a consumer's install tree is what changes.
