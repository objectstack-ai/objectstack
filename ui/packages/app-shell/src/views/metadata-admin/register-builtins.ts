// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The metadata-admin engine's three EAGER load-time registrations, in a leaf
 * module of their own (objectui#6776). Since objectui#11939 step 2 the built-in
 * designers — the previews and inspectors, which were most of this module's
 * bytes — are not here: the package entry loads them with a dynamic `import()`
 * of `./register-builtin-designers.ts`, whose header says why that is safe.
 *
 * ## Why these three stay eager
 *
 * Each fills a registry that is NOT observable, and each is read during render:
 * the Related tab's anchors (`listAnchorsFor`, read inside a `useMemo` keyed on
 * the type), the generic SchemaForm's fallback JSONSchemas and the datasource
 * resource (`getMetadataResource` / `resolveResourceConfig`). A registration
 * that arrived after such a read would never reach the reader (measured on
 * objectui#11798: a pre-registration read of the anchors never recovers), so a
 * late arrival is a silent loss here, not a delay. They cost the first load
 * little next to the designers.
 *
 * ## Why they are not in `./index.ts`
 *
 * They used to sit at the bottom of the directory barrel, and that placement —
 * not the registrations themselves — is what held 172,945 gzipped bytes of
 * metadata-admin in the console's EAGER closure (objectui#6776, measured then).
 * The mechanism, in two links:
 *
 *   1. a module that registers at load time cannot be tree-shaken, so
 *      `@object-ui/app-shell`'s published `sideEffects` array named
 *      `views/metadata-admin/index.ts` (objectui#6683) and every bundler kept
 *      it whole; and
 *   2. the package barrel (`packages/app-shell/src/index.ts`) re-exported its
 *      runtime values FROM that barrel, and the console's entry imports the
 *      package barrel statically. A named re-export is an ordinary static edge,
 *      so the unshakeable module — and its whole import closure, every page,
 *      preview and inspector under `views/metadata-admin/` — was reachable
 *      eagerly even though `AppContent` declares six `lazy()` imports of it.
 *
 * Neither link can be cut where it is observed. Deleting the registrations is
 * not on the table: they are load-bearing (drop them and the Related tab, the
 * generic SchemaForm and the datasource resource go missing), and
 * `scripts/vite-declared-lazy-views.ts` carries a guard that refuses to declare
 * the module pure for exactly that reason.
 *
 * So the two concerns are SPLIT instead. This module is the side-effectful half
 * and nothing re-exports through it; `./index.ts` is the pure re-export half and
 * registers nothing. The package entry bare-imports THIS file, which keeps these
 * three registrations eager, while `./index.ts` stays shakeable and reaches the
 * browser only through the `lazy()` boundaries that always claimed to defer it.
 *
 * ## ⛔ Do not attach this import to the page barrel
 *
 * The bare import belongs to the PACKAGE ENTRY (`packages/app-shell/src/index.ts`).
 * Putting it back on `./index.ts` — even as `import './register-builtins.js';` —
 * re-creates the defect under a new name: `bareSideEffectImport` in
 * `scripts/vite-declared-lazy-views.ts` reads that line and refuses to declare
 * the barrel pure, so the barrel is unshakeable again and the closure returns.
 *
 * ## ⛔ Do not import the designers here
 *
 * A static import of `./previews/index.js` or `./inspectors/index.js` from this
 * module — or of `./register-builtin-designers.js` — puts every designer back
 * on the first load: this module is eager by design. The entry's dynamic
 * `import()` is the only edge to them.
 *
 * ## Ordering
 *
 * These three are independent of one another, of the designers and of
 * `./index.ts`: each writes into a registry module that holds a plain `Map`,
 * and no registrar reads another's table at module scope. The order below is
 * the order they were written in the barrel, kept so a `git log -p` of the
 * move reads as a move.
 */

import { registerBuiltinAnchors } from './anchors.js';
import { registerDefaultMetadataSchemas } from './default-schemas.js';
import { registerDatasourceResource } from './datasource/register.js';

// Register the built-in anchor relationships so the Related tab works out of
// the box for objects (hooks, views, pages, ...).
registerBuiltinAnchors();

// Register fallback JSONSchemas for the 12 writable types so the generic
// SchemaForm renders a real form (vs raw-JSON fallback) until the framework
// wires Zod->JSONSchema generation into /meta/types.
registerDefaultMetadataSchemas();

registerDatasourceResource();
