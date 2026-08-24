---
'@objectstack/console': patch
---

npm `description` no longer names the fabricated `@objectstack/framework`

`@objectstack/console`'s manifest `description` is what npm renders on the
package page, so it was the most-read of the three sites that named a package
nobody can install. The earlier pass corrected the other two — this package's
README and `packages/cli/src/utils/console.ts` — but left the manifest alone
because a published manifest was outside that change's declared file surface.
This is the third and last live site.

The correction is the same one the README took: the mechanism is real and only
the name was wrong. There is no umbrella `@objectstack/framework` package (404
on the public registry, and fabricated — nothing in this tree presents it as
enterprise or private, it is presented as the *default public* install). What
actually pins the two together is that `@objectstack/cli` declares
`@objectstack/console` as a dependency and both ship at one version from the
Changesets `fixed` group.

```diff
-Prebuilt Console SPA pinned to this @objectstack/framework release. Source of truth: …
+Prebuilt Console SPA pinned to this framework release, installed as a dependency of @objectstack/cli. Source of truth: …
```

"framework release" survives as the common noun the README already uses; what
is dropped is the `@objectstack/` scope that turned it into a package name. The
`@object-ui/console` source-of-truth half is unchanged — it was accurate.

Text only: no code, no exports, no behaviour change. It carries a changeset
rather than the publish-nothing exemption because the manifest `description`
ships inside the npm tarball and is a published artifact.
