---
'@objectstack/spec': patch
---

The spec's objectui citations, and the shipped description text that names the `.objectui-sha` pin (the `FormField.span` describe and six migration-entry descriptions), are re-measured against the new console pin, objectui `db11afd4967c`.

Clause-②: no

One claim was falsified rather than moved: `ObjectMapConfigSchema` is `.strict()` at the new pin (objectui#5157), so the `ListMapConfigSchema` record now says the renderer's schema warns on an undeclared key instead of parsing it clean. No key, default, enum member or export moves.
