---
"@objectstack/spec": minor
---

`KanbanConfigSchema` now declares `titleField` — optional `z.string()`, the key the board already reads and the schema refused by name (#16894).

`KanbanConfigSchema` is a `strictObject`, and it was the one item-titled view config of its family that omitted the key: `GalleryConfigSchema`, `TimelineConfigSchema`, `CalendarConfigSchema`, `GanttConfigSchema` and `ListMapConfigSchema` all declare `titleField` under the same name and the same `z.string()`. An author writing `kanban: { titleField: 'subject' }` — the spelling the renderer honours — was refused with `unrecognized_keys=["titleField"]`, while objectui's own mirror accepted it only by not looking. Declared here under the director seat's decision batch #87 (objectstack-ai/objectui#8367), confirmed by the maintainer verbatim 「批 #87 同意」.

**Clause-②: yes (widening)** — one new declared key on a published, strict accept set, so the set a consumer writes against grows. Nothing previously admitted is refused, and nothing is retired. Contract-review tier.

- **Optional, not required.** The shape is the one `CalendarConfigSchema` already writes down for this exact key: absence resolves through the ADR-0079 record display-name chain (`titleFormat` → `displayNameField` → type-aware derivation → `'Untitled'`), so requiring it would demand more than the renderer reads — the shape ruling #13748 forbids (「不要求超过渲染器真正需要的」). `TimelineConfigSchema` and `GanttConfigSchema` spell it required and are the two siblings this declaration deliberately does not copy.
- **No migration, no tombstone.** Nothing moves or is renamed: a board authored before this release parses unchanged, and `kanban.titleField` is simply no longer refused.
- **The generated projections move with it** — `authorable-surface/ui.json` gains `ui/KanbanConfig:titleField`, and the `ListView` / `ObjectListView` kanban shape lines in `content/docs/references/ui/view.mdx`, `content/docs/references/api/protocol.mdx` and `content/docs/references/data/object.mdx` gain `titleField?: string`.
