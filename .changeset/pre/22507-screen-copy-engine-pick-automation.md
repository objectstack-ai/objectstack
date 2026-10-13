---
"@objectstack/service-automation": minor
---

feat(automation): a screen's heading and body text render in the run's locale

Clause-②: yes (widening)

- **What is new.** The `screen` executor serves a screen's `title` and `description` in the language of the person who started the run. For each, it asks the engine for the translated template at `flows.<flow>.screens.<node_id>.title` / `.description` through the `i18n` service, in `AutomationContext.locale`, and fills the `{{ }}` holes of that template. This is the same pick a refusing `end` node's message already makes, through the same channel (`setI18nServiceSource`).
- **When the authored text renders.** With no locale on the run (a record-change, schedule or webhook trigger), no `i18n` service, no entry or an empty one, or a translation that does not compile, the authored template renders as before. A translation that does not compile also logs a `warn` naming the key. A resumed leg renders in the locale the run was started in.
- **The heading key covers the node label.** A screen with no `config.title` shows its node label, and a translated `title` replaces whichever heading the screen shows. The body text is translated only where the screen authors one.
- **`AutomationEngine.renderFlowTextSlot(slot, variables, context)`** is the one translated-template pick, now shared by the refusing `end` node and the `screen` executor. Its argument type, `FlowTextSlotTranslation`, is exported.
