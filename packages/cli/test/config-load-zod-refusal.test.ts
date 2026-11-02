// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A `define*` helper's `ZodError` thrown while the config module loads reaches
 * the author as ONE located, formatted refusal — never the issues as a JSON
 * array — on every command that loads the config.
 *
 * The case is the one a newcomer hits first: a `defineView` whose
 * `list.columns` mixes a column object with bare field names, in its own view
 * module re-exported through an index. Before the load seam, `os validate`
 * and `os build` printed `✗ [` and the raw issue array, naming no file and no
 * helper.
 *
 * Controls: a config that loads cleanly, a module that does not resolve, a
 * syntax error and a helper's own prose refusal all keep exactly what the
 * bundle load threw.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleRequire } from 'bundle-require';
import { z } from 'zod';
import Compile from '../src/commands/compile';
import Validate from '../src/commands/validate';
import { BUNDLE_REQUIRE_EXTERNALS, loadConfig } from '../src/utils/config';
import { configLoadRefusal } from '../src/utils/config-load-refusal';
import { linkSpec } from './helpers/define-stack-fixture.js';

const CLI_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

interface Run {
  code: number;
  stdout: string;
}

async function run(command: typeof Compile | typeof Validate, argv: string[]): Promise<Run> {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
    chunks.push(String(chunk));
    const done = rest.find((a) => typeof a === 'function') as ((e?: Error | null) => void) | undefined;
    done?.(null);
    return true;
  }) as never);
  const exitCodeBefore = process.exitCode;
  let code = 0;
  try {
    await command.run(argv, { root: CLI_ROOT });
  } catch (error) {
    const exit = (error as { oclif?: { exit?: unknown } }).oclif?.exit;
    if (typeof exit !== 'number') throw error;
    code = exit;
  } finally {
    spy.mockRestore();
    process.exitCode = exitCodeBefore;
  }
  // eslint-disable-next-line no-control-regex
  return { code, stdout: chunks.join('').replace(/\u001b\[[0-9;]*m/g, '') };
}

const MANIFEST = `{ id: 'com.example.support-desk', namespace: 'support_desk', version: '0.1.0', type: 'app', name: 'Support Desk' }`;

const OBJECT_MODULE = `import { ObjectSchema, Field } from '@objectstack/spec/data';

export const Ticket = ObjectSchema.create({
  name: 'support_desk_ticket',
  label: 'Ticket',
  sharingModel: 'private',
  fields: {
    subject: Field.text({ label: 'Subject', required: true }),
    status: Field.text({ label: 'Status' }),
    priority: Field.text({ label: 'Priority' }),
  },
});
`;

const viewModule = (columns: string) => `import { defineView } from '@objectstack/spec/ui';

const data = { provider: 'object' as const, object: 'support_desk_ticket' };

export const TicketViews = defineView({
  list: { label: 'All Tickets', type: 'grid', data, columns: ${columns} },
});
`;

const CONFIG = `import { defineStack } from '@objectstack/spec';
import { Ticket } from './src/objects/ticket.object';
import { TicketViews } from './src/views';

export default defineStack({ manifest: ${MANIFEST}, objects: [Ticket], views: [TicketViews] });
`;

let root = '';

/** A project directory: `objectstack.config.ts` plus `files`, with `@objectstack/spec` linked. */
function project(label: string, files: Record<string, string>): string {
  const dir = join(root, label);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: label, version: '0.0.0', private: true, type: 'module' }));
  linkSpec(dir);
  return join(dir, 'objectstack.config.ts');
}

const viewProject = (label: string, columns: string) =>
  project(label, {
    'objectstack.config.ts': CONFIG,
    'src/objects/ticket.object.ts': OBJECT_MODULE,
    'src/views/ticket.view.ts': viewModule(columns),
    'src/views/index.ts': `export { TicketViews } from './ticket.view';\n`,
  });

/** What bundle-require itself throws for `config`: the message a non-Zod load error must keep. */
async function bundleLoadMessage(config: string): Promise<string> {
  try {
    await bundleRequire({ filepath: config, external: BUNDLE_REQUIRE_EXTERNALS });
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error(`expected ${config} to fail to load`);
}

async function loadMessage(config: string): Promise<string> {
  try {
    await loadConfig(config);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error(`expected ${config} to fail to load`);
}

let mixed = '';

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'os-config-load-zod-refusal-'));
  mixed = viewProject('mixed', `[{ field: 'subject', link: true }, 'status', 'priority']`);
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

const LOCATED_HEAD = /src\/views\/ticket\.view\.ts:5:28 · defineView validation failed \(1 issue\):/;

// The first in-process command run loads oclif and the spec (~5 s on a shared box).
describe('a define* helper ZodError at config load is one located refusal', { timeout: 60_000 }, () => {
  it('os validate --json: the error names the view module, line, helper and path; exit 1', async () => {
    const r = await run(Validate, [mixed, '--json']);
    expect(r.code).toBe(1);
    const payload = JSON.parse(r.stdout) as { valid: boolean; error: string };
    expect(payload.valid).toBe(false);
    expect(payload.error).toMatch(LOCATED_HEAD);
    expect(payload.error).toContain('✗ list.columns: Invalid input');
    expect(payload.error).toContain('✗ list.columns.0:');
    expect(payload.error.trimStart().startsWith('[')).toBe(false);
  });

  it('os validate text face: no raw JSON array reaches the terminal', async () => {
    const r = await run(Validate, [mixed]);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(LOCATED_HEAD);
    expect(r.stdout).not.toMatch(/✗ \[\s*$/m);
    expect(r.stdout).not.toContain('"code": "invalid_union"');
  });

  it('os build --json carries the same refusal as os validate, exit code unchanged', async () => {
    const validate = JSON.parse((await run(Validate, [mixed, '--json'])).stdout) as { error: string };
    const out = join(root, 'mixed', 'dist', 'objectstack.json');
    const r = await run(Compile, [mixed, '--output', out, '--json']);
    expect(r.code).not.toBe(0);
    const payload = JSON.parse(r.stdout) as { error: string };
    expect(payload.error).toMatch(LOCATED_HEAD);
    expect(payload.error).toBe(validate.error);
  });

  it('a call that is not a define* helper is located without naming a helper', async () => {
    const config = project('object-create', {
      'objectstack.config.ts': `import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
const T = ObjectSchema.create({ name: 'BadName', label: 'T', fields: { a: Field.text({ label: 'A' }) } });
export default defineStack({ manifest: ${MANIFEST}, objects: [T] });
`,
    });
    const message = await loadMessage(config);
    expect(message).toMatch(/objectstack\.config\.ts:3:\d+ · Validation failed \(1 issue\):/);
    expect(message).toContain('✗ name:');
  });

  it('a stack the bundle frame is missing from names the config entry, never a guessed module', () => {
    const parsed = z.object({ name: z.string() }).safeParse({ name: 1 });
    if (parsed.success) throw new Error('fixture parse unexpectedly succeeded');
    const error = parsed.error as unknown as Error & { issues: unknown[] };
    error.stack = 'ZodError: []\n    at defineView (file:///elsewhere/spec/dist/index.mjs:1:1)';
    const config = join(root, 'mixed', 'objectstack.config.ts');
    const refusal = configLoadRefusal(error, config, undefined, join(root, 'mixed'));
    expect(refusal.message).toMatch(
      /^objectstack\.config\.ts \(loading it threw; the stack does not say which module\) · Validation failed \(1 issue\):/,
    );
    expect(refusal.cause).toBe(error);
  });
});

describe('controls: everything else a load throws is unchanged', { timeout: 60_000 }, () => {
  it('a config that loads cleanly still validates', async () => {
    const clean = viewProject('clean', `[{ field: 'subject', link: true }, { field: 'status' }, { field: 'priority' }]`);
    const r = await run(Validate, [clean, '--json']);
    expect(r.code).toBe(0);
    expect((JSON.parse(r.stdout) as { valid: boolean }).valid).toBe(true);
  });

  it('a module that does not resolve keeps the bundle load message', async () => {
    const config = project('missing-import', {
      'objectstack.config.ts': `import { nothing } from './src/not-there';\nexport default nothing;\n`,
    });
    expect(await loadMessage(config)).toBe(await bundleLoadMessage(config));
  });

  it('a syntax error keeps the bundle load message', async () => {
    const config = project('syntax', { 'objectstack.config.ts': `export default {\n` });
    expect(await loadMessage(config)).toBe(await bundleLoadMessage(config));
  });

  it("a helper's own prose refusal keeps its words", async () => {
    const config = project('no-views', {
      'objectstack.config.ts': `import { defineView } from '@objectstack/spec/ui';\nexport default defineView({});\n`,
    });
    expect(await loadMessage(config)).toBe(await bundleLoadMessage(config));
    expect(await loadMessage(config)).toMatch(/^defineView: the container defines no views/);
  });
});
