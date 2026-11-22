// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36366 — `actionLayout`, the order of an object's actions and
 * which are buttons per scope, is a fold scalar of the object extension
 * (ADR-0146 D10: an installed object is extended, never replaced). The fold
 * (`mergeObjectDefinitions`) carries it arm by arm: an arm the extension sets
 * replaces the running arm whole (`pinned` and `more` together), an arm it
 * leaves out stays. Two extenders resolve by `priority` (the higher one is
 * written last), and a value the tenant authored on the base stays (the
 * ADR-0029 D9.2a yield the three string scalars take).
 */

import { describe, it, expect } from 'vitest';
import { SchemaRegistry } from './registry.js';

const BASE = 'com.acme.crm';
const PAIR = 'com.acme.crm.custom';
const PARTNER = 'com.partner.crm-ext';

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

const pinned = (r: SchemaRegistry) => (r.getObject('crm_lead') as unknown as Record<string, unknown>).actionLayout;

describe('#36366 — an object extension re-arranges the object\'s actions', () => {
  it('an extension-only pin: the base pins nothing, the object is served with the extension\'s pins', () => {
    const r = registry();
    r.registerObjectExtension({ extend: 'crm_lead', actionLayout: { record: { pinned: ['convert_lead', 'log_call'] } } }, PAIR);
    expect(pinned(r)).toEqual({ record: { pinned: ['convert_lead', 'log_call'] } });
  });

  it('a base plus extension pin: the arm the extension sets replaces the base\'s, the other arm stays', () => {
    const r = registry({ ...LEAD, actionLayout: { list: { pinned: ['$export'] }, record: { pinned: ['log_call'] } } });
    r.registerObjectExtension({ extend: 'crm_lead', actionLayout: { record: { pinned: ['convert_lead'] } } }, PAIR);
    expect(pinned(r)).toEqual({ list: { pinned: ['$export'] }, record: { pinned: ['convert_lead'] } });
  });

  it('an arm is replaced whole: the base\'s `more` does not survive an extension arm that leaves it out', () => {
    const r = registry({ ...LEAD, actionLayout: { record: { pinned: ['log_call'], more: ['clone_lead', 'send_email'] } } });
    r.registerObjectExtension({ extend: 'crm_lead', actionLayout: { record: { pinned: ['convert_lead'] } } }, PAIR);
    expect(pinned(r)).toEqual({ record: { pinned: ['convert_lead'] } });
    r.registerObjectExtension(
      { extend: 'crm_lead', actionLayout: { record: { pinned: [], more: ['send_email', 'log_call'] } }, priority: 300 },
      PARTNER,
    );
    expect(pinned(r)).toEqual({ record: { pinned: [], more: ['send_email', 'log_call'] } });
  });

  it('an empty arm is a pin too: nothing drawn as a button on that page', () => {
    const r = registry({ ...LEAD, actionLayout: { record: { pinned: ['log_call'] } } });
    r.registerObjectExtension({ extend: 'crm_lead', actionLayout: { record: { pinned: [] } } }, PAIR);
    expect(pinned(r)).toEqual({ record: { pinned: [] } });
  });

  it('an extension that pins nothing leaves the base\'s pins, and the packaged base keeps its own', () => {
    const r = registry({ ...LEAD, actionLayout: { record: { pinned: ['log_call'] } } });
    r.registerObjectExtension({ extend: 'crm_lead', label: 'Prospect' }, PAIR);
    expect(pinned(r)).toEqual({ record: { pinned: ['log_call'] } });
    r.registerObjectExtension({ extend: 'crm_lead', actionLayout: { record: { pinned: ['convert_lead'] } }, priority: 300 }, PARTNER);
    expect((r.getPackagedObjectBase('crm_lead') as unknown as Record<string, unknown>).actionLayout).toEqual({ record: { pinned: ['log_call'] } });
  });

  it('two extenders resolve by priority: the higher one is written last', () => {
    const r = registry();
    r.registerObjectExtension({ extend: 'crm_lead', actionLayout: { record: { pinned: ['a_partner'] } }, priority: 250 }, PARTNER);
    r.registerObjectExtension({ extend: 'crm_lead', actionLayout: { record: { pinned: ['a_custom'] } }, priority: 150 }, PAIR);
    expect(pinned(r)).toEqual({ record: { pinned: ['a_partner'] } });
  });

  it('pins the tenant authored on the base stay over an extender\'s (ADR-0029 D9.2a)', () => {
    const r = registry({ ...LEAD, actionLayout: { record: { pinned: ['log_call'] } } });
    r.registerObject({ ...clone(LEAD), actionLayout: { record: { pinned: ['send_email'] } }, _provenance: 'org' } as never, BASE, undefined, 'overlay');
    r.registerObjectExtension({ extend: 'crm_lead', actionLayout: { record: { pinned: ['convert_lead'] } } }, PAIR);
    expect(pinned(r)).toEqual({ record: { pinned: ['send_email'] } });
  });

  it('a tenant overlay that only re-orders `more` authored a value: it stays over an extender\'s', () => {
    const r = registry({ ...LEAD, actionLayout: { record: { pinned: ['log_call'], more: ['a_one', 'a_two'] } } });
    r.registerObject(
      { ...clone(LEAD), actionLayout: { record: { pinned: ['log_call'], more: ['a_two', 'a_one'] } }, _provenance: 'org' } as never,
      BASE,
      undefined,
      'overlay',
    );
    r.registerObjectExtension({ extend: 'crm_lead', actionLayout: { record: { pinned: ['convert_lead'] } } }, PAIR);
    expect(pinned(r)).toEqual({ record: { pinned: ['log_call'], more: ['a_two', 'a_one'] } });
  });

  it('a tenant overlay that repeats the packaged pins authored nothing: the extender applies', () => {
    const r = registry({ ...LEAD, actionLayout: { record: { pinned: ['log_call'] } } });
    r.registerObject({ ...clone(LEAD), actionLayout: { record: { pinned: ['log_call'] } }, _provenance: 'org' } as never, BASE, undefined, 'overlay');
    r.registerObjectExtension({ extend: 'crm_lead', actionLayout: { record: { pinned: ['convert_lead'] } } }, PAIR);
    expect(pinned(r)).toEqual({ record: { pinned: ['convert_lead'] } });
  });

  it('is idempotent over an already-folded base', () => {
    const r = registry({ ...LEAD, actionLayout: { list: { pinned: ['$import'] } } });
    r.registerObjectExtension({ extend: 'crm_lead', actionLayout: { record: { pinned: ['convert_lead'] } } }, PAIR);
    const once = r.getObject('crm_lead') as unknown as Record<string, unknown>;
    const twice = r.foldObjectExtendersOnto('crm_lead', clone(once) as never) as unknown as Record<string, unknown>;
    expect(twice.actionLayout).toEqual(once.actionLayout);
  });

  it('control: an object nothing pins is served without the key', () => {
    const r = registry();
    r.registerObjectExtension({ extend: 'crm_lead', label: 'Prospect' }, PAIR);
    expect('actionLayout' in (r.getObject('crm_lead') as object)).toBe(false);
  });
});
