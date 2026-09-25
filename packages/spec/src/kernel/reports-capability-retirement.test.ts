// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20102] The `reports` platform capability is RETIRED with the saved-report
 * stack it mounted, and a stack that still declares it is REFUSED LOUDLY —
 * with the retirement and the replacement, never the typo advice and never a
 * silent accept.
 *
 * Why refusal and not a quiet strip: there is no provider left to mount, so an
 * accepted `requires: ['reports']` would be a declared capability the runtime
 * does not deliver (Prime Directive #10). And why a prescription rather than
 * the generic unknown-token message: `reports` was a real token, so the author
 * (very often a model repeating an older example) did not misspell anything —
 * "check for a typo" would send them looking for a spelling that does not
 * exist. The `report` METADATA kind is a different thing and is untouched; the
 * last case pins that the prescription points at it.
 */

import { describe, expect, it } from 'vitest';
import {
  PLATFORM_CAPABILITY_PROVIDERS,
  PLATFORM_CAPABILITY_TOKENS,
  RETIRED_PLATFORM_CAPABILITY_GUIDANCE,
  classifyRequiredCapability,
  isKnownPlatformCapability,
} from './platform-capabilities';
import { defineStack } from '../stack.zod';
import { ERROR_CODE_LEDGER } from '../api/error-code-ledger.zod';

const manifest = {
  id: 'com.example.reportsretired',
  namespace: 'probe',
  version: '1.0.0',
  type: 'app' as const,
  name: 'reports-retired-probe',
};
const task = { name: 'probe_task', label: 'Task', fields: { title: { type: 'text' as const, label: 'Title' } } };

function refusalOf(requires: string[]): { code?: string; status?: number; message: string; issues?: readonly unknown[] } {
  try {
    defineStack({ manifest, objects: [task], requires } as never);
  } catch (err) {
    return err as { code?: string; status?: number; message: string; issues?: readonly unknown[] };
  }
  throw new Error(`defineStack accepted requires: ${JSON.stringify(requires)}`);
}

describe('[#20102] the `reports` capability token is retired', () => {
  it('is gone from the vocabulary and from the provider map', () => {
    expect(PLATFORM_CAPABILITY_TOKENS).not.toContain('reports');
    expect(isKnownPlatformCapability('reports')).toBe(false);
    expect(Object.keys(PLATFORM_CAPABILITY_PROVIDERS)).not.toContain('reports');
    // No provider row may still name the retired package either.
    expect(
      Object.values(PLATFORM_CAPABILITY_PROVIDERS).map((p) => p.package),
    ).not.toContain('@objectstack/plugin-reports');
  });

  it('classifies as `unknown` — no preflight offers to install a provider that no longer exists', () => {
    expect(classifyRequiredCapability('reports', () => true).status).toBe('unknown');
    expect(classifyRequiredCapability('reports', () => false).status).toBe('unknown');
  });

  it('the retired-token guidance is frozen and DISJOINT from the live vocabulary', () => {
    expect(Object.isFrozen(RETIRED_PLATFORM_CAPABILITY_GUIDANCE)).toBe(true);
    const retired = Object.keys(RETIRED_PLATFORM_CAPABILITY_GUIDANCE);
    expect(retired).toContain('reports');
    // A token both declared and retired would be accepted by the vocabulary
    // check and never reach its prescription.
    expect(retired.filter((t) => PLATFORM_CAPABILITY_TOKENS.includes(t))).toEqual([]);
  });

  it('defineStack REFUSES requires: [\'reports\'] in the ADR-0112 envelope, with the prescription', () => {
    const err = refusalOf(['reports']);
    expect(err.code).toBe('STACK_CAPABILITY_UNKNOWN');
    expect(err.status).toBe(422);
    // The envelope's code is a registered one — a refusal in an unregistered
    // code would be the "silent fourth state" the ledger exists to prevent.
    expect(Object.values(ERROR_CODE_LEDGER).flat()).toContain('STACK_CAPABILITY_UNKNOWN');
    // One issue per distinct token, and it IS the retirement prescription —
    // not the typo advice every other unknown token gets.
    expect(err.issues).toEqual([RETIRED_PLATFORM_CAPABILITY_GUIDANCE.reports]);
    expect(err.message).toContain(RETIRED_PLATFORM_CAPABILITY_GUIDANCE.reports);
    expect(err.message).not.toContain('check for a typo');
  });

  it('the prescription names the retirement, the fix and the replacement', () => {
    const text = RETIRED_PLATFORM_CAPABILITY_GUIDANCE.reports;
    // First sentence: what was removed, and in which release.
    expect(text.startsWith("requires: 'reports' was removed in @objectstack/spec ")).toBe(true);
    expect(text).toMatch(/Delete the token\./);
    // The replacement, both halves: `report` metadata for a report, a ListView
    // for a saved ad-hoc object query.
    expect(text).toContain('`report` metadata');
    expect(text).toContain('`ReportSchema`');
    expect(text).toContain('ListView');
  });

  it('a live token beside the retired one still passes — the refusal is about `reports` alone', () => {
    const err = refusalOf(['automation', 'reports', 'reports']);
    // Deduplicated to one finding, and `automation` contributes none.
    expect(err.issues).toEqual([RETIRED_PLATFORM_CAPABILITY_GUIDANCE.reports]);
    // …and the control: without the retired token the same stack is accepted.
    expect(() => defineStack({ manifest, objects: [task], requires: ['automation'] } as never)).not.toThrow();
  });

  it('an ordinary misspelling keeps the typo advice — the two messages stay distinct', () => {
    const err = refusalOf(['reportz']);
    expect(err.code).toBe('STACK_CAPABILITY_UNKNOWN');
    expect(err.message).toContain("'reportz' is not a known platform capability — check for a typo");
    expect(err.message).not.toContain('was removed in');
  });
});
