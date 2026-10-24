/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * What tightening `object-master-detail-form.formType` to an `enum` actually
 * BUYS, measured at the layer that reads the declaration (objectui#5939).
 *
 * The declaration is not documentation: `manifestFromConfigs` serializes
 * `inputs` into the manifest the JSX-page compiler and the save gate validate
 * against, and `sdui-parser`'s `checkType` raises `invalid-enum` at severity
 * `error` when a prop's only declared arm is an `enum` and the written value is
 * outside it (`packages/sdui-parser/src/validate.ts`). While the key was a bare
 * `string`, every string passed — `'wizzard'` included — and the renderer then
 * matched no branch and dropped the authored sections with no diagnostic.
 *
 * ⚠️ Scope, stated plainly rather than implied. This is the AUTHORING surface —
 * the manifest, the compiler, the save gate, and what a probe samples. Per
 * objectui#5155's standing maintainer ruling, REJECTION lives at the zod/publish
 * boundary, and `@objectstack/spec`'s `ObjectMasterDetailFormPropsSchema.formType`
 * still accepts any string. The last test below asserts that gap rather than
 * papering over it, so this file cannot be read as "the hole is closed".
 */
import { describe, it, expect } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
import { manifestFromConfigs, validateTree } from '@object-ui/sdui-parser';
import type { Diagnostic, SchemaElement } from '@object-ui/sdui-parser';
import '@object-ui/components';
import '../register-plugins';

const manifest = manifestFromConfigs(
  ComponentRegistry.getAllConfigs() as unknown as Parameters<typeof manifestFromConfigs>[0],
);

/**
 * The manifest key, which carries the registration's namespace — the bare
 * `object-master-detail-form` is not a key here, and asserting against it would
 * have made every "no diagnostic" claim below vacuous. The reachability test
 * caught exactly that while this file was being written.
 */
const BLOCK = 'plugin-form:object-master-detail-form';

const nodeWith = (formType: string): SchemaElement =>
  ({
    type: BLOCK,
    objectName: 'po',
    details: [{ childObject: 'po_line', relationshipField: 'po' }],
    formType,
  }) as unknown as SchemaElement;

const diagnose = (formType: string): Diagnostic[] =>
  validateTree(nodeWith(formType), manifest).diagnostics.filter((d) => d.code === 'invalid-enum');

describe('object-master-detail-form.formType — the manifest carries the closed vocabulary', () => {
  it('the block is in the manifest at all (reachability before absence)', () => {
    // Without this, every "no diagnostic" assertion below would pass vacuously
    // on an unregistered block — `unknown-component` is a different code.
    expect(manifest.components[BLOCK], `${BLOCK} is not in the manifest`).toBeDefined();
  });

  it('serializes the enum, so the compiler and save gate see the same two values', () => {
    const input = manifest.components[BLOCK].inputs.find((i) => i.name === 'formType');
    expect(input?.type).toBe('enum');
    expect([...(input?.enum ?? [])].sort()).toEqual(['simple', 'tabbed']);
  });

  it.each(['simple', 'tabbed'])('accepts the honoured value `%s`', (value) => {
    expect(diagnose(value)).toEqual([]);
  });

  it.each(['wizzard', 'x', 'wizard', 'drawer'])(
    'reports `%s` as `invalid-enum` at severity error — nothing reported it before',
    (value) => {
      const [d] = diagnose(value);
      expect(d, `no invalid-enum diagnostic for ${JSON.stringify(value)}`).toBeDefined();
      expect(d.severity).toBe('error');
      expect(d.message).toContain('formType');
    },
  );

  it('AND the publish boundary rejects it too, since spec 17.3.0 (objectui#5155)', async () => {
    // The other half of the honest reading — and it REVERSED at
    // `@objectstack/spec` 17.3.0, which is why this test now says the opposite
    // of what it used to.
    //
    // It was written as a negative pin: objectstack owns this schema, the
    // objectui enum cannot narrow it, and a reader who stopped at the manifest
    // assertions above would wrongly conclude the value was impossible to
    // publish. That was true and worth pinning while the boundary accepted
    // `formType: 'wizzard'`. 17.3.0 closed the gap deliberately — not a
    // silent narrowing: the schema answers `invalid_value` naming the two
    // honoured options, and for the near-miss `'wizard'` it carries a bespoke
    // prescription citing ADR-0001 and the renderer measurement behind it
    // ("only the current wizard step's fields mount … so parent + details never
    // save through the atomic batch").
    //
    // ⛔ The premise did not merely evaporate, so this is not an inverted
    // assertion standing where a negative control used to. What the test owes
    // its reader is the RELATIONSHIP between the two authorities, and that is
    // what is pinned: the manifest diagnostic above and the publish boundary
    // here now agree, and each is checked on its own so a future divergence
    // fails HERE rather than reaching an author as a value that lints clean and
    // then cannot be published.
    const spec: any = await import('@objectstack/spec/ui');
    const schema = spec.ObjectMasterDetailFormPropsSchema;
    expect(schema, 'ObjectMasterDetailFormPropsSchema is not exported').toBeDefined();

    // Positive control first: the boundary still admits the honoured pair, so a
    // wholesale schema breakage cannot read as "the refusal works".
    for (const honoured of ['simple', 'tabbed']) {
      expect(
        schema.safeParse({ objectName: 'po', details: [], formType: honoured }).success,
        `the boundary stopped accepting the honoured value ${honoured}`,
      ).toBe(true);
    }

    const refused = schema.safeParse({ objectName: 'po', details: [], formType: 'wizzard' });
    expect(refused.success).toBe(false);
    if (refused.success) return;

    // The SHAPE of the refusal, not just its existence: a value refusal at the
    // key. `unrecognized_keys` would mean the key stopped being declared, and a
    // `custom` refinement would mean it is refused by a cross-field rule rather
    // than by its own vocabulary — three different facts, and only one of them
    // is "the enum closed".
    const own = refused.error.issues.filter((i: any) => i.path.join('.') === 'formType');
    expect(own.map((i: any) => i.code)).toEqual(['invalid_value']);
  });
});
