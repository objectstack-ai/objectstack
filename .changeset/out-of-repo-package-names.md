---
'@objectstack/console': patch
'@objectstack/cli': patch
---

Stop naming a package nobody can install: `@objectstack/framework` is not a real
package, and the multi-org remedy now says it is not publicly obtainable

Four `@objectstack/` names appear in this repo's published docs and runtime text
without this repo building any of them. Measured against the public npm registry
(unauthenticated `GET https://registry.npmjs.org/@objectstack%2F<name>`, with
`@objectstack/spec` and `@objectstack/cli` as positive controls so a 404 is a
fact about the name and not about access), they are **not one population but
three**:

- `@objectstack/framework` — **404, and fabricated.** Unlike the others, nothing
  in this tree describes it as enterprise, cloud, or private; it is presented as
  the *default public* install. There is no umbrella package and there never was.
- `@objectstack/security-enterprise` (404) and `@objectstack/organizations`
  (404) — **real, and deliberately not public.** This tree calls them
  "closed-source" and "cloud-private" in a dozen places, and
  `PLATFORM_CAPABILITY_PROVIDERS` declares `security-enterprise` with
  `edition: 'enterprise'`. Their 404 is the caveat npm's API carries for any
  private package, not evidence of fabrication.
- `@objectstack/service-tenant` — **published, at 4.1.0**, exactly as
  `platform-object-names.ts` describes it. Untouched.

What changes:

- **`@objectstack/console`'s README** no longer opens with
  `pnpm add @objectstack/framework`. The mechanism it described is real, just
  misnamed: `@objectstack/cli` declares `@objectstack/console` as a dependency
  and both ship at one version from the Changesets `fixed` group, so any app
  that installs the CLI — every `npx create-objectstack` scaffold does — already
  gets a version-matched Console. The instruction is corrected rather than
  deleted, so the reader is left with something they can run.
- **`serve`'s multi-org fail-fast** kept telling an operator to add
  `@objectstack/organizations` to their app without saying the runtime ships
  only with an enterprise/cloud subscription. That is the un-followable "add it
  to your dependencies" that framework#3366 exists to make legible. The remedy
  now states it, so an operator without a licence can see that the two bullets
  below it are their actual path. The declared-but-unresolvable branch is
  unchanged — that operator does have the package.

No behaviour changes: boot outcomes, exit codes and the posture wall are
untouched, and `@objectstack/security-enterprise`'s install hint is deliberately
left alone — it already names its edition boundary, and the test pinning it is
strengthened to assert that it keeps doing so.
