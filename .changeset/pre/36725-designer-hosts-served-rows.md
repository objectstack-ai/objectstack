---
'@object-ui/app-shell': patch
---

fix(studio): the hook designer and a global action opened from an app nav leaf draw refusals and texts with their served rows

Clause-②: no
Metadata-protocol: none

The served `hook` and `action` forms give `refusals` and `texts` the key-only record control (an entry is drawn under its code or key, with its own rows) and help text. Two Studio hosts did not hand that form to the designer they mount: the object's Hooks view gave the hook designer the schema only, so both keys read as the raw JSON editor in "More fields"; and the Interfaces rail, opening a global action from an app nav leaf, gave the action designer neither schema nor form, so it drew no "More fields" and neither row at all.

The hook designer now takes the served form (`serverForm`) and draws the two rows from it in its Function section, beside the handler body, the way the action designer does; the Hooks view passes the served `hook` form, and the Interfaces rail passes the served `action` schema and form to the action designer. A host with no served form keeps both keys in "More fields", as before. Nothing about what a hook or an action stores, or what the server accepts, changes.
