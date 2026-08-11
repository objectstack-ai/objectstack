// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7496 — the ruled shape of `FormView.submitBehavior: { kind: 'redirect' }`'s
 * `url`, pinned at the schema door.
 *
 * ## Why this file exists at all
 *
 * objectui's `FormPage` redirects **verbatim** on this value, and objectui#4190
 * dead-ended asking what the value may be: `url` was an unconstrained
 * `z.string()`, so `https://example.com`, `javascript:alert(1)` and
 * `//evil.example` all parsed, and the consumer had no contract to harden
 * against. The maintainer ruled the narrowest shape on 2026-08-11 —
 * relative-only, interpolation only from declared record fields, every
 * interpolated value URL-escaped, verbatim redirect on the resolved path — and
 * this file is where the spec side of that ruling is measurable.
 *
 * ## What the assertions assert, and why it is the MESSAGE
 *
 * Every refusal case checks the guidance an author reads, not merely that the
 * parse failed. The reason is the same one the rejection-envelope rule states
 * in the other direction: a bare `expect(success).toBe(false)` carries one bit,
 * and this change has two — *that* a bad URL is refused, and *what the author
 * is told to write instead*. The prescriptions are the whole product for an
 * AI-authored metadata app: an agent that gets "Invalid input" retries the same
 * absolute URL, while one that gets "write the in-app path, `/thanks`" fixes it
 * on the next token. So each case pins the rule it names AND the ruling date,
 * which is what makes the refusal traceable back to the decision.
 *
 * ## Acceptance is pinned as hard as refusal
 *
 * A relative-only rule written slightly too tight is indistinguishable, from
 * the outside, from one written correctly — until an author's legitimate
 * `/thanks?ref={{record.id}}` stops parsing. The accepted shapes below are
 * therefore not decoration: they are the half that says this refine narrowed
 * the surface exactly as far as the ruling and no further.
 */

import { describe, it, expect } from 'vitest';

import { FormViewSchema } from './view.zod';

/** Reject `value` through `schema` and return its issues as a searchable string. */
function reject(value: unknown): string {
  const r = FormViewSchema.safeParse(value);
  expect(r.success, `expected REJECTION, got a successful parse of ${JSON.stringify(value)}`).toBe(false);
  return JSON.stringify(r.error?.issues ?? []);
}

/** Parse `value` and fail loudly (with the issues) if it does not succeed. */
function accept(value: unknown): unknown {
  const r = FormViewSchema.safeParse(value);
  expect(r.success, `expected ACCEPTANCE, got ${JSON.stringify(r.error?.issues ?? '')}`).toBe(true);
  return r.data;
}

const FORM_BASE = { type: 'simple', sections: [{ fields: ['name'] }] };

/** A FormView whose submit behavior redirects to `url`. */
const redirectTo = (url: unknown) => ({ ...FORM_BASE, submitBehavior: { kind: 'redirect', url } });

// ===========================================================================
// 1. The door — the refine has to be reachable, or none of the rest counts
// ===========================================================================
describe('#7496 — the door', () => {
  it('the redirect arm still parses at all (the control)', () => {
    const parsed = accept(redirectTo('/thanks')) as { submitBehavior?: { url?: string } };
    expect(parsed.submitBehavior?.url).toBe('/thanks');
  });

  it('the refine reports at `submitBehavior.url`, not at the union root', () => {
    // Path matters as much as message: the CLI and the metadata designer both
    // print the issue at its path, and an issue parked on `submitBehavior`
    // sends the author looking at `kind`. The arm is still discriminated on
    // `kind` (#5014), so exactly one member reports.
    const r = FormViewSchema.safeParse(redirectTo('https://example.com/thanks'));
    expect(r.success).toBe(false);
    const issues = r.error?.issues ?? [];
    expect(issues.map((i) => i.path)).toEqual([['submitBehavior', 'url']]);
    expect(issues.map((i) => i.code)).toEqual(['custom']);
  });

  it('a non-string `url` is still a type error, not a shape refusal', () => {
    // The refine runs on strings only; the type gate must stay in front of it
    // or a number would reach `checkSubmitRedirectUrl` and be reported as a
    // relative-path problem.
    const msg = reject(redirectTo(42));
    expect(msg).toContain('invalid_type');
  });
});

// ===========================================================================
// 2. Ruled bullet 1 — relative paths only (the open-redirect face)
// ===========================================================================
describe('#7496 bullet 1 — relative paths only', () => {
  it.each([
    ['https', 'https://example.com/thanks'],
    ['http', 'http://example.com/thanks'],
    ['uppercase scheme', 'HTTPS://example.com/thanks'],
    ['javascript', 'javascript:alert(1)'],
    ['data', 'data:text/html,hi'],
    ['mailto', 'mailto:sales@example.com'],
    ['scheme-only', 'app-custom:whatever'],
  ])('refuses an absolute URL (%s) and names the rule + the ruling', (_label, url) => {
    const msg = reject(redirectTo(url));
    expect(msg, 'names the rule').toContain('RELATIVE path only');
    expect(msg, 'names the reason the rule exists').toContain('open');
    expect(msg, 'cites the ruling so the refusal is traceable').toContain('ruled 2026-08-11 on #7496');
    expect(msg, 'prescribes the fix, not just the refusal').toContain('/thanks');
    expect(msg, 'points the deliberate external link at the surface that IS declared for it')
      .toContain('navigation item');
  });

  it('refuses a protocol-relative `//host` — the one that LOOKS relative', () => {
    // The nastiest of the set: it starts with a slash, so every naive
    // `startsWith('/')` check passes it, and the browser still leaves the
    // origin. The message has to say that out loud or the author reads the
    // refusal as a false positive.
    const msg = reject(redirectTo('//evil.example/thanks'));
    expect(msg).toContain('protocol-relative');
    expect(msg).toContain('ANOTHER ORIGIN');
    expect(msg).toContain('ruled 2026-08-11 on #7496');
  });

  it.each([
    ['leading backslash pair', '\\\\evil.example/thanks'],
    ['slash-backslash', '/\\evil.example/thanks'],
    ['backslash mid-path', '/thanks\\evil'],
  ])('refuses a backslash (%s) — browsers normalise it to `/`', (_label, url) => {
    const msg = reject(redirectTo(url));
    expect(msg).toContain('must not contain a backslash');
    expect(msg, 'says WHY a backslash is an origin problem, not a style problem')
      .toContain('normalise');
    expect(msg, 'gives the escape for a legitimate backslash').toContain('%5C');
    expect(msg).toContain('ruled 2026-08-11 on #7496');
  });

  it.each([
    ['leading space', ' //evil.example'],
    // No backslash in these — the backslash rule fires first and is its own
    // case above, so a fixture carrying both would pin the wrong refusal.
    ['leading tab', '\t//evil.example'],
    ['leading newline', '\n//evil.example'],
    ['embedded NUL', '/thanks\u0000'],
    ['embedded DEL', '/thanks\u007f'],
  ])('refuses smuggled whitespace/controls (%s)', (_label, url) => {
    const msg = reject(redirectTo(url));
    expect(msg).toContain('whitespace or control characters');
    expect(msg, 'says why stripping is the hazard').toContain('strip');
    expect(msg, 'gives the escape for a legitimate space').toContain('%20');
    expect(msg).toContain('ruled 2026-08-11 on #7496');
  });

  it('refuses a document-relative path and explains what it resolves against', () => {
    // `thanks` is *a* relative path, so this refusal is the one an author is
    // most likely to read as pedantry. The message earns it by naming the
    // failure mode: the same form lands somewhere different per entry route.
    const msg = reject(redirectTo('thanks'));
    expect(msg).toContain('must start with `/`');
    expect(msg).toContain('document-relative');
    expect(msg).toContain('ruled 2026-08-11 on #7496');
  });

  it.each([
    ['./thanks', './thanks'],
    ['../thanks', '../thanks'],
  ])('refuses an explicitly document-relative `%s` too', (_label, url) => {
    expect(reject(redirectTo(url))).toContain('must start with `/`');
  });

  it('refuses an empty `url` — a redirect with no destination', () => {
    // `z.string()` accepted `''` before this change and the renderer would have
    // assigned an empty location. Pinned as its own case because the generic
    // leading-slash message would be a confusing thing to read for it.
    const msg = reject(redirectTo(''));
    expect(msg).toContain('needs a `url`');
    expect(msg).toContain('ruled 2026-08-11 on #7496');
  });
});

// ===========================================================================
// 3. Ruled bullet 2 — interpolation only from declared record fields
// ===========================================================================
describe('#7496 bullet 2 — `{{record.<field>}}` and nothing else', () => {
  it.each([
    ['in a path segment', '/records/{{record.id}}'],
    ['in a query value', '/thanks?ref={{record.public_ref}}'],
    ['more than one', '/t/{{record.tenant_slug}}/r/{{record.id}}'],
    ['underscore-leading field', '/t/{{record._internal_ref}}'],
  ])('accepts a declared-field token %s', (_label, url) => {
    const parsed = accept(redirectTo(url)) as { submitBehavior?: { url?: string } };
    expect(parsed.submitBehavior?.url, 'the token survives to the consumer verbatim (bullet 3)')
      .toBe(url);
  });

  it.each([
    ['another scope', '/thanks?u={{os.user.id}}'],
    ['the page scope', '/thanks?u={{page.inquiryName}}'],
    ['a bare variable', '/thanks?u={{id}}'],
    ['a nested field path', '/thanks?o={{record.owner.name}}'],
    ['an uppercase field', '/thanks?o={{record.ownerName}}'],
    ['single-brace flow syntax', '/thanks?u={record.id}'],
    ['a context token', '/thanks?u={current_user_id}'],
    ['an unclosed token', '/thanks?u={{record.id}'],
    ['a stray brace', '/thanks}'],
  ])('refuses %s and prescribes the one spelling that works', (_label, url) => {
    const msg = reject(redirectTo(url));
    expect(msg, 'names the vocabulary').toContain('ONLY declared record fields');
    expect(msg, 'gives the spelling verbatim').toContain('{{record.field_name}}');
    expect(msg).toContain('ruled 2026-08-11 on #7496');
  });

  it('the refusal states the URL-escaping half of the ruling', () => {
    // Bullet 2 is two clauses, and the second one changes what an author may
    // expect a token to DO: an escaped value cannot introduce path structure,
    // so `{{record.slug}}` can never smuggle a `../` or a second origin in.
    // An author who does not read that will file the escaping as a bug.
    const msg = reject(redirectTo('/thanks?u={{os.user.id}}'));
    expect(msg).toContain('URL-escaped');
    expect(msg).toContain('never a way to add path structure');
  });

  it('a token cannot open the path — the relative rule is not token-exempt', () => {
    // Otherwise `{{record.redirect_target}}` would be a field-shaped hole
    // straight back to the absolute URL this ruling refuses, decided by row
    // data rather than by the author.
    expect(reject(redirectTo('{{record.slug}}/thanks'))).toContain('must start with `/`');
  });
});

// ===========================================================================
// 4. Ruled bullet 3 — verbatim redirect on the resolved relative path
// ===========================================================================
describe('#7496 bullet 3 — the value reaches the consumer unchanged', () => {
  it.each([
    ['a plain path', '/thanks'],
    ['a nested path', '/console/records/crm_lead'],
    ['a query string', '/thanks?ref=web&campaign=spring'],
    ['a fragment', '/thanks#receipt'],
    ['a trailing slash', '/thanks/'],
    ['a percent-encoded segment', '/thanks/%20spaced'],
    ['the bare root', '/'],
  ])('accepts %s and parses it to the same string', (_label, url) => {
    const parsed = accept(redirectTo(url)) as { submitBehavior?: { url?: string } };
    expect(parsed.submitBehavior?.url).toBe(url);
  });

  it('`url` stays a plain string — no Expression envelope reaches the renderer', () => {
    // The consumption ruled in is a VERBATIM redirect, so wrapping this key in
    // the template-Expression envelope (which is what a `{{ }}` dialect field
    // normally gets) would break `FormPage`'s read. Pinned so a later "make it
    // a real template field" refactor has to argue with the ruling first.
    const parsed = accept(redirectTo('/records/{{record.id}}')) as { submitBehavior?: { url?: unknown } };
    expect(typeof parsed.submitBehavior?.url).toBe('string');
  });

  it('`delayMs` is untouched by the ruling', () => {
    const parsed = accept({ ...FORM_BASE, submitBehavior: { kind: 'redirect', url: '/thanks', delayMs: 500 } }) as {
      submitBehavior?: { delayMs?: number };
    };
    expect(parsed.submitBehavior?.delayMs).toBe(500);
  });
});

// ===========================================================================
// 5. Cross-face — the sibling arms and the alias curation still behave
// ===========================================================================
describe('#7496 — the neighbours the refine must not disturb', () => {
  it.each([
    ['thank-you', { kind: 'thank-you', title: 'Thanks' }],
    ['continue', { kind: 'continue' }],
    ['next-record', { kind: 'next-record' }],
  ])('the `%s` arm carries no url and is unaffected', (_kind, submitBehavior) => {
    accept({ ...FORM_BASE, submitBehavior });
  });

  it('the `to`/`href`/`target` aliases still point at `url` (批 18 curation)', () => {
    // These are unknown-key prescriptions on the same arm. A refine that made
    // the arm report differently would silently cost them, and an author who
    // wrote `href` would be told nothing useful.
    for (const alias of ['to', 'href', 'target']) {
      expect(reject({ ...FORM_BASE, submitBehavior: { kind: 'redirect', url: '/x', [alias]: '/y' } }))
        .toContain(`\`${alias}\` → \`url\``);
    }
  });

  it('a bad url and an unknown key are reported TOGETHER, not one instead of the other', () => {
    // Zod reports the shape issue and the strict-object issue in one pass, so
    // an author fixing an absolute URL does not then discover a second round of
    // `delay` → `delayMs`. Worth pinning: it is the difference between one edit
    // and two for the author most likely to hit both at once.
    const msg = reject({ ...FORM_BASE, submitBehavior: { kind: 'redirect', url: 'https://example.com', delay: 1 } });
    expect(msg).toContain('RELATIVE path only');
    expect(msg).toContain('`delay` → `delayMs`');
  });
});
