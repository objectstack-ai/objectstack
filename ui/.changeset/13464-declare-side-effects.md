---
"@object-ui/auth": patch
"@object-ui/cli": patch
"@object-ui/collaboration": patch
"@object-ui/create-plugin": patch
"@object-ui/data-objectstack": patch
"@object-ui/mobile": patch
"@object-ui/permissions": patch
"@object-ui/plugin-ai": patch
"@object-ui/plugin-calendar": patch
"@object-ui/plugin-charts": patch
"@object-ui/plugin-chatbot": patch
"@object-ui/plugin-dashboard": patch
"@object-ui/plugin-designer": patch
"@object-ui/plugin-detail": patch
"@object-ui/plugin-editor": patch
"@object-ui/plugin-form": patch
"@object-ui/plugin-gantt": patch
"@object-ui/plugin-grid": patch
"@object-ui/plugin-kanban": patch
"@object-ui/plugin-list": patch
"@object-ui/plugin-map": patch
"@object-ui/plugin-markdown": patch
"@object-ui/plugin-report": patch
"@object-ui/plugin-timeline": patch
"@object-ui/plugin-tree": patch
"@object-ui/plugin-view": patch
"@object-ui/providers": patch
"@object-ui/react": patch
---

Clause-②: no
Metadata-protocol: none

Every published package now declares `sideEffects`, so a host that bundles `@object-ui/*` can tree-shake the ones that do nothing on import. `@object-ui/react`, `auth`, `collaboration`, `data-objectstack`, `mobile`, `permissions` and `providers` declare `false`: no module in them registers, imports CSS or writes a global when it loads. Every `plugin-*` package except `plugin-ai`, `plugin-chatbot`, `plugin-dashboard` and `plugin-grid` declares an array naming exactly its entry forms and the modules that register components at load time, so `import '@object-ui/plugin-x'` still registers everything it did before. `plugin-ai`, `plugin-chatbot`, `plugin-dashboard`, `plugin-grid`, `cli`, `create-plugin` and `runner` declare `true` (objectui#13464).
