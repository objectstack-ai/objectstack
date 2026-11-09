---
'@objectstack/skills': patch
---

docs(skills): `objectstack-ui` no longer says `page:header`'s `placedActions: true` is not drawn, and an eval exercises it (#29951)

Clause-②: no
Metadata-protocol: none

- `rules/pages.md`: the component catalogue's `page:header` row says `placedActions: true` draws every placed action, read live. The console's header renderer reads the key since #29951's ui half, so the "not drawn yet" qualifier #30018 wrote is dropped.
- `evals/record-page.json`: a third case asks for a custom full record page whose header shows every action packages place on the object; the expected answer keeps the page and its tab strip and sets `placedActions: true` on the `page:header` node, with no `actions` id list beside it.
