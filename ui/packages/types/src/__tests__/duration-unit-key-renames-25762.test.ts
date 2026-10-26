/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Rename pin — the nine duration keys whose unit lived only in their describe
 * now carry it in their NAME (objectstack#25762, maintainer decision E on the
 * objectui → objectstack merge, objectstack#25677).
 *
 * After the merge, `@objectstack/spec`'s `check:duration-unit-keys` judges these
 * mirrors too; it refuses a numeric key whose describe names a unit its key name
 * lacks. The renames follow objectstack's own (objectstack#15679 /
 * objectstack#15680): `…Ms` / `…Seconds`, the unit the describe already stated.
 * The instrument that re-derives the population is that gate, not this file —
 * the table below is the nine renames this card made, pinned so none of them
 * can silently come back under its old name.
 *
 * Each old spelling stays DECLARED as a `retirementTombstone` fed by
 * `durationKeyRenamedGuidance` (`zod/tombstone.zod.ts`): an authored value is
 * refused at the key's own path, by name, with a message that names the new
 * key, instead of riding `.passthrough()` unread. The TypeScript twin of each is
 * a `?: never` member, so a typed literal refuses it at the authoring site; the
 * `@ts-expect-error` lines below are checked by this package's `type-check`
 * (`tsconfig.test.json`), and a re-declared old key leaves a directive unused,
 * which fails `tsc`.
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import type { ActionSchema as ActionInterface } from '../crud';
import type { CarouselSchema as CarouselInterface, ChatbotSchema as ChatbotInterface } from '../complex';
import type { ToastSchema as ToastInterface } from '../feedback';
import type { HoverCardSchema as HoverCardInterface, TooltipSchema as TooltipInterface } from '../overlay';
import type { ReportComponentSchema as ReportInterface } from '../reports';
import {
  ActionSchema,
  CarouselSchema,
  ChatbotEnhancedSchema,
  ChatbotFloatingSchema,
  ChatbotSchema,
  HoverCardSchema,
  ReportComponentSchema,
  ToastSchema,
  TooltipSchema,
} from '../zod/index.zod.js';

interface RenameCase {
  /** The schema the key is a member of. */
  schema: z.ZodType;
  /** A document that parses green without either spelling — the lit control. */
  base: Record<string, unknown>;
  /** Path of the member, from the document root. */
  at: readonly string[];
  retired: string;
  renamed: string;
  unit: 'milliseconds' | 'seconds';
}

const node: Pick<HoverCardInterface, 'content' | 'trigger'> = {
  content: [{ type: 'text', content: 'x' }],
  trigger: [{ type: 'text', content: 'y' }],
};

const CASES: readonly RenameCase[] = [
  { schema: CarouselSchema, base: { type: 'carousel', items: [] }, at: [], retired: 'autoPlay', renamed: 'autoPlayMs', unit: 'milliseconds' },
  { schema: ChatbotSchema, base: { type: 'chatbot', messages: [] }, at: [], retired: 'autoResponseDelay', renamed: 'autoResponseDelayMs', unit: 'milliseconds' },
  { schema: ChatbotEnhancedSchema, base: { type: 'chatbot-enhanced', messages: [] }, at: [], retired: 'autoResponseDelay', renamed: 'autoResponseDelayMs', unit: 'milliseconds' },
  { schema: ChatbotFloatingSchema, base: { type: 'chatbot-floating', messages: [] }, at: [], retired: 'autoResponseDelay', renamed: 'autoResponseDelayMs', unit: 'milliseconds' },
  { schema: ActionSchema, base: { type: 'action', label: 'Go' }, at: [], retired: 'timeout', renamed: 'timeoutMs', unit: 'milliseconds' },
  { schema: ActionSchema, base: { type: 'action', label: 'Go', retry: { maxAttempts: 2 } }, at: ['retry'], retired: 'delay', renamed: 'delayMs', unit: 'milliseconds' },
  { schema: ToastSchema, base: { type: 'toast' }, at: [], retired: 'duration', renamed: 'durationMs', unit: 'milliseconds' },
  { schema: TooltipSchema, base: { type: 'tooltip', content: 'Hi' }, at: [], retired: 'delayDuration', renamed: 'delayDurationMs', unit: 'milliseconds' },
  { schema: HoverCardSchema, base: { type: 'hover-card', ...node }, at: [], retired: 'openDelay', renamed: 'openDelayMs', unit: 'milliseconds' },
  { schema: HoverCardSchema, base: { type: 'hover-card', ...node }, at: [], retired: 'closeDelay', renamed: 'closeDelayMs', unit: 'milliseconds' },
  { schema: ReportComponentSchema, base: { type: 'report' }, at: [], retired: 'refreshInterval', renamed: 'refreshIntervalSeconds', unit: 'seconds' },
];

/** `base` with `value` written at `at` + `key`, leaving `base` untouched. */
function withKey(base: Record<string, unknown>, at: readonly string[], key: string, value: unknown): Record<string, unknown> {
  if (at.length === 0) return { ...base, [key]: value };
  const [head, ...rest] = at;
  return { ...base, [head]: withKey((base[head] ?? {}) as Record<string, unknown>, rest, key, value) };
}

describe('the nine duration keys carry their unit in their name (objectstack#25762)', () => {
  it('covers nine distinct renames — the population the gate named on the merged tree', () => {
    expect(new Set(CASES.map((c) => `${c.retired}→${c.renamed}`)).size).toBe(9);
  });

  for (const c of CASES) {
    const label = `${String((c.base as { type: string }).type)} ${[...c.at, c.retired].join('.')} → ${c.renamed}`;

    it(`${label}: the base document parses, and the renamed key accepts a number`, () => {
      expect(c.schema.safeParse(c.base).success).toBe(true);
      expect(c.schema.safeParse(withKey(c.base, c.at, c.renamed, 250)).success).toBe(true);
    });

    it(`${label}: the renamed key still refuses a non-number`, () => {
      const result = c.schema.safeParse(withKey(c.base, c.at, c.renamed, '250'));
      expect(result.success).toBe(false);
      expect(result.error?.issues.map((i) => i.path.join('.'))).toEqual([[...c.at, c.renamed].join('.')]);
    });

    it(`${label}: the old spelling is refused by name, at its own path, naming the new key`, () => {
      const result = c.schema.safeParse(withKey(c.base, c.at, c.retired, 250));
      expect(result.success).toBe(false);
      const issues = result.error?.issues ?? [];
      expect(issues.map((i) => [i.path.join('.'), i.code])).toEqual([[[...c.at, c.retired].join('.'), 'invalid_type']]);
      expect(issues[0]?.message).toContain(`\`${c.retired}\` is now \`${c.renamed}\``);
      expect(issues[0]?.message).toContain(`the value (${c.unit}) is unchanged`);
    });
  }
});

/* ── TypeScript face ───────────────────────────────────────────────────────── */

describe('the TypeScript twins refuse the old spelling at the authoring site (objectstack#25762)', () => {
  it('the renamed key compiles on every twin; the old one is a compile error', () => {
    const carousel: CarouselInterface = { type: 'carousel', items: [], autoPlayMs: 3000 };
    // @ts-expect-error — `autoPlay` was renamed `autoPlayMs`.
    const carouselOld: CarouselInterface = { type: 'carousel', items: [], autoPlay: 3000 };

    const chatbot: ChatbotInterface = { type: 'chatbot', messages: [], autoResponseDelayMs: 0 };
    // @ts-expect-error — `autoResponseDelay` was renamed `autoResponseDelayMs`.
    const chatbotOld: ChatbotInterface = { type: 'chatbot', messages: [], autoResponseDelay: 0 };

    const action: ActionInterface = { type: 'action', label: 'Go', timeoutMs: 30_000, retry: { delayMs: 1000 } };
    // @ts-expect-error — `timeout` was renamed `timeoutMs`.
    const actionOld: ActionInterface = { type: 'action', label: 'Go', timeout: 30_000 };
    // @ts-expect-error — `retry.delay` was renamed `retry.delayMs`.
    const retryOld: ActionInterface = { type: 'action', label: 'Go', retry: { delay: 1000 } };

    const toast: ToastInterface = { type: 'toast', durationMs: 3000 };
    // @ts-expect-error — `duration` was renamed `durationMs`.
    const toastOld: ToastInterface = { type: 'toast', duration: 3000 };

    const tooltip: TooltipInterface = { type: 'tooltip', content: 'Hi', delayDurationMs: 200 };
    // @ts-expect-error — `delayDuration` was renamed `delayDurationMs`.
    const tooltipOld: TooltipInterface = { type: 'tooltip', content: 'Hi', delayDuration: 200 };

    const hoverCard: HoverCardInterface = { type: 'hover-card', ...node, openDelayMs: 200, closeDelayMs: 300 };
    // @ts-expect-error — `openDelay` was renamed `openDelayMs`.
    const openOld: HoverCardInterface = { type: 'hover-card', ...node, openDelay: 200 };
    // @ts-expect-error — `closeDelay` was renamed `closeDelayMs`.
    const closeOld: HoverCardInterface = { type: 'hover-card', ...node, closeDelay: 300 };

    const report: ReportInterface = { type: 'report', refreshIntervalSeconds: 300 };
    // @ts-expect-error — `refreshInterval` was renamed `refreshIntervalSeconds`.
    const reportOld: ReportInterface = { type: 'report', refreshInterval: 300 };

    // Runtime shape is unaffected by the type-level assertions above.
    expect([carousel, chatbot, action, toast, tooltip, hoverCard, report].map((n) => n.type)).toEqual([
      'carousel', 'chatbot', 'action', 'toast', 'tooltip', 'hover-card', 'report',
    ]);
    expect([carouselOld, chatbotOld, actionOld, retryOld, toastOld, tooltipOld, openOld, closeOld, reportOld]).toHaveLength(9);
  });
});
