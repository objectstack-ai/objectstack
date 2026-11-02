---
'@objectstack/spec': patch
---

fix(spec): the `packageless-overlay-write-closed` upgrade entry names both closed overlay write addresses, the write naming no package and the write naming the read-only package itself

Clause-②: no (migration entry prose; no accept set moves)

Metadata-protocol: none

The ADR-0087 semantic entry `packageless-overlay-write-closed`, unreleased and shipping in this release, named only the write naming no package in its `surface` and `reason`. The same release also refuses a save, publish or rollback that names the installed read-only package itself (`?package=<base>`) onto a view, dashboard, report, translation or email template it ships, with the same fix the entry's `replacement` already prescribes: write the customization into the base's paired `<base>.custom`, declaring `overrides`. The entry's `surface` now names both addresses, and the stored rows either one left (package-less, or bound to the read-only package); its `reason` says what each address stored, and which writes naming the package stay open (a delete, and every write the pair could not take). The generated protocol upgrade guide shows both in one entry. Text only: no schema, export or runtime behaviour changes.
