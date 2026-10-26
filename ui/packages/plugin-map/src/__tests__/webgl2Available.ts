/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A browser that CAN start a map, for the tests that stand one in
 * (objectui#11819).
 *
 * `ObjectMap` asks for a WebGL2 context before it mounts `MapGL`, and shows the
 * record list instead of the map when there is none. happy-dom implements no
 * canvas: its `getContext` answers `null` for every context type, so under it
 * every `ObjectMap` is a browser without WebGL2 — which is what a REAL
 * `react-map-gl` reaches there too (`ObjectMap.webgl2Fallback-11819.test.tsx`).
 *
 * A test that replaces `react-map-gl/maplibre` with a stub is standing in for a
 * browser whose map starts, so it declares the other half of that world by
 * importing this module for its side effect: every test in the file then sees a
 * WebGL2 context, and every other context type still gets happy-dom's answer.
 * The hooks register on the importing file's root suite.
 */

import { afterEach, beforeEach, vi } from 'vitest';

/** All the probe touches: it releases its context through this extension. */
const STARTABLE_WEBGL2 = { getExtension: () => null } as unknown as WebGL2RenderingContext;

let getContextSpy: { mockRestore(): void } | undefined;

beforeEach(() => {
  const happyDomGetContext = HTMLCanvasElement.prototype.getContext;
  getContextSpy = vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockImplementation(function (this: HTMLCanvasElement, contextId: string, options?: unknown) {
      return contextId === 'webgl2'
        ? STARTABLE_WEBGL2
        : (happyDomGetContext as (id: string, opts?: unknown) => RenderingContext | null).call(this, contextId, options);
    } as typeof HTMLCanvasElement.prototype.getContext);
});

afterEach(() => {
  getContextSpy?.mockRestore();
  getContextSpy = undefined;
});
