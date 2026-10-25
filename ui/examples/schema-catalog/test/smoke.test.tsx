/**
 * Smoke test for the schema catalog.
 *
 * At ~400+ entries, the cost-effective contract is **structural validation**:
 * every JSON schema must be a plain object with a non-empty string `type`
 * field. This catches the failure modes that actually matter for a catalog:
 *
 *   - JSON syntax errors (caught at import time by the JSON loader)
 *   - Malformed extractor output (missing `type`)
 *   - Registry rot (entries pointing at files that don't exist)
 *
 * Full DOM render coverage is provided implicitly by the docs site, which
 * imports the catalog via `<SchemaExample id="..." />` and renders every
 * example on its respective page during the production build.
 */
import { describe, it, expect } from 'vitest';
import { allExamples } from '../src/index.js';

describe('schema-catalog smoke', () => {
  const examples = allExamples();

  it('registry is non-empty', () => {
    expect(examples.length).toBeGreaterThan(0);
  });

  it.each(examples.map((e) => [e.id, e]))(
    '%s has a valid structural schema',
    (_id, example) => {
      expect(example.schema).toBeTypeOf('object');
      expect(example.schema).not.toBeNull();
      const node = example.schema as { type?: unknown };
      expect(typeof node.type).toBe('string');
      expect((node.type as string).length).toBeGreaterThan(0);
    },
  );
});
