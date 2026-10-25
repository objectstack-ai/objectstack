/**
 * objectui#7627 — the shared record-source reader is BEHAVIOUR-NEUTRAL at every
 * site that delegates to it.
 *
 * Six view plugins each spelled "the object this block is bound to" locally and
 * had drifted apart. Collapsing them onto {@link resolveRecordSourceObjectName}
 * is only legitimate if it changes nothing any of them resolves, so this file
 * TRANSCRIBES each site's pre-collapse expression verbatim and asserts the
 * post-collapse spelling agrees with it across the whole contract-valid input
 * matrix. A future edit to the reader that moves any site turns this red.
 *
 * The matrix is contract-valid by construction: `ViewDataSchema`'s `object`
 * provider is a `strictObject` carrying exactly `{ provider, object }` with
 * `object` REQUIRED, so `{ provider: 'object' }` without an `object` cannot be
 * published. The two sites that used to coerce that off-contract shape back to
 * `objectName` — `ObjectGrid`'s `'object' in dataConfig` test and `ObjectTree`'s
 * header tail — keep their own tail at the site, so their behaviour is pinned
 * here too, on both faces of the fork.
 */
import { describe, it, expect } from 'vitest';
import { resolveRecordSourceObjectName } from '../record-source.js';

type Schema = { objectName?: string; data?: unknown; staticData?: unknown[] };
type Cfg = { provider?: string; object?: string; items?: unknown[] } | null;

// --- getDataConfig, transcribed from the plugins (objectui#7632 tracks the
// --- duplication of the PRODUCER; this is a copy for measurement only).
const getDataConfig = (schema: Schema): Cfg => {
  if (schema.data) {
    if (Array.isArray(schema.data)) return { provider: 'value', items: schema.data };
    return schema.data as Cfg;
  }
  if (schema.staticData) return { provider: 'value', items: schema.staticData };
  if (schema.objectName) return { provider: 'object', object: schema.objectName };
  return null;
};

/** Every read site, `before` transcribed verbatim from `origin/main` 11edab88. */
const SITES: {
  id: string;
  before: (s: Schema, c: Cfg) => string | undefined;
  after: (s: Schema, c: Cfg) => string | undefined;
}[] = [
  {
    id: 'ObjectCalendar:309 schemaObjectName',
    before: (s, c) => (c?.provider === 'object' ? c.object : s.objectName),
    after: (s, c) => resolveRecordSourceObjectName(s, c),
  },
  {
    id: 'ObjectCalendar:969 overlay objectName',
    before: (s, c) => (c?.provider === 'object' ? c.object : s.objectName),
    after: (s, c) => resolveRecordSourceObjectName(s, c),
  },
  {
    id: 'ObjectGantt:661 resource',
    // `??` binds tighter than `?:`, so the pre-collapse line parses as
    // `cond ? c.object : (s.objectName ?? '')` — the empty-string floor applied
    // to the FALLBACK arm only.
    before: (s, c) => (c?.provider === 'object' ? c.object : s.objectName ?? ''),
    after: (s, c) => resolveRecordSourceObjectName(s, c) ?? '',
  },
  {
    id: 'ObjectTree:373 schemaKey',
    before: (s, c) => (c?.provider === 'object' ? c.object : s.objectName) ?? '',
    after: (s, c) => resolveRecordSourceObjectName(s, c) ?? '',
  },
  {
    id: 'ObjectTree:567 headerObjectName',
    before: (s, c) => (c?.provider === 'object' ? c.object : undefined) ?? s.objectName,
    after: (s, c) => resolveRecordSourceObjectName(s, c) ?? s.objectName,
  },
  {
    id: 'ObjectMap:764 metadata objectName',
    before: (s, c) => {
      const dataProvider = c?.provider;
      const dataObjectName = c?.provider === 'object' ? c.object : undefined;
      return dataProvider === 'object' ? dataObjectName : s.objectName;
    },
    after: (s, c) => resolveRecordSourceObjectName(s, c),
  },
  {
    id: 'ObjectGrid:1206 objectName',
    before: (s, c) => (c?.provider === 'object' && c && 'object' in c ? c.object : s.objectName),
    after: (s, c) => resolveRecordSourceObjectName(s, c) ?? s.objectName,
  },
];

/** The five shapes the dispatch named, plus every other one the ladder reaches. */
const CONTRACT_VALID: [string, Schema][] = [
  ['both-bindings', { objectName: 'Y', data: { provider: 'object', object: 'X' } }],
  ['data-only', { data: { provider: 'object', object: 'X' } }],
  ['objectName-only', { objectName: 'Y' }],
  ['empty-objectName', { objectName: '', data: { provider: 'object', object: 'X' } }],
  ['api-provider', { objectName: 'Y', data: { provider: 'api', read: { url: '/x' } } }],
  ['api-provider-no-name', { data: { provider: 'api', read: { url: '/x' } } }],
  ['value-provider', { objectName: 'Y', data: { provider: 'value', items: [1] } }],
  ['staticData+objectName', { objectName: 'Y', staticData: [1] }],
  ['staticData-only', { staticData: [1] }],
  ['array-shorthand', { objectName: 'Y', data: [1, 2] }],
  ['data-object-empty-string', { objectName: 'Y', data: { provider: 'object', object: '' } }],
  ['empty-objectName-only', { objectName: '' }],
  ['nothing-bound', {}],
];

describe('resolveRecordSourceObjectName — behaviour neutrality (objectui#7627)', () => {
  for (const [name, schema] of CONTRACT_VALID) {
    for (const site of SITES) {
      it(`${site.id} is unchanged for "${name}"`, () => {
        const cfg = getDataConfig(schema);
        expect(site.after(schema, cfg)).toEqual(site.before(schema, cfg));
      });
    }
  }
});

/**
 * The OFF-CONTRACT fork. `ViewDataSchema`'s `object` provider declares `object`
 * REQUIRED, so `data: { provider: 'object' }` without one cannot be published —
 * but two sites used to coerce it back to `objectName` anyway, and one of them
 * (`ObjectGrid`) gates permission verdicts with the result. The shared reader
 * deliberately does NOT carry that coercion (AGENTS.md #0.1); the two sites keep
 * it as their own tail. These cases pin the tails: delete one and this goes red,
 * which is the only thing standing between them and a future "redundant `??`"
 * cleanup.
 */
const OFF_CONTRACT_TAIL_SITES = ['ObjectTree:567 headerObjectName', 'ObjectGrid:1206 objectName'];

describe('the off-contract `{ provider: "object" }` tail (objectui#7627)', () => {
  const offContract: Cfg = { provider: 'object' };

  it('is not answered by the shared reader — no lenient rung was added', () => {
    expect(resolveRecordSourceObjectName({ objectName: 'accounts' }, offContract)).toBeUndefined();
  });

  for (const id of OFF_CONTRACT_TAIL_SITES) {
    const site = SITES.find((x) => x.id === id)!;
    it(`${id} keeps its own tail, so the shape still resolves to \`objectName\``, () => {
      const schema = { objectName: 'accounts' };
      expect(site.before(schema, offContract)).toBe('accounts');
      expect(site.after(schema, offContract)).toBe('accounts');
    });
  }

  it('the sites that never carried the tail still resolve nothing, exactly as before', () => {
    const schema = { objectName: 'accounts' };
    for (const id of ['ObjectCalendar:309 schemaObjectName', 'ObjectMap:764 metadata objectName']) {
      const site = SITES.find((x) => x.id === id)!;
      expect(site.after(schema, offContract)).toEqual(site.before(schema, offContract));
      expect(site.after(schema, offContract)).toBeUndefined();
    }
  });
});

describe('resolveRecordSourceObjectName — the ladder it carries (objectui#6939)', () => {
  // Bound rather than inlined: callers hand this reader a whole `ViewData`
  // (whose `value` member carries `items`), never a fresh literal narrowed to
  // the two keys the reader reads.
  const valueConfig: Cfg = { provider: 'value', items: [] };

  it('reads the resolved record source FIRST when it names an object', () => {
    expect(
      resolveRecordSourceObjectName(
        { objectName: 'accounts' },
        { provider: 'object', object: 'contacts' },
      ),
    ).toBe('contacts');
  });

  it('falls back to `objectName` when the resolved source names no object', () => {
    expect(
      resolveRecordSourceObjectName({ objectName: 'accounts' }, valueConfig),
    ).toBe('accounts');
    expect(resolveRecordSourceObjectName({ objectName: 'accounts' }, { provider: 'api' })).toBe(
      'accounts',
    );
    expect(resolveRecordSourceObjectName({ objectName: 'accounts' }, null)).toBe('accounts');
  });

  it('resolves undefined when nothing names an object', () => {
    expect(resolveRecordSourceObjectName({}, null)).toBeUndefined();
    expect(resolveRecordSourceObjectName({}, valueConfig)).toBeUndefined();
  });

  it('passes an empty `object` through — `ViewDataSchema` declares `z.string()`, not a non-empty one, so coercing it here would invent a rung', () => {
    expect(
      resolveRecordSourceObjectName({ objectName: 'accounts' }, { provider: 'object', object: '' }),
    ).toBe('');
  });

  it('adds NO lenient rung for an off-contract `{ provider: "object" }` with no `object` (AGENTS.md #0.1)', () => {
    expect(
      resolveRecordSourceObjectName({ objectName: 'accounts' }, { provider: 'object' }),
    ).toBeUndefined();
  });

  it('is not the `normalizeListViewSchema` gap-fill: an `objectName` present alongside a data block does NOT win here', () => {
    // Ruling B (#7628) governs how `objectName` is POPULATED when absent; this
    // reader governs which object a block RESOLVES. Merging them would override
    // one standing ruling or the other — the whole point of objectui#7627.
    expect(
      resolveRecordSourceObjectName(
        { objectName: 'ruling_b_value' },
        { provider: 'object', object: 'resolved_source' },
      ),
    ).toBe('resolved_source');
  });
});
