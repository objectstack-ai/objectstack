// @vitest-environment node
/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#30169 — the undeclared-name warning's own contract.
 *
 * The production gate is pinned against the BUILD, not the runtime: under
 * vitest `process` is node's, so both spellings of the gate read the same
 * `NODE_ENV` and a runtime assertion cannot tell them apart. What differs is
 * what the Console's production build does to them. Vite replaces the literal
 * `process.env.NODE_ENV` with `"production"`; an optional chain off
 * `globalThis.process` survives the build and then reads the Console's
 * `window.process` shim (`ui/apps/console/index.html`), which says
 * `development` unconditionally. Measured on vite 8.3.5 with the Console's own
 * `define`: the literal folds to a constant, the chain stays live.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { transformWithOxc } from 'vite';
import { describeUndeclaredActionNames } from '../undeclaredActionNames';

const SOURCE_PATH = fileURLToPath(new URL('../undeclaredActionNames.ts', import.meta.url));

describe('the development gate folds away in a production build (objectstack#30169)', () => {
  it('reads only the bundler-replaced literal, so the Console build leaves no NODE_ENV read behind', async () => {
    // The Console's `define` (`ui/apps/console/vite.config.ts`) plus the
    // `process.env.NODE_ENV` Vite adds for a production build.
    const { code } = await transformWithOxc(readFileSync(SOURCE_PATH, 'utf8'), SOURCE_PATH, {
      lang: 'ts',
      define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
    });
    expect(code).not.toMatch(/NODE_ENV/);
    expect(code).toContain('"production" !== "production"');
  });
});

describe('describeUndeclaredActionNames', () => {
  const ADDRESS = { blockType: 'object-grid', objectName: 'lead', label: 'All Leads' };

  it('says the names are undeclared when the object was read', () => {
    const line = describeUndeclaredActionNames('bulkActions', ['create_campaign'], ADDRESS);
    expect(line).toContain("object-grid (objectName: 'lead', label: 'All Leads')");
    expect(line).toContain("1 name matches no action the object declares");
    expect(line).toContain("'create_campaign'");
  });

  it('says the actions are unknown, not undeclared, when the schema was never read', () => {
    const line = describeUndeclaredActionNames('rowActions', ['a', 'b'], ADDRESS, 'unread');
    expect(line).toContain('could not be read');
    expect(line).toContain("the row menu draws no entry for 2 names: 'a', 'b'");
    expect(line).not.toContain('matches no action');
  });

  it('heads the message with ObjectGrid unless the address names another component (objectstack#30394)', () => {
    const grid = describeUndeclaredActionNames('bulkActions', ['create_campaign'], ADDRESS);
    expect(grid?.startsWith('[ObjectUI] ObjectGrid bulkActions: object-grid (')).toBe(true);
    const list = describeUndeclaredActionNames('bulkActions', ['create_campaign'], {
      component: 'ListView', blockType: 'kanban', objectName: 'lead',
    });
    expect(list?.startsWith("[ObjectUI] ListView bulkActions: kanban (objectName: 'lead')")).toBe(true);
    expect(list).toContain('the selection bar draws no button');
  });

  it('names the component from the address in the unread prescription, not "the grid" (objectstack#30535)', () => {
    const grid = describeUndeclaredActionNames('bulkActions', ['a'], ADDRESS, 'unread');
    expect(grid).toContain('Give the ObjectGrid a data source that answers getObjectSchema');
    const list = describeUndeclaredActionNames('bulkActions', ['a'], {
      component: 'ListView', blockType: 'calendar', objectName: 'lead',
    }, 'unread');
    expect(list).toContain('Give the ListView a data source that answers getObjectSchema');
    expect(list).not.toContain('the grid');
  });

  it('says nothing for no names', () => {
    expect(describeUndeclaredActionNames('bulkActions', [], ADDRESS)).toBeNull();
  });
});
