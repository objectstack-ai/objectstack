---
'@objectstack/skills': patch
---

docs(skills): an agent's model name is optional

Clause-②: no
Metadata-protocol: none

`skills/objectstack-ai/SKILL.md` (Model Configuration) now teaches that `model.model` is optional, and that an agent without one runs on the host's default model for the environment. It no longer says `model.provider` defaults to `openai`; the key itself leaves the page in the same release (see the changeset on the skill no longer teaching `model.provider`). The `objectstack-ai` eval case on sampling settings accepts an omitted `model`. Published prose only: it teaches the optional `model` already on main since #37697. The file sat at zero token headroom, so the words are paid for by tightening the same section; no fact is removed.
