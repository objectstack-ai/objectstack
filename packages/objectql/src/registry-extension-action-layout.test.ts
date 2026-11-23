// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36366 — `actionLayout`, the order of an object's actions and
 * which are buttons per scope, is one of the paired `.custom` package's
 * arrangement keys on an object extension (`CUSTOM_ARRANGEMENT_KEYS`,
 * ADR-0146 D10), as `fieldGroups` and `relatedLists` are:
 *
 *  - only the object's own pair is applied, by role, never by `priority` or
 *    fold order (ADR-0146 D2); any other package's `actionLayout` is skipped
 *    and named (the doors refuse it before it gets here);
 *  - it is applied LAST (`applyCustomArrangement`), arm by arm: each arm the
 *    pair writes replaces the arm the object serves for that scope, whole
 *    (`pinned` and `more` together), and an arm it does not write stays as
 *    the owner, or a tenant base, gives it.
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import { SchemaRegistry } from './registry.js';

const BASE = 'com.acme.crm';
const PAIR = 'com.acme.crm.custom';
const PARTNER = 'com.partner.crm-ext';
const OTHER_PAIR = 'com.partner.crm-ext.custom';

const LEAD = {
  name: 'crm_lead',
  label: 'Lead',
  fields: { title: { name: 'title', type: 'text', label: 'Title' } },
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function registry(base: Record<string, unknown> = LEAD): SchemaRegistry {
  const r = new SchemaRegistry({ multiTenant: false });
  r.logLevel = 'silent';
  r.registerObject(clone(base) as never, BASE, undefined, 'own');
  return r;
}

const layout = (r: SchemaRegistry) => (r.getObject('crm_lead') as unknown as Record<string, unknown>).actionLayout;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('#36366 — the paired `.custom` extension arranges the object\'s actions', () => {
  it('the pair\'s arm is served where the base arranges nothing', () => {
    const r = registry();
    r.registerObjectExtension({ extend: 'crm_lead', actionLayout: { record: { pinned: ['convert_lead', 'log_call'] } } }, PAIR);
    expect(layout(r)).toEqual({ record: { pinned: ['convert_lead', 'log_call'] } });
  });

  it('arm by arm: the arm the pair writes replaces the base\'s, the arm it leaves out stays', () => {
    const r = registry({ ...LEAD, actionLayout: { list: { pinned: ['$export'] }, record: { pinned: ['log_call'] } } });
    r.registerObjectExtension({ extend: 'crm_lead', actionLayout: { record: { pinned: ['convert_lead'] } } }, PAIR);
    expect(layout(r)).toEqual({ list: { pinned: ['$export'] }, record: { pinned: ['convert_lead'] } });
  });

  it('an arm is replaced whole: the base\'s `more` does not survive a pair arm that leaves it out', () => {
    const r = registry({ ...LEAD, actionLayout: { record: { pinned: ['log_call'], more: ['clone_lead', 'send_email'] } } });
    r.registerObjectExtension({ extend: 'crm_lead', actionLayout: { record: { pinned: ['convert_lead'] } } }, PAIR);
    expect(layout(r)).toEqual({ record: { pinned: ['convert_lead'] } });
  });

  it('an empty `pinned` is an arrangement too: no action of that scope is a button', () => {
    const r = registry({ ...LEAD, actionLayout: { record: { pinned: ['log_call'] } } });
    r.registerObjectExtension({ extend: 'crm_lead', actionLayout: { record: { pinned: [] } } }, PAIR);
    expect(layout(r)).toEqual({ record: { pinned: [] } });
  });

  it('M1: another package\'s `actionLayout` is not applied, whatever its priority; the pair\'s is, and the skip is named', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = registry();
    r.registerObjectExtension({ extend: 'crm_lead', actionLayout: { record: { pinned: ['a_partner'] } }, priority: 250 }, PARTNER);
    r.registerObjectExtension({ extend: 'crm_lead', actionLayout: { record: { pinned: ['a_custom'] } }, priority: 150 }, PAIR);
    expect(layout(r)).toEqual({ record: { pinned: ['a_custom'] } });
    const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('is not applied'));
    expect(lines.some((l) => l.includes(`from package "${PARTNER}"`) && l.includes('`actionLayout`'))).toBe(true);
  });

  it('M1: at the same default priority, a package registered after the pair does not win', () => {
    const r = registry();
    r.registerObjectExtension({ extend: 'crm_lead', actionLayout: { record: { pinned: ['a_custom'] } } }, PAIR);
    r.registerObjectExtension({ extend: 'crm_lead', actionLayout: { record: { pinned: ['a_partner'] } } }, PARTNER);
    expect(layout(r)).toEqual({ record: { pinned: ['a_custom'] } });
  });

  it('M1: alone, another package\'s `actionLayout` changes nothing, nor does a `.custom` package that is not the object\'s pair', () => {
    for (const pkg of [PARTNER, OTHER_PAIR]) {
      const r = registry({ ...LEAD, actionLayout: { record: { pinned: ['log_call'] } } });
      r.registerObjectExtension({ extend: 'crm_lead', actionLayout: { record: { pinned: ['a_other'] }, list: { pinned: [] } } }, pkg);
      expect(layout(r), pkg).toEqual({ record: { pinned: ['log_call'] } });
    }
  });

  it('S2: a tenant base that arranged one scope keeps it, and the pair\'s other arm still applies', () => {
    const r = registry();
    r.registerObject({ ...clone(LEAD), actionLayout: { list: { pinned: ['$import'] } }, _provenance: 'org' } as never, BASE, undefined, 'overlay');
    r.registerObjectExtension({ extend: 'crm_lead', actionLayout: { record: { pinned: ['convert_lead'] } } }, PAIR);
    expect(layout(r)).toEqual({ list: { pinned: ['$import'] }, record: { pinned: ['convert_lead'] } });
  });

  it('S2: where the pair and a tenant base arrange the same scope, the pair\'s arm is served (applied last, by role)', () => {
    const r = registry();
    r.registerObject({ ...clone(LEAD), actionLayout: { record: { pinned: ['send_email'] } }, _provenance: 'org' } as never, BASE, undefined, 'overlay');
    r.registerObjectExtension({ extend: 'crm_lead', actionLayout: { record: { pinned: ['convert_lead'] } } }, PAIR);
    expect(layout(r)).toEqual({ record: { pinned: ['convert_lead'] } });
  });

  it('N2: a pair `actionLayout` that is no object, or an arm that is no object, is not applied', () => {
    const r = registry({ ...LEAD, actionLayout: { record: { pinned: ['log_call'] } } });
    r.registerObjectExtension({ extend: 'crm_lead', actionLayout: [{ pinned: ['a_bad'] }] } as never, PAIR);
    expect(layout(r)).toEqual({ record: { pinned: ['log_call'] } });
    const empty = registry({ ...LEAD, actionLayout: { record: { pinned: ['log_call'] } } });
    empty.registerObjectExtension({ extend: 'crm_lead', actionLayout: { record: 'log_call' } } as never, PAIR);
    expect(layout(empty)).toEqual({ record: { pinned: ['log_call'] } });
  });

  it('the packaged base keeps its own arrangement', () => {
    const r = registry({ ...LEAD, actionLayout: { record: { pinned: ['log_call'] } } });
    r.registerObjectExtension({ extend: 'crm_lead', actionLayout: { record: { pinned: ['convert_lead'] } } }, PAIR);
    expect((r.getPackagedObjectBase('crm_lead') as unknown as Record<string, unknown>).actionLayout).toEqual({ record: { pinned: ['log_call'] } });
  });

  it('is idempotent over an already-folded base', () => {
    const r = registry({ ...LEAD, actionLayout: { list: { pinned: ['$import'] } } });
    r.registerObjectExtension({ extend: 'crm_lead', actionLayout: { record: { pinned: ['convert_lead'] } } }, PAIR);
    const once = r.getObject('crm_lead') as unknown as Record<string, unknown>;
    const twice = r.foldObjectExtendersOnto('crm_lead', clone(once) as never) as unknown as Record<string, unknown>;
    expect(twice.actionLayout).toEqual(once.actionLayout);
  });

  it('control: an object nothing arranges is served without the key', () => {
    const r = registry();
    r.registerObjectExtension({ extend: 'crm_lead', label: 'Prospect' }, PAIR);
    expect('actionLayout' in (r.getObject('crm_lead') as object)).toBe(false);
  });
});
