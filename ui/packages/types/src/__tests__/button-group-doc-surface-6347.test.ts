/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `button-group.mdx` publishes the shipped surface, in BOTH directions (objectui#6347).
 *
 * ## Why this file exists rather than "the docs gates went green"
 *
 * Nothing in CI reads a component page's `plaintext` interface fence.
 * `check-doc-component-types` reads the `type` STRING LITERALS out of docs code
 * blocks and asks only "does something register this type";
 * `check-doc-snippet-types` compiles `ts`/`tsx` fences and a `plaintext` fence is
 * not one. So a member row in that fence can name any key at all and every gate
 * stays green — the same hole `component-fixture-declared-keys.test.ts` records
 * for catalog fixtures, one surface over. A green CI run on the docs correction
 * this file accompanies would have meant "nothing else broke", NOT "the
 * correction is right".
 *
 * ## What the page taught before, measured on this tree
 *
 * Ten rows disagreed with `packages/types/src/navigation.ts` and its Zod mirror,
 * in BOTH directions — the card had noticed only the first direction:
 *
 *   OVER-stated (documented, never declared):  `ButtonGroupSchema.value`,
 *     `ButtonGroupSchema.selectionMode`, `ButtonGroupButton.value`,
 *     `ButtonGroupButton.icon`; `buttons` spelled REQUIRED against a declared
 *     `buttons?`; `label?` spelled optional against a declared required `label`.
 *   UNDER-stated (declared, never documented): `ButtonGroupButton.variant`,
 *     `.size`, `.onClick`, `.className`; three `variant` members
 *     (`secondary`, `destructive`, `link`) and one `size` member (`icon`).
 *
 * Both directions are one defect class with the sign flipped, which is why this
 * file asserts SET EQUALITY on the component's own members rather than the
 * subset the card enumerated. A one-directional pin is what let the omissions
 * sit beside the corrections through two earlier passes over these pages.
 *
 * ⚠️ `.onClick` is in that UNDER-stated list as HISTORY. objectui#6124 (PR
 * #7339, ruling of 2026-08-30) RETIRED the key: the `button-group` renderer
 * renders each `<Button>` without a click handler and never reads it, so the
 * TypeScript face is now `onClick?: never` and the mirror member is a named
 * refusal, `handlerKeyRefusal('onClick', 'retired', …)`. The page owes the row
 * either way — a refusal arm is still a key of `.shape`, so the set equality
 * above is what forced objectui#7340 to spell the row `never` on the page
 * rather than delete it — but the row must no longer name a callable type.
 * The `onClick` case below therefore reads the mirror's refusal instead of
 * restating `() => void`.
 *
 * ## The authority is the mirror's `.shape`, never parse acceptance
 *
 * `BaseSchema` is `.passthrough()` (and carried `[key: string]: any` until
 * objectui#8347), so an undeclared `selectionMode` PARSES GREEN (and
 * type-checked) — acceptance cannot
 * tell "declared" from "admitted unexamined" (the reading
 * `undeclared-but-consumed-keys-6150.test.ts` and `object-grid-title-mirrored`
 * established). Membership is therefore read off `.shape`, optionality off each
 * member's own `safeParse(undefined)`, and the enum vocabularies through the
 * shared `enumOptions` reader rather than a hand-copied string list, so this
 * file follows the platform instead of asserting yesterday's vocabulary.
 *
 * ## The two BaseSchema-inherited rows are pinned too, and one of them was wrong
 *
 * The page also documents `disabled` and `className`, which `ButtonGroupSchema`
 * inherits rather than declares. `disabled` was spelled `boolean` against a
 * declared `boolean | string` (`base.ts`; the mirror is
 * `z.union([z.boolean(), z.string()])`, the string limb being the predicate
 * dialect `disabledOn` also carries).
 *
 * That read at first like a repo-wide convention worth leaving alone — 14
 * `content/docs/components/**` pages spelled a component schema's own
 * `disabled` as `boolean`. On the tree this file was written against it was
 * not a convention but an outlier: 13 of those 14 component schemas REDECLARED
 * `disabled?: boolean` themselves, so their pages were right and
 * `ButtonGroupSchema` — which did not redeclare it — was the one page out of
 * step.
 *
 * ⚠️ That 13-of-14 reading is now HISTORY, not a live fact. objectui#7087
 * (maintainer ruling 2026-09-01) removed all 18 narrowings, so NONE of the 14
 * redeclare `disabled` any more and all 14 inherit `boolean | string`; the 13
 * pages that had been right became the stale ones and were corrected by
 * objectui#7239. The reasoning below still holds and is why this file asserts
 * the type TEXT of both inherited rows rather than waving them through as
 * "documented centrally" — only the population it was measured against moved.
 * The assertions in this file are about `ButtonGroupSchema` alone and are
 * unaffected; the 14-page invariant now lives in
 * `component-docs-disabled-inherited-7239.test.ts`.
 *
 * ## `## Selection Mode` is gone because the renderer cannot draw it
 *
 * `packages/components/src/renderers/basic/button-group.tsx` implements no
 * selection behaviour at all — it maps `schema.buttons` to `Button` elements and
 * reads `variant` / `size` / `className` / `label` only. The section's heading
 * promised a capability nothing implements. The renderer half is asserted here
 * too, so that whoever DOES implement selection sees this file go red and knows
 * the page owes a section again; without it, the deletion would read as a
 * permanent verdict rather than a statement about this tree.
 *
 * The two catalog fixtures the section used to render STAY (they are a different
 * verification population, fenced off by PR #6345) and are asserted present.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { enumOptions } from '@object-ui/test-support';

import { BaseSchema } from '../zod/base.zod';
import { ButtonGroupButtonSchema, ButtonGroupSchema } from '../zod/navigation.zod';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');

const DOC_PATH = 'content/docs/components/basic/button-group.mdx';
const RENDERER_PATH = 'packages/components/src/renderers/basic/button-group.tsx';
const FIXTURE_DIR = 'examples/schema-catalog/src/schemas/components-basic-button-group';

const read = (relative: string): string => readFileSync(join(REPO_ROOT, relative), 'utf8');

const doc = read(DOC_PATH);
const renderer = read(RENDERER_PATH);

/* ── The documented surface, parsed out of the page's `ts` fence ─────────── */

interface DocumentedMember {
  /** Spelled with a `?`. */
  readonly optional: boolean;
  /** Everything between the colon and the terminating semicolon, trimmed. */
  readonly typeText: string;
}

/**
 * The one `ts` fence that carries the page's interface blocks. objectui#5867
 * batch 7 re-fenced it from `plaintext`, so `check-doc-snippet-types` now
 * compiles it; the page declares its own interfaces, so that compile does not
 * judge the member rows against the shipped schema. This file still does.
 */
function schemaFence(): string {
  const fences = [...doc.matchAll(/```ts\n([\s\S]*?)```/g)].map((match) => match[1]);
  if (fences.length !== 1) {
    throw new Error(`expected exactly one \`ts\` fence in ${DOC_PATH}, found ${fences.length}`);
  }
  return fences[0];
}

/** The body of one `interface <name> { … }` block, THROWING when absent. */
function interfaceBody(source: string, name: string): string {
  const opener = `interface ${name} {`;
  const start = source.indexOf(opener);
  if (start === -1) throw new Error(`no \`${opener}\` block in ${DOC_PATH}`);
  const end = source.indexOf('\n}', start);
  if (end === -1) throw new Error(`unterminated \`${opener}\` block in ${DOC_PATH}`);
  return source.slice(start + opener.length, end);
}

/** Member rows of an interface body, keyed by name. */
function documentedMembers(body: string): Map<string, DocumentedMember> {
  const members = new Map<string, DocumentedMember>();
  // The type text runs to the `;` that ENDS the row — an inline object type
  // carries its own `;` between members (`{ dialect?: string; source: string }`,
  // objectui#7530), so "up to the first `;`" would truncate it.
  for (const match of body.matchAll(/^ {2}(\w+)(\?)?:\s*(.+?);(?=\s*(?:\/\/.*)?$)/gm)) {
    members.set(match[1], { optional: match[2] === '?', typeText: match[3].trim() });
  }
  return members;
}

/** The single-quoted literals in a documented union, in source order. */
const documentedLiterals = (typeText: string): string[] =>
  [...typeText.matchAll(/'([^']*)'/g)].map((match) => match[1]);

/* ── The declared surface, read off the shipped Zod mirrors ──────────────── */

type ZodShape = Record<string, { safeParse(value: unknown): { success: boolean } }>;

const buttonShape = ButtonGroupButtonSchema.shape as unknown as ZodShape;
const groupShape = ButtonGroupSchema.shape as unknown as ZodShape;
const BASE_KEYS = new Set(Object.keys(BaseSchema.shape));

/** A member accepts `undefined`, i.e. the page should spell it with a `?`. */
const declaredOptional = (shape: ZodShape, key: string): boolean =>
  shape[key].safeParse(undefined).success;

/**
 * Peel `.optional()` / `.default()` / `.nullable()` off a mirror member.
 *
 * Bounded rather than `while`, for the reason `@object-ui/test-support`'s
 * `enumOptions` gives: the step is reached through `unknown`, so a node that
 * unwraps to itself ends the walk instead of the process. That shared reader is
 * deliberately NOT used here — it answers "which enum NAMES does this accept",
 * and reading a union's option SCHEMAS out of it would be relying on a return
 * value its contract does not promise.
 */
interface WrapperCarrier {
  readonly options?: readonly unknown[];
  readonly shape?: Record<string, unknown>;
  readonly def?: {
    readonly type?: string;
    readonly innerType?: unknown;
    readonly options?: readonly unknown[];
    readonly shape?: Record<string, unknown>;
  };
  readonly _def?: { readonly innerType?: unknown };
}

function unwrapWrappers(node: unknown): WrapperCarrier | undefined {
  let carrier = node as WrapperCarrier | undefined;
  for (let depth = 0; carrier && depth <= 8; depth += 1) {
    const inner = carrier.def?.innerType ?? carrier._def?.innerType;
    if (!inner) return carrier;
    carrier = inner as WrapperCarrier;
  }
  return carrier;
}

/**
 * The declared type of a member, spelled the way the page writes it.
 *
 * A union is FLATTENED, because the mirror composes one: since objectui#7530
 * `disabled` is `z.union([z.boolean(), ExpressionWireSchema])`, and
 * `ExpressionWireSchema` is itself the union `string | { dialect?: string;
 * source: string }` reused by reference (the ruling forbids a second envelope
 * spelling), so the page's flat `boolean | string | { dialect?: string; source:
 * string }` is the nested mirror read through. An object arm is spelled as an
 * inline object type — each member with its own type, `?` on the optional ones
 * — because that is the one spelling that is valid TypeScript inside a `ts`
 * fence AND a faithful reading of the mirror, so the pages can carry one
 * spelling whatever their fence language (`box.mdx` fences its block `ts`,
 * and `check:doc-snippets` compiles it).
 */
function declaredTypeText(node: unknown): string {
  const inner = unwrapWrappers(node);
  if (inner?.def?.type === 'union') {
    const options = inner.options ?? inner.def.options ?? [];
    return options.map(declaredTypeText).join(' | ');
  }
  if (inner?.def?.type === 'object') {
    const shape = inner.shape ?? inner.def.shape ?? {};
    const members = Object.entries(shape).map(([key, member]) => {
      const optional = (member as WrapperCarrier | undefined)?.def?.type === 'optional';
      return `${key}${optional ? '?' : ''}: ${declaredTypeText(member)}`;
    });
    return `{ ${members.join('; ')} }`;
  }
  return String(inner?.def?.type ?? 'unknown');
}

/**
 * The members this component declares in its OWN right.
 *
 * `type` is re-declared by `.extend()` as the discriminator literal, so it
 * belongs here even though `BaseSchema` carries a `type` too; every other
 * inherited key is documented centrally, not on a component page.
 */
const groupOwnKeys = Object.keys(groupShape).filter((key) => key === 'type' || !BASE_KEYS.has(key));

const buttonBody = interfaceBody(schemaFence(), 'ButtonGroupButton');
const groupBody = interfaceBody(schemaFence(), 'ButtonGroupSchema');
const buttonDoc = documentedMembers(buttonBody);
const groupDoc = documentedMembers(groupBody);

describe('button-group.mdx: the `ButtonGroupButton` block IS the shipped mirror (objectui#6347)', () => {
  it('documents exactly the declared members — no more, no fewer', () => {
    expect([...buttonDoc.keys()].sort()).toEqual(Object.keys(buttonShape).sort());
  });

  it.each([...Object.keys(buttonShape)])('spells `%s` with the declared optionality', (key) => {
    expect(buttonDoc.get(key)?.optional).toBe(declaredOptional(buttonShape, key));
  });

  it.each(['variant', 'size'])('publishes the whole shipped `%s` vocabulary', (key) => {
    const shipped = enumOptions(buttonShape[key]);
    expect(shipped.length).toBeGreaterThan(0);
    expect(documentedLiterals(buttonDoc.get(key)?.typeText ?? '')).toEqual(shipped);
  });

  it('documents `onClick` as the RETIRED tombstone it now is (objectui#6124)', () => {
    // Read off the mirror rather than restated: a `handlerKeyRefusal` arm
    // refuses EVERY value, a function included, which is what distinguishes a
    // retired key from the runtime slots that kept `z.function()`. If #6124 is
    // ever reversed this goes red here — at `packages/types`, where the
    // decision would live — instead of leaving the page silently understated.
    expect(buttonShape.onClick.safeParse(() => undefined).success).toBe(false);
    expect(buttonShape.onClick.safeParse('anything').success).toBe(false);
    expect(buttonDoc.get('onClick')?.typeText).toBe('never');
    expect(buttonBody).toContain('RETIRED');
    // The remedy the tombstone JSDoc and the refusal message both point at.
    expect(buttonBody).toContain('action:button');
  });
});

describe('button-group.mdx: the `ButtonGroupSchema` block IS the shipped mirror (objectui#6347)', () => {
  it('names no member the mirror does not declare', () => {
    const undeclared = [...groupDoc.keys()].filter((key) => !(key in groupShape));
    expect(undeclared).toEqual([]);
  });

  it('documents every member this component declares in its own right', () => {
    const missing = groupOwnKeys.filter((key) => !groupDoc.has(key));
    expect(missing).toEqual([]);
    // Non-vacuity: the filter above is only worth something while it has
    // something to filter.
    expect([...groupOwnKeys].sort()).toEqual(['buttons', 'size', 'type', 'variant']);
  });

  it.each([...Object.keys(groupShape).filter((key) => !BASE_KEYS.has(key))])(
    'spells `%s` with the declared optionality',
    (key) => {
      expect(groupDoc.get(key)?.optional).toBe(declaredOptional(groupShape, key));
    },
  );

  it.each(['variant', 'size'])('publishes the whole shipped `%s` vocabulary', (key) => {
    const shipped = enumOptions(groupShape[key]);
    expect(shipped.length).toBeGreaterThan(0);
    expect(documentedLiterals(groupDoc.get(key)?.typeText ?? '')).toEqual(shipped);
  });

  it.each(['disabled', 'className'])(
    'the inherited `%s` row it documents matches the declared member',
    (key) => {
      expect(BASE_KEYS.has(key)).toBe(true);
      expect(groupDoc.get(key)?.optional).toBe(declaredOptional(groupShape, key));
      expect(groupDoc.get(key)?.typeText).toBe(declaredTypeText(groupShape[key]));
    },
  );

  it('`ButtonGroupSchema` is the one component schema that does NOT narrow `disabled`', () => {
    // The reason the row above says `boolean | string` while 13 sibling pages
    // correctly say `boolean`: those 13 schemas redeclare it. This assertion is
    // what stops a later `disabled?: boolean` narrowing on ButtonGroupSchema
    // from leaving the page silently over-stating instead of under-stating.
    // `boolean | string` until objectui#7530 declared the CEL envelope on the
    // base union; the object arm is the shared `ExpressionWireSchema` read through.
    expect(declaredTypeText(groupShape.disabled)).toBe('boolean | string | { dialect?: string; source: string }');
    expect(Object.keys(groupShape).includes('disabled')).toBe(true);
  });
});

describe('button-group.mdx: no Selection Mode section, because the renderer has no selection (objectui#6347)', () => {
  it('the renderer reads neither `selectionMode` nor a group-level `value`', () => {
    expect(renderer).not.toMatch(/selectionMode/);
    expect(renderer).not.toMatch(/schema\.value/);
    // Control: this IS the renderer, and the scan can find things in it.
    expect(renderer).toContain('schema.buttons');
    expect(renderer).toContain("ComponentRegistry.register('button-group'");
  });

  it('the page carries no heading promising selection', () => {
    expect(doc).not.toMatch(/^#+ .*Selection/m);
    expect(doc).not.toContain('single-selection');
    expect(doc).not.toContain('multiple-selection');
  });

  it('the two catalog fixtures it used to render are still on disk', () => {
    // Removing the section orphans them from this page; catalog entries are a
    // separate verification population and are NOT deleted to tidy that up.
    for (const slug of ['single-selection', 'multiple-selection']) {
      expect(read(`${FIXTURE_DIR}/${slug}.json`)).toContain('"type": "button-group"');
    }
  });
});

describe('counter-probes: the readers above can still fail (objectui#6347)', () => {
  it('`interfaceBody` throws rather than returning an empty body', () => {
    expect(() => interfaceBody(schemaFence(), 'ButtonGroupSelectionSchema')).toThrow(
      /no `interface ButtonGroupSelectionSchema \{` block/,
    );
  });

  it('the extractor really parsed rows, not an empty match set', () => {
    expect(buttonDoc.size).toBe(Object.keys(buttonShape).length);
    expect(groupDoc.size).toBeGreaterThanOrEqual(groupOwnKeys.length);
  });

  it('an undeclared row would be caught — the shape the card reported', () => {
    const regressed = documentedMembers(
      "  buttons?: ButtonGroupButton[];\n  selectionMode?: 'single' | 'multiple' | 'none';",
    );
    expect([...regressed.keys()].filter((key) => !(key in groupShape))).toEqual(['selectionMode']);
  });

  it('an omitted declared row would be caught — the direction the card missed', () => {
    const regressed = documentedMembers('  type: string;\n  buttons?: ButtonGroupButton[];');
    expect(groupOwnKeys.filter((key) => !regressed.has(key))).toEqual(['variant', 'size']);
  });

  it('a truncated enum row would be caught', () => {
    expect(documentedLiterals("'default' | 'outline' | 'ghost'")).not.toEqual(
      enumOptions(groupShape.variant),
    );
  });

  it('`declaredTypeText` reads the mirror, not a hard-coded string', () => {
    // Non-vacuity for the union reader: it must distinguish the two inherited
    // rows from each other, and must not answer `unknown` for either.
    expect(declaredTypeText(groupShape.className)).toBe('string');
    expect(declaredTypeText(groupShape.disabled)).not.toBe(
      declaredTypeText(groupShape.className),
    );
    expect(declaredTypeText(groupShape.disabled)).not.toContain('unknown');
  });
});
