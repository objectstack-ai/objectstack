---
"@objectstack/cloud-connection": minor
---

fix(cloud-connection): the `install-local` listing requires an authenticated principal, and narrows `installedBy` / `storageDir` to `manage_metadata` holders (#9011)

<!-- adr-0087: not-required (no-migration-prescription) One route handler gains an
authorization gate and a caller-dependent response projection, one 401 envelope is
extracted into a shared seam, plus one new test file. No authorable property is added,
renamed, retired or tombstoned, so there is no conversion to register. The behavioural
change is that one package-inventory read stops answering anonymous callers, and stops
serving two operator-grade fields to callers who hold no authoring capability. -->

**BREAKING for any consumer that reads this route anonymously — it now answers `401`
— and for any authenticated non-operator consumer that reads `installedBy` or
`storageDir` from it.** Landing after the v17.0.0 cut, so it ships as `minor` under the
lockstep launch-window convention.

`GET /api/v1/marketplace/install-local` — the console's Setup → "Installed Apps" list —
called **no** identity resolution whatsoever. `handleList`'s first statement read the
ledger. After #8976 capability-gated the four mutating doors on this surface, this was
the only anonymous door left on it: not a weaker gate, the absence of one, so any caller
who could reach the port received `200` and the complete payload.

**What was disclosed.** Per ledger entry: `packageId`, `versionId`, `manifestId`,
`version`, `installedAt`, `installedBy`, `withSampleData`; once per response: `items`,
`total`, `storageDir`.

- `installedBy` is a **platform user id**, and the listing enumerates them across every
  install.
- `storageDir` is an **absolute filesystem path on the host** (#6721 put it on the wire
  deliberately, for a *signed-in* CLI operator who cannot see the remote host's disk).
- The inventory itself is a version-level software bill of materials for the deployment
  — which packages, at which versions, installed when.

On the walled multi-org EE shape the inventory and the installer identities are
cross-tenant information, for the same reason #8976's write channel was: metadata is
environment-scoped, not org-scoped, so Layer 0's tenant wall does not scope this read
either. Severity is nonetheless lower than #8976's: this is read-only disclosure, not a
write channel. The measurement is a code-path measurement through a composed host, not
an exploit demonstrated against a running deployment.

**The fix — authenticated floor plus field narrowing** (maintainer ruling 2026-08-16):

| caller | status | `items` / `total` | `installedBy` | `storageDir` |
|:--|:--|:--|:--|:--|
| anonymous | **401 `UNAUTHENTICATED`** | — | — | — |
| authenticated, **no** `manage_metadata` | 200 | served | **omitted** | **omitted** |
| authenticated, `manage_metadata` | 200 | served | served | served |

Splitting the payload rather than gating it whole is the point: "which packages are
installed here" and "who installed them and where they live on this host" are genuinely
different sensitivities. Demanding `manage_metadata` for the whole read would have
withdrawn a console page that ships to non-operator users today, and an authenticated
floor alone would have left the user ids and the host path on the wire for every signed-in
account.

The two narrowed keys are **omitted, not nulled** — `null` would be a claim about the
ledger ("installed by nobody") instead of a fact about the caller. The console already
renders the "installed by" line conditionally and never reads `storageDir`, so a narrowed
caller sees the same list minus that one line.

Identity is resolved by the **same** `resolveInstallPrincipal` the four mutating doors use
— `resolveAuthzContext`, the platform's single authorization resolver — not a second
session read; two auth mechanisms in one file is how the next gap gets created, and this
file has already produced one. The 401 envelope is extracted into one
`refuseUnauthenticated` seam shared by all five routes, so a client branching on
`UNAUTHENTICATED` never has to learn which door it knocked on. The read door inherits
#8976's removal of the `x-user-id` fallback: a bare header is still anonymous.

**No new capability is minted** (#8919 discipline) — the narrowing reuses
`manage_metadata`, matching the `/meta` precedent. The plugin's mount stays
**unconditional** (cloud#1287 moved it out of the `marketplaceUrl` ternary so air-gapped
boxes stop 404ing); the answer to an unauthorized read is a refusal, never an absent
route, and the enumeration suite still asserts the GET is mounted.

**Pinned.** `marketplace-install-local-list-posture.test.ts` pins all three rows above and
states, in its own docblock, that it is the file which answers "is the listing gated?" —
the sibling `capability-enumeration` suite answers that only for the mutating doors and
deliberately filters the GET out. The non-operator row is pinned in **both** directions
(the inventory is present *and* the two fields are absent), because asserting only the
absences would keep passing if that caller were refused outright — the option the ruling
rejected. The refusal asserts the ADR-0112 envelope (`code` **and** `status`) and that it
is issued **before** the ledger is read, so a refused caller cannot probe what is installed
through timing or a storage error.
