---
'@objectstack/lint': patch
---

feat(lint): warn when a select option `color` renders neutral on the option badge

Clause-②: no
Metadata-protocol: none

A new warning, `field/option-color-renders-neutral`. An option is coloured only by the colour its author declares, and the option badge paints exactly two spellings: one of the nine palette families (`gray`, `red`, `orange`, `yellow`, `green`, `blue`, `indigo`, `purple`, `pink`, lowercase) or a `#rgb` / `#rrggbb` hex. Any other declared colour (`teal`, `amber`, `Red`, `rgb(…)`, `#rrggbbaa`, a hex with no `#`) rendered neutral grey with no signal. It now draws a warning naming the option and a fix line: the lowercase family or the `#`-prefixed / alpha-free hex when the value points at one, otherwise the families and the hex form.

It runs on `os validate`, `os build` and `os lint` over object fields, object-extension fields, picklists and picklist extensions, and at the metadata save door on `object` and `object_extension` writes, where it rides back as an advisory. Nothing is refused: `SelectOption.color` still accepts any string, and charts and gantt bars still paint a CSS colour name. `os lint --strict` fails on it, as on every warning. `os explain field/option-color-renders-neutral` gives the per-surface reading. Published from the root entry: `FIELD_OPTION_COLOR_RENDERS_NEUTRAL`, `OPTION_COLOR_FAMILIES`, `isBadgePaintableOptionColor`, `lintOptionColors` and the type `OptionColorPicklist`.
