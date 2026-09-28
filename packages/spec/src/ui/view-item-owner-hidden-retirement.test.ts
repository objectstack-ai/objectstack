// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The view item's `owner` / `hidden` RETIRED (#20085) — ADR-0049
 * enforce-or-remove; triage direction, verbatim: 「retire both keys」.
 *
 * Both sat on the view-item identity layer (`viewItemBaseShape()`), were
 * accepted by the strict authoring door and by the wire member the `view`
 * write door validates, were stored verbatim — and were read by nothing.
 * Measured before removal, with lit controls, and recorded beside the
 * prescriptions in `view.zod.ts`: no writer and no reader of either view-item
 * key in the framework, in objectui at its pin and at `main`, or in cloud.
 *
 * Bookkeeping shapes, pinned below:
 *   1. Both keys are `retiredKey()` tombstones on the SHARED shape — not a
 *      strict deletion with a `guidance` entry — because that shape feeds two
 *      doors: the strict `ViewItemSchema` and the `.strip()` `ViewItemWireSchema`
 *      (member 1 of the union `saveMetaItem` validates), where a bare deletion
 *      would be a silent strip (ADR-0104). Every door that carries a ViewItem
 *      record therefore refuses, with the prescription.
 *   2. The flattened-overlay members declare their OWN `owner` / `hidden`
 *      (`flattenedViewOverlayFields()`) on a different door. [#20230] That
 *      door's pair is retired too, with these same texts, and its full pin set
 *      is `view-overlay-owner-hidden-retirement.test.ts`; the BOUNDARY pin
 *      below moved with it, from "still parses" to "refused, same text".
 *   3. D2 conversion `view-item-owner-hidden-removed` (step 18), scoped to the
 *      record spelling, reaching both collections a record travels in: `views`
 *      (stack sources, and the stored-row seam's `{ views: [row] }`) and the
 *      assembled-manifest `viewItems` channel.
 *   4. `RETIRED_KEYS_BY_MAJOR[18]` carries `ui/ViewItem:*` and
 *      `ui/ViewItemWire:*`. ⚠️ No build gate judges those rows: both defs are
 *      discriminated unions whose emitted JSON Schema has no top-level
 *      `properties`, so `authorable-surface/` has no line for either and
 *      check (b) never sees the tombstones. The registration is pinned HERE
 *      for that reason.
 *   5. No liveness row: the liveness walk stops at the `view` union's container
 *      arm, so a view-item row would be an ORPHAN (measured by the #19333 dev).
 *
 * On the assertion set (the #13823 precedent): a schema refusal raises a
 * `ZodError` whose issues carry `code` and `path` but no ADR-0112 `status` —
 * that envelope belongs to the API error surface. So these pins assert the
 * strongest set this surface has: refusal, the issue `code`, the `path` naming
 * the key, and the prescription text.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { collectConversionNotices } from '../conversions/apply';
import { applyConversionsToStoredItem } from '../conversions/stored';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';
import { MIGRATIONS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';
import { AssembledViewArtifactSchema } from './assembled-views.zod';
import { ViewItemSchema, ViewItemWireSchema, ViewMetadataSchema, defineViewItem } from './view.zod';

/** A well-formed ViewItem record — every required key, neither retired one. */
const RECORD = {
  name: 'crm_lead.my_hot_leads',
  object: 'crm_lead',
  viewKind: 'list',
  config: { type: 'grid', columns: ['name'] },
} as const;

// Unanchored, because a thrown `ZodError`'s message is the JSON of its issues;
// the key-first house convention is asserted on the issue message itself below.
const OWNER_PRESCRIPTION = /`view\.owner` was removed in @objectstack\/spec 17\.5\.0 \(ADR-0049.*Delete the key\..*`os migrate meta --from 17`/s;
const HIDDEN_PRESCRIPTION = /`view\.hidden` was removed in @objectstack\/spec 17\.5\.0 \(ADR-0049.*Delete the key;.*`os migrate meta --from 17`/s;

const RETIRED = [
  ['owner', 'usr_7', OWNER_PRESCRIPTION],
  ['hidden', true, HIDDEN_PRESCRIPTION],
] as const;

type Issue = { code: string; path: PropertyKey[]; message: string; errors?: Issue[][] };

describe('view item owner/hidden retirement — the tombstones, at every door that carries a record', () => {
  for (const [key, value, prescription] of RETIRED) {
    it(`the strict authoring door refuses \`${key}\` at its path, with the prescription`, () => {
      const r = ViewItemSchema.safeParse({ ...RECORD, [key]: value });
      expect(r.success).toBe(false);
      if (r.success) return;
      const issue = r.error.issues.find((i) => i.path[0] === key);
      expect(issue, `the refusal must name \`${key}\``).toBeDefined();
      expect(issue!.code).toBe('invalid_type');
      expect(issue!.path).toEqual([key]);
      expect(issue!.message).toMatch(prescription);
      // House convention 1: the fully-qualified key, in backticks, opens it.
      expect(issue!.message.startsWith(`\`view.${key}\` was removed`)).toBe(true);
      // The factory authors hit parses the same schema.
      expect(() => defineViewItem({ ...RECORD, [key]: value } as never)).toThrow(prescription);
    });

    it(`the wire member refuses \`${key}\` instead of stripping it in silence`, () => {
      // ⭐ The half a bare deletion would have lost: this member is `.strip()`,
      // so an undeclared key would have parsed clean and vanished.
      const r = ViewItemWireSchema.safeParse({ ...RECORD, [key]: value });
      expect(r.success).toBe(false);
      if (r.success) return;
      const issue = r.error.issues.find((i) => i.path[0] === key);
      expect(issue).toBeDefined();
      expect(issue!.code).toBe('invalid_type');
      expect(issue!.path).toEqual([key]);
      expect(issue!.message).toMatch(prescription);
    });

    it(`the \`view\` write door (the registry binding) refuses \`${key}\` and names the viewItem branch's located issue`, () => {
      // `getMetadataTypeSchema('view')` is what `saveMetaItem` validates a
      // `PUT /api/v1/meta/view` body against; a rebinding to some third shape
      // would pass the pins above and still accept the key in production.
      const door = getMetadataTypeSchema('view');
      expect(door, 'no schema bound for `view`').toBeDefined();
      expect(door).toBe(ViewMetadataSchema);
      const r = door!.safeParse({ ...RECORD, [key]: value });
      expect(r.success).toBe(false);
      if (r.success) return;
      const top = r.error.issues[0] as unknown as Issue;
      expect(top.code).toBe('invalid_union');
      // The union's diagnostics surface the claimed branch's own message…
      expect(top.message).toMatch(prescription);
      // …and that branch's issue still locates the key.
      const located = (top.errors ?? []).flat().find((i) => i.path[0] === key);
      expect(located, 'the viewItem branch must locate the key').toBeDefined();
      expect(located!.code).toBe('invalid_type');
      expect(located!.message).toMatch(prescription);
    });

    it(`the assembled-manifest channel refuses a record carrying \`${key}\``, () => {
      // Built from the same wire member, so it refuses too — which is why the
      // D2 conversion must reach `viewItems` (pinned below): an artifact
      // assembled before this release would otherwise fail registration.
      expect(AssembledViewArtifactSchema.safeParse({ ...RECORD, [key]: value }).success).toBe(false);
    });
  }

  it('CONTROL: the same record without the keys passes every door, live identity keys intact', () => {
    const withLiveKeys = { ...RECORD, label: 'My hot leads', isDefault: true, order: 2, scope: 'personal' } as const;
    for (const [label, schema] of [
      ['strict', ViewItemSchema],
      ['wire', ViewItemWireSchema],
      ['door', ViewMetadataSchema],
      ['assembled', AssembledViewArtifactSchema],
    ] as const) {
      const r = schema.safeParse(withLiveKeys);
      expect(r.success, `${label} must accept the record`).toBe(true);
      if (!r.success) continue;
      const data = r.data as Record<string, unknown>;
      // The strip path: absence must stay absence.
      expect(data, `${label} grows no \`owner\``).not.toHaveProperty('owner');
      expect(data, `${label} grows no \`hidden\``).not.toHaveProperty('hidden');
      // The live neighbours are untouched by the tombstones.
      expect(data.scope, `${label} keeps \`scope\``).toBe('personal');
      expect(data.isDefault, `${label} keeps \`isDefault\``).toBe(true);
      expect(data.order, `${label} keeps \`order\``).toBe(2);
    }
  });

  it('BOUNDARY, moved: a flattened overlay (no `config`) is refused with the SAME prescription — the other door, retired too', () => {
    // [#20230] The overlay members declared their own `owner` / `hidden`
    // (`flattenedViewOverlayFields()`), a lean personalization PUT outside
    // #20085. They are now tombstoned with this file's texts; the overlay
    // door's full pin set lives in `view-overlay-owner-hidden-retirement.test.ts`.
    for (const [key, value, prescription] of RETIRED) {
      const overlay = { name: 'crm_lead.pipeline', object: 'crm_lead', viewKind: 'form', [key]: value };
      const r = ViewMetadataSchema.safeParse(overlay);
      expect(r.success, `an overlay carrying \`${key}\``).toBe(false);
      if (r.success) continue;
      expect(r.error.issues[0]!.message).toMatch(prescription);
    }
  });

  it('fails tsc at the authoring site: the input type of both keys is `never`', () => {
    const attempt = () =>
      defineViewItem({
        name: 'crm_lead.my_hot_leads',
        object: 'crm_lead',
        viewKind: 'list',
        config: { type: 'grid', columns: ['name'] },
        // @ts-expect-error — `hidden` is a retiredKey() tombstone: its input type is `never`.
        hidden: true,
      });
    // The parse channel agrees with the type channel on the same literal.
    expect(attempt).toThrow(HIDDEN_PRESCRIPTION);
  });
});

describe('view item owner/hidden retirement — the D2 conversion', () => {
  it('a STORED view row carrying the keys replays clean through the rehydration seam', () => {
    // `database-loader.ts` replays the chain over every stored row it loads;
    // the seam wraps a `view` row as `{ views: [row] }`.
    const stored = { ...RECORD, label: 'My hot leads', scope: 'personal', owner: 'usr_7', hidden: true };
    const notices: { conversionId?: string; path?: string }[] = [];
    const rehydrated = applyConversionsToStoredItem('view', stored, {
      onNotice: (n) => notices.push(n as { conversionId?: string; path?: string }),
    }) as Record<string, unknown>;

    expect(notices.map((n) => n.conversionId)).toEqual(['view-item-owner-hidden-removed', 'view-item-owner-hidden-removed']);
    expect(notices.map((n) => n.path)).toEqual(['views[0].owner', 'views[0].hidden']);
    expect(rehydrated).not.toHaveProperty('owner');
    expect(rehydrated).not.toHaveProperty('hidden');
    // CONTROL: the live identity keys on the same row survive byte-for-byte.
    expect(rehydrated.scope).toBe('personal');
    expect(rehydrated.label).toBe('My hot leads');
    // And the rehydrated row is exactly what the write door accepts now.
    expect(ViewMetadataSchema.safeParse(rehydrated).success).toBe(true);
  });

  it('reaches the assembled-manifest `viewItems` channel, leaves overlays to their own entry and containers alone', () => {
    const { stack, notices } = collectConversionNotices(
      {
        viewItems: [
          { ...RECORD, hidden: false },
          // A flattened overlay in the same channel. [#20230] Its `hidden` is
          // retired too, and stripped by the OVERLAY entry, never by this one.
          { name: 'crm_lead.pipeline', object: 'crm_lead', viewKind: 'list', hidden: true },
        ],
        // A container carries neither key and has no top-level `config`: untouched.
        views: [{ object: 'crm_lead', list: { type: 'grid', columns: ['name'] } }],
      },
      { includeRetired: true },
    );
    expect(notices.map((n) => [n.conversionId, n.path])).toEqual([
      ['view-item-owner-hidden-removed', 'viewItems[0].hidden'],
      ['view-overlay-owner-hidden-removed', 'viewItems[1].hidden'],
    ]);
    expect(stack).toEqual({
      viewItems: [
        RECORD,
        { name: 'crm_lead.pipeline', object: 'crm_lead', viewKind: 'list' },
      ],
      views: [{ object: 'crm_lead', list: { type: 'grid', columns: ['name'] } }],
    });
    // The converted record parses through the assembled channel it travels in.
    expect(AssembledViewArtifactSchema.safeParse((stack.viewItems as unknown[])[0]).success).toBe(true);

    // Idempotence, measured: a second replay converts nothing and hands the
    // input back by reference (copy-on-write).
    const replay = collectConversionNotices(stack, { includeRetired: true });
    expect(replay.notices).toHaveLength(0);
    expect(replay.stack).toBe(stack);
  });

  it('is retired from the load path — a live author is refused at parse, never silently rewritten', () => {
    const { stack, notices } = collectConversionNotices({ views: [{ ...RECORD, owner: 'usr_7' }] });
    expect(notices).toHaveLength(0);
    expect(stack).toEqual({ views: [{ ...RECORD, owner: 'usr_7' }] });
  });
});

describe('view item owner/hidden retirement — ADR-0087 registration', () => {
  it('declares both keys on both carrier defs under major 18, with the D2 conversion in the step-18 chain', () => {
    for (const key of ['ui/ViewItem:owner', 'ui/ViewItem:hidden', 'ui/ViewItemWire:owner', 'ui/ViewItemWire:hidden']) {
      expect(RETIRED_KEYS_BY_MAJOR[18], key).toContain(key);
    }
    expect(MIGRATIONS_BY_MAJOR[18]!.conversionIds).toContain('view-item-owner-hidden-removed');
  });
});

// ─── Tree-scoped absence, with a DECLARED radius ─────────────────────────────
//
// `tsc` is the primary sweeper — `retiredKey()` types both keys `never` on
// `defineViewItem`'s input, so every typed authoring site fails to compile. The
// residue is what `tsc` never judges: JSON, YAML, MD/MDX code fences, untyped
// `.js`, and TS literals typed `unknown` (a test body handed to a write door).
// This walk covers that residue across five roots, each already declared for
// `@objectstack/spec#test` in `scripts/cross-package-test-inputs.mjs` and
// mirrored in `turbo.json` — the same roots and extensions the
// `connector.connectionTimeoutMs` pin walks.
//
// ⭐ `owner` and `hidden` are among the commonest key names in this tree (field
// `hidden`, app `hidden`, column `hidden`, record `owner` …), so a textual
// matcher would be all noise. The matcher is STRUCTURAL instead: an offender is
// one object literal (or one YAML mapping) whose OWN keys include `viewKind`
// and `owner` or `hidden` — the ViewItem record spelling (with `config`) and,
// since #20230, the flattened overlay spelling (without it): both doors of the
// family. A container never carries `viewKind`, so it is not matched.
//
// The bound, stated: a record assembled by SPREAD (`{ ...record, hidden: true }`)
// or computed keys is invisible to a text walk; `docs/**`, `.claude/**`,
// `.github/**` and the repo-root files are outside the radius.
describe('tree-scoped absence: no ViewItem record or flattened overlay inside the declared radius still carries owner/hidden', () => {
  const SPEC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const REPO_ROOT = path.resolve(SPEC_ROOT, '../..');
  const THIS_FILE = path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/');

  /** The walked roots — declared in `scripts/cross-package-test-inputs.mjs` under `@objectstack/spec`. */
  const WALK_ROOTS = ['packages', 'examples', 'skills', 'content', 'scripts'];
  const SCANNED_EXT = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json', '.md', '.mdx', '.yaml', '.yml']);
  /** Under `examples/` only the non-code extensions are scanned AND declared. */
  const EXAMPLES_EXT = new Set(['.json', '.md', '.mdx', '.yaml', '.yml']);
  const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', '.cache', '.objectstack', 'coverage', '.next', '.source']);
  const RETIRED_KEYS = ['owner', 'hidden'];

  /**
   * Structural exclusions — the retirement kit, each with its reason. ⛔ NOT an
   * allowlist file (`spec-property-retirement` §4): every entry's JOB is to
   * spell the retired keys on a record.
   */
  const EXCLUDED = new Set([
    // The tombstones themselves — both doors' shapes (schema source, not an
    // authoring; the overlay door's `config: z.undefined()` guard sits beside
    // its tombstones, measured as the one hit before this exclusion). Its
    // examples live in doc comments, which the lexer skips.
    'packages/spec/src/ui/view.zod.ts',
    // [#20230] The overlay door's own pins author the retired keys on purpose.
    'packages/spec/src/ui/view-overlay-owner-hidden-retirement.test.ts',
    // This pin names the keys to assert their absence.
    THIS_FILE,
  ]);
  const EXCLUDED_PREFIXES = [
    // The D2 conversion's fixture authors the pre-retirement record on purpose.
    'packages/spec/src/conversions/',
    // GITIGNORED build output reached only because this is a FILESYSTEM walk:
    // `retiredKey()` emits each tombstone into the generated JSON Schema's
    // `properties` beside `viewKind` and `config`. Its source, `view.zod.ts`,
    // is walked.
    'packages/spec/json-schema/',
    // Release-owned prose records the removal; never edited by a code PR.
    'content/docs/releases/',
  ];
  /** tsup's own bundle of `tsup.config.ts`, written and deleted mid-build. */
  const TSUP_BUNDLED_CONFIG = /\.bundled_[^./]+\.mjs$/;

  const isOffendingKeySet = (keys: Set<string>): boolean =>
    keys.has('viewKind') && RETIRED_KEYS.some((k) => keys.has(k));

  /**
   * One pass over JS/TS/JSON text: a stack of bracket frames, each `{` frame
   * collecting its OWN keys — an identifier or quoted string in key position
   * (after `{` or `,`) followed by `:`. Strings and comments are skipped; a
   * single- or double-quoted string never spans a line, so a mis-lexed quote
   * (a regex literal) costs at most that line. Returns the 1-based line of each
   * closing brace whose frame is an offender.
   */
  const lexOffenders = (text: string): number[] => {
    const out: number[] = [];
    const stack: { kind: string; keys: Set<string> }[] = [];
    let lastSig = '';
    let line = 1;
    let i = 0;
    const n = text.length;
    while (i < n) {
      const c = text[i]!;
      if (c === '\n') { line += 1; i += 1; continue; }
      if (c === '/' && text[i + 1] === '/') { while (i < n && text[i] !== '\n') i += 1; continue; }
      if (c === '/' && text[i + 1] === '*') {
        i += 2;
        while (i < n && !(text[i] === '*' && text[i + 1] === '/')) { if (text[i] === '\n') line += 1; i += 1; }
        i += 2;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') {
        const start = i;
        i += 1;
        while (i < n && text[i] !== c) {
          if (text[i] === '\\') i += 1;
          else if (text[i] === '\n') { if (c !== '`') break; line += 1; }
          i += 1;
        }
        const token = text.slice(start + 1, i);
        i += 1;
        let j = i;
        while (j < n && (text[j] === ' ' || text[j] === '\t')) j += 1;
        const top = stack[stack.length - 1];
        if (c !== '`' && text[j] === ':' && top?.kind === '{' && (lastSig === '{' || lastSig === ',')) top.keys.add(token);
        lastSig = 'str';
        continue;
      }
      if (/[A-Za-z_$]/.test(c)) {
        const start = i;
        while (i < n && /[\w$]/.test(text[i]!)) i += 1;
        const token = text.slice(start, i);
        let j = i;
        while (j < n && (text[j] === ' ' || text[j] === '\t')) j += 1;
        const top = stack[stack.length - 1];
        if (text[j] === ':' && top?.kind === '{' && (lastSig === '{' || lastSig === ',')) top.keys.add(token);
        lastSig = 'id';
        continue;
      }
      if (c === '{' || c === '[' || c === '(') stack.push({ kind: c, keys: new Set() });
      else if (c === '}' || c === ']' || c === ')') {
        const frame = stack.pop();
        if (frame?.kind === '{' && c === '}' && isOffendingKeySet(frame.keys)) out.push(line);
      }
      if (!/\s/.test(c)) lastSig = c;
      i += 1;
    }
    return out;
  };

  /**
   * YAML: a mapping's OWN keys are the key lines at one column, bounded by a
   * line at a smaller column or by a new list item at that column. Returns the
   * 1-based line of each `viewKind` key whose mapping is an offender.
   */
  const yamlOffenders = (text: string): number[] => {
    const rows = text.split('\n').map((raw, idx) => {
      const m = /^(\s*)(-\s+)?([A-Za-z_][\w]*)\s*:/.exec(raw);
      return m ? { idx, col: m[1]!.length + (m[2]?.length ?? 0), key: m[3]!, item: Boolean(m[2]) } : null;
    });
    const out: number[] = [];
    rows.forEach((row, at) => {
      if (!row || row.key !== 'viewKind') return;
      const keys = new Set<string>([row.key]);
      // Backward — only when `viewKind` is not itself the item's first key: the
      // same mapping runs up to (and includes) the line that opened the item.
      if (!row.item) {
        for (let k = at - 1; k >= 0; k -= 1) {
          const r = rows[k];
          if (!r) continue;
          if (r.col < row.col) break;
          if (r.col === row.col) { keys.add(r.key); if (r.item) break; }
        }
      }
      // Forward — until a shallower line, or the next item at this column.
      for (let k = at + 1; k < rows.length; k += 1) {
        const r = rows[k];
        if (!r) continue;
        if (r.col < row.col || (r.col === row.col && r.item)) break;
        if (r.col === row.col) keys.add(r.key);
      }
      if (isOffendingKeySet(keys)) out.push(row.idx + 1);
    });
    return out;
  };

  /** MD/MDX: only fenced code is judged — prose mentions are not authorings. */
  const markdownOffenders = (text: string): number[] => {
    const out: number[] = [];
    const fence = /^```([\w-]*)[^\n]*\n([\s\S]*?)^```/gm;
    for (let m = fence.exec(text); m; m = fence.exec(text)) {
      const lang = m[1]!.toLowerCase();
      const body = m[2]!;
      const offset = text.slice(0, m.index).split('\n').length;
      const hits = lang === 'yaml' || lang === 'yml' ? yamlOffenders(body) : lexOffenders(body);
      for (const h of hits) out.push(offset + h);
    }
    return out;
  };

  const offendersIn = (ext: string, text: string): number[] => {
    if (!text.includes('viewKind')) return [];
    if (ext === '.yaml' || ext === '.yml') return yamlOffenders(text);
    if (ext === '.md' || ext === '.mdx') return markdownOffenders(text);
    return lexOffenders(text);
  };

  const vanished: string[] = [];
  /** Tolerates ONLY a path's disappearance mid-walk; every other fault is re-raised. */
  const readIfPresent = (full: string, rel: string): string | undefined => {
    try {
      return fs.readFileSync(full, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
      vanished.push(rel);
      return undefined;
    }
  };

  it('the matcher finds a record authoring and ignores every neighbouring shape (anti-vacuity)', () => {
    // Offenders — the record spelling, in each syntax the walk reads.
    expect(offendersIn('.ts', "defineViewItem({ name: 'a.b', object: 'a', viewKind: 'list', config: {}, hidden: true })")).toEqual([1]);
    expect(offendersIn('.ts', "const v = {\n  name: 'a.b',\n  viewKind: 'form',\n  config: { type: 'simple' },\n  owner: 'u1',\n};")).toEqual([6]);
    expect(offendersIn('.json', '{ "views": [ { "viewKind": "list", "config": { "type": "grid" }, "owner": "u1" } ] }')).toEqual([1]);
    expect(offendersIn('.yaml', 'views:\n  - name: a.b\n    viewKind: list\n    config:\n      type: grid\n    hidden: true\n')).toEqual([3]);
    expect(offendersIn('.md', "Prose.\n\n```ts\nsave({ viewKind: 'list', config: {}, owner: 'u1' });\n```\n")).toEqual([4]);
    expect(offendersIn('.md', 'Prose.\n\n```yaml\nviewKind: list\nconfig: {}\nhidden: true\n```\n')).toEqual([4]);
    // [#20230] A flattened overlay — no `config`, the other door of the family, retired too.
    expect(offendersIn('.ts', "put({ name: 'a.b', object: 'a', viewKind: 'list', hidden: true })")).toEqual([1]);
    expect(offendersIn('.yaml', '- name: a.b\n  object: a\n  viewKind: form\n  owner: u1\n')).toEqual([3]);
    // Neighbours that must NOT match.
    // A container: no `viewKind` of its own, and the keys on a nested slot.
    expect(offendersIn('.ts', "defineView({ list: { type: 'grid', columns: [{ field: 'x', hidden: true }] } })")).toEqual([]);
    // A record without the keys; the keys on a NESTED object inside `config`.
    expect(offendersIn('.ts', "({ viewKind: 'list', config: { columns: [{ field: 'x', hidden: true }] } })")).toEqual([]);
    // A `sys_view_definition` row: `view_kind`, and `viewKind` only read off an object.
    expect(offendersIn('.ts', "create({ view_kind: spec?.viewKind === 'form' ? 'form' : 'list', owner: null, hidden: !!spec?.hidden, config: spec })")).toEqual([]);
    // Prose and quoted strings are not authorings.
    expect(offendersIn('.md', 'A view item once took `viewKind`, `config` and `hidden: true`.')).toEqual([]);
    expect(offendersIn('.ts', "const s = \"{ viewKind: 'list', config: {}, hidden: true }\";")).toEqual([]);
    // A YAML mapping whose `hidden` belongs to a sibling item.
    expect(offendersIn('.yaml', '- viewKind: list\n  config: {}\n- name: x\n  hidden: true\n')).toEqual([]);
  });

  it('a path that VANISHES mid-walk is not a finding, and every other read fault still is', () => {
    const before = vanished.length;
    const gone = path.join(REPO_ROOT, 'packages/spec/does-not-exist.bundled_probe.mjs');
    expect(fs.existsSync(gone)).toBe(false);
    expect(readIfPresent(gone, 'probe/gone')).toBeUndefined();
    expect(vanished.slice(before)).toEqual(['probe/gone']);
    expect(readIfPresent(fileURLToPath(import.meta.url), THIS_FILE)).toContain('tree-scoped absence');
    expect(() => readIfPresent(path.join(REPO_ROOT, 'packages/spec'), 'probe/dir')).toThrow();
    expect(vanished.length).toBe(before + 1);
  });

  it('no ViewItem record or flattened overlay carrying owner/hidden survives inside the declared radius', () => {
    const offenders: string[] = [];
    let visited = 0;
    let recordBearing = 0;
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
        if (!(rel.startsWith('examples/') ? EXAMPLES_EXT : SCANNED_EXT).has(ext)) continue;
        if (entry.name === 'CHANGELOG.md') continue; // release prose records the removal
        if (EXCLUDED.has(rel) || EXCLUDED_PREFIXES.some((p) => rel.startsWith(p))) continue;
        if (TSUP_BUNDLED_CONFIG.test(entry.name)) continue;
        visited += 1;
        const text = readIfPresent(full, rel);
        if (text === undefined) continue;
        if (text.includes('viewKind')) recordBearing += 1;
        for (const lineNo of offendersIn(ext, text)) offenders.push(`${rel}:${lineNo}`);
      }
    };
    for (const root of WALK_ROOTS) walk(path.join(REPO_ROOT, root));
    // Anti-vacuity: the walk covered the tree, and the files that CAN hold a
    // record were really judged.
    expect(visited).toBeGreaterThan(1000);
    expect(recordBearing).toBeGreaterThan(50);
    expect(offenders, 'a view record or overlay carrying `owner`/`hidden` means the retirement is being undone').toEqual([]);
  });
});
