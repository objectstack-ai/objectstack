// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#30803] One name, one package holder for a picklist, a mapping and a
// dataset (maintainer ruling C on #30798, phase 1; ADR-0048 §3.4 narrowed;
// `packages/objectql/src/bare-name-one-holder.ts`), on a booted showcase.
//
// The registry's own pins (`registry-bare-name-one-holder.test.ts`) drive the
// engine's package door and item seam in-process. This file drives the rule at
// the doors a deployment reaches:
//
//   - the cold boot of a deployment that already holds a clash — two
//     `AppPlugin` packages, `alpha` and `beta`, shipping one picklist, mapping
//     and dataset under the same bare names — boots, and logs ONE warning line
//     naming both holders and the rename for every name (the switch's default,
//     `'warn'`, until the maintainer rules);
//   - `POST /marketplace/install-local` of a third package declaring one of
//     those names after the boot is 422 PLUGIN_REGISTER_FAILED, naming both
//     holders and the rename, and installs nothing;
//   - the same door refusing a package that redeclares the showcase's own
//     mapping and dataset names, naming the showcase;
//   - CONTROL: a package declaring fresh names installs;
//   - [#32070] the picklist's by-name read on that clash answers by ADR-0150
//     D3: the bare `GET /meta/picklist/NAME` is 409 naming both holders, each
//     qualified address reaches its own list, a qualifier that does not hold
//     the name is refused, and each field still serves its own package's
//     options (child E6). CONTROL: a name one package holds is served as
//     before at the bare and the holder's addresses.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { AppPlugin } from '@objectstack/runtime';
import { MarketplaceInstallLocalPlugin } from '@objectstack/cloud-connection';
import { defineStack } from '@objectstack/spec';
import { PROTOCOL_MAJOR } from '@objectstack/spec/kernel';
import { bootShowcase } from './showcase-boot.js';

const SHOWCASE_PKG = 'com.example.showcase';
const SHOWCASE_MAPPING = 'showcase_inquiry_feed';
const SHOWCASE_DATASET = 'showcase_task_metrics';
const PICKLIST = 'qa_shared_status';
const MAPPING = 'qa_shared_mapping';
const DATASET = 'qa_shared_dataset';
/** A picklist only `alpha` holds: the one-holder CONTROL. */
const SOLO_PICKLIST = 'qa_alpha_status';

const picklist = (p: string, name = PICKLIST) => ({
  name, label: `${p} status`, options: [{ label: `${p} one`, value: `${p}_one` }],
});
const mapping = (p: string, name = MAPPING, targetObject = `${p}_item`) => ({
  name, label: `${p} mapping`, sourceFormat: 'csv', targetObject, fieldMapping: [{ source: 'Name', target: 'name' }],
});
const dataset = (p: string, name = DATASET, object = `${p}_item`) => ({
  name, label: `${p} dataset`, object,
  dimensions: [{ name: 'note', label: `${p} note`, field: 'note', type: 'string' }],
  measures: [{ name: 'row_count', label: `${p} count`, aggregate: 'count' }],
});

/** One of the two packages the cold boot registers, each shipping all three names. */
function bootPackage(p: 'alpha' | 'beta') {
  return defineStack({
    manifest: { id: `com.qa.bare.${p}`, namespace: p, name: `qa_bare_${p}`, version: '1.0.0', type: 'app' },
    objects: [
      {
        name: `${p}_item`,
        label: `${p} item`,
        sharingModel: 'public_read_write',
        fields: {
          name: { type: 'text', label: 'Name' },
          note: { type: 'text', label: 'Note' },
          status: { type: 'select', label: 'Status', picklist: PICKLIST },
        },
      },
    ],
    picklists: [picklist(p), ...(p === 'alpha' ? [picklist(p, SOLO_PICKLIST)] : [])],
    mappings: [mapping(p)],
    datasets: [dataset(p)],
  } as never);
}

/** An inline install-local manifest. */
const inline = (p: string, collections: Record<string, unknown[]>) => ({
  manifest: {
    id: `com.qa.bare.${p}`, namespace: p, name: `qa_bare_${p}`, version: '1.0.0', type: 'app', scope: 'project',
    engines: { protocol: `^${PROTOCOL_MAJOR}` },
    ...collections,
  },
});

/** Every line the process writes while `run` is in flight (security-catalog-one-holder-http's instrument). */
async function captureOutput<T>(run: () => Promise<T>): Promise<{ value: T; lines: string[] }> {
  const chunks: string[] = [];
  const stdout = process.stdout.write.bind(process.stdout);
  const stderr = process.stderr.write.bind(process.stderr);
  const warn = console.warn;
  (process.stdout as any).write = (chunk: unknown, ...rest: any[]) => { chunks.push(String(chunk)); return stdout(chunk as any, ...rest); };
  (process.stderr as any).write = (chunk: unknown, ...rest: any[]) => { chunks.push(String(chunk)); return stderr(chunk as any, ...rest); };
  console.warn = (...args: unknown[]) => { chunks.push(`WARN ${args.map(String).join(' ')}\n`); warn(...args); };
  try {
    const value = await run();
    return { value, lines: chunks.join('').split('\n') };
  } finally {
    (process.stdout as any).write = stdout;
    (process.stderr as any).write = stderr;
    console.warn = warn;
  }
}

/** The level of one kernel-logger line (`<ISO time> <LEVEL> <message> …`), or `undefined`. */
function levelOf(line: string): string | undefined {
  return /^(?:\S+Z\s+)?(DEBUG|INFO|WARN|ERROR|FATAL)\b/.exec(line.trim())?.[1];
}

const codeOf = (body: any) =>
  (body?.error && typeof body.error === 'object' ? body.error.code : undefined) ?? body?.code ?? null;

describe('one package holder per picklist, mapping and dataset name, on a booted showcase', () => {
  let stack: VerifyStack;
  let admin: string;
  let storageDir: string;
  let bootLines: string[] = [];

  const packageIds = async () => {
    const r = await stack.apiAs(admin, 'GET', '/packages');
    expect(r.status).toBe(200);
    const body = (await r.json()) as any;
    const rows = (body?.data?.packages ?? body?.packages ?? body?.data ?? body ?? []) as any[];
    return rows.map((p: any) => p?.manifest?.id ?? p?.id ?? p?.packageId).filter(Boolean).sort();
  };

  const installLocal = async (payload: unknown) => {
    const res = await stack.apiAs(admin, 'POST', '/marketplace/install-local', payload);
    return { status: res.status, body: (await res.json()) as any };
  };

  beforeAll(async () => {
    storageDir = mkdtempSync(join(tmpdir(), 'dogfood-bare-name-'));
    const booted = await captureOutput(() => bootShowcase({
      extraPlugins: [
        new AppPlugin(bootPackage('alpha') as never),
        new AppPlugin(bootPackage('beta') as never),
        new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir }),
      ],
    }));
    stack = booted.value;
    bootLines = booted.lines;
    admin = await stack.signIn();
  }, 300_000);

  afterAll(async () => {
    await stack?.stop();
    if (storageDir) rmSync(storageDir, { recursive: true, force: true });
  });

  it('the cold boot of a deployment holding the clash boots, and warns once naming both holders and the rename for every name', async () => {
    const warnings = bootLines.filter((l) => l.includes('Bare-name conflict at boot'));
    expect(warnings, 'one warning line').toHaveLength(1);
    const line = warnings[0]!;
    expect(levelOf(line)).toBe('WARN');
    for (const name of [PICKLIST, MAPPING, DATASET]) {
      expect(line, `names ${name}`).toContain(`"${name}"`);
      expect(line, `and its rename`).toContain(`"beta_${name}"`);
    }
    expect(line).toContain('com.qa.bare.alpha');
    expect(line).toContain('com.qa.bare.beta');
    expect(await packageIds(), 'both packages booted').toEqual(expect.arrayContaining(['com.qa.bare.alpha', 'com.qa.bare.beta']));
  });

  it('install-local of a third package declaring a held picklist name is 422 PLUGIN_REGISTER_FAILED naming both holders and the rename; nothing is installed', async () => {
    const before = await packageIds();
    const { status, body } = await installLocal(inline('gamma', { picklists: [picklist('gamma')] }));
    expect([status, codeOf(body)], JSON.stringify(body)).toEqual([422, 'PLUGIN_REGISTER_FAILED']);
    const message = String(body?.error?.message ?? '');
    expect(message).toContain(`"${PICKLIST}"`);
    expect(message).toContain('com.qa.bare.alpha');
    expect(message).toContain('com.qa.bare.beta');
    expect(message).toContain(`"gamma_${PICKLIST}"`);
    expect(await packageIds(), 'the package list is unchanged').toEqual(before);
  });

  it('install-local of a package redeclaring the showcase\'s mapping and dataset names is refused, naming the showcase', async () => {
    const before = await packageIds();
    const { status, body } = await installLocal(inline('delta', {
      mappings: [mapping('delta', SHOWCASE_MAPPING, 'showcase_task')],
      datasets: [dataset('delta', SHOWCASE_DATASET, 'showcase_task')],
    }));
    expect([status, codeOf(body)], JSON.stringify(body)).toEqual([422, 'PLUGIN_REGISTER_FAILED']);
    const message = String(body?.error?.message ?? '');
    expect(message).toContain(`"${SHOWCASE_MAPPING}"`);
    expect(message).toContain(`"${SHOWCASE_DATASET}"`);
    expect(message).toContain(SHOWCASE_PKG);
    expect(message).toContain(`"delta_${SHOWCASE_MAPPING}"`);
    expect(await packageIds(), 'the package list is unchanged').toEqual(before);
  });

  describe('[#32070] the picklist\'s by-name read answers by package (ADR-0150 D3)', () => {
    const read = async (path: string) => {
      const res = await stack.apiAs(admin, 'GET', path);
      return { status: res.status, body: (await res.json()) as any };
    };
    const labelOf = (body: any) => body?.item?.label ?? body?.data?.item?.label;
    const sentenceOf = (body: any) => String(typeof body?.error === 'string' ? body.error : body?.error?.message ?? '');

    it('the bare read of a name both packages hold is 409 RESOURCE_CONFLICT naming both, never the first registered', async () => {
      const { status, body } = await read(`/meta/picklist/${PICKLIST}`);
      expect([status, codeOf(body)], JSON.stringify(body)).toEqual([409, 'RESOURCE_CONFLICT']);
      expect(sentenceOf(body)).toContain('com.qa.bare.alpha');
      expect(sentenceOf(body)).toContain('com.qa.bare.beta');
    });

    it('each namespace address and each `?package=` reaches its own package\'s list', async () => {
      for (const p of ['alpha', 'beta']) {
        for (const path of [`/meta/picklist/${p}/${PICKLIST}`, `/meta/picklist/${PICKLIST}?package=com.qa.bare.${p}`]) {
          const { status, body } = await read(path);
          expect(status, `${path} ${JSON.stringify(body)}`).toBe(200);
          expect(labelOf(body), path).toBe(`${p} status`);
        }
      }
    });

    it('a qualifier that does not hold the name is refused naming its holder, never served another package\'s list', async () => {
      for (const path of [`/meta/picklist/beta/${SOLO_PICKLIST}`, `/meta/picklist/${SOLO_PICKLIST}?package=com.qa.bare.beta`, `/meta/picklist/_env/${SOLO_PICKLIST}`]) {
        const { status, body } = await read(path);
        expect([status, codeOf(body)], `${path} ${JSON.stringify(body)}`).toEqual([409, 'RESOURCE_CONFLICT']);
        expect(sentenceOf(body), path).toContain('com.qa.bare.alpha');
      }
    });

    it('CONTROL: a name one package holds is served at the bare address and at the holder\'s qualified addresses', async () => {
      for (const path of [`/meta/picklist/${SOLO_PICKLIST}`, `/meta/picklist/alpha/${SOLO_PICKLIST}`, `/meta/picklist/${SOLO_PICKLIST}?package=com.qa.bare.alpha`]) {
        const { status, body } = await read(path);
        expect(status, `${path} ${JSON.stringify(body)}`).toBe(200);
        expect(labelOf(body), path).toBe('alpha status');
      }
    });

    it('each field still serves its own package\'s options (child E6)', async () => {
      for (const p of ['alpha', 'beta']) {
        const { status, body } = await read(`/meta/object/${p}_item`);
        expect(status).toBe(200);
        const object = body?.data ?? body;
        const options = object?.fields?.status?.options ?? object?.item?.fields?.status?.options;
        expect(options, `${p}_item.status`).toEqual([{ label: `${p} one`, value: `${p}_one` }]);
      }
    });
  });

  it('CONTROL — install-local of a package declaring fresh names installs', async () => {
    const { status, body } = await installLocal(inline('epsilon', {
      picklists: [picklist('epsilon', 'epsilon_status')],
      mappings: [mapping('epsilon', 'epsilon_mapping', 'showcase_task')],
      datasets: [dataset('epsilon', 'epsilon_dataset', 'showcase_task')],
    }));
    expect(status, JSON.stringify(body)).toBeLessThan(300);
    expect(await packageIds()).toContain('com.qa.bare.epsilon');
  });
});
