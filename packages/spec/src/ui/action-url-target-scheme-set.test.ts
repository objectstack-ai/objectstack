// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The closed scheme set of a `type: 'url'` action's `target`, pinned at both
 * url-action doors: {@link ActionSchema} (a registered action) and
 * {@link InlineActionSchema} (an inline action, which also takes the legacy
 * `type: 'navigation'` + `to` spelling and folds it onto `url` + `target`).
 *
 * The admitted set is the one the console's action runner opens at the click
 * (`navigation-target.ts` carries the grammar and says where the runner's half
 * lives): an `http://` or `https://` URL, a `mailto:` address, an in-app path
 * that starts with `/` or `./`, and a template that opens with `${`, which the
 * runner judges after interpolation. Ruling A+ on objectstack-ai/objectui#12191
 * decided it (spec half: #23010); the refusals state the rule, never the
 * ruling, its date or a tracker id.
 *
 * ## What the assertions assert
 *
 * Every refusal case pins the message's FIRST SENTENCE and the Zod issue path.
 * The first sentence is the reason the author acts on, and the path is where
 * the CLI and the metadata designer print it. Every refusal also names the
 * admitted set as the fix. Acceptance is pinned as hard as refusal: a set
 * written one character too tight is indistinguishable from a correct one until
 * an author's `mailto:` button stops parsing. The CONTROL is that `target` on
 * every other action type, which names a script, flow, page, endpoint or form,
 * is untouched.
 */

import { describe, it, expect } from 'vitest';

import { ActionSchema, InlineActionSchema } from './action.zod';
import { ElementButtonPropsSchema } from './component.zod';

const REGISTERED_SUBJECT = "A `type: 'url'` action's `target`";
const INLINE_SUBJECT = "An inline `type: 'url'` action's `target` (or its legacy spelling `to`)";

/** A ruling citation by date or by name: the refusals state the rule instead. */
const RULING_DATE = /\bruled\b|\bruling\b|\b20\d\d-\d\d-\d\d\b/i;
/** A tracker id an author cannot resolve. */
const TRACKER_ID = /(?<![#&])#\d{3,5}(?![0-9A-Za-z])/;

type Door = 'registered' | 'inline' | 'inline legacy `to`';
const DOORS: readonly Door[] = ['registered', 'inline', 'inline legacy `to`'];

function parse(door: Door, target: string, extra: Record<string, unknown> = {}) {
  switch (door) {
    case 'registered':
      return ActionSchema.safeParse({ name: 'open_target', label: 'Open', type: 'url', target, ...extra });
    case 'inline':
      return InlineActionSchema.safeParse({ type: 'url', target, ...extra });
    case 'inline legacy `to`':
      return InlineActionSchema.safeParse({ type: 'navigation', to: target, ...extra });
  }
}

const subjectOf = (door: Door) => (door === 'registered' ? REGISTERED_SUBJECT : INLINE_SUBJECT);

/** Parse through `door`, require a refusal, and return its issues. */
function refuse(door: Door, target: string) {
  const r = parse(door, target);
  expect(r.success, `expected REFUSAL of ${JSON.stringify(target)} at the ${door} door`).toBe(false);
  return r.error?.issues ?? [];
}

/** Parse through `door`, require acceptance, and return the parsed `target`. */
function accept(door: Door, target: string, extra: Record<string, unknown> = {}): unknown {
  const r = parse(door, target, extra);
  expect(r.success, `expected ACCEPTANCE of ${JSON.stringify(target)} at the ${door} door, got `
    + JSON.stringify(r.error?.issues ?? '')).toBe(true);
  return (r.data as { target?: unknown }).target;
}

/** The message's first sentence: everything up to the first `. ` outside a code span. */
function firstSentence(message: string): string {
  let inCode = false;
  for (let i = 0; i < message.length; i += 1) {
    if (message[i] === '`') inCode = !inCode;
    if (!inCode && message[i] === '.' && (message[i + 1] === ' ' || i === message.length - 1)) {
      return message.slice(0, i + 1);
    }
  }
  return message;
}

// ===========================================================================
// 1. Refusals: first sentence and path, on every door
// ===========================================================================

/** [label, target, first sentence after the subject]. */
const REFUSALS: ReadonlyArray<readonly [string, string, string]> = [
  ['javascript:', 'javascript:alert(1)', ' opens with `javascript:`, a scheme a url target never opens.'],
  ['data:', 'data:text/html,hi', ' opens with `data:`, a scheme a url target never opens.'],
  ['tel: (not admitted)', 'tel:+15551234', ' opens with `tel:`, a scheme a url target never opens.'],
  ['vbscript:', 'vbscript:x', ' opens with `vbscript:`, a scheme a url target never opens.'],
  ['ftp:', 'ftp://example.com/f', ' opens with `ftp:`, a scheme a url target never opens.'],
  ['a scheme spelled in capitals', 'JavaScript:alert(1)', ' opens with `JavaScript:`, a scheme a url target never opens.'],
  ['http: with no slashes', 'http:example.com', ' opens with `http:` but not `http://`.'],
  ['https: with one slash', 'https:/example.com', ' opens with `https:` but not `https://`.'],
  ['protocol-relative //host', '//evil.example/x', ' opens with `//`, which is protocol-relative, not an in-app path.'],
  ['/ then a backslash', '/\\evil.example/x', ' opens with `/` followed by a backslash, which the browser reads as `//`.'],
  ['a tab', '/\t/evil.example/x', ' must not contain a tab, line feed or carriage return.'],
  ['a tab hiding javascript:', 'java\tscript:alert(1)', ' must not contain a tab, line feed or carriage return.'],
  ['a line feed', '/a\nb', ' must not contain a tab, line feed or carriage return.'],
  ['a carriage return', 'https://example.com/\r', ' must not contain a tab, line feed or carriage return.'],
  ['a bare relative path', 'thanks', ' opens with neither an admitted scheme nor `/` or `./`.'],
  ['a parent-relative path', '../thanks', ' opens with neither an admitted scheme nor `/` or `./`.'],
  ['a query only', '?tab=2', ' opens with neither an admitted scheme nor `/` or `./`.'],
  ['a fragment only', '#top', ' opens with neither an admitted scheme nor `/` or `./`.'],
  ['a leading space', ' https://example.com', ' opens with neither an admitted scheme nor `/` or `./`.'],
];

describe("a `type: 'url'` target outside the admitted set is refused", () => {
  for (const door of DOORS) {
    it.each(REFUSALS)(`%s — refused at the ${door} door with its reason, at \`target\``, (_label, target, rest) => {
      const issues = refuse(door, target);
      expect(issues.map((i) => i.path), 'exactly one issue, reported at `target`').toEqual([['target']]);
      expect(issues[0].code).toBe('custom');
      expect(firstSentence(issues[0].message)).toBe(`${subjectOf(door)}${rest}`);
    });
  }

  it.each(REFUSALS)('%s — the refusal names the admitted set as the fix, and no ruling or tracker id', (_l, target) => {
    const [issue] = refuse('registered', target);
    const msg = issue.message;
    expect(msg, 'names the two web schemes and mailto:').toContain('`http://`, `https://` or `mailto:`');
    expect(msg, 'names the in-app path form').toContain('starts with `/` or `./`');
    expect(msg, 'prescribes a concrete in-app path').toContain('`/thanks`');
    expect(msg, 'states the rule, not its ruling').not.toMatch(RULING_DATE);
    expect(msg).not.toMatch(TRACKER_ID);
  });
});

// ===========================================================================
// 2. Acceptance: every admitted shape parses, unchanged, on every door
// ===========================================================================

const ACCEPTED: ReadonlyArray<readonly [string, string]> = [
  ['an https:// URL', 'https://example.com/docs?x=1'],
  ['an http:// URL', 'http://example.com/'],
  ['a scheme in capitals', 'HTTPS://EXAMPLE.COM/x'],
  ['a mailto: address', 'mailto:a@b.com'],
  ['mailto: in capitals', 'MAILTO:sales@example.com?subject=Hi'],
  ['a rooted in-app path', '/path'],
  ['the root itself', '/'],
  ['a ./ path', './path'],
  ['a ${ctx.X} template', '${ctx.url}'],
  ['a ${param.X} template with a tail', '${param.url}/details'],
  ['an origin template', '${ctx.origin}/apps/crm'],
  ['a path with an interpolated query', '/x?id=${param.id}'],
  ['a URL with an interpolated host part', 'https://example.com/${ctx.recordId}'],
  ['a mailto: with an interpolated address', 'mailto:${param.email}'],
  ['a later backslash inside a path', '/files/a\\b'],
];

describe("an admitted `type: 'url'` target parses unchanged", () => {
  for (const door of DOORS) {
    it.each(ACCEPTED)(`%s — accepted at the ${door} door`, (_label, target) => {
      expect(accept(door, target)).toBe(target);
    });
  }

  it('`openIn` is untouched: both members still parse beside an admitted target', () => {
    for (const openIn of ['self', 'new-tab']) {
      expect(accept('registered', 'https://example.com', { openIn })).toBe('https://example.com');
      expect(accept('inline', 'mailto:a@b.com', { openIn })).toBe('mailto:a@b.com');
    }
  });

  it('the legacy inline spelling still folds onto `url` + `target`', () => {
    const r = InlineActionSchema.safeParse({ type: 'navigation', to: '/pricing' });
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ type: 'url', target: '/pricing' });
    expect(r.data).not.toHaveProperty('to');
  });
});

// ===========================================================================
// 3. The runner's own pinned cases, answered the same at the door
// ===========================================================================

describe("the door answers the runner's pinned cases the same way", () => {
  // The cases objectui pins for `classifyNavigationTarget`
  // (`packages/core/src/actions/__tests__/navigationTarget.mailto-12191.test.ts`
  // at objectui 7578323). A literal target the runner opens must parse here,
  // and one it refuses must be refused here — a wider door publishes a target
  // that fails at the click, a narrower one refuses a target that works.
  it.each([
    'https://example.com/x', 'http://example.com/x', 'HTTPS://EXAMPLE.COM/x',
    'mailto:a@b.com', 'MAILTO:a@b.com', '/path', './path',
  ])('the runner opens %j, and the door accepts it', (target) => {
    expect(accept('registered', target)).toBe(target);
  });

  it.each([
    'javascript:alert(1)', 'data:text/html,hi', '//evil.example/x', 'tel:+1',
    '/\\evil.example/x', '/\t/evil.example/x', 'vbscript:x', 'ftp://example.com',
    'http:example.com', 'path',
  ])('the runner refuses %j, and the door refuses it', (target) => {
    expect(refuse('registered', target).map((i) => i.path)).toEqual([['target']]);
  });

  it('the runner refuses an empty target, and the door refuses it once, as a missing target', () => {
    for (const door of DOORS) {
      const issues = refuse(door, '');
      expect(issues.map((i) => i.path)).toEqual([['target']]);
      expect(issues[0].message).toMatch(/'target' is required when type is 'url'/);
    }
  });
});

// ===========================================================================
// 4. CONTROL: `target` on every other type is not a navigation target
// ===========================================================================

describe('CONTROL — `target` on a non-url action is untouched', () => {
  it.each(['script', 'flow', 'api', 'form', 'modal'] as const)(
    "type: '%s' accepts targets a url action refuses",
    (type) => {
      for (const target of ['javascript:alert(1)', 'tel:+1', '//cdn.example/x', 'thanks', 'approval_wizard']) {
        const registered = ActionSchema.safeParse({ name: 'run_it', label: 'Run', type, target });
        expect(registered.success, `${type} ${target}: ${JSON.stringify(registered.error?.issues)}`).toBe(true);
        const inline = InlineActionSchema.safeParse({ type, target });
        expect(inline.success, `inline ${type} ${target}: ${JSON.stringify(inline.error?.issues)}`).toBe(true);
      }
    },
  );

  it('a registered action that never wrote `type` defaults to script, not url', () => {
    const r = ActionSchema.safeParse({ name: 'run_it', label: 'Run', target: 'thanks' });
    expect(r.success).toBe(true);
    expect(r.data?.type).toBe('script');
  });
});

// ===========================================================================
// 5. The page door that carries an inline action inherits the refusal
// ===========================================================================

describe('`element:button` — its inline `action` is judged by the inline door', () => {
  it('refuses a javascript: target at `action.target`, and accepts a mailto: one', () => {
    const refused = ElementButtonPropsSchema.safeParse({
      label: 'Run', action: { type: 'url', target: 'javascript:alert(1)' },
    });
    expect(refused.success).toBe(false);
    const issue = (refused.error?.issues ?? []).find((i) => i.path.join('.') === 'action.target');
    expect(issue, JSON.stringify(refused.error?.issues)).toBeDefined();
    expect(firstSentence(issue!.message)).toBe(
      `${INLINE_SUBJECT} opens with \`javascript:\`, a scheme a url target never opens.`,
    );

    const accepted = ElementButtonPropsSchema.safeParse({
      label: 'Email us', action: { type: 'navigation', to: 'mailto:sales@example.com' },
    });
    expect(accepted.success, JSON.stringify(accepted.error?.issues)).toBe(true);
  });
});
