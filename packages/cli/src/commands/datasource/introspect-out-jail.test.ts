// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os datasource introspect --out` keeps the server-generated draft inside the
 * current directory once symlinks are resolved.
 *
 * The jail used to be lexical only: `resolve(cwd, out)` prefix-checked against
 * `cwd`, then handed to `writeFile`, which follows symlinks. An in-tree
 * directory symlink (`objects/lnk` -> a directory outside the project) or a
 * target that is itself a symlink therefore let the draft land outside the
 * tree with exit 0. These pins hold the declared refusal for both shapes, and
 * keep the absolute / `../` refusals and the plain in-tree write unchanged.
 *
 * Every case runs in its own temp tree (a `project/` directory standing in for
 * the cwd, and an `outside/` sibling it must never write into), removed after.
 * `Config.load` is paid at module scope for the reason the sibling
 * `envelope-unwrap.test.ts` records in its header.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Config } from '@oclif/core';
import { sendOk } from '@objectstack/types';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serverBody } from '../../utils/__tests__/server-body.js';
import DatasourceIntrospect from './introspect.js';

const HERE = dirname(fileURLToPath(import.meta.url));
/** This package's own root — `packages/cli`, never outside it. */
const CLI_ROOT = resolve(HERE, '../../..');

const config = await Config.load({ root: CLI_ROOT });

const DRAFT_SOURCE = '/* draft source, verbatim from the server */';
const target = ['showcase_external', '--url', 'http://127.0.0.1:39999', '--token', 'tok', '--table', 'orders'];

let root: string | undefined;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

/** A fresh `project/` (the cwd) beside an `outside/` directory. */
function tree(): { project: string; outside: string } {
  root = mkdtempSync(join(tmpdir(), 'os-introspect-jail-'));
  const project = join(root, 'project');
  const outside = join(root, 'outside');
  mkdirSync(join(project, 'objects'), { recursive: true });
  mkdirSync(outside);
  return { project, outside };
}

/** Run the command with `cwd` as the current directory and a draft-serving server. */
async function introspect(cwd: string, out: string) {
  vi.spyOn(process, 'cwd').mockReturnValue(cwd);
  const body = serverBody((res) =>
    sendOk(res, {
      draft: { name: 'orders', datasource: 'showcase_external', definition: {}, source: DRAFT_SOURCE },
    }),
  );
  vi.stubGlobal('fetch', async () => ({ status: 200, ok: true, json: async () => body }));

  const logs: string[] = [];
  const cmd = new DatasourceIntrospect([...target, '--out', out], config);
  Object.assign(cmd, { log: (m?: string) => logs.push(String(m ?? '')) });
  try {
    await cmd.run();
    return { logs };
  } catch (err) {
    const exit = (err as { oclif?: { exit?: number } }).oclif?.exit;
    return { logs, failure: { message: (err as Error).message, exit } };
  }
}

const refusal = (out: string) => `--out must be a relative path within the current directory: ${out}`;

describe('os datasource introspect --out — the jail holds after symlinks resolve', () => {
  it('refuses an in-tree directory symlink that points outside, and writes nothing there', async () => {
    const { project, outside } = tree();
    symlinkSync(outside, join(project, 'objects', 'lnk'));

    const run = await introspect(project, 'objects/lnk/qa_sym.object.ts');

    expect(run.failure).toEqual({ message: refusal('objects/lnk/qa_sym.object.ts'), exit: 2 });
    expect(readdirSync(outside)).toEqual([]);
  });

  it('refuses a target that is itself an existing symlink, even a dangling one', async () => {
    const { project, outside } = tree();
    symlinkSync(join(outside, 'x.object.ts'), join(project, 'objects', 'x.object.ts'));

    const run = await introspect(project, 'objects/x.object.ts');

    expect(run.failure).toEqual({ message: refusal('objects/x.object.ts'), exit: 2 });
    expect(readdirSync(outside)).toEqual([]);
  });

  it('still writes a plain nested in-tree path', async () => {
    const { project } = tree();

    const run = await introspect(project, 'objects/wh_order.object.ts');

    expect(run.failure).toBeUndefined();
    expect(run.logs).toContain('Wrote objects/wh_order.object.ts');
    expect(readFileSync(join(project, 'objects', 'wh_order.object.ts'), 'utf8')).toBe(DRAFT_SOURCE);
  });

  it('still writes when the cwd itself is reached through a symlink', async () => {
    const { project } = tree();
    const alias = join(root!, 'alias');
    symlinkSync(project, alias);

    const run = await introspect(alias, 'objects/wh_order.object.ts');

    expect(run.failure).toBeUndefined();
    expect(readFileSync(join(project, 'objects', 'wh_order.object.ts'), 'utf8')).toBe(DRAFT_SOURCE);
  });

  it('creates no missing directory, and does not report one as outside the tree', async () => {
    const { project } = tree();

    const run = await introspect(project, 'objects/new_dir/wh_order.object.ts');

    // No `mkdir`: the write fails exactly as it did before the jail resolved
    // symlinks, and the failure is not the jail's refusal.
    expect(run.failure?.message).toContain('ENOENT');
    expect(run.failure?.message).not.toContain('--out must be');
    expect(existsSync(join(project, 'objects', 'new_dir'))).toBe(false);
  });

  it.each(['../x.object.ts', 'objects/../../x.object.ts'])('refuses the traversing path %s, unchanged', async (out) => {
    const { project, outside } = tree();

    const run = await introspect(project, out);

    expect(run.failure).toEqual({ message: refusal(out), exit: 2 });
    expect(existsSync(join(dirname(project), 'x.object.ts'))).toBe(false);
    expect(readdirSync(outside)).toEqual([]);
  });

  it('refuses an absolute path, unchanged', async () => {
    const { project, outside } = tree();
    const out = join(outside, 'x.object.ts');

    const run = await introspect(project, out);

    expect(run.failure).toEqual({ message: refusal(out), exit: 2 });
    expect(readdirSync(outside)).toEqual([]);
  });
});
