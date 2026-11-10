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
//   - CONTROL: a package declaring fresh names installs.
//
// [#32071, ADR-0150 D3] The same boot drives `mapping`'s by-name readers,
// which consult `(package, name)` and name no package: a name two packages
// hold is refused naming both (bare `/meta`, the import door's `mappingName`),
// the qualified address and `?package=` reach each holder, and one holder —
// including a package's mapping into an object a package it depends on owns
// (`zeta` into `alpha_item`) — answers as before. The connector pull's read is
// the same protocol read, pinned in service-automation's `connector-pull.test.ts`.

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
    picklists: [picklist(p)],
    mappings: [mapping(p)],
    datasets: [dataset(p)],
  } as never);
}

/**
 * [#32071] A package that depends on `alpha` and ships the one holder of a
 * mapping into `alpha`'s object: the cross-package one-holder import.
 */
const ZETA_MAPPING = 'qa_zeta_into_alpha';
function zetaPackage() {
  return defineStack({
    manifest: {
      id: 'com.qa.bare.zeta', namespace: 'zeta', name: 'qa_bare_zeta', version: '1.0.0', type: 'app',
      dependencies: { 'com.qa.bare.alpha': '^1.0.0' },
    },
    mappings: [mapping('zeta', ZETA_MAPPING, 'alpha_item')],
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
        new AppPlugin(zetaPackage() as never),
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

  // ── [#32071] mapping's by-name readers, on the clash this boot holds ──

  const metaRead = async (path: string) => {
    const r = await stack.apiAs(admin, 'GET', path);
    return { status: r.status, body: (await r.json()) as any };
  };
  const importDry = async (object: string, mappingName: string) => {
    const r = await stack.apiAs(admin, 'POST', `/data/${object}/import`, { format: 'csv', csv: 'Name\nx', mappingName, dryRun: true });
    return { status: r.status, body: (await r.json()) as any };
  };
  const labelIn = (body: any) => body?.item?.label ?? body?.data?.item?.label;

  it('mapping: the bare /meta read of a name two packages hold is 409 RESOURCE_CONFLICT naming both', async () => {
    const { status, body } = await metaRead(`/meta/mapping/${MAPPING}`);
    expect([status, codeOf(body)], JSON.stringify(body)).toEqual([409, 'RESOURCE_CONFLICT']);
    const message = JSON.stringify(body);
    expect(message).toContain('com.qa.bare.alpha');
    expect(message).toContain('com.qa.bare.beta');
  });

  it('mapping: the qualified address and ?package= each reach their own holder', async () => {
    for (const p of ['alpha', 'beta'] as const) {
      const qualified = await metaRead(`/meta/mapping/${p}/${MAPPING}`);
      expect([qualified.status, labelIn(qualified.body)], JSON.stringify(qualified.body)).toEqual([200, `${p} mapping`]);
      const byPackage = await metaRead(`/meta/mapping/${MAPPING}?package=com.qa.bare.${p}`);
      expect([byPackage.status, labelIn(byPackage.body)], JSON.stringify(byPackage.body)).toEqual([200, `${p} mapping`]);
    }
  });

  it('mapping: importing by a name two packages hold is 409 RESOURCE_CONFLICT naming both, never the first holder\'s MAPPING_TARGET_MISMATCH', async () => {
    for (const object of ['alpha_item', 'beta_item']) {
      const { status, body } = await importDry(object, MAPPING);
      expect([status, codeOf(body)], JSON.stringify(body)).toEqual([409, 'RESOURCE_CONFLICT']);
      expect(String(body?.error)).toContain('com.qa.bare.alpha');
      expect(String(body?.error)).toContain('com.qa.bare.beta');
    }
  });

  it('mapping: an address naming a package that does not hold the name is 409 naming its holder, never the holder\'s item under that address', async () => {
    for (const path of [`/meta/mapping/beta/${ZETA_MAPPING}`, `/meta/mapping/${ZETA_MAPPING}?package=com.qa.bare.beta`]) {
      const { status, body } = await metaRead(path);
      expect([status, codeOf(body)], `${path} ${JSON.stringify(body)}`).toEqual([409, 'RESOURCE_CONFLICT']);
      expect(JSON.stringify(body)).toContain('com.qa.bare.zeta');
    }
  });

  it('CONTROL — mapping: one holder answers as before, a package\'s mapping into the object of a package it depends on included', async () => {
    const own = await metaRead(`/meta/mapping/${SHOWCASE_MAPPING}`);
    expect([own.status, own.body?.item?._packageId ?? own.body?.data?.item?._packageId]).toEqual([200, SHOWCASE_PKG]);
    const cross = await metaRead(`/meta/mapping/${ZETA_MAPPING}`);
    expect([cross.status, labelIn(cross.body)], JSON.stringify(cross.body)).toEqual([200, 'zeta mapping']);
    const imported = await importDry('alpha_item', ZETA_MAPPING);
    expect([imported.status, imported.body?.ok, imported.body?.errors], JSON.stringify(imported.body)).toEqual([200, 1, 0]);
    const mismatch = await importDry('beta_item', ZETA_MAPPING);
    expect([mismatch.status, codeOf(mismatch.body)], JSON.stringify(mismatch.body)).toEqual([400, 'MAPPING_TARGET_MISMATCH']);
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
