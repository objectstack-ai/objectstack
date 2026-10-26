// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SeedSchema, seedFile } from '@objectstack/spec/data';
import { collectSeedFiles, placeSeedFiles } from './bundle-seed-files.js';

/**
 * [#25779] `os validate` and `os build` read each file a seed record names
 * with `seedFile(path)`, relative to the directory holding the config
 * (`collectSeedFiles`); `os build` then writes its bytes into the dataset's
 * `files` map (`placeSeedFiles`) — the shape the seed loader checks them
 * against. A path that names no file, climbs out of the root, or has a type
 * nobody can tell is refused.
 */

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

/** A package root holding `files`; answers the path of its (unread) config. */
function packageRoot(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'os-25779-'));
  roots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  return path.join(root, 'objectstack.config.ts');
}

/** Both halves, as `os build` runs them. */
function bundle(stack: Record<string, unknown>, config: string) {
  const collected = collectSeedFiles(config, stack);
  if (collected.issues.length === 0) placeSeedFiles(collected);
  return collected;
}

const sha = (text: string) => createHash('sha256').update(Buffer.from(text)).digest('hex');

describe('collectSeedFiles / placeSeedFiles', () => {
  it('writes each referenced file into its dataset, once per path, in the shape SeedSchema accepts', () => {
    const root = packageRoot({ 'fixtures/nda.pdf': '%PDF nda', 'scans/p1.png': 'png' });
    const dataset = {
      object: 'clm_version',
      records: [
        { code: 'V1', file: seedFile('fixtures/nda.pdf'), scans: [seedFile('scans/p1.png')] },
        { code: 'V2', file: seedFile('fixtures/nda.pdf') },
      ],
    };
    const result = bundle({ data: [dataset] }, root);
    expect(result.issues).toEqual([]);
    expect(result.files).toBe(2);
    expect(result.bytes).toBe(11);
    expect((dataset as any).files).toEqual({
      'fixtures/nda.pdf': {
        contentType: 'application/pdf',
        size: 8,
        sha256: sha('%PDF nda'),
        data: Buffer.from('%PDF nda').toString('base64'),
      },
      'scans/p1.png': { contentType: 'image/png', size: 3, sha256: sha('png'), data: Buffer.from('png').toString('base64') },
    });
    expect(SeedSchema.safeParse(dataset).success).toBe(true);
  });

  it('reaches the datasets of every package body too', () => {
    const root = packageRoot({ 'a.txt': 'hello' });
    const inner = { object: 'x', records: [{ f: seedFile('a.txt') }] };
    bundle({ packages: [{ manifest: { data: [inner] } }] }, root);
    expect((inner as any).files['a.txt'].contentType).toBe('text/plain');
  });

  it('leaves a dataset that names no seed file exactly as it was', () => {
    const dataset = { object: 'x', records: [{ name: 'a' }] };
    const result = bundle({ data: [dataset] }, packageRoot({}));
    expect(result).toEqual({ datasets: new Map(), files: 0, bytes: 0, issues: [] });
    expect(dataset).toEqual({ object: 'x', records: [{ name: 'a' }] });
  });

  it('refuses a path that names no file, saying where the reference sits', () => {
    const result = collectSeedFiles(
      packageRoot({}),
      { data: [{ object: 'x', records: [{ code: 'a' }, { file: seedFile('fixtures/missing.pdf') }] }] },
    );
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].location).toBe('data[0].records[1].file');
    expect(result.issues[0].message).toContain("seedFile('fixtures/missing.pdf') names no file");
  });

  it('refuses a type it cannot tell, unless the reference names one', () => {
    const root = packageRoot({ 'blob.bin': 'xx' });
    const refused = collectSeedFiles(root, { data: [{ object: 'x', records: [{ f: seedFile('blob.bin') }] }] });
    expect(refused.issues[0].message).toContain("the file's type cannot be told from its extension");

    const named = { object: 'x', records: [{ f: seedFile('blob.bin', { contentType: 'application/octet-stream' }) }] };
    expect(bundle({ data: [named] }, root).issues).toEqual([]);
    expect((named as any).files['blob.bin'].contentType).toBe('application/octet-stream');
  });

  it('a type the reference names wins over the one its extension suggests', () => {
    const root = packageRoot({ 'scan.pdf': 'x' });
    const dataset = { object: 'x', records: [{ f: seedFile('scan.pdf', { contentType: 'application/x-pdf' }) }] };
    bundle({ data: [dataset] }, root);
    expect((dataset as any).files['scan.pdf'].contentType).toBe('application/x-pdf');
  });

  it('the gate writes nothing: the stack it judged is unchanged until placeSeedFiles', () => {
    const root = packageRoot({ 'a.txt': 'hello' });
    const dataset = { object: 'x', records: [{ f: seedFile('a.txt') }] };
    const collected = collectSeedFiles(root, { data: [dataset] });
    expect(collected.files).toBe(1);
    expect('files' in dataset).toBe(false);
    placeSeedFiles(collected);
    expect((dataset as any).files['a.txt'].size).toBe(5);
  });

  it('never reads outside the package root', () => {
    const root = packageRoot({});
    const result = collectSeedFiles(root, { data: [{ object: 'x', records: [{ f: { $file: '../outside.pdf' } }] }] });
    expect(result.issues[0].message).toContain('climbs out of the package root');
  });
});
