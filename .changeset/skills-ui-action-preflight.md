---
'@objectstack/skills': patch
---

docs(skills): objectstack-ui teaches the action `preflight` read

Clause-②: no
Metadata-protocol: none

- `skills/objectstack-ui/rules/actions.md` gains one bullet beside `submitText`: `preflight` sends one same-origin `GET` before submit and shows the answer above the params, with its shape, the three holes it accepts, `fields` rows as in `resultDialog.fields`, `seed` filling a read-only param (seeded once, no default or carry-over, read by no hole), and where it is refused (no `params`, `execution: 'aggregate'`).
- The `views-apps-actions-pages` eval gains a case for a param dialog that reads a plan before submit and submits its token through `seed`.
- Nothing to do on upgrade: the key is already accepted and drawn by the console; this only teaches it.
