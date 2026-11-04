---
'@objectstack/spec': minor
'@objectstack/skills': minor
---

feat(spec): a `page:header` declares `placedActions: true`, the explicit opt-in to draw every action of the bound object placed at `record_header` / `record_more`, read live (#30018)

Clause-②: yes (widening)
Metadata-protocol: added

- **`placedActions`** on a `page:header` component's `properties` (`PageHeaderProps`, the `ComponentPropsMap['page:header']` row): `true` asks the header to draw every action of the page's object whose `locations` include `record_header` or `record_more`, read live from the object's metadata, in place of an authored `actions` id list. An action another package places on the object is then drawn without editing the page. Optional with no default: an unset key stays unset in the parsed output.
- **The `actions` list keeps its meaning.** An authored list is the whole set the header draws, and a header with neither `actions` nor `placedActions: true` draws none of the object's actions. `placedActions: false` beside a list is accepted and changes nothing.
- **Refused together.** `placedActions: true` beside an authored `actions` list, an empty one included, is refused at `properties.placedActions` by `os validate`, `os build`, `os lint` and the page save door (`component-props-invalid`, an error). The message names both keys and asks the author to keep one: `actions` for a curated list that is the whole set, or `placedActions: true` for every placed action. Nothing that parsed before is refused: until this release `placedActions` was an unknown key on the closed shape.
- **Declared ahead of its reader.** The console's header renderer does not read the key yet, so a header that sets it draws what the same header without it draws (none of the object's actions unless `actions` names them). The key's describe opens with `[PLANNED — not yet rendered]` until the renderer reads it.
- The published JSON Schema `ui/PageHeaderProps` still accepts the pair: the rule depends on the value `true`, which no projected refinement pattern states, so the parse refuses it and `dropped-refinements.baseline.json` records the site.
- `@objectstack/skills`: `objectstack-ui` `rules/pages.md` names the key in the component catalogue, marked not drawn yet, and drops a refused-shape clause from the print-page paragraph that the sentence before it already states.
