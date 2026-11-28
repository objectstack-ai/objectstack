// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An app menu entry naming a platform object (`sys_task`, `sys_note`) that the
 * stack does not declare.
 *
 * The refusal stays: the platform-prefix test cannot tell an object every
 * environment carries from one a plugin contributes, so exempting the prefix
 * would let a menu point at an absent object. What changes is the message: for
 * a platform-prefixed name it names the fix, `requiresObject`, and warns
 * against declaring a package copy, which "not defined in objects" alone
 * invites. A name without the prefix keeps the old message.
 */

import { describe, it, expect } from 'vitest';
import { defineStack } from './stack.zod';

type Envelope = Error & { code?: string; status?: number; issues?: readonly string[] };

function refusalOf(run: () => unknown): Envelope | null {
  try {
    run();
    return null;
  } catch (e) {
    return e as Envelope;
  }
}

const manifest = {
  id: 'app.example.starter',
  name: 'Starter',
  version: '1.0.0',
  type: 'app' as const,
  namespace: 'starter',
};

const company = { name: 'starter_company', label: 'Company', fields: { title: { type: 'text' as const } } };

const stackWithEntry = (entry: Record<string, unknown>) =>
  ({
    manifest,
    objects: [company],
    apps: [
      {
        name: 'starter',
        label: 'Starter',
        navigation: [
          { id: 'nav_companies', type: 'object', label: 'Companies', objectName: 'starter_company' },
          { id: 'nav_entry', type: 'object', label: 'Entry', ...entry },
        ],
      },
    ],
  }) as unknown as Parameters<typeof defineStack>[0];

const base = (name: string) =>
  `App 'starter' navigation references object '${name}' which is not defined in objects.`;

describe('app navigation naming a platform object the stack does not declare', () => {
  it.each(['sys_task', 'sys_note'])('refuses %s without requiresObject, and the message names requiresObject', (name) => {
    const refused = refusalOf(() => defineStack(stackWithEntry({ objectName: name })));
    expect(refused?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
    expect(refused?.status).toBe(422);
    const issue = refused?.issues?.find((i) => i.startsWith(base(name)));
    expect(issue).toBeDefined();
    expect(issue).toContain(`requiresObject: '${name}'`);
    expect(issue).toContain('do not declare a copy');
  });

  it.each(['sys_task', 'sys_note'])('accepts %s with requiresObject naming it', (name) => {
    expect(refusalOf(() => defineStack(stackWithEntry({ objectName: name, requiresObject: name })))).toBeNull();
  });

  it('keeps the old message, with no requiresObject hint, for an unknown name without the platform prefix', () => {
    const refused = refusalOf(() => defineStack(stackWithEntry({ objectName: 'starter_missing' })));
    expect(refused?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
    expect(refused?.status).toBe(422);
    expect(refused?.issues).toContain(base('starter_missing'));
    expect(refused?.issues?.some((i) => i.includes('requiresObject'))).toBe(false);
  });
});
