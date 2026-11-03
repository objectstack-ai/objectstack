---
'create-objectstack': patch
---

fix(create-objectstack): the scaffolded AGENTS.md lists only the `src/` directories the project's `objectstack.config.ts` loads

Clause-②: no
Metadata-protocol: none

The "Project Structure" block of the `AGENTS.md` a new project gets named `src/reports/`, `src/agents/`, `src/i18n/` and `src/handlers/`, which the scaffolded `objectstack.config.ts` never imports, so metadata a coding agent wrote there was never loaded and `npm run validate` still passed. It left out `src/skills/` and `src/picklists/`, which the config does load. The block now lists exactly the eight wired directories (objects, views, actions, flows, dashboards, apps, skills, picklists) and says that a new `src/` directory is never loaded or validated until its barrel is imported in `objectstack.config.ts`. What the config loads is unchanged.

An existing project keeps the `AGENTS.md` it was created with; to adopt the fix, edit its Project Structure block to match the directories its own `objectstack.config.ts` imports.
