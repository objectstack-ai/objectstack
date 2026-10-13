// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D6] `defineStack` refuses a package that PERMITS the `unmanaged`
 * install mode while it carries what an unmanaged install cannot copy — the
 * authoring half of the stage-0 ACCEPT's Q5 ("a declared mode is enforced",
 * refused at authoring and again at the install door before any write).
 *
 * What is pinned:
 *  - the refusal: `STACK_UNMANAGED_INSTALL_UNCOPYABLE` / 422, one `issues`
 *    entry per key, each naming the key — for a runtime-uncreatable collection
 *    (read off the registry's `allowRuntimeCreate`, never a list kept here), code,
 *    an extension of another package's items, and a manifest-level key;
 *  - the CONTROL on every row: the same stack permitting only `managed` — or
 *    declaring no `installModes` at all — is accepted, so the refusal is about
 *    the declared mode and nothing else;
 *  - a copyable package permits `unmanaged` cleanly, alone or beside `managed`,
 *    translation bundles and seed data included; an empty code container is no
 *    code.
 */
import { describe, expect, it } from 'vitest';
import { defineStack } from './stack.zod';
import { DEFAULT_METADATA_TYPE_REGISTRY } from './kernel/metadata-plugin.zod';
import { ERROR_CODE_LEDGER, ErrorCode } from './api/error-code-ledger.zod';

type Envelope = Error & { code?: string; status?: number; issues?: readonly string[] };

function refusal(config: unknown): Envelope | null {
  try {
    defineStack(config as never);
    return null;
  } catch (e) {
    return e as Envelope;
  }
}

const manifest = (installModes?: string[]) => ({
  id: 'com.example.unmanagedprobe',
  name: 'unmanaged-probe',
  version: '1.0.0',
  type: 'app' as const,
  namespace: 'probe',
  ...(installModes ? { installModes } : {}),
});

const task = { name: 'probe_task', label: 'Task', fields: { title: { type: 'text', label: 'Title' } } };
const region = {
  name: 'probe_region',
  label: 'Region',
  options: [{ label: 'North', value: 'north' }, { label: 'South', value: 'south' }],
};

const BOTH = ['managed', 'unmanaged'];

const rows: Array<{ site: string; extra: Record<string, unknown>; manifestExtra?: Record<string, unknown>; key: string }> = [
  { site: 'a runtime-uncreatable collection (`picklists`)', extra: { picklists: [region] }, key: '`picklists`' },
  { site: 'code (`functions`)', extra: { functions: { probe_noop: () => undefined } }, key: '`functions`' },
  {
    site: 'an extension of another package\'s object (`objectExtensions`)',
    extra: { objectExtensions: [{ extend: 'sys_user', fields: { probe_badge: { type: 'text', label: 'Badge' } } }] },
    key: '`objectExtensions`',
  },
];

describe('defineStack refuses `installModes` with `unmanaged` on a package the copy cannot write (ADR-0131 D6)', () => {
  it('the premise: the registry declares runtime-uncreatable types, `picklist` among them', () => {
    const uncreatable = DEFAULT_METADATA_TYPE_REGISTRY.filter((e) => !e.allowRuntimeCreate).map((e) => e.type);
    expect(uncreatable).toEqual(expect.arrayContaining(['agent', 'api', 'capability', 'field', 'job', 'picklist']));
  });

  for (const row of rows) {
    describe(row.site, () => {
      it('is refused with STACK_UNMANAGED_INSTALL_UNCOPYABLE / 422, the finding naming the key', () => {
        const refused = refusal({ manifest: manifest(BOTH), objects: [task], ...row.extra });
        expect(refused, 'refused').toBeInstanceOf(Error);
        expect(refused?.code).toBe('STACK_UNMANAGED_INSTALL_UNCOPYABLE');
        expect(refused?.status).toBe(422);
        expect(refused?.message).toMatch(/^defineStack unmanaged install-mode validation failed \(1 issue\):/);
        expect(refused?.issues).toHaveLength(1);
        expect(refused?.issues?.[0]).toContain(row.key);
        expect(refused?.message).toContain("Remove 'unmanaged' from `manifest.installModes`");
      });

      it('CONTROL: the same stack permitting only `managed`, or declaring no `installModes`, is accepted', () => {
        expect(refusal({ manifest: manifest(['managed']), objects: [task], ...row.extra })).toBeNull();
        expect(refusal({ manifest: manifest(), objects: [task], ...row.extra })).toBeNull();
      });
    });
  }

  it('judges the manifest\'s own keys too — `manifest.navigationContributions` targets another package\'s app', () => {
    const navigationContributions = [{ app: 'setup', items: [{ id: 'nav_probe', type: 'url', label: 'Probe', url: '/probe' }] }];
    const refused = refusal({ manifest: { ...manifest(BOTH), navigationContributions }, objects: [task] });
    expect(refused?.code).toBe('STACK_UNMANAGED_INSTALL_UNCOPYABLE');
    expect(refused?.issues).toHaveLength(1);
    expect(refused?.issues?.[0]).toContain('`manifest.navigationContributions`');
    // CONTROL: the same contribution on a managed-only package is accepted.
    expect(refusal({ manifest: { ...manifest(['managed']), navigationContributions }, objects: [task] })).toBeNull();
  });

  it('names every finding at once — one `issues` entry per key', () => {
    const refused = refusal({
      manifest: manifest(['unmanaged']),
      objects: [task],
      picklists: [region],
      functions: { probe_noop: () => undefined },
    });
    expect(refused?.code).toBe('STACK_UNMANAGED_INSTALL_UNCOPYABLE');
    expect(refused?.issues).toHaveLength(2);
    expect(refused?.message).toMatch(/\(2 issues\):/);
  });

  it('a copyable package permits `unmanaged` — alone or beside `managed` — with translations and seed data', () => {
    const copyable = {
      objects: [task],
      translations: [{ 'zh-CN': { objects: { probe_task: { label: '任务' } } } }],
      data: [{ object: 'probe_task', records: [{ title: 'First' }] }],
    };
    expect(refusal({ manifest: manifest(BOTH), ...copyable })).toBeNull();
    expect(refusal({ manifest: manifest(['unmanaged']), ...copyable })).toBeNull();
  });

  it('an empty code container is no code — `functions: {}` permits `unmanaged`', () => {
    expect(refusal({ manifest: manifest(BOTH), objects: [task], functions: {} })).toBeNull();
  });

  it('the code is a member of the closed ErrorCode union, registered under @objectstack/spec', () => {
    expect(ErrorCode.safeParse('STACK_UNMANAGED_INSTALL_UNCOPYABLE').success).toBe(true);
    expect(ERROR_CODE_LEDGER['@objectstack/spec']).toContain('STACK_UNMANAGED_INSTALL_UNCOPYABLE');
  });
});
