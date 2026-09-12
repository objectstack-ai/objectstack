---
'@objectstack/spec': major
---

**BREAKING** — remove `page.assignedProfiles`, and answer `profiles:` / `assignedTo:` with the permission-set route instead of correcting an author into the retired vocabulary.

`PageSchema` carried an authorable key named for the concept **ADR-0090 D2** deleted ("The Profile concept is removed — `isProfile` deleted, not deprecated"), and the schema's own alias table rewrote an authored `profiles:` **into** it — two files from `security/permission.zod.ts`, which answers the same word with *"`profiles` is not a PermissionSet field (ADR-0090 D2: no Profile concept)"*. One word, two opposite answers, depending on which schema received it.

It also enforced nothing. Measured across this repository and objectui at the ruling: **zero readers** — every hit was a declaration, a generated artifact, prose, a `CHANGELOG` or a round-trip test — so a page that "assigned profiles" stayed open to every caller who could reach it, while the Studio form and four locale bundles told the author it was an access list. ADR-0049 enforce-or-remove; maintainer ruling 2026-09-12.

## FROM → TO

| you wrote (17.4 and earlier) | write instead |
| --- | --- |
| `assignedProfiles: ['sales_manager']` on a page | delete the key. Gate the DATA the page shows with the object's permission sets, and bind those sets to people through positions (`sys_position_permission_set`) |
| `profiles: [...]` on a page (the alias corrected it into `assignedProfiles`) | the same — the alias is now a refusal naming the permission-set route, and it never accepted the key anyway |
| `assignedTo: [...]` on a page | the same |

**The one-line fix:** delete the key; page audience is the permission set's.

`os migrate meta --from 17` lists the mechanical edits for existing sources; apply them by hand.

## The retirement kit

- **A `retiredKey()` tombstone, not a bare deletion.** `PageSchema` is still parsed from the `page` metadata-type root, so there is an author to teach: `tsc` types the key `never`, and a value reaching a parse raises the prescription rather than a bare unrecognized-key report. The key therefore stays in the walked shape, which is why its liveness row stays too (as `dead`, the `rls.priority` precedent) and why the authorable-surface baseline marks it `[RETIRED]` rather than losing the line.
- **The two alias entries are gone from `aliases` and present in `guidance`.** This narrows nothing: an alias table runs only from the `unrecognized_keys` path, so `profiles:` and `assignedTo:` were *already refused* — the entries only decorated the rejection, and they decorated it with the retired word. Measured before and after on the built artifact: same `issue.code`, same `path`, different text.
- **`page.form.ts`** — the `assignedProfiles` input and its `helpText: 'Profiles that can access this page'` are removed, and with them the four locale bundles that shipped it translated (`zh-CN` 「指定配置文件」, `ja-JP`「割り当てプロファイル」, `es-ES` "Perfiles asignados"). A form input for an unwritable key is the false-compliant UI half of a retirement.
- **Three records that asserted the key WAS enforced are corrected in the same change** — one place alone only moves the lie. `liveness/page.json` graded it `live` on the strength of an objectui bridge at `react/src/spec-bridge/bridges/page.ts`, a path that does not exist in that repo (the row is deleted: a strict deletion takes the key out of the walked shape, so a surviving row would be an orphan). `api/protocol.zod.ts` and `metadata-protocol`'s search-sweep comment both said the page's "own audience gate" applied at page render; it did not, and a page has no audience gate of its own.

## What an operator with a STORED page sees

A `sys_metadata` `page` row written before this release can carry `assignedProfiles`. Nothing breaks at read: the ADR-0087 conversion `page-assigned-profiles-removed` (protocol 18) replays on rehydration and strips the key, so the row is served canonical. `os migrate meta --stored --apply` rewrites the rows so the warn stops; the next save through `PUT /api/v1/meta/page` heals one row the way it heals any pre-protocol shape.

⚠️ The strip is the mechanical half only. The paired D3 semantic entry `page-assigned-profiles-audience-to-permission-set` carries the judgement: which permission set a given profile name corresponds to is not derivable by a walker, so each name in a retired list has to be re-expressed as a permission set plus a position. Deleting the key **changes no behaviour and closes no hole** — the page was already open to everyone who could reach it. It stops an unkept promise from being made.

<!-- adr-0087: registered page-assigned-profiles-removed, page-assigned-profiles-audience-to-permission-set -->
