/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The field-widget namespace rule on the ZOD side (#5449).
 *
 * `@object-ui/core`'s `validateFieldWidgetNamespace` has refused a
 * colon-qualified form-field widget id outside the `field:` namespace since
 * #5375. This schema — the one `objectui validate` reaches, through its strict
 * twin — declared `type`/`widget` as bare optional strings, so
 * it green-lit the same document. An author who ran the CLI before shipping
 * got a tick on metadata that renders a secret into a clear-text box.
 *
 * ## Why this file is a case-for-case PIN and not a couple of smoke tests
 *
 * The rule is now stated in two places, and it cannot be shared: `core`
 * depends on this package, so delegating from here would be a cycle, and this
 * package is declared "Zero deps. No React." Nothing in CI can exercise both
 * implementations in one process — `core` cannot be imported here, and
 * `@object-ui/cli` (the other candidate host) does not declare it — so what
 * keeps the copies together is this file walking the SAME rows core's own
 * census walks, with core's error code and core's message asserted verbatim.
 * A drift on either side turns a row red here.
 *
 * The rows come from core's measured table (the real `form` renderer on the
 * built-in path, no `registerAllFields()`):
 *
 *   type            registry hit   rendered type
 *   ui:password     TRUE           text
 *   secret          false          text
 *   field:secret    false          text
 *
 * `ui:password` resolving in the registry is exactly what makes it dangerous:
 * an author who checks gets a YES and still gets a text box on the field path.
 */

import { describe, it, expect } from 'vitest';
import { FormFieldSchema, FormSchema } from '../zod/form.zod.js';
import { safeValidateSchema } from '../zod/index.zod.js';

/** The zod issue code the refinement carries, mirroring core's error code. */
const CORE_CODE = 'UNRESOLVABLE_FIELD_WIDGET_NAMESPACE';

/** Issues on a field, with core's code lifted out of `params`. */
function issuesFor(field: Record<string, unknown>) {
  const result = FormFieldSchema.safeParse(field);
  if (result.success) return [];
  return result.error.issues.map((issue) => ({
    path: issue.path.join('.'),
    code: (issue as { params?: { code?: string } }).params?.code,
    message: issue.message,
  }));
}

/** Only the namespace findings — a field may fail for unrelated reasons too. */
function namespaceIssues(field: Record<string, unknown>) {
  return issuesFor(field).filter((issue) => issue.code === CORE_CODE);
}

describe('FormFieldSchema refuses an unresolvable namespaced widget id', () => {
  it('refuses `ui:password` on `type` — the row that renders clear text', () => {
    const found = namespaceIssues({ name: 'pw', type: 'ui:password' });
    expect(found).toHaveLength(1);
    expect(found[0].path).toBe('type');
  });

  it('refuses `ui:password` on `widget` and blames `widget`, not `type`', () => {
    // The renderer reads `widget` first, so `widget` is the key to fix — core
    // picks the blamed key the same way.
    const found = namespaceIssues({ name: 'pw', widget: 'ui:password', type: 'input' });
    expect(found).toHaveLength(1);
    expect(found[0].path).toBe('widget');
  });

  it('refuses any other namespace, not a hard-coded list of known-bad ids', () => {
    // The point of closing the NAMESPACE is that the next invented id is
    // already covered. None of these exist anywhere in the repo.
    for (const id of ['ui:secret', 'component:password', 'x:y', 'ref:component']) {
      expect(namespaceIssues({ name: 'pw', type: id })).toHaveLength(1);
    }
  });

  it('states core’s message verbatim, naming the id and the repair', () => {
    const [found] = namespaceIssues({ name: 'pw', type: 'ui:password' });
    expect(found.message).toBe(
      `'ui:password' is not a form field widget: a namespaced field widget id must name the ` +
      `\`field:\` namespace (objectui#5254), so this id resolves NOTHING on the field path ` +
      `and the renderer would fall through to a plain text box — putting a secret on screen ` +
      `in clear text when the field holds one (objectui#5375). Write the built-in spelling ` +
      `(e.g. \`password\`), or the field widget id \`field:password\`. ` +
      `Resolving in the registry is not proof it resolves HERE — \`ui:password\` is a ` +
      `registered SDUI node renderer and still renders clear text as a field.`,
    );
  });

  it('carries core’s error code in `params`, since zod’s own code is `custom`', () => {
    const result = FormFieldSchema.safeParse({ name: 'pw', type: 'ui:password' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0].code).toBe('custom');
    expect(issuesFor({ name: 'pw', type: 'ui:password' })[0].code).toBe(CORE_CODE);
  });
});

/**
 * The negative controls. A refusal that also rejects the legitimate spellings
 * is not a fix — it is the same authoring-time betrayal pointed the other way,
 * and it would push authors back off the CLI.
 */
describe('FormFieldSchema still accepts every legitimate widget id', () => {
  it('accepts a `field:`-namespaced id — REGISTERED or not', () => {
    // Registration is a RUNTIME fact (`registerAllFields()`, lazily loaded
    // plugins) that no authoring-time validator can see. `field:secret` is
    // unregistered on the built-in path and still authorable; the renderer
    // answers it with a visible refusal (#5322), not a clear-text box.
    for (const id of ['field:password', 'field:secret', 'field:some-third-party-widget']) {
      expect(namespaceIssues({ name: 'pw', type: id })).toEqual([]);
      expect(namespaceIssues({ name: 'pw', widget: id })).toEqual([]);
    }
  });

  it('accepts a bare name — an open set, not a closed one', () => {
    for (const id of ['password', 'secret', 'input', 'anything-registered-later']) {
      expect(namespaceIssues({ name: 'pw', type: id })).toEqual([]);
    }
  });

  it('accepts a field with no widget id at all — `type` is optional', () => {
    expect(FormFieldSchema.safeParse({ name: 'pw' }).success).toBe(true);
  });

  it('does not fire when `widget` is bare and `type` is namespaced', () => {
    // `widget` wins the precedence, so the rendered widget is `password` and
    // the namespaced `type` never reaches the field path. Blaming it here
    // would disagree with the renderer — the failure mode the rule exists for.
    expect(namespaceIssues({ name: 'pw', widget: 'password', type: 'ui:password' })).toEqual([]);
  });

  it('leaves strip-mode parsing and the declared key set intact', () => {
    const parsed = FormFieldSchema.parse({ name: 'pw', type: 'password', bogus: 1 });
    expect(parsed).toEqual({ name: 'pw', type: 'password' });
    expect(FormFieldSchema.shape.type).toBeDefined();
  });
});

/**
 * The entry point the card was about: `safeValidateSchema`, the call
 * `objectui validate` made then (it runs the strict twin since objectui#5250).
 * It routes a `type: 'form'` document to `FormSchema` and its `fields` array. The refusal has to survive that trip with a path an
 * author can act on.
 */
describe('safeValidateSchema — the tolerant face', () => {
  const badForm = { type: 'form', fields: [{ name: 'pw', type: 'ui:password' }] };

  it('rejects the document core rejects', () => {
    const result = safeValidateSchema(badForm);
    expect(result.success).toBe(false);
    if (result.success) return;
    const found = result.error.issues.filter(
      (issue) => (issue as { params?: { code?: string } }).params?.code === CORE_CODE,
    );
    expect(found).toHaveLength(1);
    // The path the CLI prints, mirroring core's `schema.fields[0].type`.
    expect(found[0].path).toEqual(['fields', 0, 'type']);
  });

  it('reports the offending field by index, not just the document', () => {
    const result = FormSchema.safeParse({
      type: 'form',
      fields: [
        { name: 'ok', type: 'password' },
        { name: 'pw', type: 'ui:password' },
      ],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0].path).toEqual(['fields', 1, 'type']);
  });

  it('still accepts a form whose fields use the legitimate spellings', () => {
    const result = safeValidateSchema({
      type: 'form',
      fields: [
        { name: 'pw', type: 'field:password' },
        { name: 'note', type: 'textarea' },
        { name: 'plain' },
      ],
    });
    expect(result.success).toBe(true);
  });
});
