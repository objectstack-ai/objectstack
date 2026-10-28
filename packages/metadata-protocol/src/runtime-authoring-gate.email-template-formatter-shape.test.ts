// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The HOST half of the email template publish door, for a hole whose text
 * after the `|` is not a formatter name (`{{ due | date-long }}`): the shipped
 * caller threads the `email_template` write to the runtime gate, and the
 * refusal arrives in the ADR-0112 envelope (`422 INVALID_METADATA`) a Studio /
 * REST `/meta` / MCP author's client reads.
 *
 * Harness: none — `evaluateRuntimeAuthoringGate` is pure. It RETURNS the error
 * and its caller throws it, so the refusal is asserted on the envelope, `code`
 * AND `status` together, plus the `issues` array.
 */
import { describe, expect, it } from 'vitest';

import { evaluateRuntimeAuthoringGate } from './runtime-authoring-gate.js';

const template = (over: Record<string, unknown> = {}) => ({
  name: 'invoice.due',
  label: 'Invoice due',
  locale: 'en-US',
  subject: 'Due {{ amount | currency :EUR }}',
  bodyHtml: '<p>Due <b>{{ due | date:long }}</b></p>',
  variables: [{ name: 'amount', type: 'number' }, { name: 'due', type: 'date' }],
  ...over,
});

const publishTemplate = (body: unknown) =>
  evaluateRuntimeAuthoringGate({
    type: 'email_template',
    name: 'invoice.due',
    state: 'active',
    body,
    objects: [],
    permissions: [],
    books: [],
    datasets: [],
  });

describe('the email_template publish door, for a formatter part that is not a formatter name', () => {
  it('⭐ LIT — the hole is refused in the ADR-0112 envelope, naming the hole and the shape', () => {
    const verdict = publishTemplate(template({ bodyHtml: '<p>Due <b>{{ due | date-long }}</b></p>' }));

    expect(verdict.error, 'the caller throws this; null here means the door judged nothing').not.toBeNull();
    expect((verdict.error as { code?: string }).code).toBe('INVALID_METADATA');
    expect((verdict.error as { status?: number }).status).toBe(422);

    const issues = (verdict.error as { issues?: Array<Record<string, unknown>> }).issues!;
    expect(issues.map((i) => [i.rule, i.path])).toEqual([['email-template-hole-grammar', 'emailTemplates[0].bodyHtml']]);
    const wire = JSON.stringify(issues);
    expect(wire).toContain('{{ due | date-long }}');
    expect(wire).toContain('a formatter is one word');

    // Non-vacuous: the corrected formatter publishes, and so does `currency :EUR`, which the in-app dialect accepts.
    expect(publishTemplate(template()).error).toBeNull();
  });
});
