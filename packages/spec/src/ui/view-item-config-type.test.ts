// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19920] A ViewItem's `config` is typed by its arm: a list item carries a `ListView` config and a
 * form item a `FormView` config, on `ViewItem`, `ViewItemWire`, `defineViewItem`'s parameter, and
 * the `viewItem` member of every union type read off `VIEW_METADATA_MEMBERS`.
 *
 * `viewItemArmShape(viewKind, config)` took `config: z.ZodTypeAny`, so each arm's static `config`
 * WAS `unknown`: `config: 42` type-checked as every one of those names while both doors refuse it.
 * The parameter is now generic, so each arm keeps its config schema's type.
 *
 * Two halves, judged by two programs (the `view-metadata-type.test.ts` shape):
 *
 * - The TYPE half is judged by `tsc -p tsconfig.test.json` (the package's `typecheck` script, via
 *   `check:test-typecheck`), not by vitest. Each `@ts-expect-error` below asserts that its line
 *   does NOT compile. While `config` was `unknown` every one of them compiled, so each directive
 *   was unused: TS2578 in a file with no `test-typecheck-debt.json` entry, which reds the gate.
 * - The RUNTIME half ties the typed bodies to the doors: each one parses, and each refused body is
 *   refused at `config` by the doors too.
 */

import { describe, it, expect } from 'vitest';
import {
  ViewItemSchema,
  ViewItemWireSchema,
  defineViewItem,
  type ViewItem,
  type ViewItemParsed,
  type ViewItemWire,
  type ViewMetadata,
  type ViewMetadataParsed,
} from './view.zod';
import type { AssembledViewArtifact, AssembledViewArtifactParsed } from './assembled-views.zod';

// ── Real bodies, each typed through the published names ──────────────────────────────────────

const listItem: ViewItem = {
  name: 'crm_lead.pipeline',
  object: 'crm_lead',
  viewKind: 'list',
  config: { type: 'kanban', data: { provider: 'object', object: 'crm_lead' }, columns: ['name', 'stage'] },
};
const formItem: ViewItem = {
  name: 'crm_lead.intake',
  object: 'crm_lead',
  viewKind: 'form',
  config: { type: 'simple', sections: [{ label: 'Main', fields: ['name'] }] },
};
const wireItem: ViewItemWire = { ...listItem, isPinned: true, sortOrder: 2 };

// ── What the arm-typed `config` refuses at compile time ──────────────────────────────────────

const LIST_CONFIG = { type: 'grid', data: { provider: 'object', object: 'crm_lead' }, columns: ['name'] } as const;
// @ts-expect-error -- a list item's config is a ListView config, not a scalar.
const scalarConfig: ViewItem = { name: 'crm_lead.x', object: 'crm_lead', viewKind: 'list', config: 42 };
// @ts-expect-error -- the form arm's config is a FormView config: `grid` is not a form type.
const listConfigOnFormArm: ViewItem = { name: 'crm_lead.x', object: 'crm_lead', viewKind: 'form', config: LIST_CONFIG };
// @ts-expect-error -- the same on the wire member.
const wireScalarConfig: ViewItemWire = { name: 'crm_lead.x', object: 'crm_lead', viewKind: 'list', config: 42 };
// Wrapped, never called: the factory parses, and this body is refused at runtime too.
// @ts-expect-error -- and on `defineViewItem`'s parameter.
const definedScalarConfig = () => defineViewItem({ name: 'crm_lead.x', object: 'crm_lead', viewKind: 'list', config: 42 });
// @ts-expect-error -- the `viewItem` member of ViewMetadata carries the same config type.
const metadataScalarConfig: ViewMetadata = { name: 'crm_lead.x', object: 'crm_lead', viewKind: 'list', config: 42 };
// @ts-expect-error -- …and of ViewMetadataParsed.
const parsedScalarConfig: ViewMetadataParsed = { name: 'crm_lead.x', object: 'crm_lead', viewKind: 'list', config: 42 };
// @ts-expect-error -- …and of AssembledViewArtifact.
const artifactScalarConfig: AssembledViewArtifact = { name: 'crm_lead.x', object: 'crm_lead', viewKind: 'list', config: 42 };
// @ts-expect-error -- …and of AssembledViewArtifactParsed.
const parsedArtifactScalarConfig: AssembledViewArtifactParsed = { name: 'crm_lead.x', object: 'crm_lead', viewKind: 'list', config: 42 };
void [
  scalarConfig,
  listConfigOnFormArm,
  wireScalarConfig,
  definedScalarConfig,
  metadataScalarConfig,
  parsedScalarConfig,
  artifactScalarConfig,
  parsedArtifactScalarConfig,
];

describe('a ViewItem config is typed by its arm, not unknown', () => {
  it('each body typed through the published names parses at its door', () => {
    expect(ViewItemSchema.safeParse(listItem).success).toBe(true);
    expect(ViewItemSchema.safeParse(formItem).success).toBe(true);
    expect(ViewItemWireSchema.safeParse(wireItem).success).toBe(true);
  });

  it('the bodies the type refuses are refused at `config` by both doors', () => {
    const scalar = { name: 'crm_lead.x', object: 'crm_lead', viewKind: 'list', config: 42 };
    const formWithListConfig = { name: 'crm_lead.x', object: 'crm_lead', viewKind: 'form', config: LIST_CONFIG };
    for (const door of [ViewItemSchema, ViewItemWireSchema]) {
      for (const body of [scalar, formWithListConfig]) {
        const result = door.safeParse(body);
        expect(result.success).toBe(false);
        expect(result.error?.issues.every((issue) => issue.path[0] === 'config')).toBe(true);
      }
    }
  });

  it("the parsed config is the arm's parsed config (the list default `type` applied)", () => {
    const parsed: ViewItemParsed = ViewItemSchema.parse({
      name: 'crm_lead.all',
      object: 'crm_lead',
      viewKind: 'list',
      config: { data: { provider: 'object', object: 'crm_lead' }, columns: ['name'] },
    });
    if (parsed.viewKind !== 'list') throw new Error('the list arm must accept a list body');
    const type: string = parsed.config.type;
    expect(type).toBe('grid');
  });
});
