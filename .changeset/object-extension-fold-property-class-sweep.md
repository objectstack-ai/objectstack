---
"@objectstack/rest": patch
---

test(rest,dogfood): enumerate every property the object-extension fold touches, and locate #8037's divergence in i18n rather than in the fold (#8037)

Third card in one family. #7556 (PR #8015) reconciled the by-name and list reads
on `fields`; #8027 (PR #8045) then found `validations`/`indexes` duplicated,
invisible to #8015's pin because it compares FIELD NAMES and the field spread is
idempotent. #8037 arrived next, about `label`.

**The enumeration, because the instances keep arriving.**
`mergeObjectDefinitions` names six keys and copies nothing else — which
`ObjectExtensionSchema`'s own guidance states from the other side ("the merge
carries `fields`, `label`, `pluralLabel`, `description`, `validations` and
`indexes` only") — in three merge kinds:

| property | merge kind | idempotent? |
|---|---|---|
| `fields` | key-keyed spread | yes |
| `validations` | CONCATENATED | no (#8027) |
| `indexes` | CONCATENATED | no (#8027) |
| `label` / `pluralLabel` / `description` | scalar, last-writer-wins | yes |

So a fold has three distinct failure modes and a field-name pin sees one.
`meta-object-extension-property-classes.test.ts` sweeps all six across twelve
host shapes (artifact/bridged/absent × no-row/customised/verbatim/prefolded),
asserting each read against the REGISTRY'S RESOLVED SCHEMA (ADR-0029 D9.2)
rather than against another route — both prior defects had the two routes
agreeing with each other on a body that was already wrong.

**#8037 is not a fold defect.** Traced through a real artifact-ingest boot,
`foldObjectExtendersOnto` is called on the by-name read and on the layered read
with the same base and returns the same body to both, `label` included. The
sweep holds the same result from the other side: on all twelve shapes every read
agrees with D9.2 on all six properties. The divergence is produced one layer up.
`translateObject` resolves each of the three scalars as `catalog ?? document`,
and the showcase's own catalog declares `objects.showcase_account.label =
"Account"`. The list and by-name reads are translated, so the catalog entry
replaces whatever the fold resolved; `?layers=true` is deliberately not
translated ("this is a diagnostic"). Hence "onto `?layers=true` only".

**The extension is the milder half.** The catalog is keyed by object name and
resolved ahead of the document, so it defeats the TENANT's customisation too: an
admin who renames the object through the ordinary Studio round-trip gets a
`layers.overlay` carrying `"Customer"` and both reads every writable form
derives from still serving `"Account"`. That is the scenario #8027/#8045 were
about. Escalated rather than decided here — the issue itself asks for a design
ruling, and both candidate directions change behaviour well outside this card's
region.

**No behaviour change.** Tests only; `mergeObjectDefinitions`,
`foldObjectExtendersOnto`, `getMetaItem` and `getMetaItemLayered` are untouched,
so #8045's idempotency, the `layers.overlay` boundary and byte-identity for
unextended objects all stand as they were.

Reverse-verified per arm (A: #8045's subtraction disabled; B: the card's
proposed "fold drops scalars"; C: #7556's fold disabled). Arm B — the easy half
the card asked for — is invisible to BOTH existing pins and is caught only by
this file's anti-vacuity case: dropping scalars makes the three reads agree by
deleting a documented `ObjectExtensionSchema` feature, and leaves the tenant
rename defect untouched.
