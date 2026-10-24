/* ADR-0080: the registration graph every SDUI manifest this app emits is read
 * from. Importing this module registers everything the console does, EAGERLY,
 * which is the PREREQUISITE `packages/sdui-parser/scripts/gen-manifest.ts`
 * states. It has two importers, so they read one list:
 *   - `manifest-dump.tsx` — the browser dump page (`dev/manifest-dump.html`);
 *   - `../scripts/build-sdui-manifest.ts` — the console build step that ships
 *     `dist/sdui.manifest.json` (objectui#11403), under Node.
 *
 * Two lists have to agree here, and nothing used to check them:
 *   - `src/register-plugins.ts` — what the console actually ships, most of it
 *     registered LAZILY (the chunk loads on first use).
 *   - the eager imports below — what this graph loads so the manifest carries
 *     each block's real `inputs`.
 *
 * Importing the former means a plugin the console lazy-registers but this file
 * forgets to import eagerly survives as a `lazy: true` stub and
 * `assertFullyLoaded` fails the build — instead of that block landing in the
 * manifest with no props, which would make every prop an author writes on it
 * an `unknown-prop` diagnostic downstream. Eager registration wins over a stub,
 * so the manifest itself is unchanged; this only makes the drift detectable. */
import '../src/register-plugins';

import '@object-ui/components';
import '@object-ui/plugin-grid';
import '@object-ui/plugin-form';
import '@object-ui/plugin-view';
import '@object-ui/plugin-list';
import '@object-ui/plugin-detail';
import '@object-ui/plugin-dashboard';
import '@object-ui/plugin-charts';
import '@object-ui/plugin-kanban';
import '@object-ui/plugin-calendar';
import '@object-ui/plugin-gantt';
import '@object-ui/plugin-timeline';
import '@object-ui/plugin-map';
import '@object-ui/plugin-markdown';
import '@object-ui/plugin-report';
import '@object-ui/plugin-tree';
