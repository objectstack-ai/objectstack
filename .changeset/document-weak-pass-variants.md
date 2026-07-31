---
---

docs(ui,protocol): document the six navigation / knowledge-source variants that the #4177 variant/doc gate was only ever name-checking. `apps.mdx` enumerated nine navigation item types but gave `report`, `action` and `component` a single shared sentence instead of sections; `knowledge.mdx` named `object` / `file` / `http` in a table with no example of any, leaving the per-kind keys undocumented. Each example was parsed against the real schema (`NavigationItemSchema`, `KnowledgeSourceKindSchema`) before landing. Documentation only; releases nothing.
