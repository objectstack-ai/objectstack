/**
 * objectui#7104 — `AlertDialogSchema` declares the keys the `alert-dialog`
 * renderer READS.
 *
 * Measured on `origin/main` `a3eb5d07a`, re-measured unchanged on `6eebc54b6`
 * (2026-09-05, the branch's merge-base at push time): the renderer
 * (`packages/components/src/renderers/overlay/alert-dialog.tsx`) reads
 * `schema.content` (the body, through `renderChildren`), `schema.cancelText`
 * (draws `AlertDialogCancel` only when truthy), `schema.actionText` (draws
 * `AlertDialogAction` only when truthy) and `schema.onAction` (that button's
 * `onClick`) — and NONE of the four was declared on the TS interface or in the
 * zod mirror. They were accepted only because `BaseSchema` carried
 * `[key: string]: any` and the mirror is `.passthrough()`: no editor completed
 * them, no page named them, and a wrong-typed value rode through unexamined.
 * Meanwhile the three keys the type DID declare for the same affordance
 * (`cancelLabel` / `confirmLabel` / `confirmVariant`) are read by nothing, so a
 * document written strictly against the shipped type renders an EMPTY footer.
 *
 * Direction (the PM ruling on the card): declare what the renderer reads. The
 * read dialect is the one live documents are written in — the component's own
 * registered `inputs` and `defaultProps` ship `cancelText` / `actionText`, and
 * the in-repo producer census (lit controls in the PR body) finds three
 * producers of the read dialect on an alert-dialog node and zero of the
 * declared one. Teaching the renderer `cancelLabel` instead would silently
 * blank the footer of every document that works today. ⛔ Neither dialect is
 * declared twice: one affordance, one authoring name (AGENTS.md #0.1).
 *
 * ## Both faces, per key
 *
 * - `content`, `cancelText`, `actionText` — declared on BOTH faces with the
 *   value domain the read enforces: `renderChildren` takes a node or a node
 *   array (the sibling overlays' `content` shape), and the two labels are
 *   truthiness-gated strings with NO renderer default (omit one and that
 *   button is not drawn; the designer palette seeds `'Cancel'` / `'Continue'`).
 * - `onAction` — a RUNTIME SLOT in the objectui#6124 shape: callable on the TS
 *   face (the renderer wires it as the action button's `onClick`), refused BY
 *   NAME in the mirror through `handlerKeyRefusal()` because JSON has no
 *   function value. It is the live key the `onConfirm` tombstone points at.
 *
 * ## Red first
 *
 * Written and run BEFORE the schema edit, on the untouched base. Predicted and
 * observed there: the membership legs red (no such mirror members), the
 * wrong-typed-value legs red (the values parsed green through passthrough),
 * the `onAction` legs red, the docs rows red (the page still published the
 * phantom `actions` row); the controls, the renderer scan, the inert-trio pins
 * and the fixture pins green. The compile-time leg failed on every `Equal`
 * over the four new members, which resolved to `any` through the index
 * signature. The PR body carries the counts from that run.
 *
 * ## What this file left OPEN, and what has since closed it
 *
 * - RESOLVED, and re-derived rather than deleted: `cancelLabel` /
 *   `confirmLabel` / `confirmVariant` used to stay declared on both faces and
 *   read by nothing, and the pins below recorded that state so that the PR
 *   retiring them would re-derive these lines deliberately rather than pass
 *   unnoticed. That PR is objectui#7963 (maintainer ruling 2026-09-10, ADR-0049
 *   enforce-or-remove), and this file went red exactly where it was built to:
 *   the three type-level `StillDeclared` legs and the `@default` docblock leg.
 *   The block near the bottom is the SAME pin re-derived onto the other side of
 *   the flip — the trio is now REFUSED BY NAME rather than merely inert, so what
 *   it asserts is that the keys stay DECLARED (which is what makes a refusal
 *   loud under `.passthrough()`), that the renderer still reads none of them,
 *   and that their docblocks now teach the retirement instead of publishing an
 *   `@default` nothing applies. The parse-level and TypeScript-level contract of
 *   that refusal lives in its own file,
 *   `alert-dialog-footer-keys-refusal-7963.test.ts`, and the DOM reading it
 *   rests on lives with the renderer, in
 *   `packages/components/src/__tests__/alert-dialog-footer-keys-liveness-7963.test.tsx`
 *   — deliberately not duplicated here, for the same reason the objectui#7693
 *   half below is not: this package cannot see a renderer.
 * - RESOLVED, and re-derived rather than deleted: the four schema-catalog
 *   fixtures used to author `actions`, a key no surface carries, so the docs
 *   page's own examples rendered an empty footer — objectui#7693. That card
 *   landed and this file went red exactly as predicted above, on all four
 *   membership legs. The block at the bottom is the SAME pin re-derived onto
 *   the other side of the flip: the fixtures now author the read dialect, and
 *   what it asserts is the TYPES-side reading (every key they author is a
 *   member of the mirror's shape), not the render-side one. The render-side
 *   half lives with the catalog, in
 *   `examples/schema-catalog/test/alert-dialog-footer-read-dialect-7693.test.tsx`
 *   — deliberately not duplicated here, because this package cannot see a
 *   renderer and that one cannot see the mirror's shape.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error -- plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { stripComments as strip } from '../../../../scripts/js-comment-mask.mjs';
import type { z } from 'zod';

import type { SchemaNode } from '../base';
import type { AlertDialogSchema } from '../overlay';
import { AlertDialogSchema as AlertDialogZod } from '../zod/overlay.zod.js';

/** Local annotation, since the import above is untyped -- the call site stays checked. */
const stripComments: (source: string) => string = strip;

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const read = (relative: string): string => readFileSync(join(REPO_ROOT, relative), 'utf8');

const RENDERER = 'packages/components/src/renderers/overlay/alert-dialog.tsx';
const DECLARATION = 'packages/types/src/overlay.ts';
const DOC = 'content/docs/components/overlay/alert-dialog.mdx';
const FIXTURE_DIR = 'examples/schema-catalog/src/schemas/components-overlay-alert-dialog';
const FIXTURES = ['basic-alert-dialog', 'confirmation-dialog', 'custom-actions', 'destructive-action'] as const;

/** The three JSON-authorable keys the renderer reads. */
const READ_KEYS = ['content', 'cancelText', 'actionText'] as const;
/**
 * The three keys the type declared for the same affordance and nothing read.
 *
 * ⚠️ RE-POINTED by objectui#7963, ⛔ not deleted. They were `INERT_DECLARED` —
 * declared, accepted, and read by nothing. They are now REFUSED BY NAME on both
 * faces (`retirementTombstone()` in the mirror, `?: never` on the interface), so
 * "inert" became wrong in its own terms: an authored value no longer rides
 * `.passthrough()` through, it reds at parse. The list keeps its members and its
 * job here — naming the keys the renderer must go on NOT reading and the docs
 * page must go on NOT teaching — under the name that is now true of them.
 */
const RETIRED_DECLARED = ['cancelLabel', 'confirmLabel', 'confirmVariant'] as const;

const shape = AlertDialogZod.shape;

/** A document in the read dialect, every declared value well-typed. */
const AUTHORED = {
  type: 'alert-dialog',
  title: 'Delete this account?',
  description: 'This action cannot be undone.',
  trigger: { type: 'button', label: 'Delete account', variant: 'destructive' },
  content: [{ type: 'text', content: 'Everything under the account goes with it.' }],
  cancelText: 'Keep it',
  actionText: 'Delete',
} as const;

/* -- Type-level leg: compiled by `tsc -p packages/types/tsconfig.test.json` -- */

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
/** A runtime slot keeps a callable member (the objectui#6124 pin's shape). */
type KeepsFunction<T> = [Extract<NonNullable<T>, (...args: never[]) => unknown>] extends [never]
  ? false
  : true;

// The read keys, at the read's own value domain. `SchemaNode` already admits
// `undefined`, so no `| undefined` on `content` (the objectui#7082 note).
export type _Content = Expect<Equal<AlertDialogSchema['content'], SchemaNode | SchemaNode[]>>;
export type _CancelText = Expect<Equal<AlertDialogSchema['cancelText'], string | undefined>>;
export type _ActionText = Expect<Equal<AlertDialogSchema['actionText'], string | undefined>>;
// objectui#8978 — the capability the retired `confirmVariant` was supposed to
// carry, on a spelling in the `action*` dialect this node already uses for that
// button. Two values, and the DOM reading that earns the narrowness lives in
// `packages/components/src/__tests__/alert-dialog-action-variant-8978.test.tsx`.
export type _ActionVariant = Expect<
  Equal<AlertDialogSchema['actionVariant'], 'default' | 'destructive' | undefined>
>;
export type _OnAction = Expect<Equal<AlertDialogSchema['onAction'], (() => void) | undefined>>;
export type _OnActionCallable = Expect<KeepsFunction<AlertDialogSchema['onAction']>>;

// The mirror's INPUT side: the two labels accept a string, the slot accepts
// nothing a JSON author can write.
type MirrorInput = z.input<typeof AlertDialogZod>;
export type _MirrorCancelText = Expect<Equal<MirrorInput['cancelText'], string | undefined>>;
export type _MirrorActionText = Expect<Equal<MirrorInput['actionText'], string | undefined>>;
export type _MirrorOnActionRefused = Expect<Equal<MirrorInput['onAction'], undefined>>;

// The trio, re-derived by objectui#7963: `?: never`, so the member's type is
// `undefined` and no value is assignable to it. These three legs were
// `string | undefined` / the variant union until the retirement landed — that
// is the flip this file was built to make visible.
export type _CancelLabelRetired = Expect<Equal<AlertDialogSchema['cancelLabel'], undefined>>;
export type _ConfirmLabelRetired = Expect<Equal<AlertDialogSchema['confirmLabel'], undefined>>;
export type _ConfirmVariantRetired = Expect<Equal<AlertDialogSchema['confirmVariant'], undefined>>;

// `Equal<…, undefined>` alone would also hold for a key typed `?: undefined`, so
// the refusal itself is asserted where it bites: at the authoring site. The
// `@ts-expect-error` IS the assertion — it stops compiling if any of the three
// ever becomes assignable again.
export const retiredTrioRefused: AlertDialogSchema = {
  type: 'alert-dialog',
  // @ts-expect-error objectui#7963 — `cancelLabel` is retired; write `cancelText`
  cancelLabel: 'Keep it',
  // @ts-expect-error objectui#7963 — `confirmLabel` is retired; write `actionText`
  confirmLabel: 'Delete',
  // @ts-expect-error objectui#7963 — `confirmVariant` is retired, with no surviving spelling
  confirmVariant: 'destructive',
};

// A wrong-typed value is now a compile error AT the key. Before objectui#7104
// the index signature absorbed it: `cancelText: 123` compiled clean.
export const wellTyped: AlertDialogSchema = { type: 'alert-dialog', cancelText: 'Cancel', actionText: 'Continue' };
export const wrongTyped: AlertDialogSchema = {
  type: 'alert-dialog',
  // @ts-expect-error objectui#7104 — `cancelText` is a string, no longer `any` through the index signature
  cancelText: 123,
};

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

/* -- Readers for the docs Schema block and the TS interface (the objectui#7082 shape) -- */

interface Member {
  readonly optional: boolean;
  readonly typeText: string;
}

/**
 * The page's one `ts` fence. objectui#5867 batch 8 re-fenced it from
 * `plaintext`, so `check-doc-snippet-types` now compiles it; the page declares
 * its own interface, so that compile does not judge the member rows against the
 * shipped schema. This file still does.
 */
function schemaFence(doc: string): string {
  const fences = [...doc.matchAll(/```ts\n([\s\S]*?)```/g)].map((match) => match[1]);
  if (fences.length !== 1) throw new Error(`expected exactly one ts fence in ${DOC}, found ${fences.length}`);
  return fences[0];
}

function interfaceBody(source: string, opener: string): string {
  const start = source.indexOf(opener);
  if (start === -1) throw new Error(`no \`${opener}\` block`);
  const end = source.indexOf('\n}', start);
  if (end === -1) throw new Error(`unterminated \`${opener}\` block`);
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

const declaredInterface = () =>
  interfaceBody(read(DECLARATION), 'export interface AlertDialogSchema extends BaseSchema {');

/* -- Runtime leg -- */

describe('the three read keys are DECLARED on the mirror (objectui#7104)', () => {
  it.each(READ_KEYS)('`%s` is a member of the mirror shape (membership cannot be read off acceptance under passthrough)', (key) => {
    expect(shape[key]).toBeDefined();
  });

  it.each(READ_KEYS)('`%s`: the declared value parses green and SURVIVES the parse', (key) => {
    // Green under passthrough before the change too — survival alone cannot
    // tell a declared key from an undeclared one, which is why membership is
    // asserted off `.shape` above and refusal is asserted below.
    const result = AlertDialogZod.safeParse(AUTHORED);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data[key]).toEqual(AUTHORED[key]);
  });

  it.each([
    ['cancelText', 123],
    ['actionText', ['Continue']],
    // `SchemaNodeSchema` is `BaseSchemaCore | primitive`, and `BaseSchemaCore`
    // requires `type` — an object without one is not a node.
    ['content', { label: 'a node without a type' }],
  ] as const)('`%s` refuses a wrong-typed value AT the key — the enforcement the declaration adds', (key, wrong) => {
    const result = AlertDialogZod.safeParse({ ...AUTHORED, [key]: wrong });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => String(issue.path[0]))).toContain(key);
  });

  it('control: the SAME wrong-typed value under an UNDECLARED key is still admitted unexamined — passthrough is unchanged', () => {
    const result = AlertDialogZod.safeParse({ ...AUTHORED, actionLabel: 123 });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.actionLabel).toBe(123);
  });

  it('control: a document that omits all three still parses green — every new member is optional', () => {
    const { content: _content, cancelText: _cancelText, actionText: _actionText, ...rest } = AUTHORED;
    expect(AlertDialogZod.safeParse(rest).success).toBe(true);
  });
});

describe('`onAction` is a RUNTIME SLOT — callable on the TS face, refused BY NAME in the mirror (objectui#7104, the objectui#6124 shape)', () => {
  it('is a member of the mirror shape, carrying the runtime-slot guidance as its description', () => {
    const member = shape.onAction as { description?: string } | undefined;
    expect(member).toBeDefined();
    expect(member?.description).toContain('RUNTIME SLOT');
    expect(member?.description).toContain('`onAction`');
    expect(member?.description).not.toContain('RETIRED');
  });

  it('a JSON author writing it is refused at its own path and pointed at the node-type spelling', () => {
    const result = AlertDialogZod.safeParse({ ...AUTHORED, onAction: { action: 'toast', title: 'Deleted' } });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((candidate) => String(candidate.path[0]) === 'onAction');
    expect(issue).toBeDefined();
    expect(issue?.code).toBe('custom');
    expect(issue?.message).toContain('action:button');
  });

  it('a live function is refused too — the mirror is not the programmatic channel', () => {
    expect(AlertDialogZod.safeParse({ ...AUTHORED, onAction: () => undefined }).success).toBe(false);
  });
});

describe('the fact the declaration records: the renderer READS these keys and teaches them (objectui#7104)', () => {
  it('reads `schema.content`, `schema.cancelText`, `schema.actionText` and `schema.onAction`', () => {
    const renderer = read(RENDERER);
    for (const key of ['content', 'cancelText', 'actionText', 'onAction']) {
      expect(renderer, key).toContain(`schema.${key}`);
    }
  });

  it('its registered `inputs` and `defaultProps` ship the read dialect, and none of the declared-but-unread trio', () => {
    const renderer = read(RENDERER);
    expect(renderer).toMatch(/name:\s*'cancelText'/);
    expect(renderer).toMatch(/name:\s*'actionText'/);
    expect(renderer).toMatch(/name:\s*'content'/);
    expect(renderer).toMatch(/^\s*cancelText:\s*'Cancel',/m);
    expect(renderer).toMatch(/^\s*actionText:\s*'Continue',/m);
    for (const key of RETIRED_DECLARED) expect(renderer, key).not.toContain(key);
  });

  it('control: the scan can find things — this IS the alert-dialog registration', () => {
    const renderer = read(RENDERER);
    // ⛔ Deliberately NOT a string on the TRIGGER path — see the twin control in
    // `overlay-node-slot-doc-types-7082.test.ts`. objectui#9710 moved the eight
    // overlay triggers onto a shared seam and killed the previous spelling here;
    // `content` is a sibling slot that work does not touch.
    expect(renderer).toContain("ComponentRegistry.register('alert-dialog'");
    expect(renderer).toContain('renderChildren(schema.content)');
  });
});

describe('the trio is RETIRED — the objectui#7104 pin re-derived onto the other side of the flip (objectui#7963)', () => {
  it.each(RETIRED_DECLARED)('`%s` is still a MEMBER of the mirror — which is what makes the refusal loud', (key) => {
    // ⛔ Deleting the member was never the shape: `BaseSchemaCore` ends
    // `.passthrough()`, so a dropped key is KEPT in silence. This leg reads
    // identically before and after the retirement and means the OPPOSITE thing —
    // which is exactly why the leg below now asks what the member DOES.
    expect(shape[key]).toBeDefined();
  });

  it.each(RETIRED_DECLARED)('`%s` is a REFUSAL arm, not a value type — the reading `.shape` membership cannot give', (key) => {
    expect(AlertDialogZod.safeParse({ ...AUTHORED, [key]: 'anything' }).success).toBe(false);
  });

  it.each(RETIRED_DECLARED)('`%s` is still declared on the TS interface, now as `?: never`', (key) => {
    const member = members(declaredInterface()).get(key);
    expect(member?.optional).toBe(true);
    expect(member?.typeText).toBe('never');
  });

  it.each(RETIRED_DECLARED)('`%s` is still read by nothing in the renderer', (key) => {
    // ⭐ The reading the retirement rests on, kept standing rather than retired
    // with the keys. The ruling was RETIRE, ⛔ not "teach the renderer the other
    // dialect" — so this must go on being true after the change, not before it.
    expect(read(RENDERER)).not.toContain(key);
  });

  it('their docblocks now teach the retirement instead of publishing an `@default` the renderer never applied', () => {
    // The prong-2 reading the follow-up judged, re-derived: the three `@default`
    // tags were the shipped type telling authors a value would be supplied when
    // nothing read the key at all. They are gone, and each docblock names the
    // card. ⚠️ The `confirmVariant` block named NO substitute until
    // objectui#8978 answered the separate question the retirement pointed at; it
    // now names `actionVariant`, and the KEY is still `?: never` (the leg above
    // is what holds that, and the `@ts-expect-error` at the top of this file is
    // what holds it at an authoring site).
    const iface = declaredInterface();
    expect(iface).not.toMatch(/@default 'Cancel'/);
    expect(iface).not.toMatch(/@default 'Confirm'/);
    for (const key of RETIRED_DECLARED) {
      expect(iface, key).toMatch(new RegExp(`objectui#7963[\\s\\S]{0,4000}?${key}\\?: never;`));
    }
  });

  it('control: the surviving spellings are NOT retired on either face', () => {
    // Without this, every leg above would pass against an interface that had
    // retired the whole footer.
    expect(members(declaredInterface()).get('cancelText')?.typeText).toBe('string');
    expect(members(declaredInterface()).get('actionText')?.typeText).toBe('string');
    expect(AlertDialogZod.safeParse({ ...AUTHORED, cancelText: 'Keep it' }).success).toBe(true);
  });
});

describe('the docs page publishes the read dialect (objectui#7104)', () => {
  const rows = () => members(interfaceBody(schemaFence(read(DOC)), 'interface AlertDialogSchema {'));

  it.each([
    ['content', 'SchemaNode | SchemaNode[]'],
    ['cancelText', 'string'],
    ['actionText', 'string'],
    ['actionVariant', "'default' | 'destructive'"],
  ])('row `%s` is published as `%s`, optional — the declaration\'s own spelling', (key, typeText) => {
    expect(rows().get(key)).toEqual({ optional: true, typeText });
  });

  it.each(['content', 'cancelText', 'actionText', 'actionVariant'])(
    'and the page says what the DECLARATION says for `%s` — neither face can drift alone',
    (key) => {
      // The row texts above are literals, so on their own they pin the page to a
      // string rather than to the type. This leg is the other half: the same row
      // read off `packages/types/src/overlay.ts`.
      expect(rows().get(key)).toEqual(members(declaredInterface()).get(key));
    },
  );

  it('the phantom `actions` row is gone — no surface ever carried it', () => {
    expect(rows().has('actions')).toBe(false);
    expect(read(DOC)).not.toMatch(/^\s*actions\?:/m);
  });

  it('`onAction` is not published as an authorable row — a runtime slot has no JSON spelling', () => {
    expect(rows().has('onAction')).toBe(false);
  });

  it('the page does not teach the declared-but-unread trio either', () => {
    for (const key of RETIRED_DECLARED) expect(rows().has(key), key).toBe(false);
  });

  it('control: the rows both faces always agreed on are still there', () => {
    expect(rows().get('type')?.typeText).toBe("'alert-dialog'");
    // `trigger` widened to the union on both faces with objectui#7081; the row
    // still says what the declaration says.
    expect(rows().get('trigger')?.typeText).toBe('SchemaNode | SchemaNode[]');
  });
});

describe('the schema-catalog fixtures author the READ dialect — objectui#7693, the premise pin re-derived', () => {
  const fixture = (name: string): Record<string, unknown> =>
    JSON.parse(read(`${FIXTURE_DIR}/${name}.json`)) as Record<string, unknown>;

  it.each(FIXTURES)('%s.json authors `cancelText` and `actionText` and no `actions` array', (name) => {
    const json = fixture(name);
    expect(json).not.toHaveProperty('actions');
    expect(typeof json.cancelText).toBe('string');
    expect(typeof json.actionText).toBe('string');
  });

  it('every key any fixture authors is a MEMBER of the mirror — the reading passthrough used to hide', () => {
    // The types-side half of objectui#7693, and the only half this package can
    // measure. `BaseSchema` is `.passthrough()`, so `safeParse` says nothing
    // about whether an authored key is carried by anything; membership in the
    // mirror's own shape is the question, and it is asked here rather than in
    // the catalog because `AlertDialogZod.shape` is not visible from there.
    const authored = new Set(FIXTURES.flatMap((name) => Object.keys(fixture(name))));
    const undeclared = [...authored].filter((key) => !(key in shape)).sort();
    expect(undeclared).toEqual([]);
  });

  it('control: `actions` is not a member, so the leg above really would catch it', () => {
    // Without this, the assertion above passes just as well against a mirror
    // that declares everything, and the four fixture legs read as a tautology.
    expect('actions' in shape).toBe(false);
    expect(['type', 'title', 'trigger', 'cancelText', 'actionText'].every((k) => k in shape)).toBe(true);
  });

  it('control: the pre-repair shape STILL parses green — passthrough did not change', () => {
    // Why nothing red covered objectui#7693 before it landed, kept as a live
    // reading rather than as history: re-authoring a fixture under `actions`
    // would sail through `safeParse` again, which is why the membership leg
    // above is the guard and `.success` is not.
    const preRepair = {
      type: 'alert-dialog',
      title: 'Are you sure?',
      trigger: { type: 'button', label: 'Open' },
      actions: [{ type: 'button', label: 'Cancel' }, { type: 'button', label: 'Continue' }],
    };
    expect(AlertDialogZod.safeParse(preRepair).success).toBe(true);
  });

  it('and every one of them parses GREEN — now with the keys the renderer reads', () => {
    for (const name of FIXTURES) {
      expect(AlertDialogZod.safeParse(fixture(name)).success, name).toBe(true);
    }
  });
});

describe('the comment projection has a subject that FORCES it (objectui#9768)', () => {
  const OWN = fileURLToPath(import.meta.url);
  const OPENER = 'export interface CommentProjectionForcingSubject {';
  const subject = (): string => interfaceBody(readFileSync(OWN, 'utf8'), OPENER);

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
