---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): `OS_METADATA_WRITABLE` no longer unlocks a write into a read-only package (#8146)

With the documented operator hatch set, `PUT /api/v1/meta/permission/showcase_contributor?package=com.example.showcase`
answered **200** against `com.example.showcase` — a **read-only** package — while
Studio rendered that same permission matrix fully disabled behind a "Read-only"
badge. Two surfaces answered the same question differently, and the row landed
`{ package_id: 'com.example.showcase', organization_id: null }`: bound *into* the
package the deployment ships.

**Maintainer ruling, 2026-08-12 (option B): the badge is telling the truth and
the server should refuse.** The hatch is a **metadata-type-level** unlock by its
own shipped documentation — `content/docs/deployment/environment-variables.mdx`
defines it as treating named types "as `allowOrgOverride: true` … overridden
per-org", and this package's CHANGELOG records that it "deliberately does not
unlock the org dimension". A type-level unlock says nothing about the **package**
dimension, so the 200 was a bug rather than a policy choice.

The package door now sits **above** the hatch limb and **below** every registry
limb in `SysMetadataRepository.assertAllowed`. A hatch write that **names** a
read-only base is refused with the codes the error-code ledger already registers
for the package-writability condition:

- **`override-artifact`** → `403 ITEM_LOCKED`, carrying `lockSource: 'package'`
  and the package id — the server-side counterpart of Studio's badge.
- **`runtime-only`** → `422 WRITABLE_PACKAGE_REQUIRED`, the same code and
  prescription `saveMetaItem` already emits for ADR-0070 D1.

**What deliberately keeps working — the hatch is narrowed, not retired.** Only a
write that *names* a read-only base is refused. Verified by measurement before
the change was written, and pinned as tests:

- a **package-less** hatch write still lands the env-wide overlay
  (`{ package_id: null, organization_id: null }`);
- under an org kernel it still lands the **per-org override** the variable's
  documentation promises (`{ package_id: null, organization_id: <org> }`);
- a hatch write naming a **writable** base still lands;
- an **ADR-0005 org overlay** of a code-shipped item is untouched — it names the
  read-only package it customizes by construction and returns at the registry
  limb, above the door.

No documentation changes and no capability is retired.

**The refusal no longer prescribes the step the caller already took.** When the
hatch is open, the `ITEM_LOCKED` message states that `OS_METADATA_WRITABLE`
unlocks the type and not package writability, and points at the remedy that
actually works (retry without `?package=`). The previous sentence — "set
`OS_METADATA_WRITABLE=<type>`" — would otherwise be emitted *while that variable
is set*, which is the shape that makes an automated client retry forever. With
the hatch closed, that sentence is still offered, because then it is true.

**Known boundary (#8184, not fixed here):** on a scoped kernel
(`environmentId !== undefined`) `saveMetaItem` refuses earlier, in `protocol.ts`,
with the undiscriminated `NOT_OVERRIDABLE`, so this refusal is not reachable on
that topology. Not a regression — that branch answered `NOT_OVERRIDABLE` before
this change too.
