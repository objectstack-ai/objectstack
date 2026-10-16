---
'@objectstack/spec': minor
'@objectstack/lint': minor
'@objectstack/plugin-security': patch
---

feat(spec)!: retire the object's `externalSharingModel` — the external org-wide default no principal ever read (#23268)

**BREAKING** — `externalSharingModel` on an object (`ObjectSchema`, the `object` metadata type) is now refused at parse. ADR-0090 D11 declared it as a second org-wide default for portal and partner principals, and nothing ever evaluated it: no request resolves an external principal, and the authorization kernel's `EXTERNAL` rung (ADR-0095 / ADR-0099) admits explicitly shared rows only, never an org-wide default. Setting `externalSharingModel: 'private'` hid nothing from anyone. Delete the key. `sharingModel` is the one org-wide default; a principal reaches a row it does not own through an explicit share (a manual share or a sharing rule), and an anonymous reader through a share link (`publicSharing`, unchanged).

Clause-②: no (narrowing)

Measured before removal, at `e4ec6ec1a`: no row-pipeline reader in any package. The key's only readers were authoring checks of its own ordering against `sharingModel` — the publish linter's alias and wider-than-internal branches, and the `plugin-security` posture gate's env-tighten comparison — plus the Studio console's object settings select (a separate console change). The only authored instances in this repository were two showcase objects.

## FROM → TO

| you wrote (17.7 and earlier) | write instead |
| --- | --- |
| `externalSharingModel: 'private'` (or `'public_read'`, `'public_read_write'`, `'controlled_by_parent'`) on an object | nothing — delete the key; share rows explicitly where an outside principal needs them |
| `import { SECURITY_EXTERNAL_WIDER } from '@objectstack/lint'` | nothing — the rule `security-external-wider-than-internal` is removed with the key it judged |

**The one-line fix:** delete `externalSharingModel` from every object.

**What an author who still writes it sees.** `tsc` fails at the authoring site (`ObjectSchema` types the key as retired), and the parse — `ObjectSchema.create()`, `defineStack({ objects })`, `PUT /api/v1/meta/object/:name` (draft saves included) — refuses it at its own path with the prescription:

> `object.externalSharingModel` was removed in @objectstack/spec 18 (ADR-0049 enforce-or-remove) — it never had an effect: no request resolves an external principal, and the external rung of the authorization kernel (ADR-0095) admits explicitly shared rows only, never an org-wide default, so the value changed no answer for anyone. Delete the key. `sharingModel` is the one org-wide default; a principal reaches a row it does not own through an explicit share, and an anonymous reader through a share link (`publicSharing`). Run `os migrate meta --from 17` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand.

## The retirement kit

- **A `retiredKey()` tombstone** on `ObjectSchema`, a `strictObject` — so the refusal carries the prescription rather than a bare unknown-key report, and `tsc` fails first. `RETIRED_KEYS_BY_MAJOR[18]`: `data/Object:externalSharingModel`.
- **The D2 conversion `object-external-sharing-model-removed`** (protocol 18, retired from the load path) deletes the key from every `objects[]` entry, one notice per object, as a lossless delete. Studio's object settings offered the select and `PUT /api/v1/meta/object` persisted it until this release, so a stored `object` row can carry it; the rehydration seams replay this conversion over stored rows, and `os migrate meta --stored` lists the rows that carry it before the upgrade.
- **The D3 entry `object-external-sharing-model-retired`** asks the author whether anything they built assumed the key kept outside users away from an object's rows. Nothing ever enforced that.
- **Ledger:** the row goes `planned` → `dead`, kept as a tombstone row (a tombstone keeps the key in the walked shape).
- **No deprecation window**, per the project's startup-stage posture.

**`@objectstack/lint`:** the `security-external-wider-than-internal` rule and its exported `SECURITY_EXTERNAL_WIDER` id are removed, and `security-owd-alias` no longer reads `externalSharingModel`; the parse refuses the key on every parsed door. On an unparsed intake (`os lint` on a raw config) the ledger-driven advisory reports it as `liveness-dead-property`.

**`@objectstack/plugin-security`:** the object posture gate's env-tighten-only rule (R1) compares `sharingModel` alone; the external half left with the key.

⚠️ **The out-of-repo consumer population is NOT MEASURED.** `@objectstack/spec` is published, so this is breaking for consumers no telemetry was consulted for.

<!-- adr-0087: registered object-external-sharing-model-removed, object-external-sharing-model-retired -->
