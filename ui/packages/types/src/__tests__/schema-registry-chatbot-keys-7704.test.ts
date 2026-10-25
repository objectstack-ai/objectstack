// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `SchemaRegistry` names all three `plugin-chatbot` registrations, so the
 * published `ComponentType` union does too (objectui#7704).
 *
 * ## The defect this pins shut
 *
 * `packages/plugin-chatbot/src/renderer.tsx` registers three components —
 * `chatbot` (`:62`), `chatbot-enhanced` (`:241`), `chatbot-floating` (`:379`).
 * `SchemaRegistry` mapped one of them. `ComponentType = keyof SchemaRegistry`
 * is the published union, so a consumer discriminating on it was told two
 * registered keys DO NOT EXIST. The asymmetry that proves which half was wrong:
 * `packages/cli/src/utils/known-schema-types.ts:83-84` lists both keys — the
 * CLI keeps its own parallel list precisely because this map did not have them.
 *
 * The map could not have carried them earlier and stayed honest. This map's
 * value has to be the type the registered renderer honours, and until
 * objectui#7655 there was none to point at: `ChatbotSchema` pins `type` to
 * `'chatbot'`, and each registration's real key set lived in an anonymous
 * `ChatbotSchema & { ... }` intersection local to the renderer file.
 * objectui#7655 gave each registration one named authoring face, declared in
 * THIS package — which is what makes the two entries simultaneously
 *
 *   - HONEST: each value pins `type` to its own key, and the registration for
 *     that key takes that exact type as its `schema` parameter
 *     (`renderer.tsx:256`, `:394`), so the map's value and the renderer's prop
 *     type are one declaration; and
 *   - REACHABLE: `@object-ui/types` has zero workspace dependencies, and both
 *     faces are its own declarations. This is the difference from the `kanban`
 *     case objectui#7645 measured, where the honoured type lived in
 *     `@object-ui/plugin-kanban` — naming it from here would have been a
 *     phantom dependency and a cycle, and it was resolved the other way, by
 *     moving the dialect down into this package (objectui#7664).
 *
 * ## Scope — two keys, not a sweep
 *
 * objectui#7704 is these two keys, whose faces now exist. Whether EVERY
 * `SchemaRegistry` value must be the type its renderer honours is
 * objectui#7665's question and is deliberately not asked or answered here.
 *
 * ## Two channels, stated so nobody reads the wrong one
 *
 * The `export type assertion…` block below is COMPILE-TIME: it is checked by
 * `tsc -p packages/types/tsconfig.test.json` (this package's `type-check`
 * script chains it) and erased before vitest runs. A green vitest run is NOT
 * evidence about it — the same split `chatbot-registration-authoring-faces-7655
 * .test.ts` and `kanban-plugin-dialect-authoritative-7664.test.ts` document.
 * The `it` blocks are the RUNTIME channel: a source census of the interface
 * (so deleting an entry fails vitest too, not only `tsc`) and the accept sets
 * of the validator the CLI applies.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ts from 'typescript';
import type {
  SchemaRegistry,
  ComponentType,
  ComplexSchema,
  ChatbotSchema,
  ChatbotEnhancedSchema,
  ChatbotFloatingSchema,
} from '../index';
import {
  ChatbotEnhancedSchema as ChatbotEnhancedZod,
  ChatbotFloatingSchema as ChatbotFloatingZod,
  safeValidateSchema,
} from '../zod/index.zod';

/* -------------------------------------------------------------------------- */
/* Compile-time pins — read by tsc via tsconfig.test.json, not by this run.    */
/* -------------------------------------------------------------------------- */

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type IsAny<T> = 0 extends 1 & T ? true : false;

// Non-vacuity controls: `any` on either side satisfies every `extends` below
// while checking nothing, and `Equal<any, X>` is `false`.
type _RegistryIsReal = Assert<Equal<IsAny<SchemaRegistry>, false>>;
type _EnhancedFaceIsReal = Assert<Equal<IsAny<ChatbotEnhancedSchema>, false>>;
type _FloatingFaceIsReal = Assert<Equal<IsAny<ChatbotFloatingSchema>, false>>;

// 1. THE CARD. The published union yields both keys. `Extract` collapses to
//    `never` the moment an entry is dropped, which fails this loudly — the
//    `_KeyKept` shape objectui#7645/#7664 carry for `'kanban'`.
type _EnhancedKeyPublished = Assert<Equal<Extract<ComponentType, 'chatbot-enhanced'>, 'chatbot-enhanced'>>;
type _FloatingKeyPublished = Assert<Equal<Extract<ComponentType, 'chatbot-floating'>, 'chatbot-floating'>>;

// 2. Each value IS the face its registration honours — not `ChatbotSchema`
//    (which `Equal` rejects: it pins `type` to `'chatbot'`), and not a
//    `BaseSchema & { type }` weakest-true-claim placeholder.
type _EnhancedValueIsItsFace = Assert<Equal<SchemaRegistry['chatbot-enhanced'], ChatbotEnhancedSchema>>;
type _FloatingValueIsItsFace = Assert<Equal<SchemaRegistry['chatbot-floating'], ChatbotFloatingSchema>>;

// 3. Honesty, stated independently of #2: each value's own `type` literal IS
//    the key it is filed under. This is the property objectui#7645 found
//    violated for `'kanban'`, and the reason these two keys could not be added
//    before objectui#7655 minted the faces.
type _EnhancedValueIsHonest = Assert<Equal<SchemaRegistry['chatbot-enhanced']['type'], 'chatbot-enhanced'>>;
type _FloatingValueIsHonest = Assert<Equal<SchemaRegistry['chatbot-floating']['type'], 'chatbot-floating'>>;
// …and the honesty check can fail — the pre-#7655 value would have been
// `ChatbotSchema`, whose `type` is `'chatbot'`, not either new key.
type _HonestyCanFail = Assert<Equal<Equal<ChatbotSchema['type'], 'chatbot-enhanced'>, false>>;

// 4. The `'chatbot'` entry is untouched: this card ADDS two keys, it does not
//    re-point the existing one.
type _ChatbotEntryUnchanged = Assert<Equal<SchemaRegistry['chatbot'], ChatbotSchema>>;

// 5. Registry value and validator arm are the same declaration, so the key the
//    map publishes and the arm `safeValidateSchema` selects cannot drift.
type _EnhancedArmIsTheValue = Assert<
  Equal<Extract<ComplexSchema, { type: 'chatbot-enhanced' }>, SchemaRegistry['chatbot-enhanced']>
>;
type _FloatingArmIsTheValue = Assert<
  Equal<Extract<ComplexSchema, { type: 'chatbot-floating' }>, SchemaRegistry['chatbot-floating']>
>;

/* -------------------------------------------------------------------------- */
/* Runtime pin 1 — source census of the interface                             */
/* -------------------------------------------------------------------------- */

const REGISTRY_TS = join(dirname(fileURLToPath(import.meta.url)), '..', 'registry.ts');

/** The `SchemaRegistry` members as declared, in source order: key + value type text. */
function registryEntries(interfaceName = 'SchemaRegistry'): Array<{ key: string; value: string }> {
  const sf = ts.createSourceFile(REGISTRY_TS, readFileSync(REGISTRY_TS, 'utf8'), ts.ScriptTarget.ESNext, false, ts.ScriptKind.TS);
  const decl = sf.statements.find(
    (s): s is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(s) && s.name.text === interfaceName,
  );
  if (!decl) throw new Error(`no top-level interface ${interfaceName} in ${REGISTRY_TS}`);
  return decl.members.filter(ts.isPropertySignature).map((m) => ({
    key: ts.isStringLiteral(m.name) || ts.isIdentifier(m.name) ? m.name.text : m.name.getText(sf),
    value: m.type ? m.type.getText(sf) : '',
  }));
}

describe('SchemaRegistry declares all three chatbot registrations (objectui#7704)', () => {
  const entries = registryEntries();
  const keys = entries.map((e) => e.key);
  const valueOf = (key: string) => entries.find((e) => e.key === key)?.value;

  it('the census reader read a real map — lit control before any assertion about the two keys', () => {
    // If the parse collapsed, or the interface were renamed, every assertion
    // below would pass vacuously on an empty list. These are the controls.
    expect(keys.length).toBeGreaterThan(60);
    // ⚠️ The lit control was `'kanban'` until objectui#8802 retired that key
    // from the map with the bare node type. `'carousel'` is its replacement:
    // another `// Complex` group entry, declared in the same block, so the
    // control still proves the parse reached this group rather than merely
    // returning a long list.
    expect(keys).toContain('carousel');
    expect(keys).toContain('chatbot');
    expect(valueOf('chatbot')).toBe('ChatbotSchema');
  });

  it('both registered keys are declared, each pointing at its own authoring face', () => {
    expect(keys).toContain('chatbot-enhanced');
    expect(keys).toContain('chatbot-floating');
    expect(valueOf('chatbot-enhanced')).toBe('ChatbotEnhancedSchema');
    expect(valueOf('chatbot-floating')).toBe('ChatbotFloatingSchema');
  });

  it('they sit with the family, under the `// Complex` group', () => {
    const at = keys.indexOf('chatbot');
    expect(at).toBeGreaterThan(keys.indexOf('carousel'));
    expect(keys[at + 1]).toBe('chatbot-enhanced');
    expect(keys[at + 2]).toBe('chatbot-floating');
  });

  it('the census reader can fail — a name that is not there throws rather than reading empty', () => {
    expect(() => registryEntries('NotARealRegistryInterface')).toThrow(/no top-level interface NotARealRegistryInterface/);
  });
});

/* -------------------------------------------------------------------------- */
/* Runtime pin 2 — the key is reachable through the validator the CLI applies  */
/* -------------------------------------------------------------------------- */

describe('each newly named key selects its own arm end to end (objectui#7704)', () => {
  // `messages` is a required arm on both twins (measured: a `{ type }`-only
  // document is refused at `messages`, not at `type`), so the minimal node
  // carries it. Everything else on both faces is optional.
  const ENHANCED_NODE = { type: 'chatbot-enhanced', messages: [] };
  const FLOATING_NODE = { type: 'chatbot-floating', messages: [] };

  it('a minimal node of either key passes safeValidateSchema — the tolerant node union', () => {
    expect(safeValidateSchema(ENHANCED_NODE).success).toBe(true);
    expect(safeValidateSchema(FLOATING_NODE).success).toBe(true);
  });

  it('the discriminant is real — each twin refuses the sibling key, and refuses it AT `type`', () => {
    // Same documents as the control below with only `type` swapped, so the
    // one refusal path proves the key is the discriminant and nothing else.
    const enhancedOnFloating = ChatbotEnhancedZod.safeParse(FLOATING_NODE);
    const floatingOnEnhanced = ChatbotFloatingZod.safeParse(ENHANCED_NODE);
    expect(enhancedOnFloating.success).toBe(false);
    expect(floatingOnEnhanced.success).toBe(false);
    if (!enhancedOnFloating.success) {
      expect(enhancedOnFloating.error.issues.map((i) => i.path.join('.'))).toEqual(['type']);
    }
    if (!floatingOnEnhanced.success) {
      expect(floatingOnEnhanced.error.issues.map((i) => i.path.join('.'))).toEqual(['type']);
    }
  });

  it('control: each twin accepts its own key, so the refusal above is about the discriminant', () => {
    expect(ChatbotEnhancedZod.safeParse(ENHANCED_NODE).success).toBe(true);
    expect(ChatbotFloatingZod.safeParse(FLOATING_NODE).success).toBe(true);
  });
});
