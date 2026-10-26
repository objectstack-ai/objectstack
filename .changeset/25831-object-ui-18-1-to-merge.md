---
"@object-ui/app-shell": minor
"@object-ui/auth": minor
"@object-ui/cli": minor
"@object-ui/collaboration": minor
"@object-ui/components": minor
"@object-ui/console": minor
"@object-ui/core": minor
"@object-ui/create-plugin": minor
"@object-ui/data-objectstack": minor
"@object-ui/fields": minor
"@object-ui/i18n": minor
"@object-ui/layout": minor
"@object-ui/mobile": minor
"@object-ui/permissions": minor
"@object-ui/plugin-ai": minor
"@object-ui/plugin-calendar": minor
"@object-ui/plugin-charts": minor
"@object-ui/plugin-chatbot": minor
"@object-ui/plugin-dashboard": minor
"@object-ui/plugin-designer": minor
"@object-ui/plugin-detail": minor
"@object-ui/plugin-editor": minor
"@object-ui/plugin-form": minor
"@object-ui/plugin-gantt": minor
"@object-ui/plugin-grid": minor
"@object-ui/plugin-kanban": minor
"@object-ui/plugin-list": minor
"@object-ui/plugin-map": minor
"@object-ui/plugin-markdown": minor
"@object-ui/plugin-report": minor
"@object-ui/plugin-timeline": minor
"@object-ui/plugin-tree": minor
"@object-ui/plugin-view": minor
"@object-ui/providers": minor
"@object-ui/react": minor
"@object-ui/react-runtime": minor
"@object-ui/sdui-parser": minor
"@object-ui/types": minor
---

**BREAKING** Object UI's changes from its 18.1.0 release to the day it moved into this repository, released here as one entry. They are objectui commits `a3c0da9`..`9e1fe03`, the release commit to the freeze. Their 65 changesets came across with the code under `ui/.changeset/`, which `changeset version` does not read, so this entry carries them into the release. Each of those 65 files stays in `ui/.changeset/` unchanged, as the full record of its change. Five of the changes are breaking retirements; each has a paragraph below and points at the file that holds its migration table.

<!-- adr-0087: not-required (no-migration-prescription) The five retirements below shipped in objectui before it merged into this repository, and each one is an `@object-ui/*` surface: a renderer node type and its schema (`html`), a widget source member (`module`), exports nothing read, three providers that duplicated `@object-ui/react` and `@object-ui/app-shell` names, and nine `@object-ui/types` schema keys. None is an `@objectstack/spec` key, object definition or stored shape, so the ADR-0087 registries in `packages/spec` have no entry to write and `objectstack migrate meta` has nothing to rewrite. objectui had no conversion registry; each old spelling is refused by name, at validation or by the compiler, and each change ships its own migration in the original changeset this entry points to, which is why this entry does not restate them (maintainer ruling 28 = B on objectstack#25831). -->

### The raw-HTML `html` node type is retired (objectui#13449, PR #13475)

`@object-ui/components` no longer registers `html` or `ui:html`, `@object-ui/core` drops it from the public blocks, and `@object-ui/types` no longer exports `HtmlSchema`. Its renderer wrote the authored string into the page with no sanitiser. A page that still names the node draws the unknown-component panel, and `objectui validate` refuses `type: "html"` by name. The `html` field type is a different layer and stays. Migration: `ui/.changeset/13449-retire-html-renderer.md`.

### The `module` widget source is retired (objectui#13450, PR #13473)

`WidgetRegistry` no longer loads a widget's code from a URL at runtime, and `@object-ui/types` no longer exports `WidgetSourceModule`. That loader was a runtime dynamic import and needed `unsafe-eval` under a strict content security policy. A manifest that still declares the `module` source is refused before anything is fetched, with a message that names both replacement sources. Migration: `ui/.changeset/13450-retire-widget-module-source.md`.

### Nine zero-consumer modules are retired and the runner is private (objectui#13453 part 1, PR #13506)

`@object-ui/core` drops the fluent schema builders and the drag-and-drop, keyboard and sharing protocol bridges. `@object-ui/react` drops `useFocusTrap`, `useFocusReturn`, `useRovingFocus`, `usePageTransition`, `useSchemaPersistence` and `createLocalStorageAdapter`. `@object-ui/collaboration` drops `LiveCursors`. The test-only reset helpers are no longer on the package roots of `@object-ui/core`, `@object-ui/app-shell`, `@object-ui/types` and `@object-ui/plugin-detail`. Nothing in ObjectUI read any of them. `@object-ui/runner` is now private. Details: `ui/.changeset/13453-core-retire-dead-modules.md`, `13453-react-retire-dead-hooks.md`, `13453-collaboration-retire-live-cursors.md` and `13453-test-helpers-off-barrels.md`.

### The providers trio is retired (objectui#13453 part 2, PR #13507)

`@object-ui/providers` no longer exports `DataSourceProvider` / `useDataSource`, `MetadataProvider` / `useMetadata` or `ThemeProvider` / `useTheme`. They duplicated names that `@object-ui/react` and `@object-ui/app-shell` publish with different implementations. `UploadProvider` and the upload adapters are unchanged. Migration: `ui/.changeset/13453-providers-retire-trio.md`.

### Nine duration keys carry their unit in their name (objectstack#25762, PR #13515)

Nine keys on `carousel`, the three chatbot nodes, `ActionSchema`, `ActionSchema.retry`, `toast`, `tooltip`, `hover-card` and `report` now end in `Ms` or `Seconds`. The value and its unit do not change. An old key is refused at its own path with a message that names the new key, and its TypeScript member is `never`. Migration table: `ui/.changeset/25762-duration-keys-carry-unit.md`.

### Also in this range

- Every package's `react` / `react-dom` peer range is `^19.0.0` (was `^18.0.0 || ^19.0.0`): a React 18 host is no longer supported (objectui#13465, PR #13481).
- The `react-pages` capability (`kind: 'react'` pages) now defaults to off in `@object-ui/core`; a host turns it on. The Console sets zod's `jitless` before any module runs, so zod no longer probes for `eval` (PR #13526).
- An invalid `gantt` block is refused with each schema issue named, instead of drawn (objectui#13459, PR #13490). An action's `confirmText` or `successMessage` with no template hole is shown exactly as written (objectui#13476, PR #13482).
- A record section whose fields are all empty folds into one "Show N empty fields" row (objectui#13386, PR #13483). The list, gallery, map and timeline record preview mounts `RecordDetailPanel` (PR #13486).
- Bulk actions keep each failed record's id and reason, and refresh the bound list once per run (objectui#13442, PR #13474). The AI build chat's plan card says how the build will land (objectui#12724, PR #13508). Assistant answers render text and charts in stream order (objectui#13492, PR #13500).
- Inline locale-map labels and descriptions on reports and pages show in the viewer's language (objectui#13470, #13488; PRs #13487, #13501). Positions show by label in a permission set's assigned users (objectui#13477, PR #13493). The translation preview draws the `positions` and `permissions` groups (objectui#13478, PR #13485). Calendar events with a lookup `titleField` show the record's display name (PR #13480). Unlabeled datasource enum selects get readable option labels (objectui#13353, PR #13499).
- More console pages are translated (objectui#13460, PRs #13489, #13503). Icon-only buttons have accessible names and clickable controls are keyboard-reachable (objectui#13461, PR #13494).
- Every published package declares `sideEffects` (objectui#13464, PR #13495). One `react` 19.3.0 line and one `zod` `^4.6.5` range across the packages, and single-copy pins for `@ai-sdk/react`, `ai` and `better-auth` (objectstack#25685, #25727; PRs #13472, #13496, #13512).
- Tooling and test-only changes for the merge, which publish nothing: workspace-root readers and test assumptions (objectstack#25723, #25733; PRs #13484, #13498) and warm test imports (objectstack#25763, PR #13513).

Clause-②: yes (narrowing)
Metadata-protocol: narrowed
