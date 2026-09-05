---
"@objectstack/cli": patch
---

`objectstack init` and `objectstack create` now read one emission policy instead of each restating it.

Both commands write a `tsconfig.json` and a set of third-party dependency ranges into a new project. Each had written those in its own words, and the words had come apart. Measured on the tree: the TypeScript range — the value that decides whether a scaffolded project type-checks at all — was written in six places across three scaffolders and had split into three values (`^5.3.0`, `^5.8.0`, `^6.0.0`); the vitest range into two. The two CLI values were written in the same commit and stayed apart for 211 days.

The control for that reading was already in the same file: `SCAFFOLD_PNPM_RANGE` and `renderPnpmWorkspaceYaml()` are imported by the second scaffolder rather than restated, and across the same five emissions, the same window and the same authors, they had not drifted at all. So the policy moved to where those already live — `renderScaffoldTsconfig()` and one `SCAFFOLD_*_RANGE` constant per dependency, in `init.ts`, imported by `create.ts`.

Two emitted values had to survive the merge, and both are argued rather than picked:

- **TypeScript `^5.3.0`.** `TypeScript 5.3+` is already this project's published floor — `content/docs/getting-started/index.mdx` says so, and `content/docs/deployment/troubleshooting.mdx` repeats it. `^5.8.0` matched no statement anywhere, and `^5.3.0` was already what three of the five emissions carried. Measured rather than assumed: TypeScript 5.3.3 type-checks every shape these two commands emit with results identical to 6.0.3.
- **vitest `^4.0.0`.** Neither value was a recorded decision and both were written in the same commit; `^4.0.18` claimed a patch-level floor nothing justifies and was strictly the narrower of the two.

**Nothing a scaffolded project installs changes.** `^5.3.0` and `^5.8.0` both resolve to typescript 5.9.3, and `^4.0.0` and `^4.0.18` both to vitest 4.1.11 — what moves is the floor each project declares, which is a support promise, so the surviving one is the promise the docs already make. Driving all five emissions and hashing the trees before and after: every `tsconfig.json` is byte-identical, `os init -t app` and `os init -t empty` are byte-identical in full, and exactly three `package.json` files change by exactly the one line each.

`npx create-objectstack` is deliberately untouched. It cannot import from `@objectstack/cli` — the dependency edge runs the other way — and its `^6.0.0` is a different question: unifying it would change which major of TypeScript a scaffolded project installs.
