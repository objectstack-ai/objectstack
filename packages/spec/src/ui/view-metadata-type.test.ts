// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19871] The published type `ViewMetadata` names a `view` body; it is not `unknown`.
 *
 * `ViewMetadataSchema` is a `z.preprocess`, whose input type is `unknown`, so the type declared as
 * `z.input<typeof ViewMetadataSchema>` WAS `unknown`: any value type-checked against a name and a
 * TSDoc that promise a persisted view body. It is now the union of the input types of
 * `VIEW_METADATA_MEMBERS`, the members the schema's union runs.
 *
 * Two halves, judged by two programs:
 *
 * - The TYPE half is judged by `tsc -p tsconfig.test.json` (the package's `typecheck` script, via
 *   `check:test-typecheck`), not by vitest. Each `@ts-expect-error` below asserts that its line
 *   does NOT compile. While `ViewMetadata` was `unknown` every one of them compiled, so each
 *   directive was unused: TS2578 in a file with no `test-typecheck-debt.json` entry, which reds the
 *   gate. The member bodies are typed through the published name, so a later narrowing that drops
 *   a member is a compile error on its line.
 * - The RUNTIME half ties those typed bodies to the door: each one parses, through the member it
 *   is written for, so the fixture really covers every member.
 */

import { describe, it, expect } from 'vitest';
import {
  VIEW_METADATA_BRANCHES,
  diagnoseViewMetadata,
  type ViewMetadata,
  type ViewMetadataBranch,
} from './view.zod';

// ── One body per member, each typed through the published name ────────────────────────────────

const viewItem: ViewMetadata = {
  name: 'crm_lead.all',
  object: 'crm_lead',
  viewKind: 'list',
  config: { type: 'grid', data: { provider: 'object', object: 'crm_lead' }, columns: ['name'] },
};
const container: ViewMetadata = {
  object: 'crm_lead',
  list: { type: 'grid', data: { provider: 'object', object: 'crm_lead' }, columns: ['name'] },
};
const listOverlay: ViewMetadata = { type: 'grid', columns: ['name'], object: 'crm_lead', viewKind: 'list' };
const formOverlay: ViewMetadata = {
  type: 'simple',
  sections: [{ label: 'Main', fields: ['name'] }],
  object: 'crm_lead',
  viewKind: 'form',
};

const BODY_OF_EACH_MEMBER: Record<ViewMetadataBranch, ViewMetadata> = {
  viewItem,
  container,
  listOverlay,
  formOverlay,
};

// ── What `ViewMetadata` refuses at compile time ──────────────────────────────────────────────

const someValue: unknown = JSON.parse('{"nope":1}');
// @ts-expect-error -- `unknown` is not a view body; it was assignable while ViewMetadata was `unknown`.
const fromUnknown: ViewMetadata = someValue;
// @ts-expect-error -- `notAViewKey` is declared by no member (TS2353).
const undeclaredKey: ViewMetadata = { type: 'grid', columns: ['name'], object: 'crm_lead', viewKind: 'list', notAViewKey: 1 };
// @ts-expect-error -- a view body is an object.
const scalar: ViewMetadata = 42;
void [fromUnknown, undeclaredKey, scalar];

describe('[#19871] ViewMetadata is a view body, not unknown', () => {
  it('has a typed body for every member of the union', () => {
    expect(Object.keys(BODY_OF_EACH_MEMBER).sort()).toEqual([...VIEW_METADATA_BRANCHES].sort());
  });

  for (const branch of VIEW_METADATA_BRANCHES) {
    it(`the ${branch} body typed as ViewMetadata parses, through the ${branch} member`, () => {
      const diagnosis = diagnoseViewMetadata(BODY_OF_EACH_MEMBER[branch]);
      expect(diagnosis.success).toBe(true);
      expect(diagnosis.branch).toBe(branch);
    });
  }
});
