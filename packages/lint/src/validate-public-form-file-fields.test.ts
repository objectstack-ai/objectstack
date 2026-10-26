// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Ruling C on #25572 (#25650): a form open to anonymous intake that declares a
// file field is refused at validate, compile and the publish gate, naming the
// field. Pins both doors: the rule over a whole stack (what the three CLI
// commands run through `authoring-rules.ts`), and the runtime publish gate on a
// `view` write (`runRuntimeAuthoringRules`, the function the metadata write
// path calls) resolving the field's type against its `objects` context.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { FILE_REFERENCE_TYPES } from '@objectstack/spec/data';

import { AUTHORING_RULES } from './authoring-rules.js';
import { runRuntimeAuthoringRules } from './runtime-gate.js';
import { PUBLIC_FORM_FILE_FIELD, validatePublicFormFileFields } from './validate-public-form-file-fields.js';

const supplier = {
  name: 'supplier_application',
  label: 'Supplier application',
  fields: {
    company: { type: 'text', label: 'Company' },
    email: { type: 'email', label: 'Email' },
    certificate: { type: 'file', label: 'Certificate' },
    logo: { type: 'image', label: 'Logo' },
  },
};

const OPEN = { enabled: true, allowAnonymous: true, publicLink: '/forms/apply' };

const formOf = (fields: unknown[], sharing: Record<string, unknown> = OPEN, bucket = 'sections') => ({
  type: 'simple',
  data: { provider: 'object', object: 'supplier_application' },
  [bucket]: [{ name: 'about', fields }],
  sharing,
});

const stackOf = (view: Record<string, unknown>, objects: unknown = [supplier]) => ({ objects, views: [view] });

describe('validatePublicFormFileFields — the stack rule the CLI commands run', () => {
  it('refuses a `{ field }` entry naming a file field on a public formViews entry', () => {
    const findings = validatePublicFormFileFields(stackOf({
      name: 'supplier_views',
      formViews: { apply: formOf([{ field: 'company' }, { field: 'certificate', required: true }]) },
    }));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: PUBLIC_FORM_FILE_FIELD,
      where: 'view "supplier_views" · formViews.apply',
      path: 'views[0].formViews.apply.sections[0].fields[1]',
    });
    expect(findings[0].message).toContain('"certificate"');
  });

  it('refuses a bare field name, and every file field in a section, each at its own entry', () => {
    const findings = validatePublicFormFileFields(stackOf({
      name: 'supplier_views',
      form: formOf(['logo', 'company', 'certificate']),
    }));
    expect(findings.map((f) => f.path)).toEqual([
      'views[0].form.sections[0].fields[0]',
      'views[0].form.sections[0].fields[2]',
    ]);
  });

  it('refuses a file field in a later section and in the legacy `groups` bucket', () => {
    const form = formOf(['company']);
    (form.sections as unknown[]).push({ name: 'documents', fields: [{ field: 'certificate' }] });
    expect(validatePublicFormFileFields(stackOf({ name: 'v', form })).map((f) => f.path))
      .toEqual(['views[0].form.sections[1].fields[0]']);
    expect(validatePublicFormFileFields(stackOf({ name: 'v', form: formOf(['certificate'], OPEN, 'groups') }))
      .map((f) => f.path)).toEqual(['views[0].form.groups[0].fields[0]']);
  });

  it('refuses on the flattened `viewKind: form` item', () => {
    const findings = validatePublicFormFileFields(stackOf({
      name: 'supplier_apply',
      viewKind: 'form',
      config: formOf(['certificate']),
    }));
    expect(findings.map((f) => f.path)).toEqual(['views[0].config.sections[0].fields[0]']);
  });

  it('refuses every FILE_REFERENCE_TYPES type, and only those', () => {
    for (const type of FILE_REFERENCE_TYPES) {
      const object = { name: 'supplier_application', fields: { attachment: { type } } };
      const findings = validatePublicFormFileFields(stackOf({ name: 'v', form: formOf(['attachment']) }, [object]));
      expect(findings, type).toHaveLength(1);
    }
    for (const type of ['text', 'textarea', 'url', 'json', 'lookup']) {
      const object = { name: 'supplier_application', fields: { attachment: { type } } };
      expect(validatePublicFormFileFields(stackOf({ name: 'v', form: formOf(['attachment']) }, [object])), type)
        .toEqual([]);
    }
  });

  it('reads an object whose fields are a list', () => {
    const object = { name: 'supplier_application', fields: [{ name: 'certificate', type: 'file' }] };
    expect(validatePublicFormFileFields(stackOf({ name: 'v', form: formOf(['certificate']) }, [object])))
      .toHaveLength(1);
  });

  it('resolves the object from the view when the form names none', () => {
    const form: Record<string, unknown> = formOf(['certificate']);
    delete form.data;
    expect(validatePublicFormFileFields(stackOf({ name: 'v', object: 'supplier_application', formViews: { apply: form } })))
      .toHaveLength(1);
  });

  it('passes a form that is not open to anonymous intake, whichever switch is off', () => {
    for (const sharing of [
      { ...OPEN, allowAnonymous: false },
      { ...OPEN, enabled: false },
      { enabled: true, allowAnonymous: true },
      { allowAnonymous: true, publicLink: '/forms/apply' },
    ]) {
      expect(validatePublicFormFileFields(stackOf({ name: 'v', form: formOf(['certificate'], sharing) })))
        .toEqual([]);
    }
  });

  it('passes a public form that declares no file field', () => {
    expect(validatePublicFormFileFields(stackOf({ name: 'v', form: formOf(['company', { field: 'email' }]) })))
      .toEqual([]);
  });

  it('does not judge a form whose object or field does not resolve', () => {
    expect(validatePublicFormFileFields(stackOf({ name: 'v', form: formOf(['certificate']) }, []))).toEqual([]);
    expect(validatePublicFormFileFields(stackOf({ name: 'v', form: formOf(['not_a_field']) }))).toEqual([]);
  });

  it('is registered gating, on all three commands and on the publish gate for view writes', () => {
    const entry = AUTHORING_RULES.find((r) => r.name === 'validatePublicFormFileFields');
    expect(entry).toMatchObject({
      tier: 'gating',
      commands: ['validate', 'build', 'lint'],
      surfaces: ['cli', 'runtime-publish'],
      runtimeTypes: ['view'],
    });
  });
});

describe('the runtime publish gate on a view write', () => {
  const gate = (item: unknown) =>
    runRuntimeAuthoringRules({ type: 'view', item, context: { objects: [supplier] } });

  it('refuses the publish as an error at the field entry, resolving the type from the objects context', () => {
    const { errors } = gate({
      name: 'supplier_views',
      formViews: { apply: formOf([{ field: 'company' }, { field: 'certificate' }]) },
    });
    const finding = errors.find((e) => e.rule === PUBLIC_FORM_FILE_FIELD);
    expect(finding, JSON.stringify(errors)).toBeDefined();
    expect(finding!.path).toContain('formViews.apply.sections[0].fields[1]');
  });

  it('admits the same form once the file field is off it', () => {
    const { errors } = gate({
      name: 'supplier_views',
      formViews: { apply: formOf([{ field: 'company' }, { field: 'email' }]) },
    });
    expect(errors.filter((e) => e.rule === PUBLIC_FORM_FILE_FIELD)).toEqual([]);
  });
});

describe('the object a candidate submits into is the doors\' own function', () => {
  const source = readFileSync(new URL('./validate-public-form-file-fields.ts', import.meta.url), 'utf8');

  it('imports anonymousFormObjectName from @objectstack/spec/ui and keeps no retyped rung order', () => {
    expect(source).toMatch(/anonymousFormObjectName,[\s\S]*?\} from '@objectstack\/spec\/ui'/);
    expect(source).not.toContain('candidateObjectName');
    expect(source).not.toContain('viewObjectName');
  });
});
