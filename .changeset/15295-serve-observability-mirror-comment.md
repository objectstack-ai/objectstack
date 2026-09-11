---
'@objectstack/cli': patch
---

`serve.ts`'s observability knob block points at the cloud mirror in the house style, keeps the sync duty, and names the package that owns the list (#15295)

The block above `buildServeObservability()` instructed the reader to *"keep the
two in sync"* with `apps/cloud/server/observability.ts` — a path that has not
existed in this repository since `apps/cloud` moved to `objectstack-ai/cloud`
(`git ls-tree origin/main -- apps/` returns exactly `apps/docs`, the positive
control that makes that a reading rather than a broken query). A reader was
being sent to a file they cannot open, with no hint that it lives in another
repository.

**The duty is live, so it stays.** The cloud file still exists and still reads
all five names as `process.env` lookups (measured on `objectstack-ai/cloud` and
recorded on #15295, with that file's own `process.env` hit count as the firing
control). Deleting the clause would have dropped a real obligation whose failure
mode is quiet: the two exporters drift and the cloud host stops reading the
variables an operator set.

Three things change, all inside one comment block:

- the path is re-spelled in this repo's settled style for a cloud-repo
  reference — ``(`apps/cloud/server/observability.ts`, cloud repo)``, the form
  at `packages/services/service-cluster/src/multi-node-gate-mount.ts:9`;
- the duty is narrowed to what its own words say — **names, not defaults**.
  `OS_OBS_SERVICE_NAME` defaults to `objectstack` here and to
  `objectstack-cloud` there *deliberately*, because two deployments are two
  services; a future reader "tidying" that into one value would merge both
  deployments into a single telemetry series. The comment now says so, which is
  the point of writing it down rather than leaving it to be rediscovered;
- the canonical home for the variable list is named as
  `@objectstack/observability` — the package **both** consumers already import
  — instead of two consumers pointing at each other. That mutual pointing is
  the decay mechanism itself, and it is still one-sided today: the cloud file
  carries no reciprocal sentence, so nobody renaming a name over there is
  prompted to come back here.

⛔ No behaviour changes, and no observability code path was touched. No env var
is added, removed or renamed; no default moves.

**This ships, which is why it carries a changeset rather than
`skip-changeset`.** `@objectstack/cli`'s published `files[]` is
`["dist","README.md","CHANGELOG.md"]`, and this package builds with plain `tsc`
(no `removeComments`), so the block is emitted verbatim into the tarball —
measured on the rebuilt artifact: the new clause is present in
`dist/commands/serve.js` (1 occurrence, and the knob-list line as control
resolves to that one file), the old spelling is absent from all of `dist`, and
`dist/commands/serve.d.ts` carries 0 of it because the block sits above a
non-exported helper. So the published JS bytes move while the declaration
surface does not.
