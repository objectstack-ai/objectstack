// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23004] An empty state's one `link` — `{ label, url }` — pinned.
 *
 * The maintainer's "one plain sentence and one action" for an empty page,
 * contract first: {@link EmptyStateSchema} gains one optional link, a closed
 * shape refused at parse when malformed, whose `url` follows the grammar a
 * `type: 'url'` action's `target` follows (`navigation-target.ts`). A link
 * only: an empty state invokes no action.
 *
 * ## What the assertions assert
 *
 * - §1 every admitted target parses, byte-identical, beside both `label` forms.
 * - §2 every refusal class of the grammar is refused at `link.url`, with the
 *   class's first sentence after the link's own subject — the reason the
 *   author acts on, at the path the CLI and the designer print.
 * - §3 ONE GRAMMAR: on a corpus of admitted and refused targets, the link's
 *   verdict equals a registered `type: 'url'` action's, sentence for sentence
 *   once the subjects are set aside. A second predicate that agreed on the
 *   accept set and drifted on a reason reds here.
 * - §4 a malformed link — a missing member, an extra key, a non-object — is
 *   refused for the right reason, at the right path.
 * - §5 the author reaching for `action` / `button`, or writing the target flat,
 *   is pointed at the link (and, for an add-record wish, at `addRecord`).
 * - §6 the doors that carry the shape by reference answer what it answers.
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';

import { ActionSchema } from './action.zod';
import { ComponentPropsMap } from './component.zod';
import { EmptyStateSchema, ListViewSchema } from './view.zod';

const LINK_SUBJECT = "An empty-state link's `url`";
const ACTION_SUBJECT = "A `type: 'url'` action's `target`";

/** A ruling citation by date or by name: the refusals state the rule instead. */
const RULING_DATE = /\bruled\b|\bruling\b|\b20\d\d-\d\d-\d\d\b/i;
/** A tracker id an author cannot resolve. */
const TRACKER_ID = /(?<![#&])#\d{3,5}(?![0-9A-Za-z])/;

/** The issue codes and paths a refusal carries, so a refusal for the WRONG reason reds. */
function issues(result: z.ZodSafeParseResult<unknown>): { code: string; path: string }[] {
  if (result.success) return [];
  return result.error.issues.map((i) => ({ code: i.code, path: i.path.join('.') }));
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

function parseLink(url: unknown, label: unknown = 'How to connect a server') {
  return EmptyStateSchema.safeParse({ title: 'No servers yet', link: { label, url } });
}

// ===========================================================================
// §1 Acceptance
// ===========================================================================

describe('§1 an admitted link parses, byte-identical', () => {
  const ACCEPTED: ReadonlyArray<readonly [string, string]> = [
    ['a rooted in-app path', '/docs/connect-a-server'],
    ['the root itself', '/'],
    ['a ./ path', './how-to'],
    ['an https:// URL', 'https://docs.example.com/how-to?x=1#top'],
    ['an http:// URL', 'http://example.com/'],
    ['a scheme in capitals', 'HTTPS://EXAMPLE.COM/x'],
    ['a mailto: address', 'mailto:support@example.com?subject=Hi'],
    ['an origin template', '${ctx.origin}/docs'],
  ];

  it.each(ACCEPTED)('%s', (_label, url) => {
    const body = { title: 'No servers yet', message: 'Servers you connect appear here.', icon: 'server', link: { label: 'How to connect', url } };
    const r = EmptyStateSchema.safeParse(body);
    expect(issues(r)).toEqual([]);
    expect(r.success && r.data).toStrictEqual(body);
  });

  it('`label` takes an inline locale map, the I18nLabel form `title` takes', () => {
    const r = parseLink('/docs', { en: 'How to publish a package', 'zh-CN': '如何发布软件包' });
    expect(issues(r)).toEqual([]);
  });

  it('the link is optional: an empty state without one parses as before', () => {
    const body = { title: 'Nothing here', message: 'Rows appear here.', icon: 'inbox' };
    const r = EmptyStateSchema.safeParse(body);
    expect(issues(r)).toEqual([]);
    expect(r.success && r.data).toStrictEqual(body);
  });
});

// ===========================================================================
// §2 Refusal, one row per class of the grammar
// ===========================================================================

/** [label, url, first sentence after the subject]. */
const REFUSALS: ReadonlyArray<readonly [string, string, string]> = [
  ['javascript:', 'javascript:alert(1)', ' opens with `javascript:`, a scheme a url target never opens.'],
  ['data:', 'data:text/html,hi', ' opens with `data:`, a scheme a url target never opens.'],
  ['tel: (not admitted)', 'tel:+15551234', ' opens with `tel:`, a scheme a url target never opens.'],
  ['http: with no slashes', 'http:example.com', ' opens with `http:` but not `http://`.'],
  ['protocol-relative //host', '//evil.example/x', ' opens with `//`, which is protocol-relative, not an in-app path.'],
  ['/ then a backslash', '/\\evil.example/x', ' opens with `/` followed by a backslash, which the browser reads as `//`.'],
  ['a tab hiding javascript:', 'java\tscript:alert(1)', ' must not contain a tab, line feed or carriage return.'],
  ['a bare relative path', 'docs/connect', ' opens with neither an admitted scheme nor `/` or `./`.'],
  ['a leading space', ' https://example.com', ' opens with neither an admitted scheme nor `/` or `./`.'],
];

describe('§2 a target outside the admitted set is refused at `link.url`, with its reason', () => {
  it.each(REFUSALS)('%s', (_label, url, rest) => {
    const r = parseLink(url);
    expect(issues(r)).toEqual([{ code: 'custom', path: 'link.url' }]);
    const message = r.success ? '' : r.error.issues[0].message;
    expect(firstSentence(message)).toBe(`${LINK_SUBJECT}${rest}`);
    expect(message, 'names the admitted set as the fix').toContain('`http://`, `https://` or `mailto:`');
    expect(message).not.toMatch(RULING_DATE);
    expect(message).not.toMatch(TRACKER_ID);
  });

  it('an empty url is refused once, as empty, by `minLength`', () => {
    const r = parseLink('');
    expect(issues(r)).toEqual([{ code: 'too_small', path: 'link.url' }]);
    expect(firstSentence(r.success ? '' : r.error.issues[0].message)).toBe(`${LINK_SUBJECT} is empty.`);
  });
});

// ===========================================================================
// §3 One grammar: the link answers what a `type: 'url'` action answers
// ===========================================================================

describe("§3 the link's url and a url action's target are judged by one grammar", () => {
  const CORPUS = [
    '/', '/docs', './x', '${param.url}', 'https://a.example', 'http://a.example/x', 'MAILTO:a@b.co',
    'mailto:a@b.co', 'javascript:x', 'JavaScript:x', 'data:x', 'vbscript:x', 'ftp://a', 'tel:1',
    'https:/a', 'http:a', '//a', '/\\a', '/a\nb', 'a\rb', '/\t/a', 'x', '../x', '?q=1', '#f', ' /x',
    '/files/a\\b',
  ];

  it.each(CORPUS)('%j — same verdict, same reason', (target) => {
    const action = ActionSchema.safeParse({ name: 'open_it', label: 'Open', type: 'url', target });
    const link = parseLink(target);
    expect(link.success, `link verdict for ${JSON.stringify(target)}`).toBe(action.success);
    if (action.success || link.success) return;
    const actionMessage = action.error.issues.find((i) => i.path.join('.') === 'target')!.message;
    const linkMessage = link.error.issues.find((i) => i.path.join('.') === 'link.url')!.message;
    expect(linkMessage.slice(LINK_SUBJECT.length)).toBe(actionMessage.slice(ACTION_SUBJECT.length));
  });
});

// ===========================================================================
// §4 A malformed link
// ===========================================================================

describe('§4 a malformed link is refused for the right reason, at the right path', () => {
  const REFUSED: ReadonlyArray<readonly [label: string, link: unknown, expected: { code: string; path: string }[]]> = [
    ['a link with no label', { url: '/docs' }, [{ code: 'invalid_union', path: 'link.label' }]],
    ['a link with no url', { label: 'Docs' }, [{ code: 'invalid_type', path: 'link.url' }]],
    ['a numeric url', { label: 'Docs', url: 42 }, [{ code: 'invalid_type', path: 'link.url' }]],
    ['an extra key', { label: 'Docs', url: '/docs', openIn: 'new-tab' }, [{ code: 'unrecognized_keys', path: 'link' }]],
    ['an action on the link', { label: 'Add', url: '/docs', action: 'create_record' }, [{ code: 'unrecognized_keys', path: 'link' }]],
    ['a bare-string link', '/docs', [{ code: 'invalid_type', path: 'link' }]],
    ['two links', [{ label: 'A', url: '/a' }, { label: 'B', url: '/b' }], [{ code: 'invalid_type', path: 'link' }]],
  ];

  it.each(REFUSED)('%s', (_label, link, expected) => {
    const r = EmptyStateSchema.safeParse({ title: 'None', link });
    expect(issues(r)).toEqual(expected);
  });

  it('`href` on the link is answered with `url`', () => {
    const r = EmptyStateSchema.safeParse({ link: { label: 'Docs', href: '/docs' } });
    expect(r.success).toBe(false);
    const unknown = r.success ? undefined : r.error.issues.find((i) => i.code === 'unrecognized_keys');
    expect(unknown?.message).toContain('`href` → `url`');
  });
});

// ===========================================================================
// §5 Guidance
// ===========================================================================

describe('§5 an author reaching for a call to action is pointed at the link', () => {
  function refusalOf(body: Record<string, unknown>): string {
    const r = EmptyStateSchema.safeParse(body);
    expect(r.success).toBe(false);
    expect(issues(r)).toEqual([{ code: 'unrecognized_keys', path: '' }]);
    return r.success ? '' : r.error.issues[0].message;
  }

  it.each(['action', 'button'])('`%s` names `link`, says it runs nothing, and keeps the `addRecord` pointer', (key) => {
    const message = refusalOf({ title: 'None', [key]: { label: 'Add' } });
    expect(message).toContain('`link` — `{ label, url }`');
    expect(message).toContain('It runs no action, flow or script.');
    expect(message).toContain('`addRecord`');
    expect(message).not.toMatch(TRACKER_ID);
  });

  it.each(['url', 'href'])('a flat `%s` is pointed into the `link` block', (key) => {
    const message = refusalOf({ title: 'None', [key]: '/docs' });
    expect(message).toContain('`link: { label, url }`');
  });
});

// ===========================================================================
// §6 The doors that carry the shape
// ===========================================================================

describe('§6 every door that carries EmptyStateSchema answers the link as it does', () => {
  const DOORS = [
    ['list view', (emptyState: unknown) => ListViewSchema.safeParse({ columns: ['name'], emptyState })],
    ['object-grid page block', (emptyState: unknown) => ComponentPropsMap['object-grid'].safeParse({ objectName: 'account', emptyState })],
  ] as const;

  const CORPUS: unknown[] = [
    { link: { label: 'Docs', url: '/docs' } },
    { link: { label: 'Docs', url: 'javascript:alert(1)' } },
    { link: { label: 'Docs', url: '' } },
    { link: { url: '/docs' } },
    { link: { label: 'Docs', url: '/docs', extra: 1 } },
  ];

  for (const [door, parse] of DOORS) {
    it(`${door}: same success, codes and paths, one level down`, () => {
      for (const emptyState of CORPUS) {
        const direct = issues(EmptyStateSchema.safeParse(emptyState)).map(({ code, path }) => ({
          code,
          path: path ? `emptyState.${path}` : 'emptyState',
        }));
        expect(issues(parse(emptyState)), JSON.stringify(emptyState)).toEqual(direct);
      }
    });
  }
});
