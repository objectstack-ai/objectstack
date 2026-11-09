---
'@objectstack/platform-objects': patch
---

fix(platform-objects): Create User's permission set is picked from a list of the permission sets, by label, instead of typed as a machine name (#30117)

Clause-②: no
Metadata-protocol: none

The optional Permission Set on Setup's Create User dialog was an empty text box that accepted only a set's machine name, while everything else in Setup shows sets by their labels. Typing the label the administrator could see was refused. The `create_user` action's `permissionSet` param now declares `widget: 'permission-ref'`, so the dialog draws the permission-set picker the grant column itself uses: a searchable list of the permission sets, each shown by its label, that submits the chosen set's name. The value is still a set's name, and the endpoint and the grant are unchanged.
