// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `InlineActionSchema` — the action shape a UI surface declares inline
 * (objectstack-ai/objectui#2997).
 *
 * Two things need pinning:
 *
 * 1. **It stays derived.** It is `.pick()`ed from the same field factory
 *    `ActionSchema` uses, so a field's `describe()` text, its vocabulary and the
 *    `target`-required rule cannot drift into a second dialect. A restated field
 *    list would fail silently — it keeps validating, just not the same thing.
 * 2. **The legacy spellings keep parsing, and stop being emitted.** cloud's
 *    tenant pages write `{ type: 'navigation', to: … }`, which no spec enum or
 *    schema ever declared. They must validate, and parse output must always be
 *    the canonical `url` + `target`.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  ActionSchema,
  InlineActionSchema,
  ActionType,
  normalizeInlineAction,
} from './action.zod';
import { ElementButtonPropsSchema } from './component.zod';

/** The fields an inline action admits, in the order they are picked. */
const INLINE_FIELDS = [
  'type', 'name', 'label', 'target', 'openIn', 'method', 'params',
  'confirmText', 'successMessage', 'errorMessage', 'refreshAfter', 'opensInNewTab',
] as const;

/** Reach the inner object through the preprocess → object → refine chain. */
function inlineObject(): z.ZodObject<Record<string, z.ZodTypeAny>> {
  // z.preprocess(fn, inner) is a pipe: `.out` is the refined object, whose
  // `.def.schema`… — walk defensively so a zod internals rename fails loudly
  // here rather than making the assertions vacuous.
  const pipe = InlineActionSchema as unknown as { def?: { out?: unknown } };
  let node = pipe.def?.out as { shape?: unknown; def?: { schema?: unknown } } | undefined;
  for (let i = 0; i < 6 && node && !node.shape; i++) {
    node = node.def?.schema as typeof node;
  }
  expect(node?.shape, 'could not reach the inline action object shape').toBeDefined();
  return node as unknown as z.ZodObject<Record<string, z.ZodTypeAny>>;
}

describe('InlineActionSchema is derived from ActionSchema, not restated', () => {
  it('admits exactly the documented field set', () => {
    expect(Object.keys(inlineObject().shape).sort()).toEqual([...INLINE_FIELDS].sort());
  });

  it('admits only fields ActionSchema itself declares', () => {
    // ActionSchema is z.object(…).refine(…), so its shape is not reachable
    // through the exported schema — parse a body carrying every inline field
    // instead. If ActionSchema dropped one, the round-trip would lose it.
    const body = {
      name: 'go_somewhere',
      label: 'Go',
      type: 'url' as const,
      target: '/environments',
      openIn: 'new-tab' as const,
      method: 'POST' as const,
      params: [],
      confirmText: 'Sure?',
      successMessage: 'Done',
      errorMessage: 'Failed',
      refreshAfter: true,
      opensInNewTab: true,
    };
    const parsed = ActionSchema.safeParse(body);
    expect(parsed.success, JSON.stringify((parsed as { error?: unknown }).error)).toBe(true);
    for (const key of INLINE_FIELDS) {
      expect(parsed.data, `ActionSchema dropped "${key}"`).toHaveProperty(key);
    }
  });

  it('excludes every registry-only concern', () => {
    const shape = inlineObject().shape;
    for (const key of ['objectName', 'locations', 'order', 'ai', 'requiredPermissions',
      'visible', 'disabled', 'resultDialog', 'body', 'icon', 'variant']) {
      expect(shape, `"${key}" should not be inline-authorable`).not.toHaveProperty(key);
    }
  });

  it('shares ActionType, so a new action type is inline-authorable for free', () => {
    for (const type of ActionType.options) {
      const needsTarget = type !== 'script';
      const body = needsTarget ? { type, target: '/x' } : { type, target: 'fn_name' };
      expect(InlineActionSchema.safeParse(body).success, `type "${type}" rejected`).toBe(true);
    }
  });
});

describe('InlineActionSchema — identity is optional, unlike a registered action', () => {
  it('parses without name or label', () => {
    const r = InlineActionSchema.safeParse({ type: 'url', target: '/environments' });
    expect(r.success, JSON.stringify((r as { error?: unknown }).error)).toBe(true);
  });

  it('is exactly what ActionSchema refuses — the two differ on purpose', () => {
    const body = { type: 'url', target: '/environments' };
    expect(InlineActionSchema.safeParse(body).success).toBe(true);
    const strict = ActionSchema.safeParse(body);
    expect(strict.success).toBe(false);
    expect((strict as { error: z.ZodError }).error.issues.map(i => i.path.join('.')).sort())
      .toEqual(['label', 'name']);
  });

  it('keeps the target-required rule it inherited', () => {
    for (const type of ['url', 'flow', 'modal', 'api', 'form']) {
      const r = InlineActionSchema.safeParse({ type });
      expect(r.success, `type "${type}" should require a target`).toBe(false);
      expect((r as { error: z.ZodError }).error.issues.some(i => i.path.join('.') === 'target')).toBe(true);
    }
  });
});

describe('normalizeInlineAction — the legacy spellings cloud actually writes', () => {
  it('folds the exact shape in cloud service-tenant pages', () => {
    // packages/service-tenant/src/pages/{pricing,welcome,billing-cancel,billing-success}
    const r = InlineActionSchema.safeParse({ type: 'navigation', to: '/environments' });
    expect(r.success, JSON.stringify((r as { error?: unknown }).error)).toBe(true);
    expect(r.data).toMatchObject({ type: 'url', target: '/environments' });
  });

  it('never emits the legacy spellings back out', () => {
    const out = InlineActionSchema.parse({ type: 'navigation', to: '/x' }) as Record<string, unknown>;
    expect(out.type).toBe('url');
    expect(out).not.toHaveProperty('to');
  });

  it('leaves an explicit target alone when `to` is also present', () => {
    const out = InlineActionSchema.parse({ type: 'url', target: '/wins', to: '/loses' }) as Record<string, unknown>;
    expect(out.target).toBe('/wins');
    expect(out).not.toHaveProperty('to');
  });

  it('passes a canonical body through untouched, by identity', () => {
    const canonical = { type: 'url', target: '/x' };
    expect(normalizeInlineAction(canonical)).toBe(canonical);
  });

  it('does not invent a type for a bare `to`', () => {
    // `to` alone still means "navigate", so the default `script` type must not
    // silently swallow it — the target-required rule has nothing to check, but
    // the fold must still move `to` onto `target` rather than dropping it.
    const out = normalizeInlineAction({ to: '/x' }) as Record<string, unknown>;
    expect(out.target).toBe('/x');
    expect(out).not.toHaveProperty('to');
    expect(out.type).toBeUndefined();
  });

  it('is a no-op on non-objects', () => {
    for (const v of [undefined, null, 'x', 7, [1, 2]]) {
      expect(normalizeInlineAction(v)).toBe(v);
    }
  });
});

describe('element:button declares its action', () => {
  it('no longer strips it from the parse output', () => {
    const r = ElementButtonPropsSchema.safeParse({
      label: 'Upgrade',
      action: { type: 'navigation', to: '/apps/cloud_control/sys_environment' },
    });
    expect(r.success, JSON.stringify((r as { error?: unknown }).error)).toBe(true);
    expect(r.data).toHaveProperty('action');
    expect((r.data as { action: Record<string, unknown> }).action)
      .toMatchObject({ type: 'url', target: '/apps/cloud_control/sys_environment' });
  });

  it('still renders inert without one — the prop is optional', () => {
    const r = ElementButtonPropsSchema.safeParse({ label: 'Static' });
    expect(r.success).toBe(true);
    expect(r.data).not.toHaveProperty('action');
  });

  it('rejects an action whose type is not dispatchable', () => {
    const r = ElementButtonPropsSchema.safeParse({
      label: 'Broken',
      action: { type: 'teleport', target: '/x' },
    });
    expect(r.success).toBe(false);
  });
});
