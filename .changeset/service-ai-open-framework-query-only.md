---
"@objectstack/service-ai": minor
---

feat(service-ai): open framework AI is query-only, declines app-building

The unified `data_chat` persona (ADR-0040) advertised that it can BUILD or
CHANGE the application, but that capability is supplied entirely by the cloud AI
Studio plugin's `metadata_authoring`/`solution_design` skills. On the open
single-env framework those skills are not registered, so the authoring tools
never resolve — yet the LLM, still reading the "you can build" persona,
role-played designing a whole system (emitting design docs it had no tools to
execute).

Fix: in `buildSystemMessages`, when no authoring (build-register) skill is
active, append a deployment-capability note constraining the assistant to
data/query and instructing it to decline build requests instead of pretending.
Keyed off actual skill presence, so cloud/EE (AI Studio loaded) keeps the full
build UX with zero extra wiring.
