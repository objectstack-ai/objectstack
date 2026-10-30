---
'@object-ui/app-shell': patch
'@object-ui/plugin-gantt': patch
---

fix(app-shell, plugin-gantt): the home launcher tile draws the app's branding, and a gantt's name column is headed by its object

Clause-②: no
Metadata-protocol: none

The console home's app tiles (and the `app:launcher` block, which draws the same strip) now follow the app's declared branding, the way the top-bar app pill and the app switcher already do: the `branding.logo` image when one is declared, else the app's icon on its `branding.primaryColor` when that is a hex, else the icon on the name-keyed gradient as before. A logo that fails to load falls back to the tile.

A gantt bound to an object now heads its task list's name column with that object's label (translated like every other surface that names the object), so a campaign gantt reads "Campaign" rather than "Task Name". An inline data set, an object that declares no label, and a mixed-object tree (`objectField`) keep the generic heading.
