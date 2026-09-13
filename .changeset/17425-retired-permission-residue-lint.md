---
"@objectstack/lint": minor
---

feat(lint): `permission-retired-lifecycle-residue` — the retired `allowRestore` / `allowPurge` bits are now named at the authoring door (#17425)

`ObjectPermissionSchema` accepts `allowRestore: false` / `allowPurge: false` as inert residue and strips them silently. That tolerance is #12840's class ruling and is unchanged here: the accept set does not move, no schema is touched, and every other value keeps the tombstone's loud refusal.

The silence is deliberate — every artifact the published 17.x toolchain built has the retired default materialized in every permission entry, and a per-occurrence notice would be a storm. But `acceptRetiredDefaultResidue`'s own docblock names the channels that stay loud for authored sources — tsc `never`, `os migrate meta`, the ADR-0087 D2 conversion — and against a non-TypeScript author that list is one entry short. `tsc never` is a TypeScript channel. The conversion and `os migrate meta` are the same channel twice, and `permission-allow-restore-purge-removed` is declared `retiredFromLoadPath`, so it never fires while a stack loads. An author who writes the key in a JSON or YAML source and does not run the migration gets a clean parse and no signal at all — which is what a tombstone exists to prevent.

`os validate`, `os build` and `os lint` now emit one advisory `warning` per carrying entry, on the raw pre-parse stack where the key is still present and still attributable to a line somebody wrote. The hint is the retirement's own prescription, read from the tombstone's published description rather than retyped, so it cannot drift from the parse-time wording the same author sees through the other door.

It fires on the captured residue value and on nothing else: `true`, `"false"`, `0` and `null` are already refused at the parse with the prescription attached, and the surviving enforced lifecycle bit `allowTransfer: false` is not residue and is never named.

New published exports on `@objectstack/lint`: `validateRetiredPermissionResidue`, `PERMISSION_RETIRED_LIFECYCLE_RESIDUE` and the `RetiredPermissionResidueFinding` type. Nothing is removed and no existing finding changes shape or severity.
