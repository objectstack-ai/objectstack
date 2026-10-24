/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The overlay family's `trigger` slot admits a node OR a node array on every
 * face it ships on (objectui#7081).
 *
 * ## What was wrong, measured on `origin/main` `737037f2`
 *
 * Seven overlay declarations spelled `trigger` as a single `SchemaNode`:
 * `DialogSchema`, `AlertDialogSchema`, `SheetSchema`, `DrawerSchema` (optional)
 * and `PopoverSchema`, `HoverCardSchema`, `DropdownMenuSchema` (required).
 * Every one of their Zod mirrors (`zod/overlay.zod.ts`) spelled the same key
 * `z.union([SchemaNodeSchema, z.array(SchemaNodeSchema)])`; every one of their
 * renderers hands `schema.trigger` to `renderChildren`, whose `Array.isArray`
 * branch (`packages/components/src/lib/utils.tsx:23`) serves the array; and
 * every one of their registrations ships `defaultProps.trigger` as an ARRAY.
 * The two siblings that already carried the union on the TS face
 * (`TooltipSchema`, `ContextMenuSchema`) are the controls below.
 *
 * So the published type -- the one an author's editor reads -- refused the
 * form the validator accepted, the runtime rendered and the component's own
 * default shipped: copying a renderer's default into a typed document was a
 * type error against the type that shipped it.
 *
 * ## Why no gate caught it
 *
 * `zod-mirror-parity.test.ts` asserts one direction only: the mirror accepts
 * everything the declaration declares. A mirror WIDER than its declaration is
 * exactly what that test is built to allow (objectui#5684). This file pins
 * the other direction for this one slot, on this one family.
 *
 * ## What moved (triage 2026-09-03 on the card)
 *
 * The TS face only. The validator's accept set does not move -- the mirror
 * already accepted both forms -- so this is a declaration catching up with
 * what ships, not a capability. `SchemaNode` itself is untouched, and a bare
 * `SchemaNode` slot still refuses an array (the counter-control below).
 *
 * ## The faces, per member
 *
 * - TS: `XSchema['trigger']` equals `SchemaNode | SchemaNode[]`, optionality
 *   kept per member (`SchemaNode` already admits `undefined`, so no
 *   `| undefined` on the optional ones -- the objectui#7082 note).
 * - Zod: the mirror parses a single node AND an array, and refuses a non-node
 *   at the `trigger` path, so the parse is examining the key.
 * - the registration: the shipped `defaultProps.trigger`, read off the
 *   renderer source, is an array, equals the typed copy in `SHIPPED`, and
 *   parses through the mirror. The typed copy is what compiles against the
 *   declaration -- the card's own complaint, made a pin.
 * - the docs: each page's `trigger` row publishes the union.
 *
 * ## Ablation
 *
 * With `overlay.ts` reverted to its pre-#7081 bytes, the `_*Trigger` and
 * `_*AdmitsArray` legs for the seven and the seven `shipped*` documents fail
 * under `tsc -p tsconfig.test.json`; the controls, the counter-control and
 * every runtime leg stay green (the mirror and the renderers never moved).
 * Recorded on the PR.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error -- plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { stripComments as strip } from '../../../../scripts/js-comment-mask.mjs';

import type { DeclaredNode, SchemaNode } from '../base';
import type { CollapsibleSchema } from '../disclosure';
import type { ButtonSchema } from '../form';
import type { TextSchema } from '../layout';
import type {
  AlertDialogSchema,
  ContextMenuSchema,
  DialogSchema,
  DrawerSchema,
  DropdownMenuSchema,
  HoverCardSchema,
  PopoverSchema,
  SheetSchema,
  TooltipSchema,
} from '../overlay';
import {
  AlertDialogSchema as AlertDialogZod,
  ContextMenuSchema as ContextMenuZod,
  DialogSchema as DialogZod,
  DrawerSchema as DrawerZod,
  DropdownMenuSchema as DropdownMenuZod,
  HoverCardSchema as HoverCardZod,
  PopoverSchema as PopoverZod,
  SheetSchema as SheetZod,
  TooltipSchema as TooltipZod,
} from '../zod/overlay.zod.js';

/** Local annotation, since the import above is untyped -- the call site stays checked. */
const stripComments: (source: string) => string = strip;

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const read = (relative: string): string => readFileSync(join(REPO_ROOT, relative), 'utf8');

const DECLARATION = 'packages/types/src/overlay.ts';
const MIRROR = 'packages/types/src/zod/overlay.zod.ts';
const RENDERERS = 'packages/components/src/renderers/overlay';
const DOCS = 'content/docs/components/overlay';
const RENDER_CHILDREN = 'packages/components/src/lib/utils.tsx';

/* -- Type-level leg: compiled by `tsc -p packages/types/tsconfig.test.json` -- */

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
/** Does this slot admit the ARRAY form? The whole of objectui#7081 in one operator. */
type AdmitsArray<T> = SchemaNode[] extends T ? true : false;
/** Is the key spelled with a `?` -- read off the type, not off the source text. */
type IsOptionalKey<T, K extends keyof T> = Record<never, never> extends Pick<T, K> ? true : false;

type Union = SchemaNode | SchemaNode[];

// The seven widened members, each equal to the union `ContextMenuSchema` spells.
export type _DialogTrigger = Expect<Equal<DialogSchema['trigger'], Union>>;
export type _AlertDialogTrigger = Expect<Equal<AlertDialogSchema['trigger'], Union>>;
export type _SheetTrigger = Expect<Equal<SheetSchema['trigger'], Union>>;
export type _DrawerTrigger = Expect<Equal<DrawerSchema['trigger'], Union>>;
export type _PopoverTrigger = Expect<Equal<PopoverSchema['trigger'], Union>>;
export type _HoverCardTrigger = Expect<Equal<HoverCardSchema['trigger'], Union>>;
export type _DropdownMenuTrigger = Expect<Equal<DropdownMenuSchema['trigger'], Union>>;

export type _DialogAdmitsArray = Expect<Equal<AdmitsArray<DialogSchema['trigger']>, true>>;
export type _AlertDialogAdmitsArray = Expect<Equal<AdmitsArray<AlertDialogSchema['trigger']>, true>>;
export type _SheetAdmitsArray = Expect<Equal<AdmitsArray<SheetSchema['trigger']>, true>>;
export type _DrawerAdmitsArray = Expect<Equal<AdmitsArray<DrawerSchema['trigger']>, true>>;
export type _PopoverAdmitsArray = Expect<Equal<AdmitsArray<PopoverSchema['trigger']>, true>>;
export type _HoverCardAdmitsArray = Expect<Equal<AdmitsArray<HoverCardSchema['trigger']>, true>>;
export type _DropdownMenuAdmitsArray = Expect<Equal<AdmitsArray<DropdownMenuSchema['trigger']>, true>>;

// Optionality is KEPT per member: four optional, three required, as before.
export type _DialogOptional = Expect<Equal<IsOptionalKey<DialogSchema, 'trigger'>, true>>;
export type _AlertDialogOptional = Expect<Equal<IsOptionalKey<AlertDialogSchema, 'trigger'>, true>>;
export type _SheetOptional = Expect<Equal<IsOptionalKey<SheetSchema, 'trigger'>, true>>;
export type _DrawerOptional = Expect<Equal<IsOptionalKey<DrawerSchema, 'trigger'>, true>>;
export type _PopoverRequired = Expect<Equal<IsOptionalKey<PopoverSchema, 'trigger'>, false>>;
export type _HoverCardRequired = Expect<Equal<IsOptionalKey<HoverCardSchema, 'trigger'>, false>>;
export type _DropdownMenuRequired = Expect<Equal<IsOptionalKey<DropdownMenuSchema, 'trigger'>, false>>;

// Controls: the two members that already carried the union are unchanged.
export type _TooltipTrigger = Expect<Equal<TooltipSchema['trigger'], Union>>;
export type _ContextMenuTrigger = Expect<Equal<ContextMenuSchema['trigger'], Union>>;

// Counter-control: `AdmitsArray` can say `false`, and the widening is per member,
// not on the node type: `SchemaNode` is one node or a primitive, never a list.
// (Its object arm became `DeclaredNode`, the declared-node union, under
// objectui#11466; that change is not this widening.)
export type _SchemaNodeUntouched = Expect<
  Equal<SchemaNode, DeclaredNode | string | number | boolean | null | undefined>
>;
interface SingularSlot {
  trigger: SchemaNode;
}
export type _SingularRefusesArray = Expect<Equal<AdmitsArray<SingularSlot['trigger']>, false>>;
export const singularStaysSingular: SingularSlot = {
  // @ts-expect-error objectui#7081 -- a bare `SchemaNode` slot still refuses the array form; the widening is per member, not on `SchemaNode`
  trigger: [{ type: 'button', label: 'Open' }],
};

// The one in-repo `trigger` OUTSIDE the family that carried the same asymmetry
// (`disclosure.ts`: `string | SchemaNode` on the TS face, the union in
// `disclosure.zod.ts`, an array in `collapsible.tsx`'s `defaultProps`). It was
// fenced out of objectui#7081 and filed as objectui#7767, and stood here as
// `_CollapsibleStillSingular` -- `AdmitsArray<...>` equal to `false` -- under
// the note that "the day it widens, this leg goes red and the pin is re-derived
// deliberately".
//
// objectui#7767 IS that day, and it is not a second decision: it carries the
// 2026-09-03 ruling recorded above -- "The TS face only. The validator's accept
// set does not move" -- onto this eighth member, whose mirror, renderer and
// shipped `defaultProps` all already served the array. So the leg is TURNED,
// not deleted. It is a pin and not a formality: compiled against the pre-#7767
// declaration this assertion errors (TS2344, `false` does not satisfy `true`),
// and so does `shippedCollapsible` below (TS2322).
//
// The redundant `string |` half went with the widening. `_SchemaNodeUntouched`
// above pins `SchemaNode` as `DeclaredNode | string | ...` (its object arm was
// `BaseSchema` until objectui#11466), and the leg below
// spells the consequence out: `string | SchemaNode` denoted `SchemaNode` all
// along, so dropping it moved nothing.
export type _CollapsibleTrigger = Expect<Equal<CollapsibleSchema['trigger'], Union>>;
export type _CollapsibleAdmitsArray = Expect<Equal<AdmitsArray<CollapsibleSchema['trigger']>, true>>;
export type _CollapsibleRequired = Expect<Equal<IsOptionalKey<CollapsibleSchema, 'trigger'>, false>>;
export type _StringSchemaNodeCollapses = Expect<Equal<string | SchemaNode, SchemaNode>>;

/**
 * The `defaultProps.trigger` each overlay registration ships, copied VERBATIM
 * from its renderer. The runtime leg below proves each copy still equals the
 * source, so this table cannot drift from what ships; this table is what
 * compiles against the declarations.
 */
const SHIPPED = {
  dialog: [{ type: 'button', label: 'Open Dialog' }] satisfies ButtonSchema[],
  'alert-dialog': [{ type: 'button', label: 'Open Alert', variant: 'destructive' }] satisfies ButtonSchema[],
  sheet: [{ type: 'button', label: 'Open Sheet' }] satisfies ButtonSchema[],
  drawer: [{ type: 'button', label: 'Open Drawer' }] satisfies ButtonSchema[],
  popover: [{ type: 'button', label: 'Open Popover', variant: 'outline' }] satisfies ButtonSchema[],
  'hover-card': [{ type: 'button', label: 'Hover me', variant: 'link' }] satisfies ButtonSchema[],
  'dropdown-menu': [{ type: 'button', label: 'Menu', variant: 'outline' }] satisfies ButtonSchema[],
  tooltip: [{ type: 'button', label: 'Hover me', variant: 'outline' }] satisfies ButtonSchema[],
  'context-menu': [{ type: 'text', content: 'Right click here' }] satisfies TextSchema[],
};

// The card's complaint, as a compile: the renderer's own shipped default,
// authored into a typed document. Red on the pre-#7081 declarations.
export const shippedDialog: DialogSchema = { type: 'dialog', trigger: SHIPPED.dialog };
export const shippedAlertDialog: AlertDialogSchema = { type: 'alert-dialog', trigger: SHIPPED['alert-dialog'] };
export const shippedSheet: SheetSchema = { type: 'sheet', trigger: SHIPPED.sheet };
export const shippedDrawer: DrawerSchema = { type: 'drawer', trigger: SHIPPED.drawer };
export const shippedPopover: PopoverSchema = { type: 'popover', trigger: SHIPPED.popover, content: [] };
export const shippedHoverCard: HoverCardSchema = { type: 'hover-card', trigger: SHIPPED['hover-card'], content: [] };
export const shippedDropdownMenu: DropdownMenuSchema = {
  type: 'dropdown-menu',
  trigger: SHIPPED['dropdown-menu'],
  items: [],
};

// The same complaint on the eighth member (objectui#7767), copied VERBATIM from
// `packages/components/src/renderers/disclosure/collapsible.tsx`'s
// `defaultProps`. Red on the pre-#7767 declaration: `string | SchemaNode`
// refused the array its own registration ships.
export const shippedCollapsible: CollapsibleSchema = {
  type: 'collapsible',
  trigger: [{ type: 'button', label: 'Toggle', variant: 'outline' }],
  content: [{ type: 'text', content: 'Collapsible content goes here' }],
};

// A widening, not a replacement: every singular `trigger` keeps type-checking.
const SINGLE: ButtonSchema = { type: 'button', label: 'Open' };
export const singleDialog: DialogSchema = { type: 'dialog', trigger: SINGLE };
export const singleAlertDialog: AlertDialogSchema = { type: 'alert-dialog', trigger: SINGLE };
export const singleSheet: SheetSchema = { type: 'sheet', trigger: SINGLE };
export const singleDrawer: DrawerSchema = { type: 'drawer', trigger: SINGLE };
export const singlePopover: PopoverSchema = { type: 'popover', trigger: SINGLE, content: [] };
export const singleHoverCard: HoverCardSchema = { type: 'hover-card', trigger: SINGLE, content: [] };
export const singleDropdownMenu: DropdownMenuSchema = { type: 'dropdown-menu', trigger: SINGLE, items: [] };
export const singleCollapsible: CollapsibleSchema = { type: 'collapsible', trigger: SINGLE, content: [] };
// ... and so does the bare `string` the dropped `string |` half used to name --
// it is a `SchemaNode`, which is why that half was redundant (objectui#7767).
export const stringCollapsible: CollapsibleSchema = { type: 'collapsible', trigger: 'Toggle', content: [] };

/* -- The forcing subject for the comment projection (objectui#9768) -- */

/**
 * The subject that makes this reader's comment projection LOAD BEARING.
 *
 * Every subject this file reads today produces the same member map with the
 * projection and with no projection at all -- measured across all three
 * `packages/types` readers that share `scripts/js-comment-mask.mjs`, over the
 * whole population they project, and identical on every body (objectui#9768,
 * out of the reverse ablation on objectui#9751). A guard nothing exercises
 * cannot notice being deleted, weakened, or reverted to a hand-rolled regex.
 *
 * The body below carries a member-shaped row inside an ORDINARY block comment
 * -- no `*` gutter, so the row sits on the two-space anchor `members()` matches
 * -- and the pin over it reds the moment `stripComments` leaves `members()`.
 *
 * ⛔ A subject, not a synthetic string: the pin reads this file off disk and
 * extracts this body exactly as it extracts a declaration (the distinction
 * objectui#9748 drew). It is declared here rather than shared with its two
 * sibling readers because each of them carries its OWN copy of `members()`, and
 * a guard in one file cannot red for a projection dropped in another.
 */
export interface CommentProjectionForcingSubject {
  /*
  ⛔ Do not give this block a `*` gutter, and do not "tidy" the row below: a
  gutter moves it off the two-space anchor and this subject silently stops
  forcing anything.

  phantom?: SchemaNode;

  That row is prose. It is a MEMBER ROW to any reader that counts members
  before it separates code from comments.
  */
  real?: SchemaNode;
  label: string;
}

export type _ForcingSubjectReal = Expect<Equal<CommentProjectionForcingSubject['real'], SchemaNode>>;
export type _ForcingSubjectLabel = Expect<Equal<CommentProjectionForcingSubject['label'], string>>;

/* -- Readers (the objectui#7082 shape) -- */

interface Member {
  readonly optional: boolean;
  readonly typeText: string;
}

/**
 * A page's one `ts` fence. objectui#5867 batch 8 re-fenced every overlay page
 * this file reads from `plaintext`, so `check-doc-snippet-types` now compiles
 * them; each page declares its own interface, so that compile does not judge
 * the `trigger` row against the shipped schema. This file still does.
 */
function schemaFence(doc: string, path: string): string {
  const fences = [...doc.matchAll(/```ts\n([\s\S]*?)```/g)].map((match) => match[1]);
  if (fences.length !== 1) throw new Error(`expected exactly one ts fence in ${path}, found ${fences.length}`);
  return fences[0];
}

function interfaceBody(source: string, opener: string, path: string): string {
  const start = source.indexOf(opener);
  if (start === -1) throw new Error(`no \`${opener}\` block in ${path}`);
  const end = source.indexOf('\n}', start);
  if (end === -1) throw new Error(`unterminated \`${opener}\` block in ${path}`);
  return source.slice(start + opener.length, end);
}

/**
 * Member rows of an interface body, keyed by name.
 *
 * Comments go first, through `scripts/js-comment-mask.mjs`: the bodies carry
 * doc comments whose prose holds member-shaped lines. `stripComments` because
 * this reader reports member names -- neither a line nor an offset.
 *
 * What makes that a live claim rather than a classification argument:
 * `CommentProjectionForcingSubject` above, whose body carries a member-shaped
 * row inside an ordinary block comment. Drop the `stripComments` call here and
 * the pin over that subject reds (objectui#9768).
 */
function members(body: string): Map<string, Member> {
  const bare = stripComments(body);
  const found = new Map<string, Member>();
  for (const match of bare.matchAll(/^ {2}(\w+)(\?)?:\s*([^;]+);/gm)) {
    found.set(match[1], { optional: match[2] === '?', typeText: match[3].trim() });
  }
  return found;
}

/**
 * The `trigger: [...]` literal inside a registration's `defaultProps`, as the
 * VALUE it denotes. The renderers write these as plain JS object literals with
 * bare keys and single-quoted strings; that grammar is converted to JSON here,
 * and anything outside it THROWS rather than parsing to something else.
 */
function shippedTrigger(rendererSource: string, path: string): unknown {
  const at = rendererSource.indexOf('defaultProps:');
  if (at === -1) throw new Error(`no \`defaultProps:\` in ${path}`);
  const open = rendererSource.indexOf('trigger:', at);
  if (open === -1) throw new Error(`no \`trigger:\` under \`defaultProps\` in ${path}`);
  const start = rendererSource.indexOf('[', open);
  let depth = 0;
  let end = -1;
  for (let i = start; i < rendererSource.length; i += 1) {
    if (rendererSource[i] === '[') depth += 1;
    if (rendererSource[i] === ']') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (start === -1 || end === -1) throw new Error(`\`defaultProps.trigger\` in ${path} is not an array literal`);
  const literal = rendererSource.slice(start, end + 1);
  if (!/^\[\s*\{(\s*\w+:\s*'[^'":]*'\s*,?)+\s*\}\s*\]$/.test(literal)) {
    throw new Error(`\`defaultProps.trigger\` in ${path} is outside the literal grammar this reader converts: ${literal}`);
  }
  return JSON.parse(literal.replace(/(\w+):/g, '"$1":').replace(/'/g, '"'));
}

/* -- The family -- */

interface Member7081 {
  readonly name: string;
  readonly type: keyof typeof SHIPPED;
  readonly zod: { safeParse: (value: unknown) => { success: boolean; data?: any; error?: any } };
  readonly optional: boolean;
  /** The other REQUIRED keys of the mirror, so a parse can fail only on `trigger`. */
  readonly rest: Record<string, unknown>;
}

const NODE = { type: 'button', label: 'Open' };
const NODES = [NODE, { type: 'text', content: 'and another' }];

const WIDENED: readonly Member7081[] = [
  { name: 'DialogSchema', type: 'dialog', zod: DialogZod, optional: true, rest: {} },
  { name: 'AlertDialogSchema', type: 'alert-dialog', zod: AlertDialogZod, optional: true, rest: {} },
  { name: 'SheetSchema', type: 'sheet', zod: SheetZod, optional: true, rest: {} },
  { name: 'DrawerSchema', type: 'drawer', zod: DrawerZod, optional: true, rest: {} },
  { name: 'PopoverSchema', type: 'popover', zod: PopoverZod, optional: false, rest: { content: [] } },
  { name: 'HoverCardSchema', type: 'hover-card', zod: HoverCardZod, optional: false, rest: { content: [] } },
  { name: 'DropdownMenuSchema', type: 'dropdown-menu', zod: DropdownMenuZod, optional: false, rest: { items: [] } },
];

/** The two that already declared the union: same legs, so the widened seven are held to the settled shape. */
const CONTROLS: readonly Member7081[] = [
  { name: 'TooltipSchema', type: 'tooltip', zod: TooltipZod, optional: true, rest: {} },
  { name: 'ContextMenuSchema', type: 'context-menu', zod: ContextMenuZod, optional: true, rest: { items: [] } },
];

const FAMILY = [...WIDENED, ...CONTROLS];

describe.each(FAMILY.map((member) => [member.name, member] as const))('%s.trigger admits a node or a node array on every face (objectui#7081)', (_title, { name, type, zod, optional, rest }) => {
  it('the declaration spells the union, optionality kept', () => {
    const row = members(interfaceBody(read(DECLARATION), `export interface ${name} extends BaseSchema {`, DECLARATION)).get('trigger');
    expect(row).toEqual({ optional, typeText: 'SchemaNode | SchemaNode[]' });
  });

  it('the mirror parses a SINGLE node and hands it back', () => {
    const result = zod.safeParse({ type, ...rest, trigger: NODE });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.trigger).toEqual(NODE);
  });

  it('the mirror parses a node ARRAY and hands it back', () => {
    const result = zod.safeParse({ type, ...rest, trigger: NODES });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.trigger).toEqual(NODES);
  });

  it('the mirror refuses a non-node AT the `trigger` path -- the parse is examining the key', () => {
    // `SchemaNodeSchema` is `BaseSchemaCore | primitive`, and `BaseSchemaCore`
    // requires `type`: an object without one is not a node, in either form.
    for (const wrong of [{ label: 'a node without a type' }, [{ label: 'a node without a type' }]]) {
      const result = zod.safeParse({ type, ...rest, trigger: wrong });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues.map((issue: { path: unknown[] }) => String(issue.path[0]))).toContain('trigger');
    }
  });

  it('the registration ships `defaultProps.trigger` as an ARRAY, equal to the typed copy, and the mirror parses it', () => {
    const path = `${RENDERERS}/${type}.tsx`;
    const shipped = shippedTrigger(read(path), path);
    expect(Array.isArray(shipped)).toBe(true);
    expect(shipped).toEqual(SHIPPED[type]);
    expect(zod.safeParse({ type, ...rest, trigger: shipped }).success).toBe(true);
  });

  it('the renderer hands `schema.trigger` to the render path -- the read site the docblock names', () => {
    // TWO spellings, one claim. objectui#9710 moved the eight `asChild` triggers
    // onto a shared seam, so they now hand the slot to `renderTriggerSlot`,
    // which renders it through `renderChildren` one hop down (pinned as a chain
    // in `what did NOT move` below). `context-menu` still calls `renderChildren`
    // directly -- its `asChild` child is a real element, so it was never part of
    // that repair. What this asserts is unchanged: the renderer READS
    // `schema.trigger`, which is what licenses the widened declaration.
    expect(read(`${RENDERERS}/${type}.tsx`)).toMatch(
      /renderChildren\(\s*schema\.trigger|renderTriggerSlot\([A-Za-z]+Trigger,\s*schema\.trigger\)/,
    );
  });

  it('the docs page publishes the union', () => {
    const path = `${DOCS}/${type}.mdx`;
    const row = members(interfaceBody(schemaFence(read(path), path), `interface ${name} {`, path)).get('trigger');
    expect(row?.typeText).toBe('SchemaNode | SchemaNode[]');
  });
});

describe('what did NOT move (objectui#7081)', () => {
  it('`renderChildren` still has the `Array.isArray` branch every docblock points at', () => {
    const utils = read(RENDER_CHILDREN);
    expect(utils).toContain('export function renderChildren(');
    expect(utils).toMatch(/if \(Array\.isArray\(children\)\)/);
    // The other hop of the chain the docblocks now describe: the shared seam
    // objectui#9710 introduced reaches that same branch. Without this, the
    // per-member assertion above proves only that the renderer calls the seam,
    // and the array form's read site would be unpinned.
    expect(utils).toContain('export function renderTriggerSlot(');
    // ⚠️ Anchored at the DECLARATION, not at the name: `renderTriggerSlot` and
    // `renderChildren` both appear in that function's docblock, so an unanchored
    // match would be satisfied by the prose describing the chain rather than by
    // the chain.
    expect(utils).toMatch(/export function renderTriggerSlot\([\s\S]*?renderChildren\(/);
  });

  it('the mirror spells the union on all nine overlay `trigger` members -- a census, so a tenth or a ninth cannot slip in or out unnoticed', () => {
    const spelled = read(MIRROR).match(/^\s*trigger: z\.union\(\[SchemaNodeSchema, z\.array\(SchemaNodeSchema\)\]\)/gm) ?? [];
    expect(spelled).toHaveLength(FAMILY.length);
  });

  it('no overlay declaration spells `trigger` as a bare `SchemaNode` any more', () => {
    expect(read(DECLARATION)).not.toMatch(/^\s*trigger\??: SchemaNode;/m);
    // Control: the scan can find the widened spelling, nine times.
    expect(read(DECLARATION).match(/^\s*trigger\??: SchemaNode \| SchemaNode\[\];/gm)).toHaveLength(FAMILY.length);
  });

  it('every widened docblock names its read site and the array branch', () => {
    const source = read(DECLARATION);
    for (const { type } of WIDENED) {
      // ⛔ No trailing colon. This used to require `…${type}.tsx:` -- a
      // cross-file LINE ADDRESS, the form AGENTS.md #11 bans outright because
      // nothing re-derives it and it rots the first time a line moves above the
      // thing it cites. objectui#9710's edit moved those lines and made all
      // seven addresses wrong, which is the rot that rule describes. The claim
      // this test makes -- every widened docblock NAMES its read site -- is
      // carried by the file path; the line number never carried any of it.
      expect(source, type).toContain(`packages/components/src/renderers/overlay/${type}.tsx`);
    }
    expect(source.match(/`Array\.isArray` branch/g)).toHaveLength(WIDENED.length);
  });
});

describe('counter-probes: the readers above can still fail (objectui#7081)', () => {
  it('`shippedTrigger` throws on a literal outside its grammar rather than parsing it to something else', () => {
    expect(() => shippedTrigger("defaultProps: { trigger: [{ type: 'button', label: \"double\" }] }", 'x.tsx')).toThrow(
      /outside the literal grammar/,
    );
    expect(() => shippedTrigger("defaultProps: { trigger: { type: 'button' } }", 'x.tsx')).toThrow(/not an array literal/);
    expect(() => shippedTrigger('inputs: []', 'x.tsx')).toThrow(/no `defaultProps:`/);
  });

  it('`shippedTrigger` reads a nested literal whole', () => {
    expect(shippedTrigger("defaultProps: {\n  trigger: [{ type: 'button', label: 'Open Alert', variant: 'destructive' }],\n}", 'x.tsx')).toEqual(
      SHIPPED['alert-dialog'],
    );
  });

  it('the pre-#7081 spelling would be caught on every widened member', () => {
    const regressed = members('  trigger: SchemaNode;');
    expect(regressed.get('trigger')).toEqual({ optional: false, typeText: 'SchemaNode' });
    expect(regressed.get('trigger')?.typeText).not.toBe('SchemaNode | SchemaNode[]');
  });

  it('the extractors really parsed rows, not empty match sets', () => {
    for (const { name } of FAMILY) {
      expect(members(interfaceBody(read(DECLARATION), `export interface ${name} extends BaseSchema {`, DECLARATION)).size).toBeGreaterThan(1);
    }
  });
});

describe('the comment projection has a subject that FORCES it (objectui#9768)', () => {
  const OWN = fileURLToPath(import.meta.url);
  const OPENER = 'export interface CommentProjectionForcingSubject {';
  const subject = (): string => interfaceBody(readFileSync(OWN, 'utf8'), OPENER, OWN);

  it('the subject really carries a member-shaped row inside a block comment -- read off the UNPROJECTED text', () => {
    // A lookup, not a projection. Without this leg the pin below passes just as
    // well against a subject that lost the row, and an empty guard reads
    // exactly like a live one.
    expect(subject()).toMatch(/\n {2}phantom\?: SchemaNode;\n/);
  });

  it('`members()` reads the two DECLARED rows and not the row in the comment', () => {
    // ⭐ The leg that reds: drop `stripComments` from `members()` and `phantom`
    // joins this map, so the member list -- and the count -- is wrong.
    const rows = members(subject());
    expect([...rows.keys()]).toEqual(['real', 'label']);
    expect(rows.get('real')).toEqual({ optional: true, typeText: 'SchemaNode' });
    expect(rows.get('label')).toEqual({ optional: false, typeText: 'string' });
  });
});
