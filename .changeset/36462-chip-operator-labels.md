---
'@object-ui/plugin-list': patch
---

fix(plugin-list): a condition chip names an operator only the advanced filter panel writes in that panel's own words, never by its id

Clause-②: no
Metadata-protocol: none

A list or drill dialog whose conditions carry `is_not_null`, `is_null`, `greater_than`, `less_than`, `not_equals`, `icontains` or `ends_with` used to show the operator id on its chip ("Deal Value: is_not_null"). The chip, and the quick filter's operator choice, now read the advanced panel's word for it in every language ("Deal Value: Is not null", "金额：不为 null"). Any other operator spelling the chip cannot word is shown as "Condition" instead of its id; a view filter's comparison symbol (`>=`, `=`) still reads as written. A chip with no value no longer ends in a space.
