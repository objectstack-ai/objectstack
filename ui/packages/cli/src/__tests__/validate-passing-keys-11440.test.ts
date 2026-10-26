/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `objectui validate`, end to end, on the documents objectui#11440 arms — the
 * three the card names as refused at the public door:
 *
 *   - a stored spec page whose `type` is its page kind (`home`), in the shape
 *     objectstack's example apps author with `definePage`;
 *   - the `app-schema-renderer` node the governed mobile guide teaches, its
 *     `mobileNavMode` key (`skills/objectui/guides/mobile.md`);
 *   - the plugin-detail package's own `detail-view` example, whose first tab's
 *     content is a `detail-section` node (its "With Tabs" section).
 *
 * That example is TSX. Its second tab handed `record:activity` a host feed
 * (`items: activityData`), which objectui#11321 refuses by name in a JSON
 * document, so the rows below validated the first tab alone and held the
 * host-feed refusal as the ONLY issue left on the full document.
 * objectui#11515 re-authored that tab to the block's declared `properties`, so
 * the full document as the page now writes it validates (the third row). The
 * host-feed row stays, as the refusal's control on the old spelling. Each
 * document is restated here, not read from the page, so this file reads no
 * markdown.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { validate } from '../commands/validate.js';

/** See `validate-root-path-line.test.ts` — the escape byte is never spelled. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

let dir: string;
let out: string[];
let exitCodes: number[];
let restore: () => void;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'objectui-validate-11440-'));
  out = [];
  exitCodes = [];
  const originalLog = console.log;
  const originalError = console.error;
  const capture = (...args: unknown[]) => {
    out.push(args.map(String).join(' '));
  };
  console.log = capture;
  console.error = capture;
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCodes.push(code ?? 0);
    return undefined as never;
  }) as never);
  restore = () => {
    console.log = originalLog;
    console.error = originalError;
    exitSpy.mockRestore();
  };
});

afterEach(() => {
  restore();
  rmSync(dir, { recursive: true, force: true });
});

async function run(name: string, document: unknown): Promise<string> {
  const file = join(dir, `${name}.json`);
  writeFileSync(file, JSON.stringify(document, null, 2), 'utf-8');
  await validate(file);
  return out.join('\n').replace(ANSI, '');
}

const EXAMPLE_DETAIL_SECTION = {
  type: 'detail-section',
  fields: [
    { name: 'description', label: 'Description' },
    { name: 'employees', label: 'Employee Count' },
  ],
};

describe('objectui validate — the documents objectui#11440 arms', () => {
  it('validates a stored spec page whose `type` is its kind (`home`)', async () => {
    const text = await run('home-page', {
      name: 'crm_welcome',
      label: 'CRM Welcome',
      type: 'home',
      template: 'header-sidebar-main',
      kind: 'full',
      regions: [
        { name: 'header', width: 'full', components: [{ type: 'page:header', properties: { title: 'Welcome to the CRM' } }] },
        { name: 'main', components: [{ type: 'element:text', properties: { content: 'A sample page.' } }] },
      ],
    });
    expect(text).not.toContain('Schema validation failed');
    expect(text).toContain('Schema is valid');
    expect(exitCodes).toEqual([0]);
  });

  it('validates the `app-schema-renderer` node the mobile guide teaches', async () => {
    const text = await run('app-schema-renderer', { type: 'app-schema-renderer', mobileNavMode: 'bottom_nav' });
    expect(text).toContain('Schema is valid');
    expect(exitCodes).toEqual([0]);
  });

  it('refuses a mode the renderer does not implement, at `mobileNavMode` (control)', async () => {
    const text = await run('app-schema-renderer-misspelt', { type: 'app-schema-renderer', mobileNavMode: 'bottom-nav' });
    expect(text).toContain('Schema validation failed');
    expect(text).toContain('mobileNavMode');
    expect(exitCodes).toEqual([1]);
  });

  it('validates the plugin-detail example\'s `detail-view` with its `detail-section` tab', async () => {
    const text = await run('detail-view-section', {
      type: 'detail-view',
      title: 'Account: Acme Corp',
      objectName: 'accounts',
      resourceId: '12345',
      fields: [{ name: 'name', label: 'Account Name' }, { name: 'industry', label: 'Industry' }],
      tabs: [{ key: 'details', label: 'Details', content: EXAMPLE_DETAIL_SECTION }],
      showEdit: true,
      showDelete: true,
    });
    expect(text).not.toContain('Schema validation failed');
    expect(text).toContain('Schema is valid');
    expect(exitCodes).toEqual([0]);
  });

  it('validates the example\'s full document as the page writes it since objectui#11515: the Activity tab authors `properties`', async () => {
    const text = await run('detail-view-full-declared', {
      type: 'detail-view',
      title: 'Account: Acme Corp',
      objectName: 'accounts',
      resourceId: '12345',
      fields: [{ name: 'name', label: 'Account Name' }, { name: 'industry', label: 'Industry' }],
      tabs: [
        { key: 'details', label: 'Details', icon: '📄', content: EXAMPLE_DETAIL_SECTION },
        { key: 'activity', label: 'Activity', badge: '12', content: { type: 'record:activity', properties: { limit: 20, showCompleted: false } } },
      ],
      showEdit: true,
      showDelete: true,
    });
    expect(text).not.toContain('Schema validation failed');
    expect(text).toContain('Schema is valid');
    expect(exitCodes).toEqual([0]);
  });

  it('on the example\'s old full document, the only issue left is the host feed on `record:activity` (objectui#11321)', async () => {
    const text = await run('detail-view-full', {
      type: 'detail-view',
      title: 'Account: Acme Corp',
      objectName: 'accounts',
      resourceId: '12345',
      tabs: [
        { key: 'details', label: 'Details', content: EXAMPLE_DETAIL_SECTION },
        { key: 'activity', label: 'Activity', badge: '12', content: { type: 'record:activity', items: [] } },
      ],
    });
    expect(text).toContain('Schema validation failed');
    // The validator prints a path as `tabs → 1 → content`.
    expect(text).toContain('Path: tabs → 1 → content → items');
    expect(text).toContain('HOST FEED SLOT');
    expect(text).not.toContain('tabs → 0');
    expect(exitCodes).toEqual([1]);
  });
});
