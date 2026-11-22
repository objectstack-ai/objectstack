---
'@objectstack/service-messaging': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(messaging): a member's own "no digest" or "no quiet hours" now beats the organization's default

Clause-②: no
Metadata-protocol: none

A member who chooses no digest, or clears their quiet hours, now keeps that choice even when the organization's default sets a digest or quiet hours. The organization's default is a default, not a floor. Before this release the member still got the organization's digest and quiet hours.

- **Three states per field.** A notification preference's `digest` and `quiet_hours` are each one of: not set (empty), explicitly off, or a value. The most specific preference that sets the field decides it. A preference that leaves a field empty decides nothing for that field, so it keeps following the next preference: the default for all users, then none. Explicit off is `none` for the digest and `{ "off": true }` for quiet hours. An organization default that is explicitly off is the same as no default.
- **`digest` has no default value any more.** A preference created without a digest stores it empty, so it follows the organization's default. On a database created by an earlier release, the `digest` column still carries the old database default `none`. The messaging service writes an explicit empty digest on every insert that leaves it out, so the database default never applies. A write that skips the platform's engine (raw SQL, a bulk load straight into the table) still stores `none` on such a database. That stored `none` now means "no digest".
- **Stored rows keep their meaning.** On the first start of this release, every stored `digest = 'none'` is rewritten to empty, in every organization, once. The pass is recorded in `sys_migration` (`messaging-preference-digest-none-unset`) and never runs again, so a `none` chosen after the upgrade is kept. A stored `none` never took effect before, so no one's digest changes at upgrade. If you picked "none" by hand in Setup > Notification Preferences to opt out, pick it again after upgrading.
- **The Notification Settings page offers the opt-out.** "No digest" is always offered and saves `none`. Clearing the quiet-hours window and saving stores `{ "off": true }`. The two notes saying these choices were not offered are gone, in all 11 languages.
