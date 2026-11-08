// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The one reading of "does `os serve` auto-inject the AI plugin for this
 * config" (#31411): `serve` decides what it loads with it, and the migrate
 * commands refuse with it.
 *
 *  - ⭐ `serve`'s decision is unchanged for every input: the predicate answers
 *    exactly what `serve`'s inline reading answered before it moved here (the
 *    oracle below is that reading, verbatim in shape);
 *  - the plugin `serve` counts as "already mounted" is read the same way;
 *  - ⭐ neither `serve.ts` nor `schema-migration-plugins.ts` keeps a copy of
 *    the rule: both call it.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AI_SERVICE_PACKAGE,
  AI_STUDIO_PACKAGE,
  describeAiAutoInjectRefusal,
  mountsAiServicePlugin,
  resolveAiServiceLoad,
} from './ai-service-auto-inject.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** `serve`'s inline reading before #31411: `requires`, the host's package.json, the `ai` tier. */
function serveBefore(declaredRequires: ReadonlySet<string>, tierOn: boolean, hostDeclares: (pkg: string) => boolean): string {
  const wantsAiService = hostDeclares('@objectstack/service-ai') || hostDeclares('@objectstack/service-ai-studio');
  const aiRequired = declaredRequires.has('ai') || declaredRequires.has('ai-studio');
  if (!tierOn) return 'off';
  if (aiRequired) return 'required';
  if (wantsAiService) return 'auto';
  return 'off';
}

describe('resolveAiServiceLoad — the AI auto-inject rule, read once', () => {
  it('⭐ answers what serve answered before, for every input', () => {
    const requiresCases = [[], ['ai'], ['ai-studio'], ['automation'], ['ai', 'automation']];
    const declaredCases: string[][] = [[], [AI_SERVICE_PACKAGE], [AI_STUDIO_PACKAGE], ['@objectstack/service-automation']];
    let cases = 0;
    for (const requires of requiresCases) {
      for (const tierOn of [true, false]) {
        for (const declared of declaredCases) {
          const declaredRequires = new Set(requires);
          const hostDeclares = (pkg: string): boolean => declared.includes(pkg);
          expect(
            resolveAiServiceLoad({ declaredRequires, aiTierEnabled: tierOn, hostDeclaresDependency: hostDeclares }),
            JSON.stringify({ requires, tierOn, declared }),
          ).toBe(serveBefore(declaredRequires, tierOn, hostDeclares));
          cases++;
        }
      }
    }
    expect(cases).toBe(40);
  });

  it('requires ai or ai-studio is required; a declared dependency alone is auto; the tier off is off', () => {
    const none = (): boolean => false;
    expect(resolveAiServiceLoad({ declaredRequires: new Set(['ai']), aiTierEnabled: true, hostDeclaresDependency: none })).toBe('required');
    expect(resolveAiServiceLoad({ declaredRequires: new Set(['ai-studio']), aiTierEnabled: true, hostDeclaresDependency: none })).toBe('required');
    expect(resolveAiServiceLoad({ declaredRequires: new Set(), aiTierEnabled: true, hostDeclaresDependency: (p) => p === AI_SERVICE_PACKAGE })).toBe('auto');
    expect(resolveAiServiceLoad({ declaredRequires: new Set(), aiTierEnabled: false, hostDeclaresDependency: (p) => p === AI_SERVICE_PACKAGE })).toBe('off');
    expect(resolveAiServiceLoad({ declaredRequires: new Set(), aiTierEnabled: true, hostDeclaresDependency: none })).toBe('off');
  });

  it('the mounted AI plugin is read by registered name or class name, as serve reads it', () => {
    class AIServicePlugin {}
    expect(mountsAiServicePlugin([{ name: 'com.objectstack.service-ai' }])).toBe(true);
    expect(mountsAiServicePlugin([new AIServicePlugin()])).toBe(true);
    expect(mountsAiServicePlugin([{ name: 'com.objectstack.service-ai-studio' }, null, undefined])).toBe(false);
    expect(mountsAiServicePlugin([])).toBe(false);
  });

  it('the refusal names its reason and the remedy', () => {
    expect(describeAiAutoInjectRefusal('required')).toMatch(/`requires` names `ai`/);
    expect(describeAiAutoInjectRefusal('auto')).toMatch(/package\.json declares @objectstack\/service-ai/);
    for (const load of ['required', 'auto'] as const) {
      expect(describeAiAutoInjectRefusal(load)).toMatch(/mount the AI plugin explicitly in the config/);
    }
  });
});

describe('no second copy of the rule', () => {
  const source = (rel: string): string => readFileSync(join(HERE, rel), 'utf8');

  it('⭐ serve.ts reads it through the shared predicate, and restates none of it', () => {
    const serve = source('../commands/serve.ts');
    expect(serve).toMatch(/resolveAiServiceLoad\(\{/);
    expect(serve).toMatch(/mountsAiServicePlugin\(plugins\)/);
    expect(serve).not.toMatch(/declaredRequires\.has\('ai'\)/);
    expect(serve).not.toMatch(/=== 'com\.objectstack\.service-ai'/);
    expect(serve).not.toMatch(/=== 'AIServicePlugin'/);
  });

  it('⭐ composeServedPlatform refuses through the same predicate', () => {
    const plugins = source('./schema-migration-plugins.ts');
    expect(plugins).toMatch(/resolveAiServiceLoad\(\{/);
    expect(plugins).toMatch(/mountsAiServicePlugin\(/);
    expect(plugins).not.toMatch(/\.has\('ai-studio'\)/);
  });
});
