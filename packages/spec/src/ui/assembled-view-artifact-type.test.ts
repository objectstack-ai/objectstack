// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19920] The published types `AssembledViewArtifact` / `AssembledViewArtifactParsed` name a
 * non-container view artifact; they are not `unknown`.
 *
 * `AssembledViewArtifactSchema`'s union is built from `VIEW_METADATA_MEMBERS` values cast to
 * `z.ZodTypeAny`, so both types, derived from the schema itself, WERE `unknown`: any value — a
 * container included — type-checked against a name that promises one `viewItems:` entry. They are
 * now the union of the input (resp. output) types of the three non-container members.
 *
 * Two halves, judged by two programs (the `view-metadata-type.test.ts` shape):
 *
 * - The TYPE half is judged by `tsc -p tsconfig.test.json` (the package's `typecheck` script, via
 *   `check:test-typecheck`), not by vitest. Each `@ts-expect-error` below asserts that its line
 *   does NOT compile; while the types were `unknown` every one of them compiled, so each directive
 *   was unused (TS2578), which reds the gate. The bodies are typed through the published names, so
 *   a later narrowing that drops a member is a compile error on its line.
 * - The RUNTIME half ties those typed bodies to the schema: each one parses, and its parse output
 *   is a value of `AssembledViewArtifactParsed`.
 */

import { describe, it, expect } from 'vitest';
import {
  AssembledViewArtifactSchema,
  type AssembledViewArtifact,
  type AssembledViewArtifactParsed,
} from './assembled-views.zod';
import { VIEW_METADATA_BRANCHES, VIEW_METADATA_MEMBERS, type ViewMetadataBranch } from './view.zod';

type ArtifactBranch = Exclude<ViewMetadataBranch, 'container'>;

// ── One body per non-container member, each typed through the published name ─────────────────

const viewItem: AssembledViewArtifact = {
  name: 'crm_lead.all',
  object: 'crm_lead',
  viewKind: 'list',
  config: { type: 'grid', data: { provider: 'object', object: 'crm_lead' }, columns: ['name'] },
};
const listOverlay: AssembledViewArtifact = { type: 'grid', columns: ['name'], object: 'crm_lead', viewKind: 'list' };
const formOverlay: AssembledViewArtifact = {
  type: 'simple',
  sections: [{ label: 'Main', fields: ['name'] }],
  object: 'crm_lead',
  viewKind: 'form',
};

const BODY_OF_EACH_MEMBER: Record<ArtifactBranch, AssembledViewArtifact> = { viewItem, listOverlay, formOverlay };

// ── What the two types refuse at compile time ────────────────────────────────────────────────

const someValue: unknown = JSON.parse('{"nope":1}');
// @ts-expect-error -- `unknown` is not an artifact; it was assignable while AssembledViewArtifact was `unknown`.
const fromUnknown: AssembledViewArtifact = someValue;
const CONTAINER_LIST = { type: 'grid', data: { provider: 'object', object: 'crm_lead' }, columns: ['name'] } as const;
// @ts-expect-error -- a container travels in `views:`, never in `viewItems:`; no artifact member admits a `list` config.
const container: AssembledViewArtifact = { object: 'crm_lead', list: CONTAINER_LIST };
// @ts-expect-error -- `notAViewKey` is declared by no member (TS2353).
const undeclaredKey: AssembledViewArtifact = { type: 'grid', columns: ['name'], object: 'crm_lead', viewKind: 'list', notAViewKey: 1 };
// @ts-expect-error -- `unknown` is not a parsed artifact either; it was assignable while AssembledViewArtifactParsed was `unknown`.
const parsedFromUnknown: AssembledViewArtifactParsed = someValue;
void [fromUnknown, container, undeclaredKey, parsedFromUnknown];

describe('AssembledViewArtifact is a non-container view artifact, not unknown', () => {
  it('has a typed body for every non-container member', () => {
    expect(Object.keys(BODY_OF_EACH_MEMBER).sort()).toEqual(
      VIEW_METADATA_BRANCHES.filter((branch) => branch !== 'container').sort(),
    );
  });

  for (const branch of Object.keys(BODY_OF_EACH_MEMBER) as ArtifactBranch[]) {
    it(`the ${branch} body typed as AssembledViewArtifact parses, through the ${branch} member`, () => {
      const body = BODY_OF_EACH_MEMBER[branch];
      expect(AssembledViewArtifactSchema.safeParse(body).success).toBe(true);
      const parsed: AssembledViewArtifactParsed = VIEW_METADATA_MEMBERS[branch].parse(body);
      expect(parsed).toMatchObject({ object: 'crm_lead' });
    });
  }
});
