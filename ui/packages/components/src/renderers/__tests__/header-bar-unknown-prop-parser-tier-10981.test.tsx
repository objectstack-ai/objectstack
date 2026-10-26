/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The parser-tier half of the `header-bar` refusal clause, held on the live
 * registry (objectui#10981, the open question from objectui#10959).
 *
 * objectui#10959 corrected the `HeaderBarSchema` refusals of objectui#10387
 * (`title`, `logo`, `nav`, `left`, `center`, `right`, `sticky`, `height`) and
 * objectui#10286 (`variant`) to say that nothing warned at render, and that
 * "only the parser tier's `unknown-prop` warning noticed it". The pin for that
 * wording lives in `@object-ui/types`, which cannot import the parser, so it
 * holds the prose only. The parser-tier behaviour was measured once, on the
 * objectui#10959 pull request, and pinned nowhere: `validateTree`'s generic
 * undeclared-key branch answers it, and no parser pin names `header-bar`.
 *
 * This file holds that half where the registry lives. The manifest is built
 * the way `container-declaration-ratchet.test.tsx` builds it — every KNOWN
 * registry key, through `manifestFromConfigs` — so a registration that starts
 * declaring one of these keys as an input turns this red, and so does a change
 * to the parser that stops answering an undeclared key with `unknown-prop`.
 * Either one makes the published clause false, and this is where it shows.
 *
 * Both spellings are held: the bare `header-bar` and the namespaced
 * `ui:header-bar`. Every value shape the objectui#10387 / objectui#10286 pins
 * refuse is held too, because the answer depends only on the key being
 * undeclared, and a pin that tried one shape could not show that.
 */

import { describe, it, expect } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
import { manifestFromConfigs, validateTree } from '@object-ui/sdui-parser';
import type { Diagnostic, SchemaElement } from '@object-ui/sdui-parser';

// Module scope, not a hook: this import IS the registration (AGENTS.md
// §测试纪律 — an unbounded module load must not be billed to a bounded window).
import '../index';

/** Every live registry key, as `container-declaration-ratchet.test.tsx` builds it. */
const diagnose = (schema: unknown): Diagnostic[] => {
  const configs = ComponentRegistry.getKnownTypes().map((t) => {
    const meta = ComponentRegistry.getMeta(t);
    return { type: t, namespace: meta?.namespace, isContainer: meta?.isContainer, inputs: meta?.inputs };
  });
  const manifest = manifestFromConfigs(configs as unknown as Parameters<typeof manifestFromConfigs>[0]);
  return validateTree(schema as SchemaElement, manifest).diagnostics;
};

const TEXT = { type: 'text', content: 'x' };

/** The refused keys and the values their `@object-ui/types` pins refuse. */
const RETIRED: Record<string, unknown[]> = {
  title: ['My App'],
  logo: ['/logo.svg', TEXT, [TEXT]],
  nav: [[{ label: 'Docs', href: '/docs' }], []],
  left: [TEXT, [TEXT], 'plain text'],
  center: [TEXT, [TEXT], 'plain text'],
  right: [TEXT, [TEXT]],
  sticky: [true, false],
  height: ['64px', 64],
  variant: ['default', 'bordered', 'floating', 'transparent'],
};

const TYPES = ['header-bar', 'ui:header-bar'] as const;
const CRUMBS = [{ label: 'Home', href: '/' }];

describe('header-bar — the refused keys draw exactly the parser tier\'s `unknown-prop` (objectui#10981)', () => {
  it.each(TYPES)('`%s` is a live registration, and its control draws nothing', (type) => {
    expect(ComponentRegistry.getKnownTypes()).toContain(type);
    expect(diagnose({ type, crumbs: CRUMBS })).toEqual([]);
  });

  it.each(TYPES)('`%s` — every refused key, in every refused shape, draws one `unknown-prop` naming it', (type) => {
    const wrong: string[] = [];
    for (const [key, values] of Object.entries(RETIRED)) {
      for (const value of values) {
        const found = diagnose({ type, crumbs: CRUMBS, [key]: value });
        const one = found.length === 1 ? found[0] : undefined;
        if (one?.code !== 'unknown-prop' || !one.message.includes(`"${key}"`)) {
          wrong.push(`${key}=${JSON.stringify(value)} → ${JSON.stringify(found.map((d) => d.code))}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it.each(TYPES)('`%s` — lit control: the keys it does declare draw no `unknown-prop`', (type) => {
    const declared = (ComponentRegistry.getMeta(type)?.inputs ?? []).map((input) => input.name);
    expect(declared).toContain('crumbs');
    for (const key of Object.keys(RETIRED)) expect(declared).not.toContain(key);
    const found = diagnose({ type, crumbs: CRUMBS, rightContent: TEXT });
    expect(found.filter((d) => d.code === 'unknown-prop')).toEqual([]);
  });
});
