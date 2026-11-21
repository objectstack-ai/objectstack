---
'@object-ui/console': patch
---

fix(console): full-height edge drawers have square corners

Clause-②: no
Metadata-protocol: none

- The console stylesheet gave every dialog surface a 1.25rem corner radius, which also rounded the left and right drawers (the notification center, the record drawer, the side form drawer and every other full-height Sheet). Those drawers sit against the top, side and bottom of the window, so the rounding showed as a notch at their inner corners. The rule now skips full-height edge sheets; they render with square corners. Centred dialogs and bottom sheets keep the rounded corners. Drawer width, animation and content are unchanged.
