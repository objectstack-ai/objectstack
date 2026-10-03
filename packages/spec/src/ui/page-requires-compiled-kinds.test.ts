// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Page `requires` only on the kinds whose source is compiled at save (#21459;
 * ruling record 5964312254, letter A).
 *
 * `requires` is the plugin-namespace list ADR-0080 §5 derives from an html
 * page's source at save. `PageSchema` used to admit it on every kind; on
 * `react`, `full` and `slotted` pages nothing derived it, so a written list
 * there was a declaration nothing honoured. Bookkeeping shapes, pinned below:
 *
 *   1. `checkPageRequiresKind`, an exported object-level check attached to
 *      `PageSchema` beside `checkPageSourceCompleteness` (the one mechanism
 *      this file uses for kind-conditional rules), refuses the key at
 *      `requires` on every kind outside `COMPILED_PAGE_KINDS`, naming the key,
 *      the page's kind and the compiled kinds. Its parity with the schema is
 *      pinned in `object-refinement-check-exports.test.ts`.
 *   2. D2 conversion `page-requires-non-compiled-kind-removed` (step 18), a
 *      lossless strip retired from the load path: stored rows and artifacts
 *      replay clean, authored sources are refused until edited.
 *   3. The family's D3 entry is `page-requires-non-compiled-kind-refused`.
 *      There is no `RETIRED_KEYS_BY_MAJOR` row: the key stays live on html
 *      pages, so nothing is tombstoned.
 *
 * On the assertion set: a bare `PageSchema` parse raises zod issues, pinned by
 * `code`, `path` and the message's named subjects; the stack door wraps them
 * in the ADR-0112 envelope, pinned by `code` and `status`.
 */

import { describe, expect, it } from 'vitest';

import { collectConversionNotices } from '../conversions/apply';
import { ALL_CONVERSIONS } from '../conversions/registry';
import { applyConversionsToStoredItem } from '../conversions/stored';
import type { ConversionNotice } from '../conversions/types';
import { MIGRATIONS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';
import { defineStack } from '../stack.zod';
import { COMPILED_PAGE_KINDS, PageSchema } from './page.zod';

const CONVERSION_ID = 'page-requires-non-compiled-kind-removed';
const D3_ID = 'page-requires-non-compiled-kind-refused';

const BASE = { name: 'home_page', label: 'Home', type: 'home' } as const;
/** The kinds a `source` is required on — every fixture of one carries a source, so only `requires` is judged. */
const SOURCE_KINDS = new Set(['html', 'jsx', 'react']);
const page = (kind: string | undefined, extra: Record<string, unknown> = {}) => ({
  ...BASE,
  ...(kind === undefined ? {} : { kind }),
  ...(kind !== undefined && SOURCE_KINDS.has(kind) ? { source: 'Card' } : {}),
  ...extra,
});

/** `PageSchema`'s own `kind` vocabulary, read off the schema rather than restated. */
const PAGE_KINDS: readonly string[] = (
  PageSchema as unknown as { shape: { kind: { unwrap: () => { options: readonly string[] } } } }
).shape.kind.unwrap().options;

const NON_COMPILED = ['react', 'full', 'slotted'] as const;

function refusalOf(value: unknown) {
  const r = PageSchema.safeParse(value);
  expect(r.success, 'expected a refusal').toBe(false);
  return r.success ? [] : r.error.issues;
}

describe('page `requires` — the parse refuses it outside the compiled kinds', () => {
  it('the vocabulary: five kinds, of which `html` and `jsx` are the compiled ones', () => {
    expect([...PAGE_KINDS].sort()).toEqual(['full', 'html', 'jsx', 'react', 'slotted']);
    expect([...COMPILED_PAGE_KINDS]).toEqual(['html', 'jsx']);
    expect(PAGE_KINDS.filter((k) => !(COMPILED_PAGE_KINDS as readonly string[]).includes(k)).sort())
      .toEqual([...NON_COMPILED].sort());
  });

  it.each(NON_COMPILED)('refuses `requires` on a `%s` page, at `requires`, naming the key, the kind and the compiled kinds', (kind) => {
    const issues = refusalOf(page(kind, { requires: ['ui'] }));
    expect(issues).toHaveLength(1);
    const [issue] = issues;
    expect(issue!.code).toBe('custom');
    expect(issue!.path).toEqual(['requires']);
    expect(issue!.message.startsWith(`\`requires\` is refused on a \`kind: '${kind}'\` page`)).toBe(true);
    expect(issue!.message).toContain('`html`');
    expect(issue!.message).toContain('`jsx`');
    expect(issue!.message).toContain('Delete the key.');
    // Runtime prose carries no tracker number (`check:doc-authoring`).
    expect(issue!.message).not.toMatch(/#\d/);
  });

  it('a page that omits `kind` is a `full` page — refused the same way, and the message says why', () => {
    // The default the refusal reads: an omitted kind parses as `full`.
    const parsed = PageSchema.parse(page(undefined));
    expect(parsed.kind).toBe('full');

    const issues = refusalOf(page(undefined, { requires: ['ui'] }));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.path).toEqual(['requires']);
    expect(issues[0]!.message.startsWith(
      "`requires` is refused on a `kind: 'full'` page (`full` is also the kind of a page that omits `kind`)",
    )).toBe(true);
  });

  it('the KEY is refused, not its contents: an empty list on a non-compiled kind is refused too', () => {
    for (const kind of [...NON_COMPILED, undefined]) {
      const issues = refusalOf(page(kind, { requires: [] }));
      expect(issues.map((i) => i.path.join('.')), `kind: ${kind}`).toEqual(['requires']);
    }
  });

  it.each(COMPILED_PAGE_KINDS)('CONTROL: a `%s` page keeps its `requires` — the save door is the one that judges it', (kind) => {
    const r = PageSchema.safeParse(page(kind, { requires: ['ui', 'plugin-kanban'] }));
    expect(r.success, JSON.stringify(r.error?.issues ?? [])).toBe(true);
    if (r.success) expect(r.data.requires).toEqual(['ui', 'plugin-kanban']);
  });

  it('CONTROL: a page with no `requires` parses on every kind, and grows none', () => {
    for (const kind of [...PAGE_KINDS, undefined]) {
      const r = PageSchema.safeParse(page(kind));
      expect(r.success, `kind: ${kind} — ${JSON.stringify(r.error?.issues ?? [])}`).toBe(true);
      if (r.success) expect(r.data).not.toHaveProperty('requires');
    }
  });

  it('the stack door wraps the same refusal in its ADR-0112 envelope, at `pages.N.requires`', () => {
    const stack = {
      manifest: { id: 'com.example.pages', name: 'pages', version: '1.0.0', type: 'app', namespace: 'pgs' },
      pages: [
        { name: 'pgs_landing', label: 'Landing', kind: 'html', source: 'Card', requires: ['ui'] },
        { name: 'pgs_workbench', label: 'Workbench', kind: 'react', source: 'Card', requires: ['ui'] },
      ],
    };
    let refusal: { code?: unknown; status?: unknown; issues?: Array<{ path: unknown[]; code: string }> } | undefined;
    try {
      defineStack(stack as never);
    } catch (e) {
      refusal = e as typeof refusal;
    }
    expect(refusal, 'defineStack must refuse the react page').toBeDefined();
    expect({ code: refusal!.code, status: refusal!.status }).toEqual({ code: 'STACK_SCHEMA_INVALID', status: 422 });
    expect(refusal!.issues!.map((i) => ({ path: i.path.join('.'), code: i.code }))).toEqual([
      { path: 'pages.1.requires', code: 'custom' },
    ]);
  });
});

type Notice = Pick<ConversionNotice, 'conversionId' | 'path' | 'from' | 'to'>;
const brief = (n: ConversionNotice): Notice => ({ conversionId: n.conversionId, path: n.path, from: n.from, to: n.to });

describe('page `requires` — the D2 conversion (the stored-row disposition)', () => {
  it.each([...NON_COMPILED, undefined])('a STORED `%s` page loads with the key stripped and the notice recorded, and then parses', (kind) => {
    const notices: ConversionNotice[] = [];
    const row = page(kind, { requires: ['ui'] });
    const rehydrated = applyConversionsToStoredItem('page', row, { onNotice: (n) => notices.push(n) }) as Record<string, unknown>;
    expect(notices.map(brief)).toEqual([
      { conversionId: CONVERSION_ID, path: 'pages[0].requires', from: 'requires', to: '(removed)' },
    ]);
    expect(rehydrated).not.toHaveProperty('requires');
    const { requires: _dropped, ...rest } = row as Record<string, unknown>;
    expect(rehydrated).toEqual(rest);
    expect(PageSchema.safeParse(rehydrated).success).toBe(true);
  });

  it.each(COMPILED_PAGE_KINDS)('CONTROL: a stored `%s` page keeps its list — no notice from this entry', (kind) => {
    const notices: ConversionNotice[] = [];
    const row = page(kind, { requires: ['ui'] });
    const rehydrated = applyConversionsToStoredItem('page', row, { onNotice: (n) => notices.push(n) }) as Record<string, unknown>;
    expect(notices.filter((n) => n.conversionId === CONVERSION_ID)).toHaveLength(0);
    expect(rehydrated.requires).toEqual(['ui']);
  });

  it('strips exactly where the parse refuses: on every kind of the vocabulary, and on an omitted one', () => {
    for (const kind of [...PAGE_KINDS, undefined]) {
      const value = page(kind, { requires: ['ui'] });
      const refused = !PageSchema.safeParse(value).success;
      const { notices } = collectConversionNotices({ pages: [value] }, { includeRetired: true });
      const stripped = notices.some((n) => n.conversionId === CONVERSION_ID);
      expect(stripped, `kind: ${kind}`).toBe(refused);
    }
  });

  it('leaves an unknown `kind` as stored — that refusal is the kind enum\'s, not this entry\'s', () => {
    const artifact = { pages: [{ ...BASE, kind: 'bespoke', requires: ['ui'] }] };
    const { stack, notices } = collectConversionNotices(artifact, { includeRetired: true });
    expect(notices.filter((n) => n.conversionId === CONVERSION_ID)).toHaveLength(0);
    expect(stack).toBe(artifact);
  });

  it('a BUILT artifact replays the strip on every affected page and only those', () => {
    const artifact = {
      pages: [
        page('react', { requires: ['ui'] }),
        page('html', { requires: ['ui'] }),
        page('slotted', { requires: [] }),
        page(undefined),
      ],
    };
    const { notices } = collectConversionNotices(artifact, { includeRetired: true });
    expect(notices.filter((n) => n.conversionId === CONVERSION_ID).map((n) => n.path)).toEqual([
      'pages[0].requires',
      'pages[2].requires',
    ]);
  });

  it('is idempotent by construction: a second replay converts nothing', () => {
    const { stack } = collectConversionNotices({ pages: [page('react', { requires: ['ui'] })] }, { includeRetired: true });
    const replay = collectConversionNotices(stack, { includeRetired: true });
    expect(replay.notices.filter((n) => n.conversionId === CONVERSION_ID)).toHaveLength(0);
    expect(replay.stack).toBe(stack);
  });

  it('is retired from the load path — the authoring funnel does not rewrite a live source', () => {
    const input = { pages: [page('react', { requires: ['ui'] })] };
    const { stack, notices } = collectConversionNotices(input);
    expect(notices.filter((n) => n.conversionId === CONVERSION_ID)).toHaveLength(0);
    expect(stack).toEqual(input);
  });
});

describe('page `requires` — the ADR-0087 ledger', () => {
  it('wires the D2 conversion into the step-18 chain as a retired, stamped strip', () => {
    expect(MIGRATIONS_BY_MAJOR[18]!.conversionIds).toContain(CONVERSION_ID);
    const conversion = ALL_CONVERSIONS.find((c) => c.id === CONVERSION_ID);
    expect(conversion, 'the D2 conversion must be registered').toBeDefined();
    expect(conversion!.toMajor).toBe(18);
    expect(conversion!.retiredFromLoadPath).toBe(true);
    expect(conversion!.retiredAfter).toMatch(/^\d+\.\d+\.\d+$/);
    expect(conversion!.surface).toBe('page.requires');
  });

  it('carries ONE D3 entry for the family, judging its D2 conversion', () => {
    const entries = MIGRATIONS_BY_MAJOR[18]!.semantic.filter((s) => s.id === D3_ID);
    expect(entries, 'the family needs its own D3 entry').toHaveLength(1);
    const [entry] = entries;
    expect(entry!.reason).toContain(`\`${CONVERSION_ID}\``);
    expect(entry!.conversionIds).toEqual([CONVERSION_ID]);
    expect(entry!.replacement).toContain('delete the key');
    expect(entry!.acceptanceCriteria.length).toBeGreaterThan(0);
  });

  it('registers no tombstone: the key stays in the walked shape, live on html pages', () => {
    const all = Object.values(RETIRED_KEYS_BY_MAJOR).flat();
    expect(all).not.toContain('ui/Page:requires');
    // CONTROL: the table does carry this def's one real tombstone.
    expect(all).toContain('ui/Page:assignedProfiles');
    const shape = (PageSchema as unknown as { shape: Record<string, unknown> }).shape;
    expect(Object.keys(shape)).toContain('requires');
  });
});
