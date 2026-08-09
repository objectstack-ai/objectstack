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
  'type', 'name', 'label', 'target', 'openIn', 'method', 'params', 'bodyExtra',
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
      bodyExtra: { resend: true },
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

/**
 * #5777 — the payload key. `params` carried two fact-contracts (an
 * `ActionParam[]` definition array in the spec, a static payload map in the
 * live objectui runner, discriminated by `Array.isArray`); the maintainer's
 * 2026-08-06 ruling took direction A, a SEPARATE key, and refused the
 * same-name union. `bodyExtra` is that key — already declared on `ActionSchema`
 * for `type:'api'` bodies, now picked onto the inline shape.
 */
describe('InlineActionSchema — `bodyExtra` is the payload key, `params` is not (#5777)', () => {
  it('accepts the showcase submit button verbatim, `{{page.<var>}}` tokens included', () => {
    // examples/app-showcase/src/ui/pages/contact-form.page.ts — the site the
    // #5068 gate reported. Values are template tokens, not literals: the
    // console action runtime resolves them via resolvePageVarTokens.
    const r = InlineActionSchema.safeParse({
      type: 'api',
      target: '/api/v1/forms/contact-us/submit',
      method: 'POST',
      bodyExtra: {
        name: '{{page.inquiryName}}',
        email: '{{page.inquiryEmail}}',
      },
      successMessage: 'Thanks! We received your inquiry.',
      refreshAfter: false,
    });
    expect(r.success, JSON.stringify((r as { error?: unknown }).error)).toBe(true);
    expect((r.data as { bodyExtra: Record<string, unknown> }).bodyExtra)
      .toEqual({ name: '{{page.inquiryName}}', email: '{{page.inquiryEmail}}' });
  });

  it('REFUSES the object form of `params`, and the refusal names `bodyExtra`', () => {
    // The rejection assertion is the envelope this surface HAS: a schema parse
    // reports a coded issue at a path, not an HTTP status (no route is involved
    // in a `.safeParse`). `toThrow()`-shaped "it failed somehow" would stay
    // green if the message regressed to the bare "expected array, received
    // object" an author cannot act on — which is the whole defect #5777 fixes.
    const r = InlineActionSchema.safeParse({
      type: 'api',
      target: '/api/v1/forms/contact-us/submit',
      params: { name: '{{page.inquiryName}}' },
    });
    expect(r.success).toBe(false);
    const issues = (r as { error: z.ZodError }).error.issues;
    const paramsIssue = issues.find(i => i.path.join('.') === 'params');
    expect(paramsIssue, JSON.stringify(issues)).toBeDefined();
    expect(paramsIssue!.code).toBe('invalid_type');
    expect((paramsIssue as unknown as { expected: string }).expected).toBe('array');
    expect(paramsIssue!.message).toContain('bodyExtra');
    expect(paramsIssue!.message).toContain('#5777');
    // And it says what `params` IS, not only what it is not.
    expect(paramsIssue!.message).toContain('DEFINITION array');
  });

  it('keeps the definition-array meaning of `params` intact', () => {
    const r = InlineActionSchema.safeParse({
      type: 'api',
      target: '/api/v1/sales_order/close',
      params: [{ name: 'reason', label: 'Reason', type: 'text' }],
      bodyExtra: { closed_by_ui: true },
    });
    expect(r.success, JSON.stringify((r as { error?: unknown }).error)).toBe(true);
    // Both keys coexist — they are different concepts, which is the ruling.
    const data = r.data as { params: unknown[]; bodyExtra: Record<string, unknown> };
    expect(Array.isArray(data.params)).toBe(true);
    expect(data.bodyExtra).toEqual({ closed_by_ui: true });
  });

  it('renames `payload` onto `bodyExtra` rather than accepting a third spelling', () => {
    // `payload: 'bodyExtra'` has been in the alias table since #5013. The pick
    // must not lose it — an alias that survives on ActionSchema and dies on the
    // inline shape is exactly the second-dialect drift this schema prevents.
    const r = InlineActionSchema.safeParse({ type: 'api', target: '/x', payload: { a: 1 } });
    expect(r.success).toBe(false);
    const issue = (r as { error: z.ZodError }).error.issues[0]!;
    expect(issue.code).toBe('unrecognized_keys');
    expect(issue.message).toContain('`payload` → `bodyExtra`');
  });

  it('leaves `body` unreachable — it is the script hook body, not a payload', () => {
    // Why the ruling's suggested name could not be taken: `body` is declared on
    // ActionSchema and #4352's refinement rejects it alongside any non-script
    // type. It is not picked here at all, so it is an unknown key inline.
    const shape = inlineObject().shape;
    expect(shape).not.toHaveProperty('body');
    const r = InlineActionSchema.safeParse({ type: 'api', target: '/x', body: { a: 1 } });
    expect(r.success).toBe(false);
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

  it('carries an api payload through to parse output (#5777, end to end)', () => {
    // The #5068 gate parses `properties` through this schema, so this is the
    // exact call whose `component-props-invalid` finding the showcase page
    // produced before the ruling.
    const r = ElementButtonPropsSchema.safeParse({
      label: 'Submit inquiry',
      variant: 'primary',
      action: {
        type: 'api',
        target: '/api/v1/forms/contact-us/submit',
        method: 'POST',
        bodyExtra: { name: '{{page.inquiryName}}' },
      },
    });
    expect(r.success, JSON.stringify((r as { error?: unknown }).error)).toBe(true);
    expect((r.data as { action: { bodyExtra: unknown } }).action.bodyExtra)
      .toEqual({ name: '{{page.inquiryName}}' });
  });

  it('still reports the object form of `params` as invalid, at the props path', () => {
    const r = ElementButtonPropsSchema.safeParse({
      label: 'Submit inquiry',
      action: { type: 'api', target: '/x', params: { name: '{{page.n}}' } },
    });
    expect(r.success).toBe(false);
    const issue = (r as { error: z.ZodError }).error.issues
      .find(i => i.path.join('.') === 'action.params');
    expect(issue, JSON.stringify((r as { error: z.ZodError }).error.issues)).toBeDefined();
    expect(issue!.code).toBe('invalid_type');
    expect(issue!.message).toContain('bodyExtra');
  });
});
