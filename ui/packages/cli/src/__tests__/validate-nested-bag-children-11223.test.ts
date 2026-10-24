/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `objectui validate` judges a component nested in a `page:` container's props
 * bag (objectui#11223) — the public door the card measured.
 *
 * A page built the way the spec and the validator's own remedy text teach —
 * blocks nested in `properties.children` — got `Schema is valid!` for a
 * malformed nested block and for a nested `type` no arm declares. The command
 * runs `safeValidateSchema`, which now judges each nested component by the node
 * union at its real path; this file pins what an author reads: the numbered
 * issue with that path, and the "No arm accepts type" note the printer builds
 * from the nested discriminator's own verdict. The schema-level pins live in
 * `packages/types/src/__tests__/nested-page-children-11223.test.ts`.
 *
 * Harness (fixtures under `os.tmpdir()`, `process.exit` recorded rather than
 * taken) follows `validate-root-path-line.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validate } from '../commands/validate.js';

/** The CSI sequences chalk may add; the escape byte is built, never spelled. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

const text = (content: unknown) => ({ type: 'element:text', properties: { content } });

let dir: string;
let out: string[];
let exitCodes: number[];
let restore: () => void;

const printed = (): string => out.join('\n').replace(ANSI, '');

function writeSchema(name: string, schema: unknown): string {
  const file = join(dir, name);
  writeFileSync(file, JSON.stringify(schema, null, 2), 'utf-8');
  return file;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'objectui-validate-11223-'));
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

describe('objectui validate — a component nested in a props bag is judged (objectui#11223)', () => {
  it('refuses a malformed nested block, at the member\'s own path', async () => {
    await validate(writeSchema('section.json', {
      type: 'page:section',
      properties: { children: [text('intro'), text(7)] },
    }));

    expect(exitCodes).toEqual([1]);
    const lines = printed();
    expect(lines).not.toContain('Schema is valid!');
    expect(lines).toContain('Path: properties → children → 1 → properties → content');
  });

  it('names the unknown nested `type` where it sits, with the nearest accepted types', async () => {
    await validate(writeSchema('tabs.json', {
      type: 'page:tabs',
      properties: { items: [{ label: 'One', children: [{ type: 'element:txt' }] }] },
    }));

    expect(exitCodes).toEqual([1]);
    const lines = printed();
    expect(lines).toContain('Path: properties → items → 0 → children → 0 → type');
    expect(lines).toContain('No arm accepts type "element:txt" at properties → items → 0 → children → 0.');
    expect(lines).toMatch(/Nearest of the \d+ accepted types: .*element:text/);
  });

  it('still says `Schema is valid!` for a valid nested page (the control)', async () => {
    await validate(writeSchema('page.json', {
      type: 'page:section',
      properties: {
        children: [
          text('intro'),
          { type: 'page:card', properties: { title: 'Card', children: [text('in the card')] } },
          { type: 'page:accordion', properties: { items: [{ label: 'Panel', children: [text('in the panel')] }] } },
        ],
      },
    }));

    expect(exitCodes).toEqual([0]);
    expect(printed()).toContain('Schema is valid!');
  });
});
