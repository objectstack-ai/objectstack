// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `os init` must scaffold a project whose `manifest.id` the spec accepts —
// pinned against the spec's own exported rule, never a restatement of it.
//
// The defect this holds shut (#17534): every template interpolated the
// NAMESPACE into the id (`com.example.${namespace}`). A namespace is snake_case
// by rule and an id segment refuses underscores, so `os init my-app` — the very
// name the neighbouring scaffold tests use — wrote `com.example.my_app`, which
// `ManifestSchema` refuses. The two identifiers are derived from one project
// name under contradictory rules; deriving either from the other is the bug.

import { describe, it, expect } from 'vitest';
import { MANIFEST_ID_PATTERN, ManifestSchema } from '@objectstack/spec/kernel';
import { TEMPLATES, sanitizeNamespace, manifestIdSlug } from '../src/commands/init.js';

/** The `id:` literal a template's rendered config declares. */
function renderedId(templateKey: string, projectName: string): string | undefined {
  const cfg = TEMPLATES[templateKey].configContent(projectName, sanitizeNamespace(projectName));
  return /\bid:\s*'([^']+)'/.exec(cfg)?.[1];
}

// `my-app` is the name the other init scaffold tests use, and `my_app` is a
// name a user can type: npm accepts it and the namespace sanitizer leaves it
// alone, so it is the shortest path to the underscore this rule refuses.
const PROJECT_NAMES = ['my-app', 'my_app', 'MyApp', 'support desk', '@acme/crm', '2fa'];

describe('os init scaffolds a conforming manifest.id', () => {
  it.each(Object.keys(TEMPLATES))('template "%s"', (templateKey) => {
    for (const name of PROJECT_NAMES) {
      const id = renderedId(templateKey, name);
      expect(id, `template ${templateKey} must declare a manifest id`).toBeTruthy();
      expect(MANIFEST_ID_PATTERN.test(id as string), `${templateKey} + ${name} → ${id}`).toBe(true);
      // The pattern is necessary but the schema is the authority, so ask it too.
      const parsed = ManifestSchema.safeParse({ id, version: '1.0.0', type: 'app', name: 'X' });
      expect(parsed.success, `${templateKey} + ${name} → ${id} must parse`).toBe(true);
    }
  });

  it('never interpolates the namespace into the id — the two rules contradict', () => {
    // The regression in one line: the namespace for `my-app` is `my_app`, and
    // no template may carry that value inside its id.
    expect(sanitizeNamespace('my-app')).toBe('my_app');
    for (const templateKey of Object.keys(TEMPLATES)) {
      expect(renderedId(templateKey, 'my-app')).not.toContain('my_app');
    }
  });
});

describe('manifestIdSlug', () => {
  it.each([
    ['my-app', 'my-app'],
    ['my_app', 'my-app'],
    ['MyApp', 'myapp'],
    ['support desk', 'support-desk'],
    ['@acme/crm', 'crm'],
    ['2fa', 'app-2fa'],
    ['', 'app'],
    ['---', 'app'],
  ])('%s → %s', (input, expected) => {
    expect(manifestIdSlug(input)).toBe(expected);
  });

  it('is prefixable into an id the spec accepts, for every name tried', () => {
    for (const name of [...PROJECT_NAMES, '', '---', 'ünïcödé', 'a']) {
      expect(MANIFEST_ID_PATTERN.test(`com.example.${manifestIdSlug(name)}`), name).toBe(true);
    }
  });
});
