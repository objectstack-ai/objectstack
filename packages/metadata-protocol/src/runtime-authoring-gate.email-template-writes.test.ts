// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #25189 — the HOST half of the email template publish door.
 *
 * `@objectstack/lint`'s `validate-email-template-hole-placements.test.ts`
 * proves the gate dispatches an `email_template` write to the placement rule.
 * This file asks the other side of the package wall: does the SHIPPED caller
 * thread an `email_template` write to that gate, and does the refusal arrive in
 * the existing ADR-0112 envelope (`422 INVALID_METADATA`) a Studio / REST
 * `/meta` / MCP author's client reads (ruling `6335348115` on #25082, item 3)?
 *
 * Harness: none — `evaluateRuntimeAuthoringGate` is pure, so nothing about the
 * door is stubbed. It RETURNS the error and its caller throws it, so the
 * refusal is asserted on the envelope, `code` AND `status` together, plus the
 * `issues` array; never a bare `toThrow()`.
 *
 * The bodies carry holes and markup only, never a value.
 */
import { describe, expect, it } from 'vitest';

import { evaluateRuntimeAuthoringGate } from './runtime-authoring-gate.js';

/** A template whose every hole sits in a supported placement. */
const cleanTemplate = (over: Record<string, unknown> = {}) => ({
  name: 'acme.welcome',
  label: 'Welcome',
  locale: 'en-US',
  subject: 'Hi {{user.name}}',
  bodyHtml: '<p>Hi <b>{{user.name}}</b>, <a href="{{{link}}}">open</a></p>',
  variables: [
    { name: 'user.name', type: 'string' },
    { name: 'link', type: 'url' },
  ],
  ...over,
});

/** An encoded hole in a URL attribute — a placement class the encoding does not suit. */
const IN_URL_ATTRIBUTE = '<p><a href="{{link}}">open</a></p>';

const publishTemplate = (body: unknown, state: 'draft' | 'active' = 'active') =>
  evaluateRuntimeAuthoringGate({
    type: 'email_template',
    name: (body as { name?: string })?.name ?? 'acme.welcome',
    state,
    body,
    objects: [],
    permissions: [],
    books: [],
    datasets: [],
  });

describe('the host threads an email_template publish to the runtime gate (#25189)', () => {
  it('⭐ LIT — a hole in a placement the renderer cannot encode for is refused in the ADR-0112 envelope', () => {
    const verdict = publishTemplate(cleanTemplate({ bodyHtml: IN_URL_ATTRIBUTE }));

    expect(verdict.error, 'the caller throws this; null here means the door judged nothing').not.toBeNull();
    expect((verdict.error as { code?: string }).code).toBe('INVALID_METADATA');
    expect((verdict.error as { status?: number }).status).toBe(422);

    // The receipt the author reads back: rule id, the face and the template it
    // names, the hole as written. The written template is the candidate's only
    // entry, so its positional path names it.
    const issues = (verdict.error as { issues?: Array<Record<string, unknown>> }).issues!;
    expect(issues.map((i) => [i.rule, i.path])).toEqual([['email-template-hole-placement', 'emailTemplates[0].bodyHtml']]);
    const wire = JSON.stringify(issues);
    expect(wire).toContain('acme.welcome');
    expect(wire).toContain('{{link}}');

    expect((verdict.error as { rulesRun?: string[] }).rulesRun).toContain('validateEmailTemplateHolePlacements');
  });

  it('⭐ LIT — a currency argument that is not a literal ISO 4217 code is refused in the same envelope, naming the rule', () => {
    const verdict = publishTemplate(cleanTemplate({ subject: 'Due {{ amount | currency:currency_code }}' }));

    expect(verdict.error, 'the caller throws this; null here means the door judged nothing').not.toBeNull();
    expect((verdict.error as { code?: string }).code).toBe('INVALID_METADATA');
    expect((verdict.error as { status?: number }).status).toBe(422);

    const issues = (verdict.error as { issues?: Array<Record<string, unknown>> }).issues!;
    expect(issues.map((i) => [i.rule, i.path])).toEqual([['email-template-hole-grammar', 'emailTemplates[0].subject']]);
    const wire = JSON.stringify(issues);
    expect(wire).toContain('{{ amount | currency:currency_code }}');
    expect(wire).toContain('ISO 4217');
    expect((verdict.error as { rulesRun?: string[] }).rulesRun).toContain('validateEmailTemplateHoleGrammar');

    // Non-vacuous: the literal code publishes.
    expect(publishTemplate(cleanTemplate({ subject: 'Due {{ amount | currency:EUR }}' })).error).toBeNull();
  });

  it('⭐ LIT — a hole that chains a second formatter is refused in the same envelope, naming the one-formatter rule', () => {
    const verdict = publishTemplate(cleanTemplate({ bodyHtml: '<p>{{ actual_amount | default:0 | number:2 }}</p>' }));

    expect(verdict.error, 'the caller throws this; null here means the door judged nothing').not.toBeNull();
    expect((verdict.error as { code?: string }).code).toBe('INVALID_METADATA');
    expect((verdict.error as { status?: number }).status).toBe(422);

    const issues = (verdict.error as { issues?: Array<Record<string, unknown>> }).issues!;
    expect(issues.map((i) => [i.rule, i.path])).toEqual([['email-template-hole-grammar', 'emailTemplates[0].bodyHtml']]);
    const wire = JSON.stringify(issues);
    expect(wire).toContain('{{ actual_amount | default:0 | number:2 }}');
    expect(wire).toContain('a hole takes one formatter');

    // Non-vacuous: one formatter publishes.
    expect(publishTemplate(cleanTemplate({ bodyHtml: '<p>{{ actual_amount | number:2 }}</p>' })).error).toBeNull();
  });

  it('the same template publishes once the hole is moved to a supported placement', () => {
    const verdict = publishTemplate(cleanTemplate());
    expect(verdict.error, 'the refusal is about the placement, not about the type').toBeNull();
    expect(verdict.advisories).toEqual([]);
  });

  it('a draft save is not judged (ruling item 4) — the same body is judged at its publish', () => {
    const body = cleanTemplate({ bodyHtml: IN_URL_ATTRIBUTE });
    expect(publishTemplate(body, 'draft')).toEqual({ error: null, advisories: [] });
    // Non-vacuous: the draft's body IS refused once it is published.
    expect(publishTemplate(body, 'active').error).not.toBeNull();
  });
});
