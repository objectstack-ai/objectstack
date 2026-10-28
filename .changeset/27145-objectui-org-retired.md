---
'@objectstack/skills': patch
'@object-ui/console': patch
'@object-ui/auth': patch
'@object-ui/cli': patch
'@object-ui/collaboration': patch
'@object-ui/components': patch
'@object-ui/core': patch
'@object-ui/create-plugin': patch
'@object-ui/data-objectstack': patch
'@object-ui/fields': patch
'@object-ui/i18n': patch
'@object-ui/layout': patch
'@object-ui/mobile': patch
'@object-ui/permissions': patch
'@object-ui/plugin-ai': patch
'@object-ui/plugin-calendar': patch
'@object-ui/plugin-charts': patch
'@object-ui/plugin-chatbot': patch
'@object-ui/plugin-dashboard': patch
'@object-ui/plugin-designer': patch
'@object-ui/plugin-detail': patch
'@object-ui/plugin-editor': patch
'@object-ui/plugin-form': patch
'@object-ui/plugin-gantt': patch
'@object-ui/plugin-grid': patch
'@object-ui/plugin-kanban': patch
'@object-ui/plugin-list': patch
'@object-ui/plugin-map': patch
'@object-ui/plugin-markdown': patch
'@object-ui/plugin-report': patch
'@object-ui/plugin-timeline': patch
'@object-ui/plugin-tree': patch
'@object-ui/plugin-view': patch
'@object-ui/providers': patch
'@object-ui/react': patch
'@object-ui/react-runtime': patch
'@object-ui/types': patch
---

docs(ui): package homepages and README links point at objectstack.ai/docs; objectui.org is retired

Clause-②: no
Metadata-protocol: none

The ObjectUI documentation site at objectui.org is retired. Its pages now live in the ObjectStack docs, mostly under [User Interface](https://objectstack.ai/docs/frontend). Every `@object-ui/*` package's `homepage` and README links now go to the matching page there, and the old objectui.org addresses answer with a permanent redirect to the same page. The `description` fields spell the product name "ObjectUI". The `@objectstack/skills` bundle's ObjectUI skill links to the same pages. Nothing else changes in what these packages ship.
