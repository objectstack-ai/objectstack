// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// `sanitizeNamespace()` emits a namespace that has a paired customization
// namespace (ADR-0146 D3), judged by the spec's own `customizationNamespace`,
// and its cap is pinned equal to the spec constant it restates.

import { describe, it, expect } from 'vitest';
import {
  MAX_CUSTOMIZATION_BASE_NAMESPACE_LENGTH,
  ManifestSchema,
  customizationNamespace,
} from '@objectstack/spec/kernel';
import { SCAFFOLD_NAMESPACE_MAX_LENGTH, sanitizeNamespace } from './rewrite-identity.js';

/** Names a scaffolder is handed: short, exact-fit, long, scoped, odd. */
const NAMES = [
  '', 'x', 'a', '1', 'my-app', 'crm', 'base', 'system', 'sys', 'Base', '@acme/sys',
  'abcdefghijklm', 'abcdefghijklmn', 'qa-console-first-paint', 'abcdefghijkl-mnop',
  'abcdefghijk--lmnop', '1234567890123456', '9-lives', '@acme/very-long-project-name',
  'My Cool App!!', '__leading', 'trailing__', 'a.b.c.d.e.f.g.h.i', 'ünïcödé-name',
  'abcdefghijklmnopqrstuvwxyz', 'twelve-chars', 'thirteen-char',
];

describe('the scaffold namespace cap', () => {
  it('is the spec constant it restates', () => {
    expect(SCAFFOLD_NAMESPACE_MAX_LENGTH).toBe(MAX_CUSTOMIZATION_BASE_NAMESPACE_LENGTH);
  });

  it.each(NAMES)('%j sanitizes to a namespace the manifest accepts and that has a customization pair', (name) => {
    const ns = sanitizeNamespace(name);
    expect(ManifestSchema.shape.namespace.safeParse(ns).success, ns).toBe(true);
    expect(['base', 'system', 'sys']).not.toContain(ns);
    expect(customizationNamespace(ns), ns).toEqual({ ok: true, value: `${ns}_custom` });
  });
});

describe('sanitizeNamespace', () => {
  it.each([
    ['qa-console-first-paint', 'qa_console_fi'],
    // The 13th character is `_`: dropped, never left trailing.
    ['abcdefghijkl-mnop', 'abcdefghijkl'],
    ['@acme/very-long-project-name', 'very_long_pro'],
    ['1234567890123456', 'a123456789012'],
    ['abcdefghijklmn', 'abcdefghijklm'],
  ])('truncates %j to %j', (name, expected) => {
    expect(sanitizeNamespace(name)).toBe(expected);
  });

  // Names that already fit are scaffolded exactly as before.
  it.each([
    ['my-app', 'my_app'],
    ['crm', 'crm'],
    ['abcdefghijklm', 'abcdefghijklm'],
    ['thirteen-char', 'thirteen_char'],
    ['', 'app'],
    ['x', 'x_app'],
    ['9-lives', 'a9_lives'],
    ['sys', 'sys_app'],
    ['system', 'system_app'],
    ['@acme/my-app', 'my_app'],
  ])('keeps %j as %j', (name, expected) => {
    expect(sanitizeNamespace(name)).toBe(expected);
  });
});
