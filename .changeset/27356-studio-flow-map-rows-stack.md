---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(studio): a flow node's key / value map puts each field name on its own line, so the name is readable

Clause-②: no
Metadata-protocol: none

- **Before.** In the flow inspector, each row of a key / value map (a Create Record or Update Record node's field values, an HTTP node's headers, an assignment's variables) put the key box, the value box and up to two buttons on one line. In the 300 px inspector the key box showed about nine characters, so a field name read "subj" or "dueD".
- **Now.** A row stacks: the key on its own line beside the remove button, the value on the line under it beside the text / expression toggle where the map has one. The same field name shows about 24 characters. Nothing about what the map stores changes.
