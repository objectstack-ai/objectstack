// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24677] The authoring doors refuse a `lookup` or `master_detail` field whose
 * `reference` is a stored-metadata-body table.
 *
 * The engine never hydrates such a field: `expand` keeps its stored id and
 * never nests the row, and a master-detail `parent` root over a family header
 * stays unbound (`@objectstack/objectql`'s
 * `engine-hydration-stored-metadata-body.test.ts`). So as declared it saved,
 * built and validated, and then never worked. These pins hold that the author
 * learns it where the field is declared, at every authoring door alike:
 *
 *  - `os validate` and `os build` (`runAuthoringRules`, the CLI's own entry);
 *  - the object save door (`runRuntimeAuthoringRules` on an `object` write),
 *    whose finding is the build's finding; the protocol-level half, through
 *    the real `saveMetaItem`, is `@objectstack/metadata-protocol`'s
 *    `protocol.runtime-authoring-gate.test.ts`;
 *
 * and that a reference to an ordinary platform table still saves (the
 * control), and that the #24316 hop refusal is unchanged beside it.
 */
import { describe, expect, it } from 'vitest';
import { STORED_METADATA_BODY_OBJECTS, STORED_METADATA_BODY_PRESCRIPTION } from '@objectstack/spec/kernel';
import { EXPRESSION_INVALID, runAuthoringRules } from './authoring-rules.js';
import { runRuntimeAuthoringRules } from './runtime-gate.js';
import { validateStackExpressions } from './validate-expressions.js';

const RELATIONSHIP_TYPES = ['lookup', 'master_detail'] as const;

/** `sharingModel` is authored so `security-owd-unset` stays quiet and the finding is this rule's. */
const carrier = (type: string, target: string, fields: Record<string, unknown> = {}) => ({
  name: 'probe_carrier',
  label: 'Probe Carrier',
  sharingModel: 'private',
  fields: {
    name: { type: 'text', label: 'Name' },
    meta: { type, label: 'Meta', reference: target },
    ...fields,
  },
});

/** Where the refusal is located: the KEY the author edits. */
const WHERE = "object 'probe_carrier' · field 'meta' reference";

const atReference = <T extends { where: string }>(found: readonly T[]): T[] =>
  found.filter((f) => f.where === WHERE);

const gateObject = (item: unknown, objects: unknown[] = []) =>
  runRuntimeAuthoringRules({ type: 'object', item, context: { objects } });

const dump = (r: unknown) => JSON.stringify(r, null, 2);

describe('[#24677] a lookup or master_detail into a stored-metadata-body table is refused at author time', () => {
  for (const target of STORED_METADATA_BODY_OBJECTS) {
    for (const type of RELATIONSHIP_TYPES) {
      it(`a \`${type}\` to '${target}' is an error naming the field, its type and the target, ending on the prescription`, () => {
        const found = atReference(validateStackExpressions({ objects: [carrier(type, target)] }));

        expect(found, dump(found)).toHaveLength(1);
        const [issue] = found;
        expect(issue.severity).toBe('error');
        expect(issue.message).toContain(`\`meta\` is a \`${type}\``);
        expect(issue.message).toContain(`names '${target}'`);
        expect(issue.message.endsWith(STORED_METADATA_BODY_PRESCRIPTION)).toBe(true);
      });

      it(`\`os validate\` and \`os build\` refuse a \`${type}\` to '${target}' under the expression rule`, () => {
        const stack = { objects: [carrier(type, target)] };
        for (const command of ['validate', 'build'] as const) {
          const found = atReference(runAuthoringRules(command, { normalized: stack, parsed: stack }));
          expect(found, `${command}: ${dump(found)}`).toHaveLength(1);
          expect(found[0]).toMatchObject({ rule: EXPRESSION_INVALID, severity: 'error', path: WHERE });
        }
      });

      it(`the object save door refuses a \`${type}\` to '${target}' with the build's own finding`, () => {
        const result = gateObject(carrier(type, target));

        expect(result.rulesRun).toContain('validateStackExpressions');
        const atDoor = atReference(result.errors);
        expect(atDoor, dump(result)).toHaveLength(1);
        const stack = { objects: [carrier(type, target)] };
        const atBuild = atReference(runAuthoringRules('build', { normalized: stack, parsed: stack }));
        for (const key of ['rule', 'where', 'path', 'message', 'hint'] as const) {
          expect(atDoor[0][key], `door and build disagree on '${key}'`).toBe(atBuild[0][key]);
        }
      });
    }
  }

  it('a `user` field whose authored `reference` names the family is refused too — the collector\'s type set, not a second one', () => {
    // `user`'s target is implied (`sys_user`), but an authored `reference` on it
    // is not refused at parse and is the target every reader resolves, so the
    // hop refusal's collector admits it, and this refusal judges the same set.
    const [issue] = atReference(validateStackExpressions({ objects: [carrier('user', 'sys_metadata')] }));
    expect(issue?.message).toContain('`meta` is a `user`');
    expect(atReference(validateStackExpressions({ objects: [carrier('user', 'sys_user')] }))).toEqual([]);
  });

  it('a master_detail refusal says its `parent` root stays unbound; a lookup refusal does not', () => {
    const [md] = atReference(validateStackExpressions({ objects: [carrier('master_detail', 'sys_metadata')] }));
    const [lk] = atReference(validateStackExpressions({ objects: [carrier('lookup', 'sys_metadata')] }));
    expect(md.message).toContain('`parent` root stays unbound');
    expect(lk.message).not.toContain('`parent` root');
  });

  it('a stored object that already declares one is still refused on its next save', () => {
    // The written item's stored self carries the same field: a finding located
    // on the written item is judged against the baseline without it, so a
    // stored row is not grandfathered past the door it next crosses.
    const stored = carrier('lookup', 'sys_metadata');
    const result = gateObject({ ...stored, label: 'Probe Carrier (renamed)' }, [stored]);

    expect(atReference(result.errors), dump(result)).toHaveLength(1);
  });

  it('a stored sibling that declares one is not this write\'s to answer for (the differential)', () => {
    const sibling = carrier('lookup', 'sys_metadata');
    const written = { name: 'probe_other', label: 'Other', sharingModel: 'private', fields: { name: { type: 'text', label: 'Name' } } };

    const result = gateObject(written, [sibling]);

    expect(result.errors.filter((f) => f.where.includes(' reference')), dump(result)).toEqual([]);
  });
});

describe('[#24677] the control: a reference to an ordinary table still saves', () => {
  for (const target of ['sys_user', 'probe_account']) {
    for (const type of RELATIONSHIP_TYPES) {
      it(`a \`${type}\` to '${target}' draws no finding at the build or at the object save door`, () => {
        const objects = [
          carrier(type, target),
          { name: 'probe_account', label: 'Account', sharingModel: 'private', fields: { name: { type: 'text', label: 'Name' } } },
        ];
        expect(atReference(validateStackExpressions({ objects }))).toEqual([]);
        const stack = { objects };
        expect(atReference(runAuthoringRules('build', { normalized: stack, parsed: stack }))).toEqual([]);
        expect(atReference(gateObject(objects[0], [objects[1]]).errors)).toEqual([]);
      });
    }
  }
});

describe('[#24677] the #24316 hop refusal is unchanged beside it', () => {
  it('a formula reading through the family reference draws the hop refusal at its expression, and the reference refusal at the field', () => {
    const stack = {
      objects: [carrier('lookup', 'sys_metadata', { body_out: { type: 'formula', label: 'Out', expression: 'record.meta.metadata' } })],
    };
    const found = validateStackExpressions(stack);

    const hop = found.filter((i) => i.message.includes('a stored-metadata table'));
    expect(hop.map((i) => i.where), dump(found)).toEqual(["object 'probe_carrier' · field 'body_out' expression"]);
    expect(hop[0].message).toContain('this formula reads null on every row');
    expect(atReference(found), dump(found)).toHaveLength(1);
    // Each refusal is selected by its own location alone: the reference
    // refusal never reads as a hop, and the hop never as the reference.
    expect(atReference(hop)).toEqual([]);
    expect(atReference(found)[0].message).not.toContain('a stored-metadata table');
  });
});
