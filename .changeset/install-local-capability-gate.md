---
"@objectstack/cloud-connection": minor
---

fix(cloud-connection): the four mutating `install-local` routes require the `manage_metadata` capability, and the `x-user-id` header fallback is gone (#8976)

<!-- adr-0087: not-required (no-migration-prescription) Four route handlers gain
a capability gate, one identity resolver is replaced by the shared one, plus one
new test file and a shared test fixture. No authorable property is added,
renamed, retired or tombstoned, so there is no conversion to register. The
behavioural change is that four package-install doors stop accepting callers who
hold no authoring capability, and stop accepting a bare identity header. -->

**BREAKING for any integration that installs, uninstalls, reseeds or purges a
local marketplace package with a principal holding no authoring capability — and
for anything that identified itself to these routes with an `x-user-id` header.**
Landing after the v17.0.0 cut, so it ships as `minor` under the lockstep
launch-window convention.

`MarketplaceInstallLocalPlugin`'s `requireAuthenticatedUser` asked one question —
"is there a session?" — and it was the only check on all four mutating routes:

- `POST /api/v1/marketplace/install-local` — accepts an **inline manifest**,
  hot-registers its objects into the shared registry, runs `syncSchemas()`
  against the shared database, writes the install ledger and runs seed data;
- `DELETE /api/v1/marketplace/install-local/:manifestId`;
- `POST /api/v1/marketplace/install-local/:manifestId/reseed-sample-data`;
- `POST /api/v1/marketplace/install-local/:manifestId/purge-sample-data`.

It also ended in a fallback that trusted a bare **`x-user-id` request header**,
commented as being "for cases where auth is disabled (e.g. test stubs)".

**Measured through the composed plugin, to the point the state actually changes**
— `manifest.register()`, `objectql.syncSchemas()`, the ledger file on disk,
`SeedLoaderService.load()`, `driver.delete()`. All three principal shapes were
indistinguishable, and every effect fired for every one of them:

| principal | install | reseed | purge | uninstall |
|:--|:--|:--|:--|:--|
| bare `x-user-id` header, **no session** | **200** | **200** | **200** | **200** |
| authenticated, **no** `manage_metadata` | **200** | **200** | **200** | **200** |
| authenticated, `manage_metadata` | 200 | 200 | 200 | 200 |

Nothing downstream refused any of it. The first row is the sharper half: with no
session store consulted first, a caller who could reach the port completed a
full schema-mutating install and had `installedBy` recorded as a string of their
own choosing.

**Severity by deployment shape.** Metadata is environment-scoped rather than
org-scoped, so Layer 0's tenant wall does not reach these writes: on the walled
multi-org EE shape this is a cross-tenant write channel — any signed-up user of
any customer organization could mutate the schema every other tenant runs on,
and `organization_admin` deliberately withholds `manage_metadata` precisely
because a tenant administrator is not supposed to. It also nullified the
already-implemented cloud-side ruling that AI `build` be structurally closed on
that shape: closing the build agent while this route stayed open closed the
front door and left the loading dock unlocked. On a single-org self-host the
severity is genuinely lower — every user is one tenant's — but "any employee
with a login can alter the schema and run seed data" still contradicts the
operator-action framing, and the header fallback admitted callers with no login
at all. The measurements above are code-path measurements through a composed
host, not an exploit demonstrated against a running deployment.

**The fix.** All four routes now resolve identity **and** capability through
`resolveAuthzContext` — the platform's single authorization resolver
(`@objectstack/core`) — and demand ADR-0066 D1's `manage_metadata`, the same key
the `/meta` write doors carry (#6603, and #8919 for the promotion verbs). A
caller with no resolvable principal gets `401 UNAUTHENTICATED`; an authenticated
caller without the capability gets `403 FORBIDDEN` naming the capability they
need. The refusal is issued before any work, so a refused caller cannot probe
what is installed through a downstream error. Service and operator tokens are
exempt exactly as elsewhere, with no special case: an API key resolves through
the same resolver to its owner's real grants.

**The `x-user-id` fallback is removed, not mode-gated.** It carried no mode flag
to gate it to, and it was the last `x-user-id` trust left in `packages/**`
source — the two sibling raw-route surfaces that carried the identical line had
it *removed* in favour of this same resolver rather than restricted
(`plugin-sharing`'s share-link routes, `service-settings`' settings routes). The
one first-party caller of these routes, `os package install`, signs in for a
real better-auth session cookie and never sent the header.

The plugin's mount stays **unconditional** (cloud#1287 moved it out of the
`marketplaceUrl` ternary so air-gapped boxes stop 404ing). This is authorization
on the routes, not un-mounting the plugin.

**Anti-drift.** `marketplace-install-local-capability-enumeration.test.ts`
derives the mutating routes from the plugin's own route table and compares them
against a declared list, so a new mutating install-local route fails the build
until it is enumerated and its refusal cases run. Each refusal asserts the
ADR-0112 envelope (`code` **and** `status`) *and* that no registry, schema,
ledger, seed or delete effect fired — a gate that answers 403 after
`syncSchemas()` has run is still the bug.

Two existing suites whose names read as authorization coverage —
`marketplace-install-local-posture-gate.test.ts` (the ADR-0120 D5e ceremony,
which the caller satisfies from their own request body) and
`marketplace-install-local-tenancy-posture.test.ts` (which selects a seeding
path) — now open with an explicit statement of what they do **not** cover and
name the file that does, backed by an assertion that the named file exists so
the correction cannot rot into a wrong answer. Neither test was weakened.
