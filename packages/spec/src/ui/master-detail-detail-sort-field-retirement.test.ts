// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An `object-master-detail-form` detail entry's `sortField` RETIRED (#21589) —
 * ADR-0049 enforce-or-remove through the ADR-0087 D2 route, the spec half of
 * objectui#11070 round 9 (the direction recorded on #21220's landing, mirrored
 * on objectui#11396 ③).
 *
 * Measured before removal, at the `.objectui-sha` pin `89cad75d5570`:
 * `MasterDetailDetailConfig` has no `sortField` member
 * (`plugin-form/src/MasterDetailForm.tsx:83`); the field the line grid stamps
 * with each line's position is DERIVED from the child object
 * (`deriveMasterDetail.ts:540`) and handed to the grid as `sort_field`
 * (`:874`). The spec still declared the key, so an authored value published
 * green and was dropped. The writer census at the retirement is zero.
 *
 * Bookkeeping shapes, pinned below:
 *   1. A `retiredKey()` tombstone on the strict detail entry — the refusal
 *      carries the prescription, which names the derived field set from its
 *      one declaration (`data/inline-grid-sort-fields.ts`), and the key's
 *      input type is `never`. `PageComponentSchema.properties` is an open bag,
 *      so the props schema is reached by the advisory props lint and never by
 *      the page parse: an existing page is never hard-refused.
 *   2. D2 conversion `object-master-detail-form-detail-sort-field-removed`
 *      (step 18), a strip scoped by component type and by position, retired
 *      from the load path: a stored or built page replays clean, with a notice.
 *   3. `RETIRED_KEYS_BY_MAJOR[18]` carries the NESTED key
 *      `ui/ObjectMasterDetailFormProps:details.sortField`, and the family's D3
 *      entry is `object-master-detail-form-detail-sort-field-retired`.
 *   4. `record:line_items`' answer to the same spelling names no block that
 *      takes it any more.
 *
 * On the assertion set: a schema refusal raises a `ZodError` whose issues carry
 * `code` and `path` but no ADR-0112 `status` — no HTTP door parses this row
 * (the page write door parses `properties` as an open bag). So each refusal is
 * pinned by the issue `code`, the `path` naming the key, and the prescription.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { collectConversionNotices } from '../conversions/apply';
import { ALL_CONVERSIONS } from '../conversions/registry';
import { applyConversionsToStoredItem } from '../conversions/stored';
import type { ConversionNotice } from '../conversions/types';
import { INLINE_GRID_SORT_FIELDS } from '../data/inline-grid-sort-fields';
import { MIGRATIONS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';
import { ComponentPropsMap, ObjectMasterDetailFormPropsSchema, RecordLineItemsProps } from './component.zod';
import { PageSchema } from './page.zod';

const CONVERSION_ID = 'object-master-detail-form-detail-sort-field-removed';
const D3_ID = 'object-master-detail-form-detail-sort-field-retired';
const REGISTERED_KEY = 'ui/ObjectMasterDetailFormProps:details.sortField';

// Unanchored, because a thrown `ZodError`'s message is the JSON of its issues;
// the key-first house convention is asserted on the issue message itself.
const PRESCRIPTION =
  /`object-master-detail-form` property `details\[\]\.sortField` was removed in @objectstack\/spec 17 \(ADR-0087 D2\) — the console reads no authored value.*Delete the key\..*Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand\./s;

/** A detail entry's live keys — the showcase project workspace's entry shape. */
const ENTRY = { title: 'Lines', childObject: 'crm_invoice_line', addLabel: 'Add line' } as const;

const props = (details: unknown[]) => ({ objectName: 'crm_invoice', details });

/** A stored `page` row whose block's detail entry carries `sortField`. */
const storedPage = (sortField: string) => ({
  name: 'invoice_entry',
  label: 'Invoice Entry',
  type: 'app',
  regions: [
    {
      name: 'main',
      components: [{ type: 'object-master-detail-form', properties: props([{ ...ENTRY, sortField }]) }],
    },
  ],
});

type Notice = Pick<ConversionNotice, 'conversionId' | 'path' | 'from' | 'to'>;
const brief = (n: ConversionNotice): Notice => ({
  conversionId: n.conversionId,
  path: n.path,
  from: n.from,
  to: n.to,
});

describe('object-master-detail-form detail-entry sortField retirement — the tombstone', () => {
  it('refuses the key on a detail entry, at the key, with the prescription', () => {
    for (const value of ['line_no', 'position']) {
      const r = ObjectMasterDetailFormPropsSchema.safeParse(props([{ ...ENTRY, sortField: value }]));
      expect(r.success, `sortField: ${value}`).toBe(false);
      if (r.success) continue;
      expect(r.error.issues).toHaveLength(1);
      const issue = r.error.issues[0]!;
      expect(issue.code).toBe('invalid_type');
      expect(issue.path).toEqual(['details', 0, 'sortField']);
      expect(issue.message).toMatch(PRESCRIPTION);
      // House convention 1: the fully-qualified key, in backticks, opens it.
      expect(issue.message.startsWith('`object-master-detail-form` property `details[].sortField` was removed')).toBe(true);
    }
  });

  it('the prescription names every derived sort-field name, from the one declaration', () => {
    const r = ObjectMasterDetailFormPropsSchema.safeParse(props([{ ...ENTRY, sortField: 'line_no' }]));
    const message = r.success ? '' : r.error.issues[0]!.message;
    expect(INLINE_GRID_SORT_FIELDS.size).toBe(6);
    for (const name of INLINE_GRID_SORT_FIELDS) expect(message, name).toContain(`\`${name}\``);
  });

  it('the row the props lint dispatches on is the same schema, so it refuses it too', () => {
    // `validateComponentProps` (packages/lint) reads `ComponentPropsMap[type]`;
    // a rebinding to some other shape would pass the pins above and still
    // accept the key where an author meets it.
    expect(ComponentPropsMap['object-master-detail-form']).toBe(ObjectMasterDetailFormPropsSchema);
    expect(() => ComponentPropsMap['object-master-detail-form'].parse(props([{ ...ENTRY, sortField: 'sort' }])))
      .toThrow(PRESCRIPTION);
  });

  it('refuses the key by the TOMBSTONE, not by the strict unknown-key arm — the two are different answers', () => {
    const retired = ObjectMasterDetailFormPropsSchema.safeParse(props([{ ...ENTRY, sortField: 'line_no' }]));
    expect(retired.success).toBe(false);
    expect((retired.error?.issues ?? []).map((i) => i.code)).not.toContain('unrecognized_keys');
    // CONTROL: an undeclared sibling on the same entry comes back as
    // `unrecognized_keys`. Without this pair, a shape that had simply DROPPED
    // the key would pass the pin above on the strict arm's generic message.
    const undeclared = ObjectMasterDetailFormPropsSchema.safeParse(props([{ ...ENTRY, zzzNotAKey: 'line_no' }]));
    expect(undeclared.success).toBe(false);
    const issue = undeclared.error?.issues.find((i) => i.code === 'unrecognized_keys') as
      | { keys?: string[]; path?: unknown[] }
      | undefined;
    expect(issue?.keys).toEqual(['zzzNotAKey']);
    expect(issue?.path).toEqual(['details', 0]);
  });

  it('CONTROL: an entry without the key parses, keeps its live keys, and grows no `sortField`', () => {
    const r = ObjectMasterDetailFormPropsSchema.safeParse(props([ENTRY]));
    expect(r.success, JSON.stringify(r.error?.issues ?? [])).toBe(true);
    if (!r.success) return;
    const [entry] = (r.data as { details: Record<string, unknown>[] }).details;
    expect(entry).toEqual(ENTRY);
    expect(entry).not.toHaveProperty('sortField');
  });

  it('the walked shape keeps `sortField` as a key of the detail entry', () => {
    type Unwrapped = { unwrap(): { element: { shape: Record<string, unknown> } } };
    const details = (ObjectMasterDetailFormPropsSchema.shape as unknown as Record<string, Unwrapped>).details;
    const entryKeys = Object.keys(details.unwrap().element.shape);
    expect(entryKeys).toContain('sortField');
    expect(entryKeys, 'CONTROL: its live neighbour').toContain('amountField');
    // Eleven keys the renderer reads, plus the tombstone.
    expect(entryKeys).toHaveLength(12);
  });

  it('fails tsc at the authoring site: the input type of `sortField` is `never`', () => {
    const authored: z.input<typeof ObjectMasterDetailFormPropsSchema> = {
      objectName: 'crm_invoice',
      details: [
        {
          ...ENTRY,
          // @ts-expect-error — `sortField` is a retiredKey() tombstone: its input type is `never`.
          sortField: 'line_no',
        },
      ],
    };
    // The parse channel agrees with the type channel on the same literal.
    expect(() => ObjectMasterDetailFormPropsSchema.parse(authored)).toThrow(PRESCRIPTION);
  });

  it('never hard-refuses an existing page: the page parse still accepts a block carrying the key', () => {
    // `PageComponentSchema.properties` is an open bag — the page door does not
    // dispatch on the component type; the tombstone speaks through the props lint.
    const r = PageSchema.safeParse(storedPage('line_no'));
    expect(r.success, JSON.stringify(r.error?.issues ?? [])).toBe(true);
  });

  it('`record:line_items` answers the same spelling naming no block that takes it', () => {
    const r = RecordLineItemsProps.safeParse({
      childObject: 'crm_invoice_line',
      relationshipField: 'invoice',
      columns: [{ name: 'quantity' }],
      sortField: 'line_no',
    });
    expect(r.success).toBe(false);
    const issue = r.error?.issues.find((i) => i.code === 'unrecognized_keys');
    expect(issue?.path).toEqual([]);
    expect(issue?.message).toContain('No block takes an authored `sortField`');
    // CONTROL: the sibling entry key still names the block that takes it.
    const addLabel = RecordLineItemsProps.safeParse({
      childObject: 'crm_invoice_line',
      relationshipField: 'invoice',
      columns: [{ name: 'quantity' }],
      addLabel: 'Add line',
    });
    expect(addLabel.error?.issues.find((i) => i.code === 'unrecognized_keys')?.message)
      .toContain('`addLabel` belongs to an `object-master-detail-form` detail entry');
  });
});

describe('object-master-detail-form detail-entry sortField retirement — the D2 conversion', () => {
  it('a STORED page whose detail entry carries the key loads with it stripped and the notice recorded', () => {
    const notices: ConversionNotice[] = [];
    const row = storedPage('line_no');
    const rehydrated = applyConversionsToStoredItem('page', row, {
      onNotice: (n) => notices.push(n),
    }) as ReturnType<typeof storedPage>;

    expect(notices.map(brief)).toEqual([
      {
        conversionId: CONVERSION_ID,
        path: 'pages[0].regions[0].components[0].properties.details[0].sortField',
        from: 'sortField',
        to: '(removed)',
      },
    ]);
    const properties = rehydrated.regions[0]!.components[0]!.properties;
    // Every live key on the same entry and block survives byte-for-byte.
    expect(properties).toEqual(props([ENTRY]));
    // The rehydrated block is exactly what the props row accepts now, and the
    // page still parses.
    expect(ObjectMasterDetailFormPropsSchema.safeParse(properties).success).toBe(true);
    expect(PageSchema.safeParse(rehydrated).success).toBe(true);
  });

  it('a BUILT artifact replays the same strip — every position the block can sit in, every entry', () => {
    const artifact = {
      pages: [
        {
          name: 'invoice_entry',
          regions: [
            {
              name: 'main',
              components: [
                {
                  type: 'object-master-detail-form',
                  properties: props([{ ...ENTRY, sortField: 'line_no' }, { childObject: 'crm_payment' }, { childObject: 'crm_step', sortField: 'position' }]),
                },
                {
                  type: 'page:card',
                  properties: {
                    children: [{ type: 'object-master-detail-form', properties: props([{ ...ENTRY, sortField: 'sequence' }]) }],
                  },
                },
              ],
            },
          ],
        },
        {
          name: 'invoice_entry_detail',
          kind: 'slotted',
          regions: [],
          slots: { details: { type: 'object-master-detail-form', properties: props([{ ...ENTRY, sortField: 'sort' }]) } },
        },
      ],
    };
    const { stack, notices } = collectConversionNotices(artifact, { includeRetired: true });
    expect(notices.filter((n) => n.conversionId === CONVERSION_ID).map((n) => n.path)).toEqual([
      'pages[0].regions[0].components[0].properties.details[0].sortField',
      'pages[0].regions[0].components[0].properties.details[2].sortField',
      'pages[0].regions[0].components[1].properties.children[0].properties.details[0].sortField',
      'pages[1].slots.details.properties.details[0].sortField',
    ]);
    expect(JSON.stringify(stack)).not.toContain('"sortField"');
  });

  it('CONTROL: a block whose entries carry no key is unchanged — no notice, and the row comes back by reference', () => {
    const row = {
      name: 'invoice_entry',
      regions: [{ name: 'main', components: [{ type: 'object-master-detail-form', properties: props([ENTRY]) }] }],
    };
    const notices: ConversionNotice[] = [];
    const rehydrated = applyConversionsToStoredItem('page', row, { onNotice: (n) => notices.push(n) });
    expect(notices.filter((n) => n.conversionId === CONVERSION_ID)).toHaveLength(0);
    expect(rehydrated).toBe(row);
  });

  it('is scoped by component TYPE and POSITION: the same key elsewhere is not this entry\'s', () => {
    const artifact = {
      pages: [
        {
          name: 'p',
          regions: [
            {
              name: 'main',
              components: [
                // Another component's own `details[].sortField`.
                { type: 'acme:line_editor', properties: { details: [{ sortField: 'position' }] } },
                // The block's TOP-level props: not a detail entry, so not this
                // key (the props gate reports it as an unknown key).
                { type: 'object-master-detail-form', properties: { objectName: 'crm_invoice', sortField: 'position' } },
              ],
            },
          ],
        },
      ],
    };
    const { stack, notices } = collectConversionNotices(artifact, { includeRetired: true });
    expect(notices.filter((n) => n.conversionId === CONVERSION_ID)).toHaveLength(0);
    expect(stack).toBe(artifact);
  });

  it('is idempotent by construction: a second replay converts nothing', () => {
    const { stack } = collectConversionNotices({ pages: [storedPage('line_no')] }, { includeRetired: true });
    const replay = collectConversionNotices(stack, { includeRetired: true });
    expect(replay.notices).toHaveLength(0);
    expect(replay.stack).toBe(stack);
  });

  it('is retired from the load path — the authoring funnel does not rewrite a live source', () => {
    const input = { pages: [storedPage('line_no')] };
    const { stack, notices } = collectConversionNotices(input);
    expect(notices.filter((n) => n.conversionId === CONVERSION_ID)).toHaveLength(0);
    expect(stack).toEqual(input);
  });
});

describe('object-master-detail-form detail-entry sortField retirement — the ADR-0087 ledger row', () => {
  it('declares ONE nested key under major 18', () => {
    expect(RETIRED_KEYS_BY_MAJOR[18]).toContain(REGISTERED_KEY);
    const all = Object.values(RETIRED_KEYS_BY_MAJOR).flat();
    expect(all.filter((k) => k.startsWith('ui/ObjectMasterDetailFormProps:'))).toEqual([REGISTERED_KEY]);
  });

  it('wires the D2 conversion into the step-18 chain as a retired, stamped, lossless strip', () => {
    expect(MIGRATIONS_BY_MAJOR[18]!.conversionIds).toContain(CONVERSION_ID);
    const conversion = ALL_CONVERSIONS.find((c) => c.id === CONVERSION_ID);
    expect(conversion, 'the D2 conversion must be registered').toBeDefined();
    expect(conversion!.toMajor).toBe(18);
    expect(conversion!.retiredFromLoadPath).toBe(true);
    expect(conversion!.retiredAfter).toMatch(/^\d+\.\d+\.\d+$/);
    expect(conversion!.surface).toBe('page.component.object-master-detail-form.details[].sortField');
  });

  it('carries ONE D3 entry for the family, naming its D2 conversion', () => {
    const entries = MIGRATIONS_BY_MAJOR[18]!.semantic.filter((s) => s.id === D3_ID);
    expect(entries, 'the family needs its own D3 entry').toHaveLength(1);
    const [entry] = entries;
    expect(entry!.reason).toContain(`\`${CONVERSION_ID}\``);
    expect(entry!.replacement).toContain('delete the key');
    // The D3 text is concatenated into the generated registry as a literal, so
    // it cannot import the one declaration; this keeps the two lists equal.
    for (const name of INLINE_GRID_SORT_FIELDS) expect(entry!.replacement, name).toContain(`\`${name}\``);
    expect(entry!.acceptanceCriteria.length).toBeGreaterThan(0);
  });
});

// ─── Tree-scoped absence, inside the radius the package already declares ───
//
// `tsc` sweeps only TYPED authoring sites, and a page component's `properties`
// is an open bag, so `tsc` does not reach a block authored through
// `definePage`/`defineStack` at all. This walk covers every text file under the
// five repo roots `scripts/cross-package-test-inputs.mjs` declares for
// `@objectstack/spec#test` (mirrored in `turbo.json`), plus the example apps'
// own `src/` trees.
//
// The matcher judges the AUTHORING SHAPE, never a mention: `sortField` in key
// position with a snake_case field-name value, quoted or bare (TS / JS / JSON,
// and YAML). A guidance or prescription string, a schema declaration and the
// grid's own `sort_field` never take that shape. Prose mentions are spelled in
// inline code in this repo, and inline code is stripped before judging. The
// bound, stated: a value that is not a field-name literal, a shorthand
// property, and `docs/**`, `.claude/**`, `.github/**` and the repo-root files
// are outside what this walk sees. A future schema that declares a `sortField`
// of its own would trip this walk: narrow the matcher to detail entries then,
// never exclude the new file.
//
// [#21768] The first such schema: the `object-form` runtime form field declares
// the `grid` widget's camelCase `sortField` (the row field the grid stamps with
// each row's index), so an inline `grid` field authors `sortField: 'position'`
// legitimately. The matcher is narrowed accordingly, by the object literal the
// key sits in: one whose own level names `type` (or `widget`) `grid` /
// `field:grid` is that inline field, not a detail entry. Nested literals — a
// column's own `type` — never decide it, every match in a file is judged (an
// inline grid field earlier in a file hides no detail entry after it), and a
// key outside any literal (YAML) is still judged an authoring.
describe('tree-scoped absence: nothing inside the declared radius still authors a detail-entry sortField', () => {
  const SPEC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const REPO_ROOT = path.resolve(SPEC_ROOT, '../..');
  const THIS_FILE = path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/');

  /** The walked roots — declared in `scripts/cross-package-test-inputs.mjs` under `@objectstack/spec`. */
  const WALK_ROOTS = ['packages', 'examples', 'skills', 'content', 'scripts'];
  const SCANNED_EXT = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json', '.md', '.mdx', '.yaml', '.yml']);
  /** Under `examples/` the non-code extensions, plus `.ts` inside an app's own `src/` tree. */
  const EXAMPLES_EXT = new Set(['.json', '.md', '.mdx', '.yaml', '.yml']);
  const EXAMPLE_APP_SRC_TS = /^examples\/[^/]+\/src\/.+\.ts$/;
  const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', '.cache', '.objectstack', 'coverage', '.next', '.source']);

  const AUTHORING = /(^|[^\w.$])["']?sortField["']?[ \t]*:[ \t]*(["']?)[a-z_][a-z0-9_]*\2(?=[ \t]*([,}\]#]|$))/m;

  const AUTHORING_ALL = new RegExp(AUTHORING.source, 'gm');
  /** An inline `grid` form field's own-level marker: the one literal that declares a `sortField` of its own. */
  const INLINE_GRID_FIELD = /(^|[^\w.$])["']?(?:type|widget)["']?[ \t]*:[ \t]*["'](?:field:)?grid["']/m;

  /** Inline code spans are prose; newline-bounded, so a fenced example is still judged. */
  const stripInlineCode = (text: string): string => text.replace(/`[^`\n]*`/g, '');

  /**
   * The own level of the object literal enclosing `at` — its text with every
   * nested `{…}` / `[…]` group removed — or `undefined` when `at` sits in no
   * literal (YAML, a bare key).
   */
  const enclosingLiteralOwnLevel = (text: string, at: number): string | undefined => {
    let start = -1;
    for (let i = at - 1, depth = 0; i >= 0; i -= 1) {
      const c = text[i];
      if (c === '}' || c === ']') depth += 1;
      else if (c === '{' || c === '[') {
        if (depth === 0) { if (c === '{') start = i; break; }
        depth -= 1;
      }
    }
    if (start < 0) return undefined;
    let own = '';
    for (let i = start + 1, depth = 0; i < text.length; i += 1) {
      const c = text[i]!;
      if (c === '{' || c === '[') depth += 1;
      else if (c === '}' || c === ']') {
        if (depth === 0) break;
        depth -= 1;
      } else if (depth === 0) own += c;
    }
    return own;
  };

  const judge = (text: string): RegExpMatchArray | null => {
    const stripped = stripInlineCode(text);
    for (const m of stripped.matchAll(AUTHORING_ALL)) {
      const own = enclosingLiteralOwnLevel(stripped, m.index! + m[1]!.length);
      if (own !== undefined && INLINE_GRID_FIELD.test(own)) continue; // an inline grid field's own key
      return m;
    }
    return null;
  };

  /**
   * Structural exclusions — the retirement kit, each with its reason. ⛔ NOT an
   * allowlist file (`spec-property-retirement` §4): every entry's JOB is to
   * spell the retired key.
   */
  const EXCLUDED = new Set([
    // This pin authors the key to assert its refusal and its conversion.
    THIS_FILE,
    // The props-lint pin authors the key to assert the advisory warning an
    // author meets at `os validate` / `os build` / `os lint`.
    'packages/lint/src/validate-component-props.test.ts',
  ]);
  const EXCLUDED_PREFIXES = [
    // The D2 conversion's fixture authors the pre-retirement entry on purpose.
    'packages/spec/src/conversions/',
    // Release-owned prose records the removal; never edited by a code PR.
    'content/docs/releases/',
    // GITIGNORED build output (`packages/spec/json-schema/`), reached only
    // because this is a FILESYSTEM walk. Its source is `component.zod.ts`.
    'packages/spec/json-schema/',
  ];
  /** tsup's own bundle of `tsup.config.ts`, written and deleted mid-build. */
  const TSUP_BUNDLED_CONFIG = /\.bundled_[^./]+\.mjs$/;

  /** Tolerates ONLY a path that vanished mid-walk; every other read fault is re-raised. */
  const readIfPresent = (full: string): string | undefined => {
    try {
      return fs.readFileSync(full, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
      return undefined;
    }
  };

  it('the matcher recognises an authoring and ignores a prose mention, a guidance string and a declaration (anti-vacuity)', () => {
    // Offenders — the retired shape, in each syntax the walk reads.
    expect(judge("details: [{ childObject: 'crm_invoice_line', sortField: 'line_no' }],")).not.toBeNull();
    expect(judge("      {\n        sortField: 'position',\n      },")).not.toBeNull();
    expect(judge('{ "details": [{ "childObject": "crm_invoice_line", "sortField": "sequence" }] }')).not.toBeNull();
    expect(judge('      details:\n        - childObject: crm_invoice_line\n          sortField: sort\n')).not.toBeNull();
    expect(judge("Prose.\n\n```ts\ndefinePage({ regions: [{ components: [{ properties: { details: [{ sortField: 'line_no' }] } }] }] });\n```\n")).not.toBeNull();
    // Neighbours that must NOT match.
    expect(judge("an authored `sortField: 'line_no'` was accepted and dropped")).toBeNull();
    expect(judge("sortField: '`record:line_items` does not read `sortField`: its grid stamps no line position'")).toBeNull();
    expect(judge('sortField: retiredKey(MASTER_DETAIL_DETAIL_SORT_FIELD_RETIRED),')).toBeNull();
    expect(judge("sortField: z.string().optional().describe('Child field'),")).toBeNull();
    expect(judge('sortField: derived.sortField,')).toBeNull();
    expect(judge("sort_field: entry.sortField,\n  sortFields: ['name'],")).toBeNull();
    expect(judge('"ui/ObjectMasterDetailFormProps:details.sortField",')).toBeNull();
  });

  it('the narrowing exempts only an inline grid field\'s own `sortField` (#21768)', () => {
    // The inline `grid` form field declares the key: exempt, in each spelling of its widget.
    expect(judge("customFields: [{ name: 'lines', type: 'grid', columns: [{ name: 'qty', type: 'number' }], sortField: 'position' }]")).toBeNull();
    expect(judge('{ "name": "lines", "type": "grid", "sortField": "position" }')).toBeNull();
    expect(judge("{ name: 'lines', widget: 'field:grid', sortField: 'line_no' }")).toBeNull();
    // CONTROLS — still offenders: a nested column's `grid` type decides nothing; an inline grid field
    // earlier in the text hides no detail entry after it; and a literal with no grid marker at its level.
    expect(judge("details: [{ childObject: 'crm_invoice_line', columns: [{ name: 'g', type: 'grid' }], sortField: 'line_no' }]")).not.toBeNull();
    expect(judge("[{ name: 'g', type: 'grid', sortField: 'position' }, { childObject: 'crm_invoice_line', sortField: 'line_no' }]")).not.toBeNull();
    expect(judge("{ childObject: 'crm_invoice_line', type: 'grids', sortField: 'line_no' }")).not.toBeNull();
  });

  it('no detail-entry sortField authoring survives inside the declared radius outside the retirement kit', () => {
    const offenders: string[] = [];
    let visited = 0;
    let exampleSources = 0;
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const rel = path.relative(REPO_ROOT, full).split(path.sep).join('/');
        if (entry.isDirectory()) {
          if (SKIPPED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
          walk(full);
          continue;
        }
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name);
        const scanned = rel.startsWith('examples/')
          ? EXAMPLES_EXT.has(ext) || EXAMPLE_APP_SRC_TS.test(rel)
          : SCANNED_EXT.has(ext);
        if (!scanned) continue;
        if (entry.name === 'CHANGELOG.md') continue; // release prose records the removal
        if (EXCLUDED.has(rel) || EXCLUDED_PREFIXES.some((p) => rel.startsWith(p))) continue;
        if (TSUP_BUNDLED_CONFIG.test(entry.name)) continue;
        visited += 1;
        if (EXAMPLE_APP_SRC_TS.test(rel)) exampleSources += 1;
        const text = readIfPresent(full);
        if (text === undefined) continue;
        const m = judge(text);
        if (m) offenders.push(`${rel} authors \`${m[0].trim().replace(/\s+/g, ' ')}\``);
      }
    };
    for (const root of WALK_ROOTS) walk(path.join(REPO_ROOT, root));
    // Anti-vacuity: the walk really covered the tree and the example apps' sources.
    expect(visited).toBeGreaterThan(1000);
    expect(exampleSources).toBeGreaterThan(50);
    expect(offenders, 'a detail-entry sortField authoring means the retirement is being undone').toEqual([]);
  });
});
