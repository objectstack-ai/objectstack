/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The console home blocks are registered under the `app-shell` namespace, and
 * the bare spelling stays the one authorable key (objectui#13301, maintainer
 * ruling 6312301934).
 *
 * Namespacing the five registrations adds five `app-shell:` keys to
 * `KNOWN_SCHEMA_TYPES`. No arm in `@object-ui/types` claims them, so
 * `objectui validate` refuses each at `type`, while the bare key a page writes
 * keeps its arm. The ratchet in `registered-types-validate-ratchet-10859`
 * counts the five as its named stopgap raise; this file pins why that raise
 * is by design: the namespaced twin is registered, and refused at authoring.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateAuthoredDocument } from '../utils/authoring-face.js';
import { KNOWN_SCHEMA_TYPES } from '../utils/known-schema-types.js';
import { validate } from '../commands/validate.js';

const HOME_BLOCKS = ['hero', 'stat', 'usage-bar', 'checklist', 'tile-grid'] as const;

/** Is `type` unclaimed by every arm of the validator's root union? */
function refusedAtType(type: string): boolean {
  const result = validateAuthoredDocument({ type });
  if (result.success) return false;
  return result.error.issues.some(
    (issue) => issue.code === 'invalid_union' && issue.path.length === 1 && issue.path[0] === 'type',
  );
}

describe('console home blocks: registered namespaced, authored bare (objectui#13301)', () => {
  it('registers each block under both its bare key and its `app-shell:` key', () => {
    for (const block of HOME_BLOCKS) {
      expect(KNOWN_SCHEMA_TYPES, block).toContain(block);
      expect(KNOWN_SCHEMA_TYPES, `app-shell:${block}`).toContain(`app-shell:${block}`);
    }
  });

  it('claims the bare key and refuses the `app-shell:` key at `type`', () => {
    for (const block of HOME_BLOCKS) {
      expect(refusedAtType(block), block).toBe(false);
      expect(refusedAtType(`app-shell:${block}`), `app-shell:${block}`).toBe(true);
    }
  });
});

/** See `validate-root-path-line.test.ts` — the escape byte is never spelled. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

let dir: string;
let out: string[];
let exitCodes: number[];
let restore: () => void;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'objectui-validate-13301-'));
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

async function validatePage(name: string, heroType: string): Promise<string> {
  const page = {
    type: 'page',
    title: 'Home',
    children: [{ type: heroType, properties: { title: 'Your workspace' } }],
  };
  const file = join(dir, name);
  writeFileSync(file, JSON.stringify(page, null, 2), 'utf-8');
  await validate(file);
  return out.join('\n').replace(ANSI, '');
}

describe('objectui validate — the hero spelling (objectui#13301)', () => {
  it('accepts a page that authors bare `hero`', async () => {
    const text = await validatePage('hero-bare.json', 'hero');
    expect(text).not.toContain('Schema validation failed');
    expect(text).toContain('Schema is valid');
    expect(exitCodes).toEqual([0]);
  });

  it('refuses the same page authoring `app-shell:hero`', async () => {
    const text = await validatePage('hero-namespaced.json', 'app-shell:hero');
    expect(text).toContain('Schema validation failed');
    expect(exitCodes).toEqual([1]);
  });
});
