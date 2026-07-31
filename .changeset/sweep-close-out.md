---
"@objectstack/plugin-hono-server": patch
"@objectstack/hono": patch
"@objectstack/runtime": patch
---

fix(hono,plugin-hono-server,runtime): one CORS source and one registry key — the last derivable copies from the #3786 sweep

Re-ran the sweep across all 72 packages. The earlier pass globbed `packages/*/src`,
which is one level deep, so it missed everything under `packages/plugins/` and
`packages/adapters/` — the "sweep is basically clean" report was based on an
incomplete scan.

**A stale CORS default, on the one description callers actually read.**
`HonoCorsOptions.allowHeaders`' TSDoc promised
`['Content-Type', 'Authorization', 'X-Requested-With']` "which is sufficient for
cookie and bearer-token auth". The real default carries three more:
`X-Tenant-ID` and `X-Environment-Id` (multi-tenant routing) and `If-Match` (the
OCC token on record PATCHes, objectui#2572). Sizing a custom `allowHeaders`
against that sentence drops all three and every cross-origin save fails with
"Failed to fetch".

The instructive part: **three** Hono CORS sites each carried their own copy of
the defaults under "keep in sync" comments, and the copies all agreed. What
drifted was the *doc* — the only description with no counterpart to be diffed
against, and the only one a caller reads.

Both defaults are now single constants, `DEFAULT_CORS_ALLOW_HEADERS` and
`DEFAULT_CORS_EXPOSE_HEADERS`, exported from `@objectstack/plugin-hono-server`
and imported by the adapter (which already depends on it — no new edge). The
TSDoc links them rather than restating, and documents an asymmetry it never
mentioned: `allowHeaders` REPLACES the default, `exposeHeaders` MERGES with it.

`hono-plugin.test.ts` stopped stubbing `./adapter` wholesale and keeps the real
constants via `importOriginal` — it asserts exact header lists, so a mocked copy
would make the test agree with itself rather than with what ships. Verified:
removing `If-Match` from the constant fails `should allow If-Match by default`,
by name.

**A third copy, in the public protocol docs.** `content/docs/protocol/kernel/
http-protocol.mdx` advertised `Access-Control-Allow-Headers: Authorization,
Content-Type` — two of the six — and methods missing `PUT` and `HEAD`, with no
mention of the exposed headers at all. That is the copy an integrator builds a
client against: reading it, you would not know `If-Match` is permitted (so you
would not attempt OCC) or that `set-auth-token` is readable (so a rotated
session would look like a bug). Corrected, with the three non-obvious allowed
headers and the two exposed ones explained, and a pointer to the constants as
the source of truth.

**A hand-copied service-registry key.** `runtime`'s share-links domain resolved
`'shareLinks'` as a string literal, copied from `SHARE_LINK_SERVICE` — whose own
doc-comment says "keep in sync with the SharingPlugin registration". It now
imports the constant. A drifted copy resolves nothing, so every share link
answers 501 "Sharing is not configured for this environment" on an environment
where it is configured perfectly well.

**Plus a duplicate ledger entry**, which is the same defect one level up:
`check-generated.ts` carried two `NO_GENERATOR` entries for
`check:strictness-ledger`, because #4203 and #4252 each added one without seeing
the other. Functionally harmless (the ledger is read into a `Set`) but it leaves
two comments telling overlapping versions of the same story. #4203's is kept —
it is the more complete account and it is the PR that fixed the underlying
problem.

Checked and deliberately left alone: `ApprovalStatus` (5 values) and
`ApprovalActionKind` (12 values) versus their `plugin-approvals` selects — diffed
verbatim, no drift today, still hand-copied across a package boundary.
