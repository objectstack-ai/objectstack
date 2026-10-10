---
"@objectstack/spec": minor
---

feat(i18n): a screen's body text has a translation key, and a screen's heading and body text are translated by the engine in the run's locale (`flows.<flow>.screens.<node_id>.description`)

Clause-②: yes (widening)

- **What is new.** A fully translated screen flow no longer has to keep a screen's body text in the source language. Translate it under `flows.<flow_name>.screens.<node_id>.description`, beside the heading's `flows.<flow_name>.screens.<node_id>.title`, whose address does not change.
- **A translation is a template.** A screen's `title` and `description` are `{{ }}` templates rendered for each run, so a translation keeps the holes of the text it translates: `description: '任务“{{ subject }}”创建成功！'` for `'Task "{{ subject }}" created successfully!'`. The schema judges a translated `description` with the same text-slot rule the source text gets, so a single-brace `{subject}` is refused with the `{{ subject }}` spelling. An empty string is accepted: it is the untranslated slot `os i18n extract` writes.
- **The body text translates only where the screen authors one.** A bundle cannot add body text to a screen that declares no `config.description`.
- **Who translates it.** The automation engine, not the console. It picks the translated template in the locale of the person who started the run and then fills the holes, so the screen a paused run serves is already translated. `ScreenSpec.title` and `ScreenSpec.description` now document that a client draws them as served and never overlays a translation on them.
- **`flowScreenCopyKey(flowName, nodeId, key)`** (`@objectstack/spec/system`) spells the key the engine reads, beside `flowRefusalMessageKey`. `FLOW_SCREEN_COPY_KEYS` is now `['title', 'description']`, and `translateFlow` overlays a translated `description` on a flow document where the screen authors one.
- **`resolveFlowScreenTitle` is not for a served screen.** A served `ScreenSpec.title` is already translated and filled, so overlaying the resolver's answer on it would draw the template's holes as literal text. The console stops calling it in a following release, and the function retires after that.
- A translated screen `title` is not judged by the text-slot rule yet, so a single-brace token in it is drawn as literal text, as it was before.
