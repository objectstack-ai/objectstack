---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(app-shell): the permission-set pages send the holder's package to the grant, clone and activation doors

Clause-②: yes
Metadata-protocol: none

A permission set is identified by `(package, name)` (objectstack ADR-0150 D4). When more than one package holds a name, the server refuses a request that names only the set, with `409 RESOURCE_CONFLICT` and every holder in `details.candidates`. The Setup and Studio pages used to address the set by its name alone, so they could not reach such a set.

- **Activation.** Where the environment-scope list serves more than one holder of a name, each holder's row reads its own state from the activation ledger. The row follows core's `ledgerRowHolders` rule, so a row naming no package can keep every holder off. The row's switch writes through `POST /security/_activation/permission/:name?package=PKG`. The item page's switch, which addresses the set by its name, shows the door's refusal as a pick among the holders it names.
- **Grants.** Setup → Permission set assignment lists one entry per holder, with the holder said beside it, and the picked holder's package goes in the link as `?package=`. `AssignedUsersSection` keeps the grants and positions that the resolver reads as that holder's: a grant by its `permission_set_package`, a position from the package that declared it. Add writes `permission_set_package`.
- **Clone.** `PermissionSetCloneDialog` takes the source's package (`sourcePackage`) and names it as `?package=`. A refusal that names the holders is shown as a pick.
- **Deactivation confirm.** It counts the people who hold the switched holder's set. A position served under a package that holds the name counts for the environment's own set too: the server reads an overlay or `.custom` override of a package's position as the environment's reference, and serves it under the package's id, so the confirm never says fewer people than lose access.
- **Editor.** In the environment scope, the permission-set editor draws its Assigned users section and its active switch for the holder it shows: the package its read named, else the environment's own set. Its link to Setup names that package. Where two packages hold the name and the read named neither, the server refuses the read, and the editor draws neither section.

A pick shows the server's sentence and one button per holder it named. Choosing a holder sends the request again for that holder: a package by `?package=`, the environment's own set by its name alone. ⛔ Nothing is chosen for the administrator, by order or otherwise. A name with one holder, and the environment's own set, are read and written by the name as before, so their requests and screens are unchanged. The pick is built from `@object-ui/components`' `AlertDialog` and `Button` only.

`@object-ui/i18n` adds the pick's copy to the studio namespace (`perm.holder.pick.*`, en and zh) and the holder labels `setupAssignments.setsHolderPackage` / `setsHolderEnvironment` in every Setup locale.
