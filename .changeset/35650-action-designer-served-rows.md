---
'@object-ui/app-shell': patch
---

fix(studio): the action designer draws a script action's refusal catalogue and declared texts with their served rows

Clause-②: no
Metadata-protocol: none

The served `action` form gives `refusals` and `texts` the key-only record control (an entry is drawn under its code or key, with its message, status, reasons and params rows) and help text, but only the Related drawer editor read that form. The action's full-page editor and the Studio object's Actions view mount the action designer, whose "More fields" section was handed the bare schema, so both keys read as the raw JSON editor.

The designer now takes the served form from its host (`serverForm` on the default-inspector props) and draws the two rows from it in its Behavior section, beside the script body; the row's own visibility rule shows them on a script action only. A host with no served form keeps both keys in "More fields", as before. Nothing about what an action stores or what the server accepts changes.

The console's zh-CN overlay gains the labels for the action's `refusals` and `texts` rows and the hook's `texts` rows.
