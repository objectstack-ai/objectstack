/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The plugin's registration surface — what importing this package puts in the
 * registry.
 *
 * ⚠️ Every assertion in this file used to be about the `kanban-ui` entry: that
 * it resolved, its label and category, its four declared `inputs`, and the
 * `defaultProps` board it shipped. That entry RETIRED (objectui#8257,
 * maintainer ruling 2026-09-09), together with `kanban-enhanced` and — from
 * objectui#8802 — the bare `kanban` key. `object-kanban` is the one surviving
 * registration, so the same questions are asked of it. The retirement itself is
 * pinned in `__tests__/kanban-family-registry-keys-retired-8257.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
// Import all renderers to register them. This was a `beforeAll(async () => {
// await import('./index') }, 15000)` — the cold transform of the renderer graph
// was billed to a hook, so it needed its timeout raised to 15s, and under full
// parallel load it blew even that (observed: 15021ms, reported as 8 skipped tests
// rather than a failed assertion). A static import puts the same cost in the
// file's import phase, which no test or hook timeout applies to — so the raised
// timeout is no longer needed at all.
import './index';

describe('Plugin Kanban', () => {
  describe('object-kanban component', () => {
    it('should be registered in ComponentRegistry', () => {
      expect(ComponentRegistry.get('object-kanban')).toBeDefined();
      // Firing control on the same call: a name nothing registers is undefined,
      // so the line above is a reading rather than a getter that always answers.
      expect(ComponentRegistry.get('zzz-not-a-type')).toBeUndefined();
    });

    it('should have proper metadata', () => {
      const config = ComponentRegistry.getConfig('object-kanban');
      expect(config).toBeDefined();
      expect(config?.label).toBe('Object Kanban');
      expect(config?.category).toBe('view');
      expect(config?.namespace).toBe('plugin-kanban');
    });

    it('should have expected inputs', () => {
      const config = ComponentRegistry.getConfig('object-kanban');
      const names = (config?.inputs ?? []).map((i) => i.name);
      expect(names).toEqual(
        expect.arrayContaining(['objectName', 'groupBy', 'columns', 'cardTitle', 'conditionalFormatting']),
      );
    });

    it('declares objectName as not required, naming the binding that can supply it (objectui#11605)', () => {
      // The spec row leaves `objectName` optional because the node's
      // `dataSource` binding can supply the object, and the page compile reads
      // this list: `required: true` here refused a bound board.
      const config = ComponentRegistry.getConfig('object-kanban');
      const objectName = (config?.inputs ?? []).find((i) => i.name === 'objectName');
      expect(objectName).toBeDefined();
      expect(objectName?.required).not.toBe(true);
      expect(objectName?.description ?? '').toContain('`dataSource.object`');
    });

    it('every declared input carries a type', () => {
      const config = ComponentRegistry.getConfig('object-kanban');
      const inputs = config?.inputs ?? [];
      expect(inputs.length).toBeGreaterThan(0);
      expect(inputs.filter((i) => !i.type)).toEqual([]);
    });
  });
});
