---
'@object-ui/console': patch
---

fix(console): a domain-bearing settings select shows the option name for a stored code

Clause-②: no
Metadata-protocol: none

A settings `select` that declares a `valueDomain` (Company → Country, Localization → Default country, Time zone, Currency) showed its stored value bare in the box, so a stored `DE` read as `DE` and the option names were visible only in the suggestion list. The box now shows the matching option's name ("Germany (DE)") and the suggestions are offered by name; picking one still stores its code. A code typed by hand is committed as typed and reads as its name once the field loses focus, and a value outside the option list is still committed verbatim and judged by the server, as before.
