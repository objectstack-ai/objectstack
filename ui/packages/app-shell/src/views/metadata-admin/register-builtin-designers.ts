// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The built-in metadata DESIGNERS — every Preview, scoped Inspector and
 * default Inspector the engine ships — registered through one call, in a
 * module the package entry loads with a dynamic `import()` (objectui#11939
 * step 2, the second half of objectui#6795's order).
 *
 * ## Why this is not in `./register-builtins.ts` any more
 *
 * `register-builtins.ts` is bare-imported by the package entry, so everything
 * it reaches sits on every console page's FIRST load. The previews and
 * inspectors were most of those bytes, and only metadata authors ever render
 * them. Step 1 (`a835c31`) made the three registries they fill observable: a
 * reader that rendered before a designer was registered re-renders when it is.
 * That is what makes a late arrival safe, so the entry now does
 *
 *     import('./views/metadata-admin/register-builtin-designers.js')
 *       .then(({ registerBuiltinDesigners }) => registerBuiltinDesigners())
 *
 * at its own module scope. Importing the entry still registers every built-in
 * designer with no action from the host; it happens once this chunk has loaded
 * instead of during the entry's own evaluation. Until then a reader shows its
 * existing "designer missing" state, then the designer.
 *
 * The three registrations whose registries are NOT observable — the Related
 * tab's anchors, the generic SchemaForm's fallback JSONSchemas and the
 * datasource resource — stay eager in `register-builtins.ts`: a late arrival
 * there would never reach a reader that already rendered.
 *
 * ## Why a function, and not a module that registers at load time
 *
 * This module performs no load-time effect: it exports one function, and the
 * entry's `.then` calls it. A dynamic import whose result is never read would
 * leave each consumer's bundler to decide whether a module with no used export
 * and no `sideEffects` entry still runs — the silent-drop class objectui#6683
 * exists to prevent. Calling a named export keeps the module in every bundle
 * by its USE, so `@object-ui/app-shell`'s `sideEffects` array does not name it
 * (`scripts/check-side-effects-array.mjs` walks the entry's static edges, and a
 * module that registers nothing at load time is not a registrar).
 *
 * ## The host keeps its own registration
 *
 * The pass runs inside `registerAsBuiltIns` (`./preview-registry.ts`): a
 * built-in fills only a type that has no entry yet. A host that registered its
 * own designer before this chunk arrived keeps it; one that registers after
 * replaces the built-in, as `register*` always has.
 *
 * ## Who else calls it
 *
 * Tests that need the designers before their first render. Calling it again is
 * harmless: every type then has an entry, and the pass skips it. (The console's
 * dev-only preview gallery does NOT call it: it imports only the package, and
 * mounts its list once the entry's own call has filled the registry.)
 */

import { registerAsBuiltIns } from './preview-registry.js';
import { registerBuiltinPreviews } from './previews/index.js';
import { registerBuiltinInspectors } from './inspectors/index.js';

export function registerBuiltinDesigners(): void {
  registerAsBuiltIns(() => {
    // Built-in Preview-tab renderers (page, view, dashboard, report, app,
    // object, flow, …).
    registerBuiltinPreviews();
    // Built-in scoped inspectors and default (selection-less) inspectors.
    registerBuiltinInspectors();
  });
}
