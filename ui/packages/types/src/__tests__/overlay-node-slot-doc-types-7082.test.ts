/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Six component pages name their node slots at the type those keys DECLARE
 * (objectui#7082).
 *
 * ## Why this file exists rather than "the docs gates went green"
 *
 * Every row this pins lived in a `plaintext` fence when this file was written
 * (objectui#5867 re-fences these pages `ts` in batches; `Subject.fence` names
 * each page's language today, and a re-fenced page declares its own interface,
 * which compiles without being judged against the declaration). `check:doc-snippets`
 * compiles `ts`/`tsx`/`typescript` fences only (`TS_FENCE_LANGUAGES`,
 * `scripts/check-doc-snippet-types.mjs`) and `check:doc-types` reads only the
 * `type` STRING LITERALS out of docs code blocks. So a member row in these
 * fences may name any type at all and every gate stays green -- the blindness
 * objectui#5250 records and objectui#5867 declares the population of. A green
 * CI run on the correction this file accompanies means "nothing else broke",
 * NOT "the correction is right". Same reasoning, and the same shape, as
 * `button-group-doc-surface-6347.test.ts` (PR #7078).
 *
 * ## The authority here is the TS declaration, NOT the Zod mirror
 *
 * That is the one deliberate departure from the #7078 model, and it is load
 * bearing. When this file was written the TS interface and its mirror
 * DISAGREED on four `trigger` rows: `AlertDialogSchema`, `SheetSchema`,
 * `HoverCardSchema` and `DropdownMenuSchema` all declared `trigger: SchemaNode`
 * (singular) while `zod/overlay.zod.ts` mirrored each as
 * `z.union([SchemaNodeSchema, z.array(SchemaNodeSchema)])`. That asymmetry was
 * objectui#7081, then OPEN. Pinning these pages against the mirror would have
 * published the array form on all four and silently pre-empted that ruling, so
 * the pin followed the type an author's editor reads, and its type-level leg
 * was built to go red the day the declaration widened.
 *
 * objectui#7081 has since LANDED (triage 2026-09-03: the validator's accept set
 * does not move; the TypeScript face stops under-reporting it). All seven
 * singular overlay `trigger` members now declare `SchemaNode | SchemaNode[]`,
 * the four rows below were re-derived to the union in the same PR, and the
 * legs that pinned the divergence now pin the agreement. The authority is
 * unchanged -- the page still says what the DECLARATION says; the declaration
 * simply agrees with its mirror now. `overlay-trigger-union-7081.test.ts` pins
 * the widening itself, on every face it ships on.
 *
 * ## What the pages taught before, measured on `2c3cd1b`
 *
 * Nine rows across six pages spelled a node slot `ComponentSchema`. That was a
 * real shipped export (`blocks.ts`) and it was NOT a node slot -- it was the
 * concrete `type: 'component'` block. A reader who looked the name up found a
 * narrow, unrelated type. Seven of the nine are corrected; the other two are
 * NOT type-name defects at all and are recorded as divergences below, because
 * no honest docs-only edit resolves them.
 *
 * ⚠️ Since objectui#4895 that export is GONE -- the whole block schema family
 * was retired under ADR-0049 (maintainer ruling 2026-09-02, option C1). The
 * correction stands unchanged; only its two type-level premise assertions left,
 * because the type they compared against no longer exists. See the note where
 * they stood.
 *
 * ## One row this file records instead of asserting green (two until objectui#7104)
 *
 * `AlertDialogSchema.actions` and `EmptySchema.action` were documented but
 * declared NOWHERE -- not on the TS interface, not in the mirror. Renaming
 * either to `SchemaNode` would have swapped one false claim for another, so
 * both kept their rows and were pinned as UNDECLARED. objectui#7104 then
 * REMOVED the `actions` row from the alert-dialog page: the key was a phantom in
 * every direction (declared nowhere, read by nothing), and the page now
 * publishes the keys the renderer reads (`alert-dialog-read-dialect-7104.test.ts`
 * pins those rows).
 *
 * ⭐ `EmptySchema.action` kept its row and its pin, with this file promising:
 * *the day it is declared, this file goes red and the page is owed a row.* That
 * day is objectui#7105, and this file DID go red -- the tripwire worked. The two
 * pins are not deleted, they are INVERTED in place: the same reads, asserted
 * with the opposite verdict, so what replaced the recorded state is itself
 * pinned. A deleted pin proves nothing about the state it left behind.
 *
 * What #7105 changed, and why the rename is honest now: the key is declared
 * `action?: SchemaNode` on the TS face and mirrored as `SchemaNodeSchema`, and
 * the RENDERER moved to match -- the `(schema as any).action` cast and the
 * `typeof actionSchema === 'object'` guard are both gone, so a bare string node
 * renders instead of being silently dropped. The guard was the whole reason
 * `SchemaNode` would have been a new false claim; it is not a false claim once
 * the renderer admits what the name admits (maintainer, decision batch #69,
 * 2026-09-07). The page was owed its row and now carries it.
 *
 * The requiredness of `AlertDialogSchema.trigger`, `SheetSchema.trigger` and
 * `SheetSchema.content` was the exception left after that: all three were
 * declared OPTIONAL and published REQUIRED, objectui#7073's defect class
 * rather than this card's, so it was fenced out of the diff and pinned
 * instead so a fix on either side would turn this file red rather than
 * passing unnoticed. objectui#7106 closed it: all three pages now spell `?`,
 * joining `ContextMenuSchema.trigger` -- the row #7073 had already corrected
 * -- as agreement rather than divergence.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error -- plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { stripComments as strip } from '../../../../scripts/js-comment-mask.mjs';

import type { SchemaNode } from '../base';
import type {
  AlertDialogSchema,
  ContextMenuSchema,
  DropdownMenuSchema,
  HoverCardSchema,
  SheetSchema,
} from '../overlay';

/** Local annotation, since the import above is untyped -- the call site stays checked. */
const stripComments: (source: string) => string = strip;

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');

const read = (relative: string): string => readFileSync(join(REPO_ROOT, relative), 'utf8');

/* -- Type-level leg: compiled by `tsc -p packages/types/tsconfig.test.json` -- */

type Equals<A, B> =
  (<G>() => G extends A ? 1 : 2) extends (<G>() => G extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
/** Does this slot admit the ARRAY form? The whole of #7081 in one operator. */
type AdmitsArray<T> = SchemaNode[] extends T ? true : false;

// The seven corrected rows, asserted against the declarations themselves rather
// than against the page text the runtime leg reads.
export type _HoverCardTrigger = Expect<Equals<HoverCardSchema['trigger'], SchemaNode | SchemaNode[]>>;
export type _HoverCardContent = Expect<Equals<HoverCardSchema['content'], SchemaNode | SchemaNode[]>>;
// No `NonNullable` here on purpose: `SchemaNode` ALREADY admits `null |
// undefined`, so stripping them would compare against a type neither side has.
export type _SheetContent = Expect<Equals<SheetSchema['content'], SchemaNode | SchemaNode[]>>;
export type _ContextMenuTrigger = Expect<Equals<ContextMenuSchema['trigger'], SchemaNode | SchemaNode[]>>;

// The #7081 boundary, mechanically -- closed since objectui#7081 landed.
// `ContextMenuSchema` always admitted an array and its page said so; the other
// three admit one now, and their pages say so too.
export type _ContextMenuAdmitsArray = Expect<Equals<AdmitsArray<ContextMenuSchema['trigger']>, true>>;
export type _DropdownAdmitsArray = Expect<Equals<AdmitsArray<DropdownMenuSchema['trigger']>, true>>;
export type _AlertDialogAdmitsArray = Expect<Equals<AdmitsArray<AlertDialogSchema['trigger']>, true>>;
export type _SheetAdmitsArray = Expect<Equals<AdmitsArray<SheetSchema['trigger']>, true>>;

// The premise the whole correction rests on used to be pinned here as two
// type-level assertions: `ComponentSchema` is a real export, and it is NOT a
// node slot -- a `type: 'component'` block is one SchemaNode among many, never
// the slot type. Both are gone because their SUBJECT is: `ComponentSchema` was
// retired with the whole block schema family in objectui#4895 (ADR-0049
// enforce-or-remove, maintainer ruling 2026-09-02, option C1), so the
// comparison is no longer expressible -- the same shape as the theme
// retirement's note in `phase2-schemas.test.ts`.
//
// The correction this file pins is UNAFFECTED, and in fact strengthened: the
// nine rows that spelled a node slot `ComponentSchema` were wrong because the
// name meant something narrow and unrelated, and now the name means nothing at
// all. `block-family-retired-4895.test.ts` pins it out of the published
// surface; the seven corrected rows below still assert against `SchemaNode`.

/* -- The forcing subject for the comment projection (objectui#9768) -- */

/**
 * A subject `members()` reads DIFFERENTLY with and without the comment
 * projection -- the one thing this reader and its two siblings did not have.
 *
 * Measured over the population the three readers sharing
 * `scripts/js-comment-mask.mjs` actually project (this file,
 * `alert-dialog-read-dialect-7104.test.ts` and `overlay-trigger-union-7081.test.ts`):
 * 20 distinct interface bodies -- 10 declarations and 10 docs fences -- and the
 * member map built WITH the projection equalled the map built with NO
 * projection at all on every one, though the projection really does delete
 * prose in most of them. The guard was correct and INERT: nothing would have
 * noticed it being deleted, weakened, or reverted to a hand-rolled regex
 * (objectui#9768, out of the reverse ablation on objectui#9751). ⛔ The counts
 * in that sentence are a reading of one day and nothing re-derives them; what
 * re-derives the PROPERTY is the pin below, on every run.
 *
 * ⚠️ The `@example` counter-probe further down is NOT that subject, and it
 * reads as though it were: a docblock gutter spells its member-shaped line with
 * three spaces and a star, while `members()` anchors on exactly two spaces
 * followed by an identifier, so that probe passes identically with the
 * projection removed. The row inside the ORDINARY block comment below sits ON
 * the anchor, which is the whole difference -- and is the hazard this reader's
 * docblock names.
 *
 * ⛔ Not a synthetic string handed to `members()`: the pin reads this file off
 * disk and extracts this body the same way it extracts a declaration, so what
 * it measures is a subject's behaviour rather than a shape the tree does not
 * have (the distinction objectui#9748 drew).
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

export type _ForcingSubjectReal = Expect<Equals<CommentProjectionForcingSubject['real'], SchemaNode>>;
export type _ForcingSubjectLabel = Expect<Equals<CommentProjectionForcingSubject['label'], string>>;

/* -- Reading a member row, on both sides -- */

interface Member {
  /** Spelled with a `?`. */
  readonly optional: boolean;
  /** Everything between the colon and the terminating semicolon, trimmed. */
  readonly typeText: string;
}

/**
 * The one fence of the page's own language that carries its interface blocks.
 * The language is named per subject: objectui#5867 re-fences these pages from
 * `plaintext` to `ts` in batches, so a page reads `ts` once its batch lands.
 */
function schemaFence(doc: string, path: string, fence: 'plaintext' | 'ts'): string {
  const opener = new RegExp('```' + fence + '\\n([\\s\\S]*?)```', 'g');
  const fences = [...doc.matchAll(opener)].map((match) => match[1]);
  if (fences.length !== 1) {
    throw new Error(`expected exactly one \`${fence}\` fence in ${path}, found ${fences.length}`);
  }
  return fences[0];
}

/** The body of one `interface <name> {` block, THROWING when absent. */
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
 * Comments go first, through `scripts/js-comment-mask.mjs` -- the one reader
 * graded against a parser -- because the declaration bodies carry
 * multi-paragraph doc comments and an `@example` fence inside one holds lines
 * that look exactly like member rows. The question asked here is "is this span
 * a comment", NOT "is this span a JSDoc block": the private projection this
 * replaced saw only a docblock opener, so an ordinary block comment holding a
 * member-shaped line was invisible to it, and its line rule fired only at the
 * start of a line.
 *
 * `stripComments` rather than `maskComments` because this reader reports
 * neither a line number nor an offset into the source it was handed -- it
 * returns member names. That is the projection the module's own header names
 * for that caller.
 *
 * What makes that a live claim rather than a classification argument:
 * `CommentProjectionForcingSubject` above, whose body carries a member-shaped
 * row inside an ordinary block comment. Remove the `stripComments` call here
 * and the pin over that subject reds (objectui#9768).
 */
function members(body: string): Map<string, Member> {
  const bare = stripComments(body);
  const found = new Map<string, Member>();
  for (const match of bare.matchAll(/^ {2}(\w+)(\?)?:\s*([^;]+);/gm)) {
    found.set(match[1], { optional: match[2] === '?', typeText: match[3].trim() });
  }
  return found;
}

/* -- The six subjects -- */

interface Subject {
  readonly name: string;
  readonly docPath: string;
  /** The page's schema fence language (objectui#5867 re-fences it in batches). */
  readonly fence: 'plaintext' | 'ts';
  readonly declPath: string;
}

const SUBJECTS: readonly Subject[] = [
  { name: 'AlertDialogSchema', docPath: 'content/docs/components/overlay/alert-dialog.mdx', fence: 'ts', declPath: 'packages/types/src/overlay.ts' },
  { name: 'ContextMenuSchema', docPath: 'content/docs/components/overlay/context-menu.mdx', fence: 'ts', declPath: 'packages/types/src/overlay.ts' },
  { name: 'HoverCardSchema', docPath: 'content/docs/components/overlay/hover-card.mdx', fence: 'ts', declPath: 'packages/types/src/overlay.ts' },
  { name: 'DropdownMenuSchema', docPath: 'content/docs/components/overlay/dropdown-menu.mdx', fence: 'ts', declPath: 'packages/types/src/overlay.ts' },
  { name: 'SheetSchema', docPath: 'content/docs/components/overlay/sheet.mdx', fence: 'ts', declPath: 'packages/types/src/overlay.ts' },
  { name: 'EmptySchema', docPath: 'content/docs/components/feedback/empty.mdx', fence: 'ts', declPath: 'packages/types/src/feedback.ts' },
];

const documented = new Map<string, Map<string, Member>>();
const declared = new Map<string, Map<string, Member>>();
for (const subject of SUBJECTS) {
  const doc = read(subject.docPath);
  documented.set(
    subject.name,
    members(interfaceBody(schemaFence(doc, subject.docPath, subject.fence), `interface ${subject.name} {`, subject.docPath)),
  );
  declared.set(
    subject.name,
    members(
      interfaceBody(
        read(subject.declPath),
        `export interface ${subject.name} extends BaseSchema {`,
        subject.declPath,
      ),
    ),
  );
}

const docRow = (owner: string, key: string): Member | undefined => documented.get(owner)?.get(key);
const declRow = (owner: string, key: string): Member | undefined => declared.get(owner)?.get(key);

/** The seven rows objectui#7082 corrects: owner, key, and the declared text. */
const CORRECTED: ReadonlyArray<readonly [string, string, string]> = [
  ['AlertDialogSchema', 'trigger', 'SchemaNode | SchemaNode[]'],
  ['ContextMenuSchema', 'trigger', 'SchemaNode | SchemaNode[]'],
  ['HoverCardSchema', 'trigger', 'SchemaNode | SchemaNode[]'],
  ['HoverCardSchema', 'content', 'SchemaNode | SchemaNode[]'],
  ['DropdownMenuSchema', 'trigger', 'SchemaNode | SchemaNode[]'],
  ['SheetSchema', 'trigger', 'SchemaNode | SchemaNode[]'],
  ['SheetSchema', 'content', 'SchemaNode | SchemaNode[]'],
];

describe('six overlay/feedback pages name node slots at the declared type (objectui#7082)', () => {
  it.each(CORRECTED)('%s.%s is published as the declaration spells it', (owner, key, expected) => {
    // Both legs, so neither side can drift alone: the page says `expected`, and
    // `expected` is still what the declaration says.
    expect(docRow(owner, key)?.typeText).toBe(expected);
    expect(declRow(owner, key)?.typeText).toBe(expected);
  });

  it.each(CORRECTED)('%s.%s no longer names `ComponentSchema`', (owner, key) => {
    expect(docRow(owner, key)?.typeText).not.toContain('ComponentSchema');
  });

  it('`ComponentSchema` is no longer a shipped export at all, which is why the old rows were wrong', () => {
    // The original assertion here read `blocks.ts` and proved `ComponentSchema`
    // was a DISTINCT export -- the concrete `type: 'component'` block, not a
    // slot type -- which is what made the nine old rows wrong. objectui#4895
    // retired the whole block schema family, so the same premise is now proved
    // the other way: the name is gone, and `blocks.ts` is a tombstone.
    const blocks = read('packages/types/src/blocks.ts');
    expect(blocks).not.toContain('export interface ComponentSchema');
    expect(blocks).toContain('RETIRED (objectui#4895');
    // Control: the file is still there and still readable, so the absence above
    // is a reading about its CONTENT and not about a failed read.
    expect(blocks).toContain('@module blocks');
    // And `SchemaNode` is the slot type these keys actually carry. Its object arm
    // is `DeclaredNode`, the declared-node union, since objectui#11466.
    expect(read('packages/types/src/base.ts')).toContain(
      'export type SchemaNode = DeclaredNode | string | number | boolean | null | undefined;',
    );
  });
});

describe('objectui#7081 landed: the rows that stayed singular for it now say the union on both faces (objectui#7082)', () => {
  it('`DropdownMenuSchema.trigger` is declared as the union, so the page says the union', () => {
    expect(declRow('DropdownMenuSchema', 'trigger')?.typeText).toBe('SchemaNode | SchemaNode[]');
    expect(docRow('DropdownMenuSchema', 'trigger')?.typeText).toBe('SchemaNode | SchemaNode[]');
  });

  it('its Zod mirror says the union it always said -- the mirror is the side that did NOT move', () => {
    // The pre-#7081 form of this pin read "still says otherwise". The
    // assertion is byte-identical; only what it proves changed: the two faces
    // now agree, and the declaration is the one that moved.
    const mirror = read('packages/types/src/zod/overlay.zod.ts');
    expect(mirror).toContain(
      "trigger: z.union([SchemaNodeSchema, z.array(SchemaNodeSchema)]).describe('Menu trigger')",
    );
  });

  it('its sibling `ContextMenuSchema` declares the same union -- the two no longer differ', () => {
    expect(declRow('ContextMenuSchema', 'trigger')?.typeText).toBe(
      declRow('DropdownMenuSchema', 'trigger')?.typeText,
    );
  });

  it("the renderer's shipped `defaultProps.trigger` is still an array", () => {
    expect(read('packages/components/src/renderers/overlay/dropdown-menu.tsx')).toMatch(
      /trigger:\s*\[\s*\{\s*type:\s*'button'/,
    );
  });
});

describe('the row a docs-only edit could not honestly resolve, resolved (objectui#7082 -> objectui#7105)', () => {
  it('`EmptySchema.action` is declared on BOTH faces, and the page names the declared type', () => {
    // The inverse of the pin this replaces, read for read: that one asserted
    // `declRow(...)` was undefined and that the mirror body carried no `action:`
    // row. objectui#7105 declared both.
    expect(docRow('EmptySchema', 'action')?.typeText).toBe('SchemaNode');
    expect(declRow('EmptySchema', 'action')).toEqual({ optional: true, typeText: 'SchemaNode' });
    // The mirror, which is where a "declared elsewhere" reading used to hide.
    const mirrorPath = 'packages/types/src/zod/feedback.zod.ts';
    const mirrorBody = interfaceBody(read(mirrorPath), 'export const EmptySchema = BaseSchema.extend({', mirrorPath);
    expect(mirrorBody).toMatch(/^\s*action:\s*SchemaNodeSchema/m);
  });

  it('`EmptySchema.action` is READ without a cast, and the object-only guard is gone', () => {
    // The behaviour half, and the reason the rename is honest now. The old pin
    // recorded the cast (`(schema as any).action as BaseSchema | undefined`) and
    // the guard (`typeof actionSchema === 'object'`) as the evidence that
    // `SchemaNode` would be a new false claim: the renderer required an OBJECT
    // while the name admits `string | number | boolean`. objectui#7105 removed
    // both, so the two are asserted ABSENT here -- undeclared-but-consumed, the
    // objectui#6150 class, closed for this key on the read side too.
    const renderer = read('packages/components/src/renderers/feedback/empty.tsx');
    expect(renderer).not.toContain('(schema as any).action');
    expect(renderer).not.toContain("typeof actionSchema === 'object'");
    // Control: this IS the renderer and the scan can find things in it, so the
    // two absences above are readings about its content and not a failed read.
    expect(renderer).toContain("ComponentRegistry.register('empty'");
    expect(renderer).toContain('toRenderableSchema(schema.action)');
  });

  it('`AlertDialogSchema.actions` is read by nothing at all -- the row objectui#7104 removed from the page was a phantom on the read side too', () => {
    const renderer = read('packages/components/src/renderers/overlay/alert-dialog.tsx');
    expect(renderer).not.toMatch(/schema\.actions/);
    // Control: this IS the renderer, and the scan can find things in it.
    // ⛔ Deliberately NOT a string on the TRIGGER path. This control used to
    // read `renderChildren(schema.trigger)` and died when objectui#9710 moved
    // the eight overlay triggers onto a shared seam — a dead control reds, which
    // is the loud direction, but it reds for a reason that has nothing to do
    // with what this test proves. `content` is a sibling slot the trigger work
    // does not touch, so it survives the next trigger refactor too.
    expect(renderer).toContain("ComponentRegistry.register('alert-dialog'");
    expect(renderer).toContain('renderChildren(schema.content)');
  });
});

describe('requiredness: the objectui#7073 class, closed -- all four rows agree on both faces (objectui#7106)', () => {
  it.each([
    ['ContextMenuSchema', 'trigger'],
    ['AlertDialogSchema', 'trigger'],
    ['SheetSchema', 'trigger'],
    ['SheetSchema', 'content'],
  ])('%s.%s is declared optional and published optional', (owner, key) => {
    expect(declRow(owner, key)?.optional).toBe(true);
    expect(docRow(owner, key)?.optional).toBe(true);
  });
});

describe('counter-probes: the readers above can still fail (objectui#7082)', () => {
  it('`interfaceBody` throws rather than returning an empty body', () => {
    expect(() => interfaceBody('nothing here', 'export interface SheetSchema extends BaseSchema {', 'x.ts')).toThrow(
      /no `export interface SheetSchema extends BaseSchema \{` block/,
    );
  });

  it('`schemaFence` throws when a page stops holding exactly one fence', () => {
    expect(() => schemaFence('```plaintext\na\n```\n```plaintext\nb\n```\n', 'x.mdx', 'plaintext')).toThrow(/found 2/);
  });

  it('the extractors really parsed rows, not empty match sets', () => {
    for (const subject of SUBJECTS) {
      expect(documented.get(subject.name)?.size).toBeGreaterThan(1);
      expect(declared.get(subject.name)?.size).toBeGreaterThan(1);
    }
  });

  it('the pre-fix spelling would be caught', () => {
    const regressed = members('  trigger: ComponentSchema;      // Component that triggers the dialog');
    expect(regressed.get('trigger')?.typeText).toBe('ComponentSchema');
    expect(regressed.get('trigger')?.typeText).not.toBe('SchemaNode');
  });

  it('a blind revert to the singular form would be caught on dropdown-menu', () => {
    // The mirror image of the probe this file carried while #7081 was open: the
    // page then said `SchemaNode` and a blind replace to the union was the
    // regression. Now the union is what the declaration says, and the singular
    // spelling is the one that would drift.
    const regressed = members('  trigger: SchemaNode;            // Trigger component');
    expect(regressed.get('trigger')?.typeText).not.toBe(declRow('DropdownMenuSchema', 'trigger')?.typeText);
  });

  it('JSDoc stripping does not eat real rows, and `@example` rows do not become fake ones', () => {
    const parsed = members(
      '\n  /**\n   * @example\n   * ```ts\n   * fake: NotAMember;\n   * ```\n   */\n  real?: SchemaNode;\n',
    );
    expect([...parsed.keys()]).toEqual(['real']);
    expect(parsed.get('real')).toEqual({ optional: true, typeText: 'SchemaNode' });
  });

  it('optionality is read, not assumed -- the two directions differ in this very file', () => {
    expect(declRow('HoverCardSchema', 'trigger')?.optional).toBe(false);
    expect(declRow('SheetSchema', 'trigger')?.optional).toBe(true);
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
