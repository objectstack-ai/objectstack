// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11939 step 2 — importing the package entry still registers every
 * built-in designer, with no call from the host.
 *
 * The entry no longer reaches the previews and inspectors statically: it loads
 * `views/metadata-admin/register-builtin-designers.ts` with a dynamic
 * `import()` at its own module scope and calls `registerBuiltinDesigners()`
 * when that chunk arrives. Ruling A on objectui#11798 refused the lazy
 * sub-entry ("drops every host relying on auto-registration without telling
 * it"), so auto-registration is the contract this file holds the entry to.
 *
 * ⛔ What would turn this red: the entry's dynamic import deleted, or its
 * `.then` no longer calling the registration. Every other suite registers the
 * designers itself and stays green through either, and so does the console's
 * eager-closure gate (the designers' chunk simply stops being emitted).
 *
 * The registries are read empty BEFORE the entry is imported, so the designers
 * found afterwards can only have come from the entry. Identity, not presence:
 * the registered component must BE the built-in one.
 *
 * The module the entry's `import()` names is imported at module scope too, so
 * its whole graph (every Preview and Inspector, about 35 modules) loads in the
 * import phase, where no test timeout applies; the entry's own `import()` then
 * resolves from the module cache, and the wait below covers only its `.then`
 * (AGENTS.md 测试纪律). Importing the three components alone left the other
 * ~32 modules to load inside the wait's 1000 ms: measured ~920 ms of it on a
 * quiet box, and a slow CI shard missed it (objectui#12478); with the module
 * imported here the wait takes under 10 ms.
 *
 * That import runs nothing: `register-builtin-designers.ts` performs no
 * load-time effect, it only exports the function. Nothing here CALLS
 * `registerBuiltinDesigners`, and the registries are read empty after every
 * import above has evaluated, so a registrar sneaking into that graph would
 * turn the first assertion red.
 */

import { describe, it, expect, vi } from 'vitest';
import { getMetadataPreview, listMetadataPreviewTypes } from '../views/metadata-admin/preview-registry';
import { getMetadataInspector } from '../views/metadata-admin/inspector-registry';
import { getMetadataDefaultInspector } from '../views/metadata-admin/default-inspector-registry';
import { FlowPreview } from '../views/metadata-admin/previews/FlowPreview';
import { FlowInspector } from '../views/metadata-admin/inspectors/FlowInspector';
import { HookDefaultInspector } from '../views/metadata-admin/inspectors/HookDefaultInspector';
// Load, never call: the entry's dynamic import resolves from this cache entry
// (objectui#12478; see the header).
import '../views/metadata-admin/register-builtin-designers';

const typesBeforeTheEntry = listMetadataPreviewTypes();
await import('../index');

describe('the package entry registers the built-in designers (objectui#11939 step 2)', () => {
  it('every built-in designer is registered once the entry’s chunk lands — no host call', async () => {
    expect(typesBeforeTheEntry).toEqual([]);

    await vi.waitFor(() => {
      expect(getMetadataPreview('flow')).toBe(FlowPreview);
    });
    expect(getMetadataInspector('flow')).toBe(FlowInspector);
    expect(getMetadataDefaultInspector('hook')).toBe(HookDefaultInspector);
  });
});
