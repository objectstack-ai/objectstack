---
'@object-ui/app-shell': patch
'@object-ui/data-objectstack': patch
---

fix(console): Set as Default over a view a package ships leaves one default view

Clause-②: no
Metadata-protocol: none

**Set as Default.** When the previous default list view was one a read-only package ships (the showcase's All Tasks, an installed app's view), Set as Default on another view left the object with two default views. Clearing the shipped view's default was refused by the server, since a write naming no package is closed on an item a read-only package ships, but the new default was written beside it in the same click. The clear now lands, and Manage views writes one view at a time, clearing the previous defaults first and setting the new one last: a refused clear stops the click, says the server's reason, and leaves the new view not made the default.

**Editing a shipped view's row state.** `updateView` on `@object-ui/data-objectstack` now writes a view a read-only package ships into that package's customization pair (`BASE.custom`, `?package=`), declaring `overrides: { package, basedOn }`, as the server's refusal prescribes. The pair is the one `POST /packages/BASE/ensure-customization` answers, which creates it on first use, and `basedOn` is the version the view's customization already declares, else the package's own version. This covers every row-state write the console sends through `updateView`: the default flag, a pin and a rename. A view no package ships, and a view a writable package ships, are written exactly as before. When the pair cannot be had (the ensure door refuses the caller, or the package records no version), nothing is written and the refusal reaches the caller.
