/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `buttonVariant` reaches the REGISTRY face of `toast` and `sonner`
 * (objectui#7316).
 *
 * The key was real end to end and invisible anyway: `ToastSchema` and
 * `SonnerSchema` both declare it as the same six-member union, both renderers
 * pass it straight into `<Button variant={…}>` — and both registrations left it
 * out of `inputs`. `toast-button-variant-parity.test.ts` next door already pins
 * the TS face, the zod mirror and the Button against each other; NONE of those
 * three is the registry, so the omission survived all of them.
 *
 * ## Why the omission was not merely cosmetic
 *
 * `inputs` is what the JSX-page compiler builds its prop whitelist from
 * (`renderers/layout/page.tsx`, `getJsxManifest`), and `sdui-parser`'s
 * `validateTree` reports every prop that is not in it as `unknown-prop`. So
 * before this change an author writing `buttonVariant` on a page was WARNED
 * about a key the renderer then went on to honour — objectui#3808 named that
 * exact failure for `element:text_input.defaultValue`, and this is the same
 * one. The designer property panel and the palette read the same array.
 *
 * ## Why `enum` and not `string`
 *
 * `cva` contributes NO variant class for a key it does not recognise and falls
 * back to `defaultVariants` only when the value is absent OR falsy. So
 * `buttonVariant: 'primary'` draws a button with no background and no text
 * colour, and `buttonVariant: ''` silently draws the default look. A `string`
 * arm leaves both writable in silence. An `enum` arm is the ONE arm
 * `validateTree` judges exactly — the `invalid-enum` block below measures that
 * it answers `error`, not `warning` — so declaring the closed list is what
 * turns those two traps into a named refusal at authoring time.
 *
 * ## Nothing here is restated
 *
 * The expected vocabulary is READ from the two zod mirrors, which objectui#6541
 * closed over exactly the Button vocabulary, and every member is then measured
 * against `buttonVariants` itself. A list typed in by hand is the artefact this
 * whole family of cards keeps producing.
 *
 * ⛔ The two registrations are SEPARATE surfaces. Every assertion below names
 * one node or asserts the two against each other, so a fix applied to one of
 * them cannot be scored as a fix to both.
 */

import { describe, it, expect } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
import { manifestFromConfigs, validateTree } from '@object-ui/sdui-parser';
import { SonnerSchema as SonnerMirror, ToastSchema as ToastMirror } from '@object-ui/types/zod';
// Module scope, not a hook: the cold transform is billed to the import phase,
// which has no test/hook timeout (AGENTS.md §测试纪律, objectui#3010).
import '../renderers/feedback/toast';
import '../renderers/feedback/sonner';
import { buttonVariants } from '../ui/button';

const NODES = ['toast', 'sonner'] as const;
type Node = (typeof NODES)[number];

const inputsOf = (node: Node) => ComponentRegistry.getConfig(node)?.inputs ?? [];
const buttonVariantInput = (node: Node) => inputsOf(node).find((i) => i.name === 'buttonVariant');

/** The `enum` arm's admitted values, flattened from either declaration form. */
const declaredEnum = (node: Node): unknown[] =>
  (buttonVariantInput(node)?.enum ?? []).map((e) =>
    typeof e === 'object' && e !== null ? (e as { value: unknown }).value : e,
  );

/**
 * The accept-set of one zod mirror's `buttonVariant`, read off the schema.
 *
 * `.options` exists only on `ZodEnum`. If either mirror ever goes back to an
 * open `z.string()` this throws naming the card, rather than comparing an empty
 * list against an empty list and passing.
 */
function mirrorAcceptSet(mirror: { shape: Record<string, unknown> }, label: string): string[] {
  type Unwrappable = { unwrap?: () => unknown; def?: { innerType?: unknown } };
  const key: unknown = mirror.shape.buttonVariant;
  const inner = (key as Unwrappable).unwrap?.() ?? (key as Unwrappable).def?.innerType ?? key;
  const options: unknown = (inner as { options?: unknown }).options;
  if (!Array.isArray(options)) {
    throw new Error(
      `\`${label}.buttonVariant\` is not an enum in the zod mirror, so there is no vocabulary `
        + 'to compare the registry declaration against (objectui#6541, objectui#7316).',
    );
  }
  return options as string[];
}

const TOAST_VOCABULARY = mirrorAcceptSet(
  ToastMirror as unknown as { shape: Record<string, unknown> },
  'ToastSchema',
);
const SONNER_VOCABULARY = mirrorAcceptSet(
  SonnerMirror as unknown as { shape: Record<string, unknown> },
  'SonnerSchema',
);
const VOCABULARY: Record<Node, string[]> = { toast: TOAST_VOCABULARY, sonner: SONNER_VOCABULARY };

/** What `buttonVariants` emits for a value it does not recognise. */
const NO_VARIANT_CLASSES = buttonVariants({ variant: '__not-a-variant__' as never });

/** The two values the type docblock records as already-stepped-in traps. */
const TRAPS = ['primary', ''] as const;

/** A manifest built from the REGISTRY, so the page compiler's own view is under test. */
const manifest = () =>
  manifestFromConfigs(
    ComponentRegistry.getKnownTypes().map((type) => {
      const meta = ComponentRegistry.getMeta(type);
      return { type, namespace: meta?.namespace, isContainer: meta?.isContainer, inputs: meta?.inputs };
    }) as unknown as Parameters<typeof manifestFromConfigs>[0],
  );

const diagnose = (node: Node, props: Record<string, unknown>) =>
  validateTree({ type: node, ...props } as never, manifest()).diagnostics;

const forKey = (node: Node, props: Record<string, unknown>, key: string) =>
  diagnose(node, props).filter((d) => JSON.stringify(d.message).includes(key));

/**
 * Refuse a vacuous pass. Measured under the objectui#7316 ablation: with the
 * entry removed the declared list is EMPTY, and an empty list contains no trap,
 * holds no value the Button refuses, and equals the other empty list — so three
 * assertions below passed for the wrong reason. Each one calls this first.
 */
function assertDeclared(node: Node): unknown[] {
  const values = declaredEnum(node);
  expect(values.length, `\`${node}\` declares no \`buttonVariant\` vocabulary at all, so the assertion below would pass vacuously`).toBeGreaterThan(0);
  return values;
}

describe('`buttonVariant` is declared on the registry face of both nodes', () => {
  it.each(NODES)('%s declares a `buttonVariant` input at all', (node) => {
    expect(
      inputsOf(node).map((i) => i.name),
      `\`${node}\` registry inputs`,
    ).toContain('buttonVariant');
    expect(buttonVariantInput(node)).toBeDefined();
  });

  it.each(NODES)('%s declares it as a CLOSED list, never an open string', (node) => {
    expect(buttonVariantInput(node)?.type, `\`${node}\`.buttonVariant arm`).toBe('enum');
    expect(declaredEnum(node).length).toBeGreaterThan(0);
  });

  it.each(NODES)('%s declares exactly the vocabulary its own zod mirror accepts', (node) => {
    expect(declaredEnum(node)).toEqual(VOCABULARY[node]);
  });

  it('the two registrations agree with each other', () => {
    expect(assertDeclared('toast')).toEqual(assertDeclared('sonner'));
    expect(TOAST_VOCABULARY).toEqual(SONNER_VOCABULARY);
  });

  it.each(NODES)('every value %s admits is one the Button actually draws', (node) => {
    const inert = assertDeclared(node).filter(
      (v) => buttonVariants({ variant: v as never }) === NO_VARIANT_CLASSES,
    );
    expect(inert, `declared on \`${node}\`, but the Button draws nothing for them`).toEqual([]);
  });
});

describe('NEGATIVE CONTROL — the declared list cannot express either trap', () => {
  it.each(TRAPS)('neither registration admits %j', (trap) => {
    expect(assertDeclared('toast')).not.toContain(trap);
    expect(assertDeclared('sonner')).not.toContain(trap);
  });

  it('and each trap is a trap for a DIFFERENT reason, measured on the Button', () => {
    // 'primary' is unrecognised: no variant class at all, so no colour.
    expect(buttonVariants({ variant: 'primary' as never })).toBe(NO_VARIANT_CLASSES);
    // '' is falsy, so `cva` falls back to `defaultVariants` and it silently
    // renders the DEFAULT look instead of failing visibly.
    expect(buttonVariants({ variant: '' as never })).toBe(buttonVariants({ variant: 'default' }));
    expect(buttonVariants({ variant: '' as never })).not.toBe(NO_VARIANT_CLASSES);
  });

  it.each(NODES)('%s reports each trap as an `invalid-enum` ERROR, not a warning', (node) => {
    for (const trap of TRAPS) {
      const found = forKey(node, { buttonVariant: trap }, 'buttonVariant');
      expect(found.map((d) => d.code), `\`${node}\` with buttonVariant=${JSON.stringify(trap)}`)
        .toEqual(['invalid-enum']);
      expect(found[0].severity).toBe('error');
    }
  });

  it.each(NODES)('%s stays silent on a value it does declare (the lit control)', (node) => {
    const legal = declaredEnum(node)[0];
    expect(forKey(node, { buttonVariant: legal }, 'buttonVariant')).toEqual([]);
  });

  it.each(NODES)('%s no longer reports the key itself as `unknown-prop`', (node) => {
    const codes = forKey(node, { buttonVariant: declaredEnum(node)[0] }, 'buttonVariant').map(
      (d) => d.code,
    );
    expect(codes).not.toContain('unknown-prop');
    // The instrument is not blind: a key NO registration declares still is one.
    const control = forKey(node, { __objectui_7316_probe__: true }, '__objectui_7316_probe__');
    expect(control.map((d) => d.code)).toEqual(['unknown-prop']);
  });
});
