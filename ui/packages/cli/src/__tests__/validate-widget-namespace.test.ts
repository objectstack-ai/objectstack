/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `objectui validate` and the field-widget namespace rule (#5449).
 *
 * The rule itself is pinned case-for-case in
 * `packages/types/src/__tests__/form-field-widget-namespace.test.ts`. What is
 * pinned HERE is the thing the card is named after: the CLI's **verdict**. The
 * command is what an author runs before shipping, and its contract is an exit
 * code — a rule that fires inside the schema but left the command exiting 0
 * would still hand out the green tick that started this.
 *
 * So these assert the exit status and the printed refusal, not `safeParse`.
 *
 * Fixtures live under `os.tmpdir()`, never in the repo tree: `validate()`
 * resolves its argument against `process.cwd()`, and a schema file dropped in
 * the workspace would be picked up by the repo's own schema gates.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validate } from '../commands/validate.js';

/**
 * The CSI sequences chalk may add. The escape byte is built with
 * `String.fromCharCode` rather than spelled into the source, so this file holds
 * no raw control character and no escape a tooling pass could materialise into
 * one (objectui AGENTS.md byte discipline).
 */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

let dir: string;
let out: string[];
let exitCodes: number[];
let restore: () => void;

/** Everything the command printed, chalk colour codes stripped. */
function printed(): string {
  return out.join('\n').replace(ANSI, '');
}

function writeSchema(name: string, schema: unknown): string {
  const file = join(dir, name);
  writeFileSync(file, JSON.stringify(schema, null, 2), 'utf-8');
  return file;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'objectui-validate-5449-'));
  out = [];
  exitCodes = [];
  const originalLog = console.log;
  const originalError = console.error;
  const capture = (...args: unknown[]) => {
    out.push(args.map(String).join(' '));
  };
  console.log = capture;
  console.error = capture;
  // `validate()` calls `process.exit` itself; record the call instead of
  // letting it tear the Vitest worker down.
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

describe('objectui validate — an unresolvable namespaced field widget id', () => {
  it('exits 1 on the document `@object-ui/core` rejects', async () => {
    // Before this change the same document printed the valid banner and exited
    // 0, while `validateSchema` in core answered
    // UNRESOLVABLE_FIELD_WIDGET_NAMESPACE for it.
    const file = writeSchema('form.json', {
      type: 'form',
      fields: [{ name: 'pw', type: 'ui:password' }],
    });

    await validate(file);

    expect(exitCodes).toEqual([1]);
    expect(printed()).toContain('Schema validation failed');
  });

  it('names the offending id, the namespace rule, and the repair', async () => {
    const file = writeSchema('form.json', {
      type: 'form',
      fields: [{ name: 'pw', type: 'ui:password' }],
    });

    await validate(file);

    const text = printed();
    expect(text).toContain("'ui:password' is not a form field widget");
    expect(text).toContain('must name the `field:` namespace');
    // The repair, spelled out — an author should not have to infer it.
    expect(text).toContain('`field:password`');
    // The trap that made this worth an error rather than a warning: the id
    // DOES resolve in the registry, just not on the field path.
    expect(text).toContain('Resolving in the registry is not proof it resolves HERE');
  });

  it('points at the field and the key an author has to edit', async () => {
    const file = writeSchema('form.json', {
      type: 'form',
      fields: [
        { name: 'ok', type: 'password' },
        { name: 'pw', widget: 'ui:password' },
      ],
    });

    await validate(file);

    expect(exitCodes).toEqual([1]);
    // The CLI joins the zod path with an arrow; `widget` is blamed because it
    // is the key that wins the renderer's precedence.
    expect(printed()).toContain('Path: fields → 1 → widget');
  });

  it('reads the rule out of YAML too — the other authored format', async () => {
    const file = join(dir, 'form.yaml');
    writeFileSync(
      file,
      ['type: form', 'fields:', '  - name: pw', "    type: 'ui:password'", ''].join('\n'),
      'utf-8',
    );

    await validate(file);

    expect(exitCodes).toEqual([1]);
    expect(printed()).toContain("'ui:password' is not a form field widget");
  });
});

/**
 * The negative controls. A CLI that now rejects everything would be worse than
 * the false green it replaces: authors would stop running it.
 */
describe('objectui validate — legitimate widget ids still pass', () => {
  it('exits 0 on a `field:`-namespaced id', async () => {
    const file = writeSchema('form.json', {
      type: 'form',
      fields: [{ name: 'pw', type: 'field:password' }],
    });

    await validate(file);

    expect(exitCodes).toEqual([0]);
    expect(printed()).toContain('Schema is valid!');
  });

  it('exits 0 on bare names, on `widget`, and on a field with no widget id', async () => {
    const file = writeSchema('form.json', {
      type: 'form',
      fields: [
        { name: 'pw', type: 'password' },
        { name: 'note', widget: 'textarea' },
        { name: 'plain' },
      ],
    });

    await validate(file);

    expect(exitCodes).toEqual([0]);
    expect(printed()).toContain('Schema is valid!');
  });
});
