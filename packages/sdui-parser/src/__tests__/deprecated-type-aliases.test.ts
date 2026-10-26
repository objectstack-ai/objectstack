/**
 * The two type names this package published before #25712 made the two copies
 * of this parser one stay importable, as deprecated aliases of the names the
 * renderer's copy had already moved to (objectui#6349, objectui#3161). The
 * rename therefore removes nothing exported, which keeps it a `minor`: the
 * launch-window guard (`scripts/check-changeset-no-major.mjs`) refuses a major.
 *
 * Type-level pins: `pnpm typecheck` compiles this file, and a dropped or
 * re-pointed alias fails it.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import { validateTree } from '../index.js';
import type { ManifestValidationResult, ParsedSchemaNode, SchemaNode, ValidationResult } from '../index.js';

describe('deprecated type aliases (#25712)', () => {
  it('`SchemaNode` is `ParsedSchemaNode`', () => {
    expectTypeOf<SchemaNode>().toEqualTypeOf<ParsedSchemaNode>();
  });

  it('`ValidationResult` is `ManifestValidationResult`, the type `validateTree` returns', () => {
    const result = validateTree(null, { components: {} });
    expectTypeOf<ValidationResult>().toEqualTypeOf<ManifestValidationResult>();
    expectTypeOf(result).toEqualTypeOf<ValidationResult>();
    // Runtime control: the call the type pin rides on really returns the shape.
    expect(Object.keys(result).sort()).toEqual(['bindings', 'diagnostics', 'requires']);
  });
});
