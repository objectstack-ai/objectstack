---
'@objectstack/service-record-context': patch
---

fix(service-record-context): `get_record_context` states nothing for a `related` object the stack does not define

Clause-②: no
Metadata-protocol: none

A context pack whose `related` entry names an object no package and no environment defines (a misspelt name, or a package removed after the pack was written) is an author defect: `os validate` reports it (`ai-context-object-unknown`), and ADR-0160 D1 says the tool answer says nothing about it. Until now the section was left out and every caller was told "Some of the material this pack covers is not visible to you", which reads as a permission narrowing nobody configured.

The section is still left out. The not-visible statement now fires only when the stack publishes the object and this caller is not served it, as it did before for a defined child. The judgement reads the published definition, which is the same for every caller, so the answer for one caller reveals nothing about another caller's access: two callers get the same bytes for a pack with an undefined `related` object, on the `/mcp` door and the stdio door alike. Nothing of the published definition is carried in the answer.
