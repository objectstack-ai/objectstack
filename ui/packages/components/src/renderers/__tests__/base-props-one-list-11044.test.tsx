/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The parser tier's base props, held on the live registry (objectui#11044).
 *
 * `SDUI_BASE_PROPS` (`@object-ui/sdui-parser`) is the one list both
 * `validateTree` and the generated JSX types read. This file holds it against
 * the two things it answers to:
 *
 *   - `BaseSchema` (`@object-ui/types`): every entry is a member, and `body` —
 *     retired by objectui#6771 and answered by name in `body-dialect.ts` — is
 *     the one member left out. A member added to `BaseSchema` without a
 *     decision here turns this red, which is how `visibleWhen`, `hiddenOn`,
 *     `testId` (and `bind` / `hidden` before them, objectui#11008) sat as false
 *     `unknown-prop`s;
 *   - the live registrations: no registration declares `visibleWhen`,
 *     `hiddenOn` or `testId`, so making them `every-node` silences no declared
 *     type check, and none of the three draws a diagnostic naming it on any
 *     registered type. For the `where-undeclared` members, every registration
 *     that declares one keeps its type check, and every one that does not
 *     draws nothing naming it.
 *
 * The manifest is built the way `bind-base-prop-parser-tier-11008.test.tsx`
 * builds it — every KNOWN registry key of this package, through
 * `manifestFromConfigs`. The tier's reading of a synthetic manifest, and the
 * `tsc` probe over the generated `.d.ts`, are
 * `packages/sdui-parser/src/__tests__/base-props-one-list-11044.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
import { BaseSchema } from '@object-ui/types/zod';
import { inputTypeArms, manifestFromConfigs, SDUI_BASE_PROPS, validateTree } from '@object-ui/sdui-parser';
import type { Diagnostic, Manifest, SchemaElement } from '@object-ui/sdui-parser';

// Module scope, not a hook: this import IS the registration (AGENTS.md
// §测试纪律 — an unbounded module load must not be billed to a bounded window).
import '../index';

const liveManifest = (): Manifest => {
  const configs = ComponentRegistry.getKnownTypes().map((t) => {
    const meta = ComponentRegistry.getMeta(t);
    return { type: t, namespace: meta?.namespace, isContainer: meta?.isContainer, inputs: meta?.inputs };
  });
  return manifestFromConfigs(configs as unknown as Parameters<typeof manifestFromConfigs>[0]);
};

const naming = (manifest: Manifest, node: Record<string, unknown>, key: string): Diagnostic[] =>
  validateTree(node as unknown as SchemaElement, manifest).diagnostics.filter((d) =>
    d.message.includes(`"${key}"`),
  );

const MEMBER_1 = { visibleWhen: "data.role == 'admin'", hiddenOn: 'data.archived', testId: 'the-node' } as const;

const WHERE_UNDECLARED = SDUI_BASE_PROPS.filter((p) => p.scope === 'where-undeclared').map((p) => p.name);

/** A value of the kind `BaseSchema` declares, per `where-undeclared` member. */
const WELL_TYPED: Record<string, unknown> = {
  name: 'email',
  label: 'Email',
  description: 'Where we write',
  placeholder: 'you@example.com',
  data: [{ id: 1 }],
  ariaLabel: 'Email address',
};

describe('the base-prop list answers to `BaseSchema` and to the live registry (objectui#11044)', () => {
  it('every entry is a `BaseSchema` member, and `body` is the one member left out', () => {
    const names = SDUI_BASE_PROPS.map((p) => p.name);
    const members = Object.keys(BaseSchema.shape);
    expect(names.filter((n) => !members.includes(n))).toEqual([]);
    expect(members.filter((m) => !names.includes(m))).toEqual(['body']);
  });

  it('no live registration declares `visibleWhen`, `hiddenOn` or `testId` as an input', () => {
    const types = ComponentRegistry.getKnownTypes();
    expect(types.length).toBeGreaterThan(0);
    const declaring = types.flatMap((type) =>
      (ComponentRegistry.getMeta(type)?.inputs ?? [])
        .filter((input) => input.name in MEMBER_1)
        .map((input) => `${type}.${input.name}`),
    );
    expect(declaring).toEqual([]);
  });

  it('across every live registration, none of the three draws a diagnostic naming it', () => {
    const manifest = liveManifest();
    const named = Object.keys(manifest.components).flatMap((type) =>
      Object.entries(MEMBER_1).flatMap(([key, value]) =>
        naming(manifest, { type, [key]: value }, key).map((d) => `${type}.${key} → ${d.code}`),
      ),
    );
    expect(named).toEqual([]);
  });

  it('a `where-undeclared` member keeps every declaring registration’s type check, and is silent elsewhere', () => {
    const manifest = liveManifest();
    const lostCheck: string[] = [];
    const drew: string[] = [];
    let declaringChecked = 0;
    for (const [type, comp] of Object.entries(manifest.components)) {
      for (const key of WHERE_UNDECLARED) {
        const declared = comp.inputs.find((input) => input.name === key);
        if (!declared) {
          drew.push(...naming(manifest, { type, [key]: WELL_TYPED[key] }, key).map((d) => `${type}.${key} → ${d.code}`));
          continue;
        }
        // 424242 is a wrong kind for every declaration without a `number` arm.
        if (inputTypeArms(declared.type).includes('number')) continue;
        declaringChecked++;
        const codes = naming(manifest, { type, [key]: 424242 }, key).map((d) => d.code);
        if (!codes.includes('type-mismatch') && !codes.includes('invalid-enum')) lostCheck.push(`${type}.${key}`);
      }
    }
    // Non-vacuity: the input family's declarations are in this population.
    expect(declaringChecked).toBeGreaterThan(0);
    expect(lostCheck).toEqual([]);
    expect(drew).toEqual([]);
  });
});
