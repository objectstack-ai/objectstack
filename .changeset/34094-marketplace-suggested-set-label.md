---
'@object-ui/app-shell': patch
---

fix(console): the Marketplace package page names a suggested binding's permission set by its label

Clause-②: no
Metadata-protocol: none

After a package that suggests a default audience binding is installed, the Marketplace package page shows "this app suggests granting SET to Everyone" with Grant and Dismiss, and later the accepted line with Revoke. Its prompt, its state lines and its Grant, Dismiss, Revoke and Reopen toasts named the permission set by its machine name (`crm_user`). They now name it by its label (`CRM user`), read from the package's own permission sets as this runtime serves them (`list('permission', { packageId })`, the read the Studio Access rail makes). A set with no label, or a read that is refused or fails, names the set by its machine name, with no error shown.

The Studio Access mount of the same banner and this page now draw the name through one shared helper, `suggestedSetLabel` (`components/suggestedSetLabel.ts`), so the two mounts cannot name the same set differently. No locale keys, props or exports change.
