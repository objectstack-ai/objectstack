---
'@object-ui/app-shell': patch
---

fix(app-shell): the Delegated Admin Scope block lists the companion grants a delegate needs, and grants the missing ones in one click

Clause-②: no
Metadata-protocol: none

A permission set's admin scope says what its holder may administer; it does not let the holder in. A delegate also needs the `setup.access` capability to enter Setup, read on `sys_user`, `sys_business_unit` and `sys_business_unit_member` so the lookups can pick people and units, and create, read, edit and delete on `sys_user_position` for the assignment rows. The scope block in the permission set editor now lists these five once the scope names a business unit, and marks each one as granted or not by the set being edited.

"Grant the missing ones" adds only what is missing to the same set, in one edit that the set's normal Save persists: `setup.access` joins `systemPermissions`, and each object row gains only the flags it lacks. No grant the set already carries is removed or narrowed, and no new key is written. Under a package (the Studio Access pillar) the list is shown without the action, with a note that these grants belong on an environment permission set in Setup: the package editor saves only the package's own objects.

What to do: nothing. A set's stored shape is unchanged.
