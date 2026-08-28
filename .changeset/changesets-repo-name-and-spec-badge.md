---
"@objectstack/spec": patch
---

fix(spec,repo): address the changesets `repo` option and the spec README's StackBlitz badge to `objectstack-ai/objectstack` (#12488)

Two places still name `objectstack-ai/spec`, which is not the repository this
monorepo lives in:

- `.changeset/config.json` — `changelog[1].repo`
- `packages/spec/README.md` — the "Try Online" StackBlitz badge target

The README badge is the user-visible half. `README.md` is listed in this
package's `files`, so it ships in the npm tarball and every reader of
`@objectstack/spec` on npm gets a "Try Online" button addressed to a repository
that is not this one. The path the badge names —
`examples/app-todo/objectstack.config.ts` — exists here, so correcting the
owner/repo segment is the whole fix.

The `.changeset/config.json` half is hygiene with a measured expiry date rather
than a bug that is firing. The configured generator `@changesets/cli/changelog`
re-exports `@changesets/changelog-git`, whose `getReleaseLine(changeset)` and
`getDependencyReleaseLine(changesets, dependenciesUpdated)` do not read the
third argument — the options object that `@changesets/apply-release-plan`
passes as `config.changelog[1]`. So `repo` has **no reader today**, and the
wrong value has never produced a wrong link in any CHANGELOG this repo has
generated. It acquires a reader the moment anyone swaps in
`@changesets/changelog-github` — which is the usual reason to touch that block
— and from then on every generated release line would link into the wrong
repository, with nothing in the diff looking wrong.

No runtime behaviour changes.
