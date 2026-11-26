---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(console): New Package offers "Also create an app", ticked by default

Clause-②: no
Metadata-protocol: none

The New Package dialog (Setup → Packages, the console's "New blank app" entries that open it, and the resource list's create-a-package-first prompt) now has a checkbox, "Also create an app" (zh: 同时创建应用), ticked each time the dialog opens.

- Ticked: one confirm creates the package and an app with the same name, live at once. The success toast reads "Created package “NAME” and its app." (zh: 已创建软件包「NAME」及其应用。), and Studio's header names the app when you land there. If the app's identifier is already taken, nothing is written and the dialog says which app holds it; change the namespace under Advanced, or untick the box. If the package is created but its app cannot go live, a toast says so and Studio's Create app is the way to try again.
- Unticked: only the package is created, exactly as before, for a package that only holds objects or flows for other packages.

Where the dialog takes you afterwards is unchanged. Packages created before this change, installed packages and other app-less packages still show the package name in Studio's header.

New locale keys in the studio catalogue (en, zh): `engine.packages.create.alsoApp`, `engine.packages.create.alsoAppHint`, `engine.packages.create.createdWithApp`. No key is removed. `PackageFormDialog`'s `newApp` prop now adds the checkbox to the create-package dialog instead of rewording the dialog for an app; no other props or exports change.
