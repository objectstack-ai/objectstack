// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21464] Every `z.unknown()` member across `ComponentPropsMap` is typed, or
 * is listed here with its recorded reason — the family close-out pin.
 *
 * ## The defect class this file holds
 *
 * A member a renderer reads with a fixed shape, declared `z.unknown()` on its
 * page-component row, accepts any value at the component-props door, and the
 * renderer answers an off-shape value with a silent default. #21445 closed the
 * `object-grid` row's seven; this file enumerates the whole map, so the next
 * such member is caught by a test instead of filed as a single point.
 *
 * ## What is pinned, and why each half
 *
 * - §1 THE ENUMERATION: a walk over every row (into arrays, record values,
 *   union arms, lazy schemas and catchalls) finds each `z.unknown()` member,
 *   and each one must be in {@link LEDGER} with a reason. A new one fails until
 *   it carries one. The other direction holds too: a ledger line whose member
 *   is no longer `z.unknown()` fails, so typing a member deletes its line and
 *   the ledger cannot outlive the debt it records.
 * - §2 EACH REASON IS CHECKED AGAINST THE SCHEMA, where it can be: a slot is a
 *   declared slot position, and a runner-forwarded member says so in its own
 *   `.describe()`.
 * - §3 THE WALK CAN FAIL: it finds a `z.unknown()` in every position it claims
 *   to walk, so a green §1 is not a walk that saw nothing.
 * - §4 THE MEMBERS THIS CARD TYPES: `navigation` on `object-map`,
 *   `object-gantt` and `object-tree` is the list view's
 *   `NavigationConfigSchema`, by identity, and refuses an off-shape value with
 *   the code AND the path; its ADR-0087 D3 entry is registered.
 *
 * Later stages pin the members they type in their own file, beside this one:
 * the list family (`object-grid` `columns` / `fields` / `selection` /
 * `selectable` / `rowActions` / `bulkActions` / `batchActions`,
 * `object-kanban` `columns`, `object-calendar` `calendar`) in
 * `component-list-family-typed-members.pin.test.ts` — `object-grid` `columns`
 * since stage 5, which exited its hold once objectui retired the grid's read of
 * a column `options`. The form family (`object-form` `contentLayout` /
 * `submitBehavior` / `navigateOnSuccess` / `mobile`) in
 * `component-form-family-typed-members.pin.test.ts`. The metric tile
 * (`object-metric` `aggregate` / `trend` / `drillDown` / `compareTo`) in
 * `component-metric-family-typed-members.pin.test.ts`. The objectui-held
 * contracts the last stage could type (`object-gantt` `markers`,
 * `object-timeline` `mapping`, and the field-name `fields` of `object-form`
 * and `object-master-detail-form`) in
 * `component-objectui-held-typed-members.pin.test.ts`; the rest of them are
 * held below as forks — the drill-down's `report`, the form's `customFields`
 * and both forms' `sections`, the timeline's `items` and the action
 * containers' members.
 *
 * ## The STAGED reason is debt, not a verdict
 *
 * A `staged` member IS read with a fixed shape at the `.objectui-sha` pin; its
 * reader is cited on its line. Typing it is the next stage of #21464's
 * close-out (the census found more than one reviewable PR's worth), each stage
 * preceded by its own census of authored writers. The ledger may only lose
 * `staged` lines: a stage that types a member deletes its line here (§1's
 * second half enforces that), and ⛔ a NEW renderer-read member is typed, never
 * added as `staged`.
 *
 * A `fork` line is a member the stage that owned it measured and did NOT type
 * under the stop valve: its contract has two or more viable shapes that no
 * ruling decides. The line names the shapes (§2 checks there are at least
 * two), and the fork is on the card with its census, for a ruling.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import {
  ComponentPropsMap,
  ObjectGanttPropsSchema,
  ObjectMapPropsSchema,
  ObjectTreePropsSchema,
  pageComponentSlotPositions,
} from './component.zod';
import { NavigationConfigSchema } from './view.zod';
import { MIGRATIONS_BY_MAJOR } from '../migrations/registry';

// ───────────────────────────────────────────────────────────────────────────
// The walk
// ───────────────────────────────────────────────────────────────────────────

/** One `z.unknown()` member: its path inside the row, and the `.describe()` nearest it. */
interface UnknownMember {
  readonly path: string;
  readonly describe: string | undefined;
}

/** Wrapper types whose `innerType` is the member itself. */
const WRAPPERS = new Set(['optional', 'nullable', 'default', 'prefault', 'readonly', 'catch', 'nonoptional']);

/**
 * Every `z.unknown()` member reachable from `schema`. Paths spell an array
 * element `[]`, a record value `{}` and an object catchall `.*`; union arms are
 * walked without an index, so two arms carrying one key name one member.
 */
function unknownMembers(schema: unknown): UnknownMember[] {
  const found: UnknownMember[] = [];
  const onPath = new Set<unknown>();
  const visit = (node: unknown, path: string, describe: string | undefined): void => {
    const s = node as { _zod?: { def?: Record<string, any> }; description?: string } | undefined;
    const def = s?._zod?.def;
    if (!def || onPath.has(def)) return;
    const here = s!.description ?? describe;
    if (def.type === 'unknown') {
      found.push({ path, describe: here });
      return;
    }
    onPath.add(def);
    if (WRAPPERS.has(def.type)) visit(def.innerType, path, here);
    else if (def.type === 'pipe') visit(def.in, path, here);
    else if (def.type === 'lazy') visit(def.getter(), path, here);
    else if (def.type === 'array') visit(def.element, `${path}[]`, undefined);
    else if (def.type === 'record') visit(def.valueType, `${path}{}`, undefined);
    else if (def.type === 'union') for (const arm of def.options) visit(arm, path, undefined);
    else if (def.type === 'intersection') {
      visit(def.left, path, undefined);
      visit(def.right, path, undefined);
    } else if (def.type === 'object') {
      for (const [key, member] of Object.entries(def.shape as Record<string, unknown>)) {
        visit(member, path ? `${path}.${key}` : key, undefined);
      }
      if (def.catchall) visit(def.catchall, `${path}.*`, undefined);
    }
    onPath.delete(def);
  };
  visit(schema, '', undefined);
  return found;
}

// ───────────────────────────────────────────────────────────────────────────
// The ledger
// ───────────────────────────────────────────────────────────────────────────

/**
 * The stages the remaining renderer-read members are typed in, by row family.
 * Each stage runs its own census of authored writers first; a narrowing that
 * would refuse a measured writer is reported, not shipped.
 */
const STAGES = {
  'fork': 'element contracts whose declaration is still objectui\'s (the timeline items, `UIActionSchema` — an objectui interface that borrows some members from the spec `Action` — and the runtime form field `FormField`, identity key `name`, which a form section\'s inline entry is too) and the metric drill-down\'s `report`: the S-objectui-held stage, the last of #21464, measured each and found two or more viable spec shapes that no ruling decides, so under the stop valve each is held and its fork reported on the card with its census; the member is typed once a ruling picks a shape',
  'held-for-decision': 'a typed shape exists (by reference, or the renderer\'s own declared type), but measured writers author values it refuses that the renderer draws — the narrowing waits for a ruling',
} as const;
type Stage = keyof typeof STAGES;

type Reason =
  /** A child-component list; every child is judged at its own node by the walks that read `pageComponentSlotPositions()`. */
  | { readonly kind: 'slot' }
  /** Handed to the action runner verbatim; checked: the member's own `.describe()` says so. */
  | { readonly kind: 'runner' }
  /** Record rows or field values: their shape is the bound object's fields, which no page-component row can know. */
  | { readonly kind: 'records' }
  /** A member of a schema another file owns and judges, carried here by reference. */
  | { readonly kind: 'shared'; readonly owner: string; readonly why: string }
  /** The renderer takes any value on purpose. */
  | { readonly kind: 'any-value'; readonly why: string }
  /** A deliberately open bag: the declared members are typed, the rest pass through. */
  | { readonly kind: 'open-bag'; readonly why: string }
  /**
   * Read with a fixed shape at the pin (`reader`); typing it is a named later
   * stage. A `fork` line also names the viable shapes no ruling has chosen
   * between (`shapes`).
   */
  | { readonly kind: 'staged'; readonly stage: Stage; readonly reader: string; readonly shapes?: readonly string[] };

const EXPRESSION_AST: Reason = {
  kind: 'shared',
  owner: 'shared/expression.zod.ts `ExpressionSchema.ast`',
  why: 'the engine-native AST `objectstack compile` fills beside `source` — opaque at the spec layer by design; each engine validates its own shape',
};
const HTTP_REQUEST: Reason = {
  kind: 'shared',
  owner: 'shared/http.zod.ts `HttpRequestSchema`',
  why: 'the query parameters and request body an `api` data source sends, forwarded verbatim to the endpoint the author names; their shape is that endpoint\'s',
};
const INLINE_JSON_SCHEMA: Reason = {
  kind: 'shared',
  owner: 'ui/view.zod.ts `ViewDataSchema` (`provider: \'schema\'`)',
  why: 'an inline JSON Schema (Draft 2020-12) document: its keywords are JSON Schema\'s, not this spec\'s',
};
const BULK_OPTION_ENTRY: Reason = {
  kind: 'shared',
  owner: 'ui/bulk-action.zod.ts `BulkActionDefSchema` `params[].options[]`',
  why: 'a deliberately open option entry (`.passthrough()`): the widget reads `color` / `icon` / `disabled` / `visibleWhen` beyond the declared `{ label, value }` pair',
};
const RECORDS: Reason = { kind: 'records' };
const SLOT: Reason = { kind: 'slot' };
const RUNNER: Reason = { kind: 'runner' };
const staged = (stage: Stage, reader: string): Reason => ({ kind: 'staged', stage, reader });
const fork = (reader: string, shapes: readonly string[]): Reason => ({ kind: 'staged', stage: 'fork', reader, shapes });

/**
 * `ObjectUI` source paths are at the `.objectui-sha` pin `89cad75d55`, except
 * the `fork` lines, read at the `.objectui-sha` pin `ab1879721595` (each read
 * point unchanged at objectui `main` `94985a92ba`).
 */
const LEDGER = new Map<string, Reason>();
const on = (types: readonly string[], paths: readonly string[], reason: Reason): void => {
  for (const type of types) for (const path of paths) LEDGER.set(`${type} ${path}`, reason);
};

const ACTION_RUNNER_PATHS = ['params', 'bodyExtra', 'bodyShape', 'operation', 'patch', 'toast', 'resultDialog', 'onSuccess'];
const VIEW_DATA_TYPES = ['object-grid', 'object-map', 'object-gantt', 'object-tree'];

// Composition slots.
on(['page:tabs', 'page:accordion'], ['items[].children[]'], SLOT);
on(['page:card'], ['children[]', 'footer[]'], SLOT);
on(['page:footer', 'page:sidebar', 'page:section'], ['children[]'], SLOT);

// The engine AST beside every evaluated expression's `source`.
on(['page:tabs'], ['items[].visibleWhen.ast'], EXPRESSION_AST);
on(['record:alert', 'action:group', 'action:menu'], ['visible.ast'], EXPRESSION_AST);
on(['action:button', 'action:icon'], ['visible.ast', 'disabled.ast'], EXPRESSION_AST);
on(['record:line_items'], ['columns[].readonlyWhen.ast', 'columns[].requiredWhen.ast'], EXPRESSION_AST);
on(['object-master-detail-form'], ['details[].columns[].readonlyWhen.ast', 'details[].columns[].requiredWhen.ast'], EXPRESSION_AST);
on(['object-grid'], ['conditionalFormatting[].condition.ast', 'bulkActionDefs[].visible.ast'], EXPRESSION_AST);

// The action blocks' runner-forwarded members.
on(['action:button', 'action:icon'], ACTION_RUNNER_PATHS, RUNNER);

// The data-source binding every record-source block shares.
on(VIEW_DATA_TYPES, ['data.read.params{}', 'data.read.body', 'data.write.params{}', 'data.write.body'], HTTP_REQUEST);
on(VIEW_DATA_TYPES, ['data.items[]'], RECORDS);
on(VIEW_DATA_TYPES, ['data.schema{}'], INLINE_JSON_SCHEMA);

// Record rows and field values.
on(['object-grid', 'object-map', 'object-gantt', 'object-tree'], ['staticData[]'], RECORDS);
on(['object-kanban', 'object-timeline'], ['data[]'], RECORDS);
on(['object-calendar'], ['data[]', 'staticData[]'], RECORDS);
on(['object-form', 'object-master-detail-form'], ['initialValues{}', 'initialData{}'], RECORDS);
on(['object-grid'], ['bulkActionDefs[].patch{}', 'bulkActionDefs[].params[].default'], RECORDS);
// A static board's card is a record row: `id` and `title` are typed, the rest
// is the row's own values (`plugin-kanban/src/index.tsx:155`, kept verbatim).
on(['object-kanban'], ['columns[].cards[].*'], RECORDS);
on(['object-grid'], ['bulkActionDefs[].params[].options[].*'], BULK_OPTION_ENTRY);

// The rest, one line each.
on(['element:definition-list'], ['items[].description'], {
  kind: 'any-value',
  why: 'shown as-is — a string or number as text, an object as JSON (`components/src/renderers/basic/data-list.tsx:68`, `toText`)',
});
on(['object-grid'], ['pagination.*'], {
  kind: 'open-bag',
  why: '`z.looseObject` on purpose: `pageSize` and `pageSizeOptions` are typed and are the only members a read point names; the member\'s own docblock records why the bag stays open',
});

// Read with a fixed shape at the pin — the forks the S-objectui-held stage
// reported, and the one member still held for a ruling.
//
// The metric tile's four members are typed (stages 4 and 5); the drill-down's
// `report` is not. The tile hands it to the shared drawer, which draws a
// dataset-bound report (`isDatasetBoundReport`) and lists the records for any
// other value. Measured against it, the by-reference candidate admits a joined
// report with no dataset-bound block, which the drawer does not draw, and
// refuses a dataset-bound report with no name, label or values, which it does.
on(['object-metric'], ['drillDown.report'], fork(
  'plugin-dashboard/src/DrillDownDrawer.tsx:92 (`isDatasetBoundReport`), used at :115; handed over at ObjectMetricWidget.tsx:742',
  [
    '`ReportSchema` by reference, as it stands: a joined report whose blocks bind no dataset is accepted and lists the records',
    '`ReportSchema` once a joined report\'s blocks must each bind a dataset, as its own refinement comment says they do',
    'a drill-report shape of its own, the two arms the drawer draws',
  ],
));
// The form's inline members are objectui's runtime form field (`FormField`,
// identity key `name`), merged over the generated set and drawn whole; the spec
// declares no such field — its own form field is keyed by `field`, and the
// merge never matches it. objectui's field is open (an index signature) and
// eight of its forty-five members are the grid widget's snake_case keys.
on(['object-form'], ['customFields'], fork(
  'plugin-form/src/customFieldsMerge.ts:78-108 (`FormField`, by `name`), from ObjectForm.tsx:755, :1180',
  [
    'objectui\'s `FormField` as it stands, open, with its snake_case grid keys',
    'a closed spec runtime field of the members a form draws, the grid keys camelCased or left out',
    'the spec\'s own `FormFieldSchema` re-keyed by `name`',
  ],
));
// A section's `fields` draws, beside a name and the form view's `{ field }`
// entry, an inline runtime form field as it stands ("shape 3") — kept by
// objectui#11550's ruling and declared by objectui
// (`ObjectFormSection.fields: (string | FormField)[]`). So this member takes a
// shape once the spec declares the runtime form field: `customFields`'s fork.
on(['object-form', 'object-master-detail-form'], ['sections[]'], fork(
  'plugin-form/src/sectionFields.ts:369-370 (shape 3), reached from ObjectForm.tsx:364, :1518 and every sectioned arm; the master-detail form hands it on at MasterDetailForm.tsx:1692',
  [
    'the form view\'s `FormSectionSchema`, its field entry widened by the runtime form field `customFields` declares',
    'a page-block section shape of its own, the form view\'s section keys plus the three entry arms the form reads',
  ],
));
// The authored timeline entry is objectui's (`TimelineFeedItem` /
// `TimelineGanttItem`): a feed entry's `content` is child schema nodes, and the
// arm an entry must match is chosen by the parent's `variant`.
on(['object-timeline'], ['items[]'], fork(
  'plugin-timeline/src/ObjectTimeline.tsx:587, into renderer.tsx (`TimelineFeedItem` / `TimelineGanttItem`, types/src/data-display.ts:2973, :3042)',
  [
    'the two arms with `content` a slot position the page walks judge, and the arm chosen by a row refinement on `variant`',
    'the two arms with `content` an opaque member and a plain union of the arms',
  ],
));
// Each member is objectui's `UIActionSchema`, drawn and run by the container.
on(['action:group'], ['actions[]{}'], fork(
  'components/src/renderers/action/action-group.tsx:303 (`UIActionSchema[]`), members at :91-249, run at :329-382',
  [
    'the read set, `action:button`\'s keys by `type`, without the keys the rows leave undecided',
    'the read set with `outcomeMessages`, a member `className` and the member `properties.params` bag declared',
  ],
));
on(['action:menu'], ['actions[]{}'], fork(
  'components/src/renderers/action/action-menu.tsx:342 (`UIActionSchema[]`), members at :80-147, :408, run at :264-328',
  [
    'the read set, `action:button`\'s keys by `type`, without the keys the rows leave undecided',
    'the read set with `outcomeMessages`, a member `className` and the member `properties.params` bag declared',
  ],
));
// The list view's own `conditionalFormatting` is the by-reference shape, as on
// `object-grid` (#21445) — but objectui's own kanban fixtures author both rule
// dialects it refuses (`plugin-kanban/src/__tests__/ObjectKanban.
// structuredMembersReachTheirSinks-8313.test.tsx:463-485`,
// `types/src/__tests__/kanban-conditional-formatting.test.ts:29-52`), so the
// narrowing is reported for a ruling instead of shipped.
on(['object-kanban'], ['conditionalFormatting'], staged('held-for-decision', 'plugin-kanban/src/KanbanBoardCore.tsx:114, evaluated at KanbanImpl.tsx:179 (`resolveConditionalFormatting`)'));

/** Every `z.unknown()` member of every row, keyed as the ledger keys it. */
function census(): Map<string, UnknownMember> {
  const members = new Map<string, UnknownMember>();
  for (const [type, row] of Object.entries(ComponentPropsMap)) {
    for (const member of unknownMembers(row)) members.set(`${type} ${member.path}`, member);
  }
  return members;
}

// ───────────────────────────────────────────────────────────────────────────
// §1 the enumeration
// ───────────────────────────────────────────────────────────────────────────

describe('§1 every `z.unknown()` member across ComponentPropsMap is typed, or listed with its reason', () => {
  it('no `z.unknown()` member is missing from the ledger', () => {
    const unlisted = [...census().keys()].filter((key) => !LEDGER.has(key));
    expect(
      unlisted,
      'A `z.unknown()` member with no recorded reason. A member a renderer reads with a fixed shape is TYPED '
      + '(by reference where a schema already declares it, otherwise to the renderer\'s read at the '
      + '`.objectui-sha` pin); a member handed verbatim to a runner keeps `z.unknown()` with that reason in its '
      + '`.describe()` and a `runner` line here.',
    ).toEqual([]);
  });

  it('no ledger line outlives its member — a typed member deletes its line', () => {
    const members = census();
    expect([...LEDGER.keys()].filter((key) => !members.has(key))).toEqual([]);
  });

  it('reaches every row: the walk visits the whole map', () => {
    // LIT CONTROL for the two above: a walk that saw no rows would pass both
    // only if the ledger were empty, and it is not.
    expect(LEDGER.size).toBeGreaterThan(0);
    expect(census().size).toBe(LEDGER.size);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §2 each reason, checked against the schema where it can be
// ───────────────────────────────────────────────────────────────────────────

describe('§2 each recorded reason holds', () => {
  const members = census();
  const entries = [...LEDGER.entries()];

  it('a `slot` member is a declared slot position', () => {
    const positions = new Set(pageComponentSlotPositions().filter((p) => !p.retired)
      .map((p) => (p.panelKey ? `${p.key}[].${p.panelKey}` : p.key)));
    const notSlots = entries
      .filter(([, reason]) => reason.kind === 'slot')
      .map(([key]) => key)
      .filter((key) => !positions.has(key.slice(key.indexOf(' ') + 1).replace(/\[\]$/, '')));
    expect(notSlots).toEqual([]);
  });

  it('a `runner` member says so in its own `.describe()`', () => {
    const silent = entries
      .filter(([, reason]) => reason.kind === 'runner')
      .map(([key]) => key)
      .filter((key) => !/forwarded to the runner/.test(members.get(key)?.describe ?? ''));
    expect(silent).toEqual([]);
  });

  it('a `staged` member names a declared stage and a reader at the pin', () => {
    for (const [key, reason] of entries) {
      if (reason.kind !== 'staged') continue;
      expect(Object.keys(STAGES), key).toContain(reason.stage);
      expect(reason.reader, key).toMatch(/\.tsx?:\d/);
    }
  });

  it('a `fork` line names the two or more shapes no ruling has chosen between, and only a fork does', () => {
    for (const [key, reason] of entries) {
      if (reason.kind !== 'staged') continue;
      if (reason.stage === 'fork') {
        expect(reason.shapes?.length ?? 0, key).toBeGreaterThanOrEqual(2);
        expect(new Set(reason.shapes).size, `${key}: each shape is a different one`).toBe(reason.shapes!.length);
      } else {
        expect(reason.shapes, key).toBeUndefined();
      }
    }
  });

  it('a `shared` member really is the owner\'s: an `ast` beside a `source`, a request beside a `url`', () => {
    for (const [key, reason] of entries) {
      if (reason !== EXPRESSION_AST) continue;
      expect(key, 'an expression-AST line names the `ast` member').toMatch(/\.ast$/);
    }
    for (const [key, reason] of entries) {
      if (reason !== HTTP_REQUEST) continue;
      expect(key, 'an HTTP-request line names `params` or `body` under `read` / `write`').toMatch(/ data\.(read|write)\.(params\{\}|body)$/);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §3 the walk can fail
// ───────────────────────────────────────────────────────────────────────────

describe('§3 the walk finds a `z.unknown()` in every position it claims to walk', () => {
  it('a plain member, an array element, a record value, a union arm, a lazy schema and a catchall', () => {
    const probe = z.object({
      plain: z.unknown().optional().describe('said here'),
      list: z.array(z.unknown()),
      bag: z.record(z.string(), z.unknown()),
      either: z.union([z.string(), z.object({ deep: z.unknown() })]),
      later: z.lazy(() => z.object({ inner: z.unknown() })),
      open: z.looseObject({ typed: z.string() }),
      typed: z.string(),
    });
    expect(unknownMembers(probe)).toEqual([
      { path: 'plain', describe: 'said here' },
      { path: 'list[]', describe: undefined },
      { path: 'bag{}', describe: undefined },
      { path: 'either.deep', describe: undefined },
      { path: 'later.inner', describe: undefined },
      { path: 'open.*', describe: undefined },
    ]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §4 the members this card types
// ───────────────────────────────────────────────────────────────────────────

describe('§4 `navigation` on object-map / object-gantt / object-tree is the list view\'s NavigationConfigSchema', () => {
  const ROWS = [
    ['object-map', ObjectMapPropsSchema],
    ['object-gantt', ObjectGanttPropsSchema],
    ['object-tree', ObjectTreePropsSchema],
  ] as const;
  const BASE = { objectName: 'account' } as const;

  /** The issue codes and paths a refusal carries, so a refusal for the WRONG reason reds. */
  const issues = (result: z.ZodSafeParseResult<unknown>): { code: string; path: string }[] =>
    result.success ? [] : result.error.issues.map((i) => ({ code: i.code, path: i.path.join('.') }));

  for (const [type, schema] of ROWS) {
    const row = () => ComponentPropsMap[type];

    it(`${type}: unwraps to NavigationConfigSchema — the same def`, () => {
      expect(schema.shape.navigation.unwrap()._zod.def).toBe(NavigationConfigSchema._zod.def);
    });

    it(`${type}: parses a navigation block to exactly what NavigationConfigSchema answers`, () => {
      const navigation = { mode: 'drawer', size: 'lg' };
      const r = row().safeParse({ ...BASE, navigation });
      expect(issues(r)).toEqual([]);
      expect(r.success && (r.data as { navigation?: unknown }).navigation)
        .toStrictEqual(NavigationConfigSchema.parse(navigation));
    });

    for (const mode of NavigationConfigSchema.shape.mode.unwrap().options) {
      it(`${type}: parses mode '${mode}'`, () => {
        expect(issues(row().safeParse({ ...BASE, navigation: { mode } }))).toEqual([]);
      });
    }

    const REFUSED: ReadonlyArray<readonly [label: string, navigation: unknown, code: string, path: string]> = [
      ['a number', 42, 'invalid_type', 'navigation'],
      ['a bare mode string', 'drawer', 'invalid_type', 'navigation'],
      ['an unknown mode', { mode: 'tab' }, 'invalid_value', 'navigation.mode'],
      ['an undeclared key', { mode: 'drawer', target: '_blank' }, 'unrecognized_keys', 'navigation'],
    ];
    for (const [label, navigation, code, path] of REFUSED) {
      it(`${type}: refuses ${label} — ${code} at ${path}`, () => {
        const r = row().safeParse({ ...BASE, navigation });
        expect(r.success).toBe(false);
        expect(issues(r)).toEqual([{ code, path }]);
      });
    }

    it(`${type}: an absent navigation stays absent`, () => {
      const r = row().safeParse(BASE);
      expect(issues(r)).toEqual([]);
      expect(r.success && r.data).not.toHaveProperty('navigation');
    });
  }

  it('is registered as the ADR-0087 D3 entry step 18 carries', () => {
    expect(MIGRATIONS_BY_MAJOR[18]!.semantic.map((s) => s.id)).toContain('ui-object-map-gantt-tree-navigation-typed');
  });
});
