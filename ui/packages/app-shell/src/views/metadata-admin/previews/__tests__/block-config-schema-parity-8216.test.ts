// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `BLOCK_CONFIG` field names ↔ the schema each block is judged by (objectui#8216).
 *
 * `previews/block-config.ts`'s own header states the rule this file mechanises:
 *
 *   > Keep each field `name` aligned with the property name the corresponding
 *   > renderer reads.
 *
 * Nothing checked it. `scripts/check-designer-field-key-parity.mjs` judges
 * `PAYLOAD_SHAPES` — the field / object / permission payloads — and never reads
 * this table; `apps/console/src/__tests__/registry-inputs-spec-parity.test.ts`
 * judges the registry `inputs` declarations, a different table on a different
 * face. What existed here instead was a per-block prose pin in the sibling
 * `block-config.test.ts`, each written AFTER a defect was found by hand:
 * `page:header.icon` (objectui#3829), `page:accordion.title` and its items
 * `value` (objectui#5212), the `global_nav` option (objectstack#6888), and
 * `object-kanban` (objectui#7772). That is the voluntary shape objectui#8068
 * ruled insufficient one table over — three keys did it right and nothing
 * noticed the fourth.
 *
 * The measured cost of the absence is objectui#7772: for three months the
 * kanban panel's only grouping control wrote `groupField`, which
 * `ObjectKanbanSchema` refuses BY NAME, while the REQUIRED `groupBy` had no
 * control at all — so that panel could not author a valid board however it was
 * filled in, and every derived check stayed green.
 *
 * ## Two oracles, because `BLOCK_CONFIG` is keyed by DESIGNER block type
 *
 * That key is not one vocabulary, and the split is measured rather than
 * assumed. Both oracle tables are read whole and DERIVED — neither is listed
 * here, so a block that gains or loses a schema changes this file's verdict
 * without anyone editing it.
 *
 *   SPEC   `ComponentPropsMap[type]` from `@objectstack/spec/ui`. STRICT
 *          objects: an undeclared key draws `unrecognized_keys` naming it. This
 *          is the face that can REFUSE, and the one the platform's
 *          component-props lint dispatches on — `PageComponent.properties` is
 *          `z.record(z.string(), z.unknown())`, so the page parse itself never
 *          descends into a block's props and `ComponentPropsMap[type]` is
 *          reachable only by dispatching on the sibling `type`
 *          (the spec's own note on `lintUnknownKeysAgainstSchema`).
 *
 *   NODE   the `@object-ui/types/zod` component arms, indexed by the `type`
 *          literal each one declares. These extend `BaseSchema`, which is
 *          `.passthrough()`, so an undeclared key here is not refused — it
 *          stops being JUDGED and the value is kept (objectui#7664's measured
 *          mechanism). A violation on this face is therefore a DECLARATION
 *          gap, not a refusal, and the two are reported under distinct ids for
 *          that reason. It is also the only face carrying
 *          `retirementTombstone()`, which is why the retired direction below
 *          cannot be measured without it.
 *
 *          ⚠️ An arm is judged at the LEVEL its block's props live on. Most
 *          arms declare them at the node's top level; the ADR-0080 public-block
 *          arms (objectui#10872) declare them the spec's way, as one
 *          `properties` object member whose value is the block's
 *          `ComponentPropsMap` row. The designer edits a block's `properties`
 *          (`block-config.ts`'s header), so such an arm is judged against that
 *          member's shape — {@link propsLevelOf} derives the level from the arm
 *          itself, ⛔ never from a list of types.
 *
 * A block may resolve on both (`object-grid`, `object-form`, `object-kanban`,
 * and, since objectui#10872, the `page:*` / `record:*` / `element:*` public
 * blocks that carry a spec row — their node face judged at `properties`), on
 * one (`grid` — node only; a spec type no arm declares yet, such as
 * `element:number` — spec only), or on neither. Neither is an EXPLICIT exemption
 * with a reason and a card, never a silent skip — the idiom is
 * `check-designer-field-key-parity.mjs`'s, copied rather than reinvented.
 *
 * ## Both directions, because "is it declared?" is not the question
 *
 * MISSING   a control writes a name the oracle does not accept.
 * RETIRED   a control writes a name the oracle still LISTS but tombstones. ADR-0087
 *           D2 retirement replaces the member with `z.never()` rather than deleting
 *           it, so every declared-key check reads green while the parser refuses
 *           every value by name. `@object-ui/test-support`'s `isShapeKeyTombstoned`
 *           is the shared judge (objectui#3809 / objectui#4947).
 *
 * ## A control homed in the `dataSource` binding is judged by the binding
 *
 * A field marked `at: 'dataSource'` (objectui#11880) writes the node-level
 * `dataSource.<name>`, not `properties.<name>`, so the block's props row is the
 * wrong oracle for it: it is judged against the spec's `ElementDataSourceSchema`
 * — the schema `PageComponentSchema.dataSource` is — on the SPEC face, and is
 * not judged by the block's props on either face. Judging it at the props row
 * would read a binding control as a retired flat key the day the spec
 * tombstones `element:number.object`, which is exactly the move it made.
 *
 * The REQUIRED direction — a schema-required key with no control — is measured
 * and reported on objectui#8216, and deliberately NOT gated here: objectui#7772's
 * triage records "an inspector need not expose every declared key" as a product
 * decision, and a gate over a product decision is a gate that gets waived.
 *
 * ## Ratchet, not bug report
 *
 * The first run over `main` surfaced three live offenders. Fixing them is not
 * this file's job and was out of scope on the card that built it — the same
 * position `check-designer-field-key-parity.mjs`'s header takes, and for the
 * same reason: the three take three DIFFERENT correct resolutions (one is
 * upstream in `@objectstack/spec`, one is a control rename plus two locale
 * tables, one is a `packages/types` mirror). Each is filed as its own card and
 * recorded in {@link LEDGER} with that card's number, and the ledger ratchets
 * BOTH ways — an unledgered violation is red, and a ledger row that no longer
 * applies is equally red, so a resolved key cannot leave an entry behind that
 * would silently re-admit the spelling later.
 */

import { describe, it, expect } from 'vitest';
import { ComponentPropsMap, ElementDataSourceSchema } from '@objectstack/spec/ui';
import * as objectUiZod from '@object-ui/types/zod';
import {
  arrayElementSchema,
  isShapeKeyTombstoned,
  listedShapeKeys,
  resolvePropsShape,
  shapeMemberTypeName,
} from '@object-ui/test-support';
import { BLOCK_CONFIG, type BlockPropField } from '../block-config';

/* ── oracles ──────────────────────────────────────────────────────────────── */

type OracleFace = 'spec' | 'node';

/**
 * The NODE oracle table, derived: every exported Zod object whose `type` member
 * is a literal, indexed by that literal. Written this way rather than as a
 * hand-listed `{ 'object-kanban': ObjectKanbanSchema }` because a hand list is
 * the thing that goes stale — a new arm would simply never be judged, which is
 * the silent-skip failure the exemption table exists to prevent.
 */
function nodeOracles(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const exported of Object.values(objectUiZod as Record<string, unknown>)) {
    const shape = resolvePropsShape(exported);
    if (!shape) continue;
    const typeMember = shape.type as { _def?: { values?: unknown[]; value?: unknown }; value?: unknown } | undefined;
    const literal =
      (typeMember?._def?.values as unknown[] | undefined)?.[0] ??
      typeMember?._def?.value ??
      typeMember?.value;
    if (typeof literal === 'string' && !(literal in out)) out[literal] = propsLevelOf(exported);
  }
  return out;
}

/**
 * The schema a designer field of this arm is judged against: the arm's
 * `properties` member when that member unwraps to an OBJECT shape — the
 * ADR-0080 public-block arms (objectui#10872), whose props live in the spec's
 * bag — and the arm itself otherwise. Read off the arm, so an arm that adopts
 * the bag later is judged at the bag without an edit here, and an arm without
 * one (or with a non-object `properties`) keeps its top-level reading.
 */
function propsLevelOf(arm: unknown): unknown {
  const member = resolvePropsShape(arm)?.properties as { unwrap?: () => unknown } | undefined;
  if (!member) return arm;
  const inner = typeof member.unwrap === 'function' ? member.unwrap() : member;
  return resolvePropsShape(inner) ? inner : arm;
}

const NODE_ORACLES = nodeOracles();
const SPEC_ORACLES = ComponentPropsMap as unknown as Record<string, unknown>;

function oraclesFor(blockType: string): Array<{ face: OracleFace; schema: unknown }> {
  const found: Array<{ face: OracleFace; schema: unknown }> = [];
  if (SPEC_ORACLES[blockType]) found.push({ face: 'spec', schema: SPEC_ORACLES[blockType] });
  if (NODE_ORACLES[blockType]) found.push({ face: 'node', schema: NODE_ORACLES[blockType] });
  return found;
}

/* ── exemptions ───────────────────────────────────────────────────────────── */

/**
 * Blocks that resolve to NO runtime-judgeable schema on either face.
 *
 * SELF-DELETING: each row asserts its block resolves to neither oracle, so an
 * exemption cannot outlive its reason — the moment one of these gains a spec
 * props shape or a node arm, this file goes red and the row must go.
 *
 * `card` owns the decision about the absence itself, not about any particular
 * key. objectui#8281 censused the blocks together and lays out the four routes;
 * a block with its own separate defect carries that card number in the reason
 * so a reader lands on the right one.
 *
 * `ai:input` was the third row until objectui#8280 removed its panel instead of
 * judging it: the palette never offered the block, so there was nothing to
 * author and nothing to exempt. The row went in the same change, because
 * "every exemption names a real block" below would have failed on it.
 */
const EXEMPT: Readonly<Record<string, { reason: string; card: string }>> = {
  // `element:definition-list` and `element:repeater` were the two rows here
  // until `@objectstack/spec` 17.5.0 gave both a `ComponentPropsMap` entry
  // (objectui#11073). The self-deleting row below turned red, as written, and
  // both rows went: the two blocks are judged on the SPEC face now.
};

/* ── ledger ───────────────────────────────────────────────────────────────── */

/**
 * The violations live on `main` today, each with the card that owns its
 * resolution. NOT a suppression list — see the header's ratchet note: a row
 * that stops applying is as red as a violation that is missing one.
 *
 * `face` scopes the row to the oracle that reports it, and it is load-bearing
 * rather than decoration: `object-form.formType` was a NODE-face declaration gap
 * while the SPEC face declared the key perfectly well (until objectui#6152 round
 * 1 closed it — see the note inside the ledger), and an unscoped row would have
 * absorbed a future spec-face violation on the same name.
 */
const LEDGER: ReadonlyArray<{ block: string; path: string; face: OracleFace; card: string; why: string }> = [
  // `object-kanban::limit@spec` stood here until @objectstack/spec 17.4.0. It was
  // the ledger working exactly as designed: the renderer honoured the key, both
  // `@object-ui/types` faces declared it and the docs taught it, while
  // `ComponentPropsMap['object-kanban']` refused it by name — so the row said
  // "upstream owes this" instead of deleting a working affordance to satisfy a
  // schema that was behind it. objectstack#16503 (landed as objectstack#16562)
  // declared `limit` upstream, which is the maintainer's option-A ruling on
  // objectui#8172, and the row went stale. Deleted rather than kept: a row that
  // no longer describes a violation is as red here as a violation with no row.
  //
  // `object-form::formType@node` stood here too, pointing at objectui#6152: the
  // TS `ObjectFormSchema` and the spec both declared `formType`, PageBlockCanvas
  // read it, and the zod mirror omitted it. objectui#6152 round 1 declared it on
  // the mirror (with the other members that pair's `UnmirroredDeclared` entry
  // recorded), the "every ledger row still applies" pin below turned red as
  // written, and the row went.
];

const ledgerId = (r: { block: string; path: string; face: OracleFace }) => `${r.block}::${r.path}@${r.face}`;

/* ── the join ─────────────────────────────────────────────────────────────── */

type Violation = { id: string; kind: 'MISSING' | 'RETIRED' | 'UNREADABLE'; detail: string };

/** Judge one name against one oracle shape; `undefined` when it is accepted. */
function judge(schema: unknown, name: string): Omit<Violation, 'id'> | undefined {
  const keys = listedShapeKeys(schema);
  if (!keys.includes(name)) {
    return { kind: 'MISSING', detail: `not a declared key (schema declares ${keys.length} keys)` };
  }
  if (isShapeKeyTombstoned(schema, name)) {
    return { kind: 'RETIRED', detail: 'declared but tombstoned — the parser refuses every value by name' };
  }
  return undefined;
}

/** Every violation on the tree, both directions, both faces, nested included. */
function census(): Violation[] {
  const found: Violation[] = [];
  for (const [blockType, fields] of Object.entries(BLOCK_CONFIG)) {
    // Binding controls are judged by the binding's own schema, once.
    for (const field of fields.filter((f) => f.at === 'dataSource')) {
      const bound = judge(ElementDataSourceSchema, field.name);
      if (bound) found.push({ id: `${blockType}::dataSource.${field.name}@spec`, ...bound });
    }
    for (const { face, schema } of oraclesFor(blockType)) {
      for (const field of fields.filter((f) => f.at !== 'dataSource')) {
        const top = judge(schema, field.name);
        if (top) found.push({ id: `${blockType}::${field.name}@${face}`, ...top });

        if (field.kind !== 'array') continue;
        // The item editors write into the array's ELEMENT shape, verbatim
        // (`PageBlockInspector.renderField`: `next[i] = { ...itemObj, [n]: v }`).
        const parentShape = resolvePropsShape(schema);
        const element = arrayElementSchema(parentShape?.[field.name]);
        if (!element) {
          // Never a skip: an unreadable element shape would silently exempt
          // every item control under it, which is the vacuity this gate exists
          // to avoid. Reported unless the parent key is itself already refused.
          if (!top) {
            found.push({
              id: `${blockType}::${field.name}[]@${face}`,
              kind: 'UNREADABLE',
              detail: 'the array element shape could not be read, so its item controls are unjudged',
            });
          }
          continue;
        }
        for (const item of field.itemFields) {
          const nested = judge(element, item.name);
          if (nested) found.push({ id: `${blockType}::${field.name}[].${item.name}@${face}`, ...nested });
        }
      }
    }
  }
  return found;
}

/* ── non-vacuity: the instruments, before the verdict ─────────────────────── */

describe('BLOCK_CONFIG ↔ node-schema parity — the instruments (objectui#8216)', () => {
  it('reads a non-empty SPEC oracle table with the rows this gate depends on', () => {
    expect(Object.keys(SPEC_ORACLES).length, 'ComponentPropsMap read empty').toBeGreaterThan(20);
    for (const t of ['page:header', 'page:tabs', 'object-kanban', 'record:details']) {
      expect(SPEC_ORACLES[t], `ComponentPropsMap lost '${t}'`).toBeTruthy();
    }
  });

  it('derives a non-empty NODE oracle table from the type literals', () => {
    // The derivation is a walk over exports; a Zod-internals change that stopped
    // yielding literals would empty it and turn every node-face assertion below
    // into a no-op that passes.
    expect(Object.keys(NODE_ORACLES).length, 'no node arms resolved').toBeGreaterThan(20);
    for (const t of ['object-kanban', 'object-form', 'object-grid', 'grid']) {
      expect(NODE_ORACLES[t], `no node arm resolved for '${t}'`).toBeTruthy();
    }
  });

  it('judges a bag-carrying arm AT its `properties` bag, and every other arm at its top level (objectui#10872)', () => {
    // The descent is derived, so its non-vacuity is measured on both sides: a
    // public-block arm resolves to its bag — the designer's `title` control is
    // a declared member there, and the bag still carries the spec's tombstone
    // for `icon` — while a top-level arm is untouched by it.
    const header = NODE_ORACLES['page:header'];
    expect(header, 'no node arm resolved for page:header').toBeTruthy();
    expect(listedShapeKeys(header)).toContain('title');
    expect(listedShapeKeys(header), 'judged at the node, not at its bag').not.toContain('properties');
    expect(judge(header, 'title')).toBeUndefined();
    expect(judge(header, 'icon')?.kind).toBe('RETIRED');
    expect(listedShapeKeys(NODE_ORACLES['object-kanban'])).toContain('groupBy');
    expect(listedShapeKeys(NODE_ORACLES['object-kanban'])).toContain('type');
  });

  it('the MISSING probe can say no — and yes', () => {
    expect(judge(SPEC_ORACLES['page:header'], 'zzzNotAKey')?.kind).toBe('MISSING');
    expect(judge(SPEC_ORACLES['page:header'], 'title')).toBeUndefined();
  });

  it('the RETIRED probe separates a tombstone from an ordinary member', () => {
    // `PageHeaderProps.icon` is the canonical tombstone (objectui#3829): still a
    // listed key, refused by name. Without this pair the retired direction could
    // be reporting nothing at all and read identically.
    expect(listedShapeKeys(SPEC_ORACLES['page:header'])).toContain('icon');
    expect(judge(SPEC_ORACLES['page:header'], 'icon')?.kind).toBe('RETIRED');
    expect(shapeMemberTypeName(SPEC_ORACLES['page:header'], 'title')).toBeTruthy();
    // …and on the node face, where `retirementTombstone()` lives.
    expect(judge(NODE_ORACLES['object-kanban'], 'groupField')?.kind).toBe('RETIRED');
    expect(judge(NODE_ORACLES['object-kanban'], 'groupBy')).toBeUndefined();
  });

  it('the binding oracle can say no — and yes — for a control homed in `dataSource` (objectui#11880)', () => {
    expect(judge(ElementDataSourceSchema, 'object')).toBeUndefined();
    expect(judge(ElementDataSourceSchema, 'limit')).toBeUndefined();
    expect(judge(ElementDataSourceSchema, 'titleField')?.kind).toBe('MISSING');
    // The population is real: element:number's Object picker lives there.
    const homed = Object.entries(BLOCK_CONFIG).flatMap(([type, fields]) =>
      fields.filter((f) => f.at === 'dataSource').map((f) => `${type}.${f.name}`),
    );
    expect(homed).toContain('element:number.object');
  });

  it('the SPEC face really refuses an undeclared key by name, not silently', () => {
    // The MISSING verdict above is a key-set read. This is the refusal it stands
    // for, measured through the parser — so a schema that quietly became
    // passthrough could not keep this gate green on a spelling comparison.
    const bogus = SPEC_ORACLES['page:header'] as { safeParse: (v: unknown) => any };
    const refused = bogus.safeParse({ title: 'T', zzzNotAKey: 1 });
    expect(refused.success).toBe(false);
    expect(refused.error.issues.flatMap((i: any) => i.keys ?? [])).toContain('zzzNotAKey');
    expect(bogus.safeParse({ title: 'T' }).success, 'the base node must parse clean').toBe(true);
  });
});

/* ── coverage: every block is judged or explicitly exempt ─────────────────── */

describe('BLOCK_CONFIG ↔ node-schema parity — coverage (objectui#8216)', () => {
  it('every block either resolves to an oracle or carries an exemption', () => {
    const undecided = Object.keys(BLOCK_CONFIG).filter(
      (t) => oraclesFor(t).length === 0 && !(t in EXEMPT),
    );
    // If this fails: a BLOCK_CONFIG block is judged by nothing and says nothing
    // about why. Give it a schema, or an EXEMPT row with a reason and a card.
    expect(undecided, 'blocks judged by nothing, with no exemption').toEqual([]);
  });

  it('every exemption is SELF-DELETING — its block must still resolve to neither oracle', () => {
    const resolvable = Object.keys(EXEMPT).filter((t) => oraclesFor(t).length > 0);
    // If this fails: the exemption's reason has expired. Delete the row and let
    // the block be judged — that is the whole point of writing them this way.
    expect(resolvable, 'exempt blocks that now HAVE a schema').toEqual([]);
  });

  it('every exemption names a real block and carries a reason and a card', () => {
    for (const [type, entry] of Object.entries(EXEMPT)) {
      expect(BLOCK_CONFIG[type], `'${type}' is not a BLOCK_CONFIG block — stale exemption`).toBeDefined();
      expect(entry.reason.length, `'${type}' needs a reason`).toBeGreaterThan(40);
      expect(entry.card, `'${type}' needs a card`).toMatch(/^objectui#\d+$/);
    }
  });

  it('the judged population is non-trivial — the gate is not vacuously green', () => {
    const judged = Object.keys(BLOCK_CONFIG).filter((t) => oraclesFor(t).length > 0);
    expect(judged.length).toBeGreaterThan(Object.keys(EXEMPT).length * 3);
    const controls = judged.reduce((n, t) => n + BLOCK_CONFIG[t].length, 0);
    expect(controls, 'no controls under judgement').toBeGreaterThan(40);
  });
});

/* ── the ratchet ──────────────────────────────────────────────────────────── */

describe('BLOCK_CONFIG ↔ node-schema parity — the ratchet (objectui#8216)', () => {
  const violations = census();
  const byId = new Map(violations.map((v) => [v.id, v]));
  const ledgered = new Set(LEDGER.map(ledgerId));

  it('no control writes a name its oracle refuses or tombstones', () => {
    const unledgered = violations
      .filter((v) => !ledgered.has(v.id))
      .map((v) => `${v.id} [${v.kind}] ${v.detail}`);
    // If this fails: a designer control writes a property key the schema that
    // judges that block does not accept — the objectui#7772 class. Resolutions
    // differ per key (retire the control, rename it, declare the key upstream),
    // so file a card and add a LEDGER row rather than picking one here.
    expect(unledgered, 'unledgered BLOCK_CONFIG field names refused by their schema').toEqual([]);
  });

  it('every ledger row still applies — a resolved key may not leave one behind', () => {
    const stale = LEDGER.filter((r) => !byId.has(ledgerId(r))).map(
      (r) => `${ledgerId(r)} (${r.card}) — no longer a violation; delete this row`,
    );
    expect(stale, 'stale LEDGER rows').toEqual([]);
  });

  it('every ledger row names a control that still exists, and carries a card', () => {
    for (const row of LEDGER) {
      const fields = BLOCK_CONFIG[row.block];
      expect(fields, `LEDGER names '${row.block}', which is not a BLOCK_CONFIG block`).toBeDefined();
      const [head, nested] = row.path.split('[].');
      const top = fields.find((f) => f.name === head);
      expect(top, `LEDGER names '${row.block}.${head}', which is not a control`).toBeDefined();
      if (nested !== undefined) {
        expect(top!.kind).toBe('array');
        const items = (top as Extract<BlockPropField, { kind: 'array' }>).itemFields;
        expect(items.map((f) => f.name), `LEDGER names '${row.path}'`).toContain(nested);
      }
      expect(row.card).toMatch(/^objectui#\d+$/);
      expect(row.why.length, `${ledgerId(row)} needs a reason`).toBeGreaterThan(60);
    }
  });

  it('every SPEC-face ledger row is a real parser refusal, named', () => {
    // The ledger's own non-vacuity. A row recorded from a key-set comparison
    // would look identical to a row recorded from nothing, so each spec-face
    // entry is re-measured through `safeParse` — the verdict the platform's
    // component-props lint actually reaches.
    //
    // SELF-DELETING, like the EXEMPT rows above: the probes below are written
    // out one per row, so this guard is what stops a future spec-face row from
    // being ledgered with no probe behind it. `page:tabs::items[].key` was the
    // second row until objectui#8278 renamed that control to `value`; its
    // measurement moved WITH it, to `page-tabs-item-value-8278.test.tsx`.
    expect(LEDGER.filter((r) => r.face === 'spec').map(ledgerId)).toEqual([]);

    // ⚠️ The spec-face ledger is EMPTY, so the self-deleting probe list above is
    // empty too — and an empty list of probes is exactly what a broken oracle
    // lookup also produces. The live control below is what separates the two: it
    // re-measures the row this test used to carry (`object-kanban::limit@spec`,
    // objectui#8172) and asserts the verdict that RETIRED it, so "no spec-face
    // violations" stays a reading rather than a silence.
    const kanban = SPEC_ORACLES['object-kanban'] as { safeParse: (v: unknown) => any };
    const base = { objectName: 'opportunity', groupBy: 'stage' };
    expect(
      kanban.safeParse(base).success,
      'the base kanban must parse clean, or neither verdict below proves anything',
    ).toBe(true);
    // The former violation, now declared upstream (objectstack#16503).
    expect(kanban.safeParse({ ...base, limit: 50 }).success).toBe(true);
    // The oracle still refuses an undeclared sibling BY NAME — without this the
    // line above would be satisfied just as well by an oracle that stopped
    // refusing anything at all.
    const bogus = kanban.safeParse({ ...base, notAKanbanKey: 1 });
    expect(bogus.success).toBe(false);
    expect(bogus.error.issues.flatMap((i: any) => i.keys ?? [])).toContain('notAKanbanKey');
  });

  it('the NODE-face ledger is empty too, and the row it last carried is re-measured', () => {
    // Same non-vacuity problem as the spec face above, on the other oracle: an
    // empty node-face ledger reads exactly like a node-oracle lookup that found
    // nothing. The live control re-measures `object-form::formType@node`, the
    // row objectui#6152 round 1 retired by declaring the key on the mirror.
    expect(LEDGER.filter((r) => r.face === 'node').map(ledgerId)).toEqual([]);
    const form = NODE_ORACLES['object-form'];
    expect(form, 'the object-form node oracle must resolve, or the verdicts below prove nothing').toBeDefined();
    expect(judge(form, 'formType')).toBeUndefined();
    // …and the same oracle still reports an undeclared name, so the line above is
    // not satisfied by an oracle that stopped judging.
    expect(judge(form, 'notAnObjectFormKey')?.kind).toBe('MISSING');
  });
});
