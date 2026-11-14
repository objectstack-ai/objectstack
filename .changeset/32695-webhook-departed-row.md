---
'@objectstack/plugin-webhooks': patch
'@objectstack/cli': patch
---

fix(plugin-webhooks, cli): an activation row a departed package left switches no remaining webhook holder, and the 18.x ownership ceremony writes a two-holder copy's switch as a row naming no package instead of picking one holder (ADR-0150 D8)

Clause-②: no
Metadata-protocol: none

**A departed package's activation row (plugin-webhooks).** A declared webhook's slot with no activation row of its own read the name's rows naming a package that no longer declares the name as its switch while the name had one holder, and under two holders such a row switched off kept both off. Such a row was the departed package's switch, and it now switches no remaining holder, in either direction:

- one holder, a departed package's row switched off: FROM the holder off TO the holder at its own row, else its declared `isActive`;
- one holder shipped inactive, a departed package's row switched on: FROM the holder on TO the holder off (its declared default);
- two holders, a departed package's row switched off: FROM both off TO each at its own row or its declared default.

The source says so once per name at `warn`, naming the departed package, the holders and the per-holder address (`POST /api/v1/security/_activation/webhook/NAME?package=PACKAGE`). A row naming no package is read exactly as before: the one holder's switch, and under two holders off keeps every holder with no row of its own off and on turns none on. A holder's own row still wins.

**The 18.x ownership ceremony's declared-webhooks step (cli).** A customized `sys_webhook` copy writes the declaration's activation row. When the copy's definition names no package, the row named the holder the composition listed LAST for the name. Of a name one holder declares it still names that holder; of a name two or more holders declare it now names no package — the name-keyed switch the copy was — and the step's notes name every holder and the per-holder address. A copy whose definition names its package writes that package's row, as before.
