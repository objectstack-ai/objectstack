---
'@objectstack/cli': patch
'create-objectstack': patch
---

The scaffolded `pnpm-workspace.yaml` records the retired `@better-auth/scim>better-call` peer rule instead of advertising it as live

`objectstack init` wrote a paragraph into every project it scaffolds explaining
an `@better-auth/scim>better-call` suppression that is not in the map it
annotates — the entry retired with objectstack#3653, and `init.test.ts` pins its
absence. All three of its claims were false on today's tree as well:
`@better-auth/scim` is not "held at a release candidate deliberately" (it is
pinned at exact stable `1.7.3`), and stable `@better-auth/scim@1.7.3` declares
`peerDependencies["better-call"]` as the exact string `1.4.0` — the single copy
`better-auth@1.7.3` itself depends on — so the `1.3.7` skew the paragraph
described does not exist.

It now records the retirement, in the shape `create-objectstack`'s bundled
`blank` template already used, and dates the measurement the way the
neighbouring `better-sqlite3` paragraph in the same block does. Both scaffold
paths previously named `1.7.1` as the current pin; both now name the measured
`1.7.3`, so the two paths tell a user the same thing.

Comments only — no declaration moves. The rendered `allowedVersions` map is
byte-identical before and after, so no resolution, lockfile or suppression
changes.
