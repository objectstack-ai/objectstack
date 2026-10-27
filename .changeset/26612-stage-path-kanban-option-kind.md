---
'@object-ui/plugin-detail': patch
'@object-ui/plugin-kanban': patch
---

fix(ui): the stage path and the kanban lay a select's options out by their declared lifecycle `kind` (#26612)

Clause-②: no
Metadata-protocol: none

A select option may declare `kind: 'open' | 'won' | 'lost'` (`SelectOption.kind` in `@objectstack/spec`). Two readers now follow it instead of the option order or the value's spelling.

- **`record:path`.** Once the status field declares a kind on any option, an option without one reads as `open`, the spec's rule for an absent kind, and is never classified from a `closed_won` / `closed_lost` spelling. The stages are laid out by kind: the open options as the steps in their authored order, then every won option as the forward terminus, then the lost options apart from the rail. A lost option authored mid-list no longer pulls the options after it into the lost group. A field that declares no kind keeps the spelling fallback and its positional layout as before, and a dev build now warns once, naming the object, the field and the stages it guessed.
- **Kanban.** Lanes the board derives from the lane field's options run open → won → lost when the field declares a kind, each class in its authored order, and every lost lane starts collapsed: a spine with its card count that the viewer can open. Authored `columns` and fields that declare no kind keep their order; the board guesses nothing from spelling.
