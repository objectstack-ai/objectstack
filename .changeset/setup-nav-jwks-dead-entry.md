---
"@objectstack/platform-objects": patch
---

fix(platform-objects): drop the dead Setup › Advanced › Signing Keys (JWKS) nav entry (#7544)

`Setup › Advanced › Signing Keys (JWKS)` could never load, for **any** persona.
`sys_jwks` declares `enable.apiEnabled: false` / `apiMethods: []`, so the list
request answers `OBJECT_API_DISABLED` (404) — and the console masked that as a
generic "No identity records" empty state, so the surface read as *"you have no
signing keys"* rather than *"this page cannot work"*.

**Why the gate it carried could not help.** The entry was contributed with
`requiredPermissions: ['manage_platform_settings']`, and an in-code comment
claimed a non-admin's list "403s server-side" — which reads as though an admin
could list the keys. None could. `apiAccessDenialFromEnable` (`rest-server.ts`)
is a **pure function of the object's `enable` block**: it takes no user, no
permissions and no context, so the 404 is identical for every persona, platform
admin included. A permission gate on the entry and an API-disabled object are
independent conditions, and no combination of the first prunes the second.

**The repair is the entry, not the object.** `sys_jwks` rows are the
environment's JWT signing keys (`private_key` — private key material); opening a
read path onto them over the generic data API would be a credential disclosure.
`enable` is unchanged, and a test now pins that it stays `apiEnabled: false` /
`apiMethods: []` (fails CLOSED since #3391) and `access: { default: 'private' }`
(ADR-0066 ④). better-auth continues to read the keys through its adapter under a
system context, so token signing and verification are unaffected.

This matches how the same class is already handled two lines below in
`setup-nav.contributions.ts`: `sys_verification` and `sys_device_code` omit
`list` and therefore get no browse entry. `sys_jwks` was the only one of the
repo's seven API-disabled objects that still had a nav entry — the six
`sys_oauth_*` token/consent stores never had one.

Also landed with the removal:

- The four `apps.setup.navigation.nav_jwks` labels move into the
  `DEAD_SETUP_NAV_IDS` tombstone (`setup-nav-dead-key-tombstone.test.ts`), which
  refuses a label with no declaring nav item and states the order for re-adding
  one. The `sys_jwks` **object** labels in the generated bundles are untouched —
  the object still exists.
- A new invariant in `platform-objects.test.ts`: every contributed
  `type: 'object'` Setup entry must target an object that can actually serve a
  `list`, judged through the same single derivation source the REST gate uses
  (`resolveEffectiveApiMethods` / `isApiOperationAllowed`, #3391). It asserts the
  control too — `nav_api_keys` → `sys_api_key` still lists, so a fix that pruned
  both would fail.

**Not addressed here** (reported on #7544 instead): nav gating has no declaration
that can express "prune when the destination cannot serve". `filterAppForUser`
gates `requiredPermissions` and `requiresService` server-side and deliberately
leaves `requiresObject` to the client, and nothing anywhere consults
`enable.apiEnabled` — so re-pointing this entry at a `requiresObject` gate would
not have pruned it either. Closing that gap is a contract-face change and belongs
in its own card.
