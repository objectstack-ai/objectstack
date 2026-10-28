/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Three public-block arms refuse the flat spelling of a row member whose spec
 * tombstone aged out at 18.2 (objectstack#25767, ADR-0087 one major on).
 *
 * Each public-block arm (`zod/public-blocks.zod.ts`) is `BaseSchema`
 * (`.passthrough()`) plus `flatPropRefusals` over its spec row, which refuses
 * a row member written flat on the node by name — and, for a member the row
 * RETIRED (a `z.never` tombstone), with the row's own retirement. Through spec
 * 18.1 `page:header`'s `icon`, `page:card`'s `actions` and `record:details`'s
 * `layout` were such tombstones. At 18.2 they aged out of the rows: the
 * strict row refuses `properties.KEY` as an unknown key naming the upgrade
 * guide, and the spec's page component refuses a flat one the same way, but
 * `flatPropRefusals` reads the row's key set and no longer sees the name — so
 * `BaseSchema` would KEEP a flat value in silence. Each arm now declares the
 * console's own refusal (`agedOutSpecKeyRefusal`, `zod/tombstone.zod.ts`).
 *
 * Pinned per key: the flat refusal (`invalid_type` at the key, naming the key,
 * the spec's guide sentence and the age-out); the bag refusal (the row's own
 * unknown-key verdict); and the control — the spec's `PageComponentSchema`
 * refuses the flat key as an unknown one at the node's root. No TypeScript
 * face restates these nodes (`zod-mirror-parity.test.ts` says so per arm).
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import { RETIRED_KEY_UPGRADE_GUIDE_SENTENCE } from '@objectstack/spec/shared';
import { PageComponentSchema as SpecPageComponentSchema } from '@objectstack/spec/ui';
import { PageCardBlockSchema, PageHeaderBlockSchema, RecordDetailsBlockSchema } from '../zod/public-blocks.zod.js';

type Issue = { code: string; path: PropertyKey[]; message: string };

interface Case {
  type: string;
  key: string;
  value: unknown;
  oui: z.ZodType;
  properties: Record<string, unknown>;
}

const CASES: Case[] = [
  { type: 'page:header', key: 'icon', value: 'star', oui: PageHeaderBlockSchema, properties: { title: 'Accounts' } },
  { type: 'page:card', key: 'actions', value: [], oui: PageCardBlockSchema, properties: {} },
  { type: 'record:details', key: 'layout', value: 'auto', oui: RecordDetailsBlockSchema, properties: {} },
];

describe.each(CASES)('$type `$key`: a row tombstone that aged out at 18.2 is refused flat by the arm itself (objectstack#25767)', ({ type, key, value, oui, properties }) => {
  const node = { type, properties };

  it('accept leg: the node without it parses on both faces', () => {
    expect(oui.safeParse(node).success).toBe(true);
    expect(SpecPageComponentSchema.safeParse(node).success).toBe(true);
  });

  it('the spec refuses it written flat as an unknown key at the node (the control)', () => {
    const r = SpecPageComponentSchema.safeParse({ ...node, [key]: value });
    expect(r.success, `the spec accepts a flat '${key}' again`).toBe(false);
    const root = r.success ? '' : (r.error.issues as readonly Issue[]).filter((i) => i.path.length === 0).map((i) => i.message).join('\n');
    expect(root).toMatch(new RegExp(`Unrecognized key\\(s\\) on this page component[^\\n]*\`${key}\``));
    expect(root).toContain('https://objectstack.ai/docs/protocol-upgrade');
  });

  it('the arm refuses it written flat, by name, instead of keeping it', () => {
    expect(Object.keys((oui as unknown as { shape: Record<string, unknown> }).shape)).toContain(key);
    const r = oui.safeParse({ ...node, [key]: value });
    expect(r.success, `the arm keeps a flat '${key}'`).toBe(false);
    const issue = r.success ? undefined : (r.error.issues as readonly Issue[]).find((i) => i.path.join('.') === key);
    expect(issue, `no issue at '${key}'`).toBeTruthy();
    expect(issue!.code).toBe('invalid_type');
    expect(issue!.message).toContain(`Unrecognized key(s) on this page component: \`${key}\``);
    expect(issue!.message).toContain(RETIRED_KEY_UPGRADE_GUIDE_SENTENCE);
    expect(issue!.message).toContain('objectstack#25767');
    expect(issue!.message).toContain(`\`properties.${key}\` is refused as an unknown key too`);
  });

  it('the arm refuses it in the `properties` bag with the row\'s own unknown-key verdict', () => {
    const r = oui.safeParse({ ...node, properties: { ...properties, [key]: value } });
    expect(r.success, `the bag keeps '${key}'`).toBe(false);
    const bag = r.success ? [] : (r.error.issues as readonly Issue[]).filter((i) => i.path.join('.') === 'properties');
    const message = bag.map((i) => i.message).join('\n');
    expect(bag.map((i) => i.code)).toContain('unrecognized_keys');
    expect(message).toMatch(new RegExp(`Unrecognized key\\(s\\) on this \`${type}\`[^\\n]*\`${key}\``));
    expect(message).toContain('https://objectstack.ai/docs/protocol-upgrade');
  });
});
