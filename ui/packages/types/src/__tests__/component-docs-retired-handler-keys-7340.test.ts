// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * No `content/docs` page teaches a RETIRED handler key as an authorable prop
 * (objectui#7340, the docs half of the objectui#6124 ruling of 2026-08-30).
 *
 * ## Why a pin rather than "the docs gates went green"
 *
 * No gate can see this drift. These pages declare their own illustrative
 * `interface` blocks and prop TABLES (objectui#6143):
 * `check-doc-component-types` reads only the `type` STRING LITERALS out of docs
 * code blocks, and `check-doc-snippet-types` compiles `ts`/`tsx` fences — every
 * fence involved here is `plaintext`, and a markdown table is not a fence at
 * all. So a member row may name any key at all and every gate stays green. Same
 * hole `component-docs-disabled-inherited-7239.test.ts` and
 * `button-group-doc-surface-6347.test.ts` record, one surface over.
 *
 * ## The defect this pins shut
 *
 * objectui#6124 (PR #7339) split the `on*` handler keys in two. 36 keys whose
 * function value actually reaches a renderer keep their function type — a
 * RUNTIME SLOT a React host supplies through props. 22 keys nothing reads
 * became `?: never` tombstones on the TypeScript face and named refusal arms on
 * the zod mirror (`handlerKeyRefusal(key, 'retired', …)`). Doc pages went on
 * listing some of the retired 22 as callable props, teaching a key that is now
 * a `tsc` error to assign and a refusal by name at authoring time.
 *
 * ## Why membership is `(interface, key)` and never the key NAME alone
 *
 * A name-level blacklist would be both wrong and unimplementable here: on this
 * tree `onChange` is RETIRED on 8 schemas and LIVE on 14, `onClick` is RETIRED
 * on 3 and LIVE on 8, `onComplete` is RETIRED on `InputOTPSchema` and LIVE on
 * `BatchOperationConfig`. `input-otp.mdx` is the sharpest case: its `onChange`
 * row is a live runtime slot sitting one line above the retired `onComplete`.
 * The unit of the defect is therefore the pair, resolved against the shipped
 * declaration — which is also what keeps this pin honest in the other
 * direction: un-retiring a key makes the page right and this file's premise
 * wrong, and it goes red pointing at `packages/types` instead of silently
 * going on asserting a removal.
 *
 * ## What this file asserts, and why in this shape
 *
 *   1. CENSUS — the retired population is MEASURED off `packages/types/src`
 *      (`on*?: never` members, anchored, attributed to their enclosing
 *      interface), not hand-listed, and pinned at the count and per-file split
 *      this card measured. #6124 moving its own population must be a decision,
 *      not a silent widening of what this file waves through.
 *   2. PAIR RULE — every doc row whose `(owner, key)` resolves to a retired
 *      shipped member spells `never`. A page may still NAME a tombstone (that
 *      is the "marked retired" disposition the card allows), but it may not
 *      present a callable type for it. Offenders are reported as
 *      `page:line owner.key -> typeText`, so a failure names the row.
 *   3. NAME NET — for the retired keys with NO live declaration anywhere
 *      (`onColumnAdd`, `onCardAdd`, `onSlideChange`, `onSendMessage`,
 *      `onSelectChange`, `onExpandChange`, `onCollapsedChange`, `onConfirm` on
 *      this tree; `onClose` and `onSave` joined with objectui#7344), no row
 *      anywhere spells them callable, whatever owner name
 *      the page used. This is the net for doc-LOCAL interface names, which rule
 *      2 cannot resolve by construction (`plugins/*.mdx` document `Overview` /
 *      `Features` / `Properties` blocks with no shipped counterpart).
 *   4. CONTROL — seven measured runtime-slot rows are present, callable, and
 *      cross-checked against source as NOT `?: never`. This is the
 *      blanket-sweep control: an edit that deleted every `on*` row under
 *      `content/docs` turns these red, and rules 2 and 3 alone would call that
 *      a pass. Four of the seven sit on pages this card edited (`input-otp.mdx`
 *      `onChange`, `schema-reference.md` `onCardMove` / `onCardClick` /
 *      `onQuickAdd`), which is where an over-broad edit would land first.
 *   5. PROSE — the reader flags rows, never mentions. Counter-probes feed it a
 *      sentence naming a retired key and a JSON example key and assert neither
 *      becomes a row, because "the retired `onComplete`" in running prose is
 *      not a teaching row (and pages are free to write one).
 *
 * ## Dispositions, recorded so a later reader does not read them as drift
 *
 * Seven pages had the retired rows REMOVED (the card's preferred disposition;
 * no page's prose depended on one). `basic/button-group.mdx` is the single
 * "marked retired" page, and not by taste: `button-group-doc-surface-6347.test`
 * asserts SET EQUALITY between that page's `ButtonGroupButton` block and the
 * shipped mirror's `.shape`, and `onClick` is still a key of that shape (a
 * refusal arm is a declared member). Removing the row would break that pin's
 * central assertion; spelling it `never` with the node-type pointer satisfies
 * both files. Assertion 6 pins that disposition explicitly so it reads as a
 * decision rather than a page someone forgot.
 *
 * ## Boundary, stated rather than implied
 *
 * The scan covers `content/docs/**` only — the published docs site, which is
 * the authoring surface this card is about. Package `README.md` files are a
 * different population and are not read here (`plugin-chatbot/README.md` shows
 * `onSendMessage` as a REACT PROP on `<ObjectChatbot>`, not as a schema key;
 * that is a different contract and out of this card's scope).
 *
 * ## Predictions, written before the first run (red-first)
 *
 * On the unmodified `origin/main` @ `4704aa4bb` pages, with this file in place:
 *
 *   - rule 2 fails listing exactly 10 rows on 8 pages —
 *     `api/schema-reference.md:926,927` (`KanbanSchema.onColumnAdd`,
 *     `onCardAdd`), `components/basic/button-group.mdx:29`
 *     (`ButtonGroupButton.onClick`), `components/data-display/tree-view.mdx:46,47`
 *     (`TreeViewSchema.onSelectChange`, `onExpandChange`),
 *     `components/form/calendar.mdx:42`, `components/form/combobox.mdx:42`,
 *     `components/form/command.mdx:41`, `components/form/radio-group.mdx:50`
 *     (`.onChange` on each), `components/form/input-otp.mdx:36`
 *     (`InputOTPSchema.onComplete`);
 *   - rule 3 fails listing the 4 of those whose key name is unambiguously
 *     retired (`onColumnAdd`, `onCardAdd`, `onSelectChange`, `onExpandChange`);
 *   - assertion 6 fails, because `button-group.mdx` spells `() => void`;
 *   - the CENSUS, CONTROL and PROSE blocks stay GREEN — the defect is in the
 *     pages' retired rows, and nothing about it touches the runtime-slot rows
 *     or the reader. A run that reddened the control too would mean the reader
 *     is broken, not that the pages are.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const TYPES_DIR = join(REPO_ROOT, 'packages', 'types', 'src');
const DOC_DIR = join(REPO_ROOT, 'content', 'docs');

/* ── The shipped surface: every `on*` member, with its enclosing interface ── */

const INTERFACE_RE = /^\s*(?:export\s+)?interface\s+([A-Za-z0-9_]+)/;
const CLOSE_RE = /^\}/;
const SHIPPED_MEMBER_RE = /^\s{2}(on[A-Z][A-Za-z0-9]*)\?:\s*(.+?);?\s*$/;

interface ShippedMember {
  readonly file: string;
  readonly line: number;
  readonly iface: string;
  readonly key: string;
  readonly type: string;
}

function shippedMembers(): ShippedMember[] {
  const out: ShippedMember[] = [];
  for (const file of readdirSync(TYPES_DIR)
    .filter((f) => f.endsWith('.ts'))
    .sort()) {
    const lines = readFileSync(join(TYPES_DIR, file), 'utf8').split('\n');
    let iface: string | null = null;
    lines.forEach((raw, idx) => {
      const decl = INTERFACE_RE.exec(raw);
      if (decl) {
        iface = decl[1];
        return;
      }
      if (CLOSE_RE.test(raw)) {
        iface = null;
        return;
      }
      const member = SHIPPED_MEMBER_RE.exec(raw);
      if (member && iface) {
        out.push({ file, line: idx + 1, iface, key: member[1], type: member[2].trim() });
      }
    });
  }
  return out;
}

const SHIPPED = shippedMembers();
const RETIRED = SHIPPED.filter((m) => m.type === 'never');
const LIVE = SHIPPED.filter((m) => m.type !== 'never');

/** `Iface.key` of every tombstoned member. */
const RETIRED_PAIRS = new Set(RETIRED.map((m) => `${m.iface}.${m.key}`));
/** `Iface.key` of every member that kept a callable type. */
const LIVE_PAIRS = new Set(LIVE.map((m) => `${m.iface}.${m.key}`));
/** Key NAMES that are retired everywhere they are declared. */
const LIVE_NAMES = new Set(LIVE.map((m) => m.key));
const UNAMBIGUOUSLY_RETIRED_NAMES = [...new Set(RETIRED.map((m) => m.key))]
  .filter((name) => !LIVE_NAMES.has(name))
  .sort();

/* ── The documented surface: `on*` rows under `content/docs` ─────────────── */

/** An interface member row: `  onFoo?: (x: T) => void;  // comment`. */
const DOC_MEMBER_RE = /^\s{0,8}(on[A-Z][A-Za-z0-9]*)\?:\s*(\S.*)$/;
/** A markdown prop-table row: ``| `onFoo` | `function` | … |``. */
const DOC_TABLE_RE = /^\|\s*`(on[A-Z][A-Za-z0-9]*)`\s*\|\s*([^|]*)\|/;
/** A section heading that owns the rows below it: `### KanbanSchema`. */
const DOC_HEADING_RE = /^#{2,4}\s+`?([A-Za-z0-9_]+)`?\s*$/;
const DOC_DECL_RE = /^\s*(?:export\s+)?(?:interface|type)\s+([A-Za-z0-9_]+)/;

interface DocRow {
  readonly page: string;
  readonly line: number;
  readonly owner: string;
  readonly key: string;
  readonly type: string;
  readonly shape: 'member' | 'table';
}

/** Everything the row declares as the member's type, comments stripped. */
function typeTextOf(rest: string): string {
  const semi = rest.indexOf(';');
  const body = semi === -1 ? rest : rest.slice(0, semi);
  const comment = body.indexOf('//');
  return (comment === -1 ? body : body.slice(0, comment)).trim();
}

function docPages(): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(dir, entry.name), rel);
      else if (/\.mdx?$/.test(entry.name)) out.push(rel);
    }
  };
  walk(DOC_DIR, '');
  return out;
}

/** Every `on*` row on one page, attributed to the declaration above it. */
function rowsIn(page: string, source: string): DocRow[] {
  const lines = source.split('\n');
  const rows: DocRow[] = [];
  lines.forEach((raw, idx) => {
    const member = DOC_MEMBER_RE.exec(raw);
    const table = DOC_TABLE_RE.exec(raw);
    if (!member && !table) return;
    const key = member ? member[1] : (table as RegExpExecArray)[1];
    const type = typeTextOf(member ? member[2] : (table as RegExpExecArray)[2].replace(/`/g, ''));
    let owner = '(unattributed)';
    for (let i = idx - 1; i >= 0; i -= 1) {
      const decl = DOC_DECL_RE.exec(lines[i]);
      if (decl) {
        owner = decl[1];
        break;
      }
      const heading = DOC_HEADING_RE.exec(lines[i]);
      if (heading) {
        owner = heading[1];
        break;
      }
    }
    rows.push({ page, line: idx + 1, owner, key, type, shape: member ? 'member' : 'table' });
  });
  return rows;
}

const ROWS = docPages().flatMap((page) => rowsIn(page, readFileSync(join(DOC_DIR, page), 'utf8')));
const rowFor = (page: string, owner: string, key: string): DocRow | undefined =>
  ROWS.find((r) => r.page === page && r.owner === owner && r.key === key);
const describeRow = (r: DocRow): string => `${r.page}:${r.line} ${r.owner}.${r.key} -> ${r.type}`;

/** Runtime-slot rows measured present on this tree — the blanket-sweep control. */
const CONTROL = [
  // ⛔ objectui#8802 removed the three `KanbanSchema` rows that sat here. The
  // bare `kanban` node type key retired (maintainer ruling 2026-09-09), the arm
  // retired with it, and `content/docs/api/schema-reference.md`'s
  // `### KanbanSchema` section is now `### ObjectKanbanSchema` — which documents
  // no handler keys at all, because the surviving face declares none. The three
  // are still FORWARDED by `KanbanRenderer`; that they are now declared nowhere
  // is measured and recorded in
  // `plugin-kanban/src/__tests__/kanban-handler-slots-7664.test.tsx`, and
  // reported rather than repaired.
  // (was: objectui#7664, the page documenting the plugin dialect under `KanbanSchema`)
  // now, whose three runtime slots are `onCardMove` / `onCardClick` /
  // `onQuickAdd` — the three `KanbanRenderer` forwards off `schema.*`.
  { page: 'components/basic/pagination.mdx', owner: 'PaginationSchema', key: 'onPageChange' },
  { page: 'components/data-display/tree-view.mdx', owner: 'TreeViewSchema', key: 'onNodeClick' },
  { page: 'components/form/button.mdx', owner: 'ButtonSchema', key: 'onClick' },
  { page: 'components/form/input-otp.mdx', owner: 'InputOTPSchema', key: 'onChange' },
] as const;

describe('the retired population is measured off the shipped tree (objectui#7340)', () => {
  it('counts the `?: never` handler members #6124 and #7344 left behind', () => {
    // 22 from objectui#6124; objectui#7344 (the objectui#6182 string-dialect
    // ruling, same shape) added `AppAction.onClick`, `ReportBuilderSchema.onSave`
    // / `.onCancel` and `CRUDDialogSchema.onClose` — a ruled move of the
    // population, recorded here rather than waved through. objectui#7068 added
    // the legacy `ActionSchema.onSuccess` / `.onFailure` (crud.ts 1 → 3, total
    // 26 → 28): NOT #6124 handler keys — they carried a callback OBJECT
    // (`ActionCallback`, deleted), the third meaning of `onSuccess` — but the
    // same `on*?: never` shape this name-shaped census reads, so the move is
    // recorded here too (maintainer ruling option 1, 2026-09-05).
    //
    // ⭐ 28 → 26, `complex.ts` 4 → 2: objectui#8802 retired the bare `kanban`
    // node type key and its `KanbanSchema` arm, taking that arm's two `?: never`
    // handler tombstones (`onColumnAdd`, `onCardAdd`) out of the shipped tree.
    // ⛔ A shrink here is normally the failure this census exists to catch — a
    // key dropped from a LIVE interface stops being refused and, under
    // `.passthrough()`, is KEPT. What separates this one is that the whole ARM
    // went: a `{ "type": "kanban" }` document is refused BY NAME before any
    // member is examined (`./bare-kanban-node-key-retired-8802.test.ts`).
    //
    // ⭐ 26 → 27, and `objectql.ts` enters this census for the first time:
    // objectui#9342 tombstoned `ObjectKanbanSchema.onCardMove` on both faces.
    // Its `'retired'` reading is objectui#7804's measurement, unchanged — an
    // authored value reaches nothing because `ObjectKanban` substitutes its own
    // mover; what objectui#9342 supplied is the missing precondition, moving
    // `KanbanRenderer`'s read onto an explicit React prop so that
    // `check:handler-key-reads` would accept the tombstone at all.
    //
    // ⭐ 27 → 26, and `app.ts` leaves this census: objectui#7469 (maintainer
    // ruling C) retired `AppAction` WHOLE, taking its `onClick?: never` out of
    // the shipped tree — the #8802 kind of shrink, not a key dropped from a live
    // interface. The array that held the type, the app node's `actions`, is
    // itself a named refusal (`./app-actions-retired-7469.test.ts`), so an
    // authored action with an `onClick` is refused before any member is read.
    //
    // ⭐ 26 → 28, and `ai.ts` enters this census for the first time:
    // objectui#10874 settled the five `on*` members of the three
    // `@object-ui/plugin-ai` declarations per key, by the objectui#6124 rule.
    // All five were `string` — the objectui#6182 dialect #7344's census could not
    // see, because `ai.ts` had no mirror until objectui#10859 — so this reader
    // counted them LIVE until now. `onApplySuggestion` / `onRejectSuggestion`
    // have no reader and are `?: never` now: the two counted here.
    // `onSelect` / `onDismiss` / `onSubmit` are RUNTIME SLOTS their components
    // call, so their twins became callables and they stay LIVE.
    //
    // ⭐ 28 → 29, `objectql.ts` 1 → 2: objectui#11234 tombstoned
    // `ObjectKanbanSchema.onQuickAdd` on both faces, completing ruling B of
    // decision batch #91 on `object-kanban`. The Quick Add pair stays on
    // `KanbanRenderer`'s props, which are not a `@object-ui/types` document
    // interface, so they are not in this census's population.
    //
    // ⭐ 29 → 30, and `designer.ts` enters this census for the first time:
    // objectui#11434 tombstoned `DataModelRelationship.onUpdate` on both faces.
    // NOT a handler key — it carried a referential-action VOCABULARY (`'cascade'`
    // and three more literals; the platform's relationship contract has no update
    // behaviour, so the seat retired it) — but the same `on*?: never` shape this
    // name-shaped census reads, so the move is recorded here the way objectui#7068's
    // `onSuccess` / `onFailure` were. Its sibling `onDelete` kept its vocabulary
    // and counted LIVE until the next step.
    //
    // ⭐ 30 → 31, `designer.ts` 1 → 2: objectui#11434 RESPELLED
    // `DataModelRelationship.onDelete` as `deleteBehavior`, the platform's
    // spelling of the referential action, in the spec's vocabulary. Not a handler
    // key either, and not retired in substance — the action lives on under the
    // new key, which `DataModelDesigner` draws — but the old spelling is now the
    // same `on*?: never` shape this census reads, refused by name with the
    // migration, so it is counted here like `onUpdate` above.
    const split: Record<string, number> = {};
    for (const m of RETIRED) split[m.file] = (split[m.file] ?? 0) + 1;
    expect({ total: RETIRED.length, split }).toEqual({
      total: 31,
      split: {
        'ai.ts': 2,
        'complex.ts': 2,
        'crud.ts': 3,
        'data-display.ts': 4,
        'designer.ts': 2,
        'feedback.ts': 1,
        'form.ts': 8,
        'navigation.ts': 3,
        'objectql.ts': 2,
        'overlay.ts': 2,
        'reports.ts': 2,
      },
    });
  });

  it('the same reader still sees the runtime-slot half — the census is not a filter that eats everything', () => {
    expect(LIVE.length).toBeGreaterThan(RETIRED.length);
    // The pair is what the rules below resolve against, so it must be able to
    // hold both dispositions for one NAME at once.
    expect(RETIRED_PAIRS.has('InputOTPSchema.onComplete')).toBe(true);
    expect(LIVE_PAIRS.has('InputOTPSchema.onChange')).toBe(true);
  });

  it('names the keys no shipped interface declares callable', () => {
    // ⛔ `onCardAdd` and `onColumnAdd` left this list with the retired `kanban`
    // arm (objectui#8802): no shipped interface declares either name at all any
    // more, so the census — which reads NAMES off the shipped tree — has nothing
    // to classify. They are not "live again": the document that could have
    // carried them is refused at its `type`.
    expect(UNAMBIGUOUSLY_RETIRED_NAMES).toEqual([
      // objectui#10874 — declared on `AIFormAssistSchema` alone, read by nothing.
      'onApplySuggestion',
      // objectui#9342 — no shipped interface declares an `onCardMove` callable
      // any more. `KanbanRendererProps.onCardMove` is a React prop on
      // `@object-ui/plugin-kanban`, not a member of a `@object-ui/types`
      // document interface, so it is not in this census's population.
      'onCardMove',
      'onClose',
      'onCollapsedChange',
      'onConfirm',
      // objectui#11434 — `DataModelRelationship.onDelete`, respelled
      // `deleteBehavior`, not a handler; no shipped interface declares the name
      // otherwise.
      'onDelete',
      'onExpandChange',
      // objectui#7068: the legacy `ActionSchema.onFailure` callback object — no
      // shipped interface declares an `onFailure` at all any more. `onSuccess`
      // is NOT here: `UIActionSchema.onSuccess` is LIVE (the spec's navigation
      // block), so that name stays ambiguous and is resolved by the pair rule.
      'onFailure',
      // objectui#11234 — no shipped interface declares an `onQuickAdd` callable
      // any more. `KanbanRendererProps['schema'].onQuickAdd` is a prop of
      // `@object-ui/plugin-kanban`'s component, not a member of a
      // `@object-ui/types` document interface, so it is not in this census's
      // population — the same reading as `onCardMove` above.
      'onQuickAdd',
      // objectui#10874 — declared on `AIFormAssistSchema` alone, read by nothing.
      'onRejectSuggestion',
      'onSave',
      'onSelectChange',
      'onSendMessage',
      'onSlideChange',
      // objectui#11434 — `DataModelRelationship.onUpdate`, a retired referential
      // action, not a handler; no shipped interface declares the name otherwise.
      'onUpdate',
    ]);
  });
});

describe('no page presents a retired member as callable (objectui#7340)', () => {
  it('every documented row resolving to a tombstone spells `never`', () => {
    const offenders = ROWS.filter(
      (r) => RETIRED_PAIRS.has(`${r.owner}.${r.key}`) && r.type !== 'never',
    ).map(describeRow);
    expect(offenders.sort()).toEqual([]);
  });

  it('no row anywhere spells an unambiguously retired key as callable', () => {
    const names = new Set(UNAMBIGUOUSLY_RETIRED_NAMES);
    const offenders = ROWS.filter((r) => names.has(r.key) && r.type !== 'never').map(describeRow);
    expect(offenders.sort()).toEqual([]);
  });

  it('`basic/button-group.mdx` keeps its tombstone row, marked retired with the node-type pointer', () => {
    // The one "marked retired" disposition, forced by the set-equality
    // assertion in `button-group-doc-surface-6347.test.ts`: a refusal arm is
    // still a key of the mirror's `.shape`, so the page owes a row for it.
    const row = rowFor('components/basic/button-group.mdx', 'ButtonGroupButton', 'onClick');
    expect(row, 'no `onClick` row attributed to ButtonGroupButton').toBeDefined();
    expect(row?.type).toBe('never');
    expect(RETIRED_PAIRS.has('ButtonGroupButton.onClick')).toBe(true);
    const page = readFileSync(join(DOC_DIR, 'components/basic/button-group.mdx'), 'utf8');
    expect(page).toContain('RETIRED');
    expect(page).toContain('action:button');
  });

  it('the walk-back reader attributed every row it found', () => {
    expect(ROWS.filter((r) => r.owner === '(unattributed)').map(describeRow)).toEqual([]);
  });
});

describe('runtime-slot rows are NOT flagged — the blanket-sweep control (objectui#7340)', () => {
  it.each(CONTROL)('$page still documents $owner.$key', ({ page, owner, key }) => {
    const row = rowFor(page, owner, key);
    expect(row, `no \`${key}\` row attributed to ${owner} in ${page}`).toBeDefined();
    expect(`${owner}.${key} -> ${row?.type}`).not.toBe(`${owner}.${key} -> never`);
  });

  it.each(CONTROL)('$owner.$key is a live member in the shipped tree', ({ owner, key }) => {
    expect({ pair: `${owner}.${key}`, live: LIVE_PAIRS.has(`${owner}.${key}`) }).toEqual({
      pair: `${owner}.${key}`,
      live: true,
    });
    expect(RETIRED_PAIRS.has(`${owner}.${key}`)).toBe(false);
  });
});

describe('the reader flags rows, never prose (objectui#7340)', () => {
  it('a sentence naming a retired key is not a row', () => {
    const prose = [
      'The retired `onComplete` key is refused by name; author behaviour as a node type.',
      'Use an action:button node instead of onSelectChange.',
      '> Note: onColumnAdd was removed in objectui#6124.',
    ].join('\n');
    expect(rowsIn('probe.mdx', prose)).toEqual([]);
  });

  it('a JSON example key is not a row', () => {
    expect(rowsIn('probe.mdx', '  "onColumnAdd": "doSomething",')).toEqual([]);
  });

  it('but a member row and a table row both ARE', () => {
    const member = rowsIn('probe.mdx', 'interface KanbanSchema {\n  onColumnAdd?: () => void;\n}');
    expect(member.map((r) => `${r.shape} ${r.owner}.${r.key} -> ${r.type}`)).toEqual([
      'member KanbanSchema.onColumnAdd -> () => void',
    ]);
    const table = rowsIn(
      'probe.mdx',
      '### KanbanSchema\n\n| Property | Type |\n|---|---|\n| `onCardAdd` | `function` | Adds a card. |',
    );
    expect(table.map((r) => `${r.shape} ${r.owner}.${r.key} -> ${r.type}`)).toEqual([
      'table KanbanSchema.onCardAdd -> function',
    ]);
  });

  it('the scan really read the docs tree — non-vacuity for every rule above', () => {
    expect(ROWS.length).toBeGreaterThan(50);
    expect(ROWS.filter((r) => r.shape === 'table').length).toBeGreaterThan(0);
    expect(ROWS.filter((r) => r.shape === 'member').length).toBeGreaterThan(0);
  });
});
