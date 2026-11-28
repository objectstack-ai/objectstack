---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(console): creating a package answers with a toast naming the new package

Clause-②: no
Metadata-protocol: none

Creating a package (Studio's *New app*, the Studio package switcher's *New package*, and the Packages page) closed the dialog and moved on with nothing on screen saying the write landed. The create dialog now shows a success toast naming the new package by its display name: "Created package “NAME”." (zh: 已创建软件包「NAME」。). A refused create shows no toast and keeps its message in the dialog, as before; saving an edit is unchanged.

New locale key: `engine.packages.create.created` in the studio catalogue (en, zh). No props or exports change.

Revoke on a granted suggested binding in Studio Access already answers with its toast ("“SET” is no longer granted by default."); a new pin on the Studio mount holds it.
