// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24316] The lint refuses a one-hop read through a reference into a
 * stored-metadata-body table, at the two sites that serve a hop: a formula
 * field's `expression` and a validation rule's hydrated `condition`.
 *
 * ObjectQL's one-hop loader never reads that hop (its own pin is
 * `@objectstack/objectql`'s `engine-formula-hop-stored-metadata-body.test.ts`),
 * so as written the formula reads null and the rule refuses every write. These
 * pins hold that the author learns it where the expression is written — on
 * `os validate` / `os build` and on the object save door, which runs the same
 * passes — and that a hop into any other object, and a read of the stored id
 * alone, are untouched.
 */
import { describe, expect, it } from 'vitest';
import { STORED_METADATA_BODY_OBJECTS } from '@objectstack/spec/kernel';
import { runStackExpressionPasses, validateStackExpressions } from './validate-expressions.js';

const carrier = (target: string, fields: Record<string, unknown>, validations?: unknown[]) => ({
  name: 'probe_carrier',
  fields: {
    title: { type: 'text' },
    meta: { type: 'lookup', reference: target },
    other: { type: 'lookup', reference: 'probe_other' },
    ...fields,
  },
  ...(validations ? { validations } : {}),
});
const other = { name: 'probe_other', fields: { name: { type: 'text' } } };
const hopIssues = (issues: ReturnType<typeof validateStackExpressions>) =>
  issues.filter((i) => i.message.includes('a stored-metadata table'));

describe('[#24316] a hop into a stored-metadata-body table is refused at author time', () => {
  for (const target of STORED_METADATA_BODY_OBJECTS) {
    it(`a formula reading through a reference to '${target}' is an error naming the reference and the table`, () => {
      const stack = {
        objects: [carrier(target, {
          body_out: { type: 'formula', expression: 'record.meta.metadata' },
          hash_out: { type: 'formula', expression: 'record.meta.checksum' },
        }), other],
      };
      const found = hopIssues(validateStackExpressions(stack));
      expect(found.map((i) => i.where)).toEqual([
        "object 'probe_carrier' · field 'body_out' expression",
        "object 'probe_carrier' · field 'hash_out' expression",
      ]);
      for (const i of found) {
        expect(i.severity).toBe('error');
        expect(i.message).toContain(`\`record.meta\` is a reference to '${target}'`);
        expect(i.message).toContain('this formula reads null on every row');
      }
    });

    it(`a validation condition reading through a reference to '${target}' is an error, nested conditions included`, () => {
      const stack = {
        objects: [carrier(target, {}, [
          { name: 'top', type: 'script', condition: "record.meta.metadata.contains('x')", message: 'm' },
          {
            name: 'nested', type: 'conditional', when: 'record.title != null', message: 'm',
            then: { name: 'inner', type: 'script', condition: "record.meta.type == 'datasource'", message: 'm' },
          },
        ]), other],
      };
      const found = hopIssues(validateStackExpressions(stack));
      expect(found).toHaveLength(2);
      expect(found[0].where).toBe("object 'probe_carrier' · validation 'top'");
      expect(found[1].where).toContain("object 'probe_carrier' · ");
      for (const i of found) {
        expect(i.severity).toBe('error');
        expect(i.message).toContain('this rule has no verdict and every write it judges is refused');
      }
    });
  }

  it('the object save door (`runtimeWriteType: object`) refuses the same hop', () => {
    const stack = {
      objects: [carrier('sys_metadata', { body_out: { type: 'formula', expression: 'record.meta.metadata' } }), other],
    };
    expect(hopIssues(runStackExpressionPasses(stack, { runtimeWriteType: 'object' }))).toHaveLength(1);
  });

  it('a hop into any other object, and a read of the stored id alone, are untouched', () => {
    const stack = {
      objects: [carrier('sys_metadata', {
        other_name: { type: 'formula', expression: 'record.other.name' },
        meta_id: { type: 'formula', expression: 'record.meta' },
      }, [{ name: 'r', type: 'script', condition: 'record.other.name == record.title', message: 'm' }]), other],
    };
    expect(hopIssues(validateStackExpressions(stack))).toEqual([]);
  });
});
