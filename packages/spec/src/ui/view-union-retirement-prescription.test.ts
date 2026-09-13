// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17299] A retirement prescription is the TOP-LEVEL message at
 * `PUT /api/v1/meta/view` — not a string buried in `invalid_union` sub-errors.
 *
 * ## The measured defect
 *
 * `ViewMetadataSchema` is the union behind the runtime write door, the one an
 * MCP/AI author reaches with no CLI anywhere on the path. A shape-level refusal
 * raised inside one of its four branches did not become the union's message:
 * the top-level message was zod's bare `Invalid input` and the prescription sat
 * at `error.issues[0].errors[k][j].message`. Measured on `origin/main`
 * `a61ae59f93`, all four branches, one tombstone each:
 *
 * ```
 * top.message: "Invalid input"
 *   errors[2][0] code=invalid_type expected=never path=["virtualScroll"]
 *     msg="`view.virtualScroll` was removed in @objectstack/spec 17.0.0 …"
 * ```
 *
 * ⚠️ Shipped behaviour, not a regression: `virtualScroll`, `striped` and
 * `bordered` have read this way since 17.0.0. Guidance that exists and cannot
 * be seen is, from the author's side, indistinguishable from guidance that does
 * not exist.
 *
 * ## Family-wide, not per case — and what decided it
 *
 * `exportOptionsPdfUnionError` (`view.zod.ts`, #8010) fixed the same burial for
 * ONE retired enum value by re-reading `issue.input`. The route taken here is
 * the family: `retirementPrescription` lifts any claimed-branch issue whose
 * shape is the retirement channel's own — `code: 'invalid_type'` with
 * `expected: 'never'`, which is what `retiredKey()` raises.
 *
 * The measurement that permitted it is §3 below. `strictObject()` closes a
 * shape with a `z.never()` CATCHALL, so the union's members reach 67 `never`
 * leaves and only 8 are tombstones — but zod folds a rejecting `never` catchall
 * into `unrecognized_keys`, so the other 59 never raise this issue shape at all.
 * A discriminant reading the schema GRAPH would have caught all 67; reading the
 * raised ISSUE catches exactly the 8. §3 lights that control rather than
 * asserting it: it fails if the catchall population is empty, and fails if any
 * catchall ever starts lifting.
 *
 * ## What this file pins
 *
 * 1. **Reach** — one pin per union branch, named, each surfacing its own
 *    tombstone at the top level. Triage's ruling: fixing one branch is not the
 *    deliverable.
 * 2. **The population is derived, never hand-listed** — every non-catchall
 *    `never` leaf on the union's surface is walked out of the schema graph and
 *    asserted to be a prescription. A retirement added tomorrow joins this pin
 *    without anyone editing it, which is the point of taking the family route.
 * 3. **The cost direction** — a refusal that is NOT a retirement keeps zod's
 *    message byte for byte: a plain shape error still reads `Invalid input`,
 *    and a curated unknown-key refusal still reads exactly as it did.
 * 4. **⛔ The acceptance face did not move.** The lift runs inside the #7510
 *    `.check()`, after the union has reached its verdict; it writes one string
 *    and nothing else. Verdicts and issue CODES are pinned over the corpora in
 *    `view-union-branch-focus.test.ts` and `view-union-diagnostics.test.ts`,
 *    which this change leaves untouched; §4 here adds the direct assertion.
 */

import { describe, expect, it } from 'vitest';
import {
  ViewMetadataSchema,
  VIEW_METADATA_BRANCHES,
  VIEW_METADATA_MEMBERS,
  selectViewMetadataBranch,
  type ViewMetadataBranch,
} from './view.zod';

/** Zod's own message for a union that nothing else explained. */
const ZOD_BARE = 'Invalid input';

const parse = (body: unknown) => ViewMetadataSchema.safeParse(body);

const topMessage = (body: unknown): string => {
  const r = parse(body);
  expect(r.success, `expected a refusal for ${JSON.stringify(body)}`).toBe(false);
  return r.error!.issues[0]!.message;
};

// ───────────────────────────────────────────────────────────────────────────
// §1 REACH — one body per union branch, each carrying a tombstone the branch
// owns. The `claims` column is asserted too: a pin that surfaced the right text
// from the WRONG branch would be measuring nothing about reach.
// ───────────────────────────────────────────────────────────────────────────

const BRANCH_PINS: ReadonlyArray<readonly [ViewMetadataBranch, string, Record<string, unknown>, string]> = [
  [
    'viewItem',
    'config.virtualScroll',
    {
      name: 'crm_lead.dash', object: 'crm_lead', viewKind: 'list',
      config: { type: 'grid', columns: ['name'], virtualScroll: true },
    },
    '`view.virtualScroll` was removed',
  ],
  [
    'container',
    'list.striped',
    {
      name: 'crm_lead', object: 'crm_lead',
      list: { type: 'grid', columns: ['name'], striped: true },
    },
    '`view.striped` was removed',
  ],
  [
    'listOverlay',
    'virtualScroll (the card\'s own repro)',
    {
      name: 'crm_lead.dash', object: 'crm_lead', viewKind: 'list',
      type: 'grid', columns: ['name'], virtualScroll: true,
    },
    '`view.virtualScroll` was removed',
  ],
  [
    'formOverlay',
    'aria',
    {
      name: 'crm_lead.edit', object: 'crm_lead', viewKind: 'form',
      type: 'simple', aria: { label: 'x' },
    },
    '`form.aria` was removed',
  ],
];

describe('§1 reach — every branch of the view union surfaces its own prescription', () => {
  it.each(BRANCH_PINS)('%s branch (%s)', (branch, _key, body, opening) => {
    expect(selectViewMetadataBranch(body), 'the pin must exercise the branch it names').toBe(branch);

    const message = topMessage(body);
    expect(message).not.toBe(ZOD_BARE);
    expect(message).toContain(opening);
    // The prescription is lifted VERBATIM — it is the migration document, and
    // its `os migrate meta` sentence is pinned class-wide by
    // `../shared/retired-key-migrate-sentence.test.ts`. A message this code
    // composed would be a second spelling of a pinned string.
    expect(message).toContain('to list the mechanical edits for existing sources; apply them by hand.');
  });

  it('the lifted string is byte-identical to the nested issue it came from', () => {
    for (const [, , body] of BRANCH_PINS) {
      const r = parse(body);
      const top = r.error!.issues[0]! as unknown as { message: string; errors?: { message: string; expected?: string }[][] };
      const nested = (top.errors ?? []).flat().find((i) => i.expected === 'never');
      expect(nested, 'the tombstone issue must still be where it always was').toBeDefined();
      expect(top.message).toBe(nested!.message);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §2 THE POPULATION, DERIVED — walked out of the schema graph, never listed.
// ───────────────────────────────────────────────────────────────────────────

interface NeverLeaf { readonly path: string; readonly isCatchall: boolean; readonly message: string }

/** Every `z.never()` leaf the union's four members reach, with its message. */
function walkNeverLeaves(): NeverLeaf[] {
  const seen = new Set<unknown>();
  const out: NeverLeaf[] = [];
  const visit = (schema: unknown, path: readonly string[], depth: number): void => {
    if (!schema || depth > 14 || seen.has(schema)) return;
    const def = (schema as { _zod?: { def?: Record<string, any> } })._zod?.def;
    if (!def) return;
    seen.add(schema);
    if (def.type === 'never') {
      const probe = (schema as { safeParse(v: unknown): { success: boolean; error?: { issues: { message: string }[] } } })
        .safeParse('probe');
      out.push({
        path: path.join('.'),
        isCatchall: path[path.length - 1] === '*',
        message: probe.success ? '' : probe.error!.issues[0]!.message,
      });
      return;
    }
    const kids: Array<readonly [string, unknown]> = [];
    const shape = typeof def.shape === 'function' ? def.shape() : def.shape;
    if (shape) for (const [k, v] of Object.entries(shape)) kids.push([k, v]);
    if (Array.isArray(def.options)) def.options.forEach((o: unknown, i: number) => kids.push([`|${i}`, o]));
    for (const k of ['element', 'innerType', 'in', 'out', 'left', 'right', 'valueType'] as const) {
      if (def[k]) kids.push(['', def[k]]);
    }
    if (typeof def.getter === 'function') { try { kids.push(['', def.getter()]); } catch { /* unreachable arm */ } }
    if (def.catchall) kids.push(['*', def.catchall]);
    for (const [k, v] of kids) visit(v, k ? [...path, k] : path, depth + 1);
  };
  for (const branch of VIEW_METADATA_BRANCHES) visit(VIEW_METADATA_MEMBERS[branch], [branch], 0);
  return out;
}

describe('§2 population — every non-catchall `never` leaf on this surface is a prescription', () => {
  const leaves = walkNeverLeaves();
  const tombstones = leaves.filter((l) => !l.isCatchall);
  const catchalls = leaves.filter((l) => l.isCatchall);

  it('the walk reached both populations — the lit control for every zero below', () => {
    expect(tombstones.length, 'no tombstone reached: the walk is broken, not the surface clean').toBeGreaterThan(0);
    expect(catchalls.length, 'no catchall reached: §3 would be asserting nothing').toBeGreaterThan(0);
  });

  it('every one of them carries a retirement prescription, not zod default text', () => {
    for (const leaf of tombstones) {
      expect(leaf.message, leaf.path).toContain('was removed');
      expect(leaf.message, leaf.path).not.toContain('expected never, received');
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §3 THE CATCHALL CONTROL — the 59 that must NOT lift.
// ───────────────────────────────────────────────────────────────────────────

describe('§3 catchall control — a closed shape\'s `never` catchall never lifts', () => {
  const UNKNOWN_NESTED = {
    name: 'crm_lead.dash', object: 'crm_lead', viewKind: 'list',
    type: 'grid', columns: ['name'], pagination: { bogusNested: 1 },
  };

  it('an unknown nested key is reported as `unrecognized_keys`, never as `expected: never`', () => {
    const r = parse(UNKNOWN_NESTED);
    expect(r.success).toBe(false);
    const nested = (r.error!.issues[0]! as unknown as { errors?: { code?: string; expected?: string }[][] }).errors ?? [];
    const flat = nested.flat();
    expect(flat.some((i) => i.code === 'unrecognized_keys'), JSON.stringify(flat)).toBe(true);
    expect(flat.some((i) => i.expected === 'never')).toBe(false);
  });

  it('so its curated prose stays where it was and the top-level message is untouched', () => {
    expect(topMessage(UNKNOWN_NESTED)).toBe(ZOD_BARE);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §4 COST DIRECTION — what must NOT change.
// ───────────────────────────────────────────────────────────────────────────

describe('§4 cost direction — a non-retirement refusal reads exactly as it did', () => {
  const NOT_RETIREMENTS: ReadonlyArray<readonly [string, unknown]> = [
    ['a plain shape error (columns is not an array)', {
      name: 'crm_lead.dash', object: 'crm_lead', viewKind: 'list', type: 'grid', columns: 'not-an-array',
    }],
    ['an unknown list-view type', {
      name: 'crm_lead.dash', object: 'crm_lead', viewKind: 'list', type: 'sideways', columns: ['name'],
    }],
    ['a container missing every slot', { object: 'crm_lead', list: {} }],
    ['a body that claims nothing at all', { name: 'x.y', object: 'x', viewKind: 'chart' }],
  ];

  it.each(NOT_RETIREMENTS)('%s keeps zod\'s bare union message', (_label, body) => {
    const r = parse(body);
    expect(r.success).toBe(false);
    const top = r.error!.issues[0]!;
    if (top.code === 'invalid_union') expect(top.message).toBe(ZOD_BARE);
    expect(r.error!.issues.map((i) => i.message).join('\n')).not.toContain('was removed in @objectstack/spec');
  });

  it('an ordinary view still parses — the lit control for every refusal above', () => {
    expect(parse({
      name: 'crm_lead.dash', object: 'crm_lead', viewKind: 'list', type: 'grid', columns: ['name'],
    }).success).toBe(true);
  });

  it('the verdict of every §1 body is still a REFUSAL, and still `invalid_union`', () => {
    for (const [, , body] of BRANCH_PINS) {
      const r = parse(body);
      expect(r.success).toBe(false);
      expect(r.error!.issues[0]!.code).toBe('invalid_union');
    }
  });
});
