---
'@object-ui/app-shell': patch
---

fix(studio): the open object, its field properties and the Form canvas follow a draft the in-tab copilot saves or undoes

Clause-②: no
Metadata-protocol: none

The Studio Data pillar now re-reads the open object, its base-object extension and the Form tab's form view on the assistant bus's metadata-refresh pulse, which the in-tab copilot already sends as a drafted result lands and as its undo finishes. The open field properties (the draft chip, the copilot's values), the Form canvas and the header's own reading follow the server's draft without a page reload. A re-read on the pulse keeps the selected field open, and closes it only when the re-read no longer has that field. The pulse is held while any of those buffers carries an unsent edit or a save in flight, and released once that work is saved, so it never replaces the author's work. No focus refetch, polling or server push is added.
