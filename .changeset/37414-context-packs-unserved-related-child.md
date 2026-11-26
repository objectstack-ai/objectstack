---
'@objectstack/skills': patch
---

docs(skills): objectstack-ai's context-pack reference says a related object the caller cannot read is left out, and names what still refuses the call

Clause-②: no
Metadata-protocol: none

`skills/objectstack-ai/references/context-packs.md` taught that a `related` object the caller cannot read refuses the whole `get_record_context` call. The tool leaves that list out instead and says so with the one `not_visible` note, which names nothing. The reference now says that, and names what does refuse the whole call with `403 PERMISSION_DENIED`: a `related` object nobody is served (a system object the record tools refuse, one closed to API list reads, or one in a disabled package), and a lookup shown to the caller whose target is such a system object. Text only; restatement elsewhere in the file is cut to pay for it.
