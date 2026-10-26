---
"@object-ui/app-shell": patch
"@object-ui/auth": patch
"@object-ui/cli": patch
"@object-ui/collaboration": patch
"@object-ui/components": patch
"@object-ui/console": patch
"@object-ui/fields": patch
"@object-ui/i18n": patch
"@object-ui/layout": patch
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
"@object-ui/plugin-gantt": patch
"@object-ui/plugin-kanban": patch
"@object-ui/plugin-list": patch
"@object-ui/plugin-map": patch
"@object-ui/plugin-markdown": patch
"@object-ui/plugin-report": patch
"@object-ui/plugin-timeline": patch
"@object-ui/plugin-tree": patch
"@object-ui/providers": patch
"@object-ui/react": patch
---

Clause-②: no
Metadata-protocol: none

One react line: every manifest that pins `react` / `react-dom` now pins 19.3.0, and every `@types/react` / `@types/react-dom` pin is 19.3.0, matching the root `pnpm.overrides`. The objectstack monorepo's `@objectstack/client-react` requires react `^19.3.0`, and a second `@types/react` copy broke `@object-ui/plugin-view`'s declaration build in the merged tree. The CLI's scaffold (`REACT_RANGE` and the shared dev-dependency map in `scaffold-dependencies.ts`) quotes the same pins, as its anchor test requires.
