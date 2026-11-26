---
'@objectstack/skills': patch
---

docs(skills): data hooks and actions teach the multi-reason refusal throw

Clause-②: no (published prose only; teaches the list throw already on main)
Metadata-protocol: none

`skills/objectstack-data/references/data-hooks.md` (Declared refusals) now teaches the list form beside the single `reason`: throw `reasons: [{ reason, params? }, …]`; each line is translated and filled from its own `params`; `userMessage` joins the lines and closes with the entry's `message`, filled from the throw's top-level `params` (else its holes render empty); every door answers `details.refusals`. It says how an entry declares `reasons` (a snake_case reason to `{ message }` only; another status needs another code), that every listed reason must be declared (refused at save when literal, a `500` at run), and that `reason` beside `reasons`, an empty list or a malformed element is a `500`. `skills/objectstack-ui/rules/actions.md` (Refusing by code) points an action's body at the same list. Both files sat at zero token headroom, so the words are paid for by tightening prose in the same file; no fact is removed (one redundant `condition` example and a sample field go).
