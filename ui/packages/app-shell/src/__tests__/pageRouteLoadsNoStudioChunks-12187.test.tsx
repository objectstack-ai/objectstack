// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12187 item 2 — a plain page route loads no built-in designer and
 * no interface list.
 *
 * ## The two edges this file holds
 *
 * Measured on the console build of `54159d3`, a page route fetched the
 * Studio's designer chunks (`register-builtin-designers`,
 * `HookDefaultInspector`, `ReportDefaultInspector`,
 * `default-inspector-registry`, and the icons they draw) and
 * `InterfaceListPage` before its content, on a page that reads no designer
 * and draws no list. Two edges did it:
 *
 *   1. the package entry ran its `import()` of
 *      `views/metadata-admin/register-builtin-designers.ts` at module scope,
 *      so every page load started it. The entry now hands that loader to the
 *      registries (`deferBuiltinDesigners`), and the first registry read runs
 *      it;
 *   2. `PageView` imported `InterfaceListPage` statically, so its chunk loaded
 *      with every page. It is now a `React.lazy` edge that only an interface
 *      page (`interfaceConfig.source`) renders.
 *
 * The console's eager-closure gate cannot see either: both chunks sit behind
 * an `import()` in the bundle, so they never enter the static closure it
 * weighs.
 *
 * ## How it is observed
 *
 * Each of the two modules is replaced by a factory that counts its own
 * evaluation, so "loaded" is a fact about the module graph rather than about a
 * registry's contents. Importing the entry evaluates its whole static graph,
 * `PageView` included, so a static edge back to either module, or a loader
 * run at the entry's module scope again, counts here.
 *
 * The file's module state is shared by its cases, so they run in order: the
 * "nothing loaded" readings come before the read that loads the designers.
 * `entryRegistersBuiltinDesigners-11939.test.tsx` holds the other half, that
 * the entry still registers the REAL designers with no host call.
 */

import { describe, it, expect, vi } from 'vitest';

const evaluated = vi.hoisted(() => ({
  designers: 0,
  interfaceListPage: 0,
  registerBuiltinDesigners: vi.fn(),
}));

vi.mock('../views/metadata-admin/register-builtin-designers', () => {
  evaluated.designers += 1;
  return { registerBuiltinDesigners: evaluated.registerBuiltinDesigners };
});

vi.mock('../views/InterfaceListPage', () => {
  evaluated.interfaceListPage += 1;
  return { InterfaceListPage: () => null };
});

import { listMetadataPreviewTypes, getMetadataPreview } from '../views/metadata-admin/preview-registry';
import { getMetadataInspector } from '../views/metadata-admin/inspector-registry';

/** Long enough for an `import()` started during the entry's evaluation to land. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 250));

await import('../index');
await settle();

describe('a plain page route loads no Studio chunk (objectui#12187 item 2)', () => {
  it('importing the package entry loads neither the built-in designers nor InterfaceListPage', () => {
    expect(evaluated.designers, 'the entry loaded the designers at its own module scope').toBe(0);
    expect(evaluated.registerBuiltinDesigners).not.toHaveBeenCalled();
    expect(
      evaluated.interfaceListPage,
      'a module in the static graph of the entry (PageView) imports InterfaceListPage statically',
    ).toBe(0);
  });

  it('the first read of a designer registry loads and registers the designers, once', async () => {
    expect(listMetadataPreviewTypes()).toEqual([]);
    await vi.waitFor(() => {
      expect(evaluated.registerBuiltinDesigners).toHaveBeenCalledTimes(1);
    });

    // Later reads, of any of the registries, start no second load.
    getMetadataPreview('flow');
    getMetadataInspector('flow');
    listMetadataPreviewTypes();
    await settle();
    expect(evaluated.designers).toBe(1);
    expect(evaluated.registerBuiltinDesigners).toHaveBeenCalledTimes(1);
  });
});
