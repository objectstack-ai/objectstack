// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #17556 — an application contributes its own first-run credentials
 * (`devHint` / `devLogins[]`) to the development boot banner.
 *
 * ## The accept-set delta this file measures
 *
 * The top-level stack door has been strict since #8687: an unknown key is an
 * `unrecognized_keys` refusal, not a silent strip. So before this change BOTH
 * spellings were REFUSED by `ObjectStackDefinitionSchema` — the capability did
 * not exist in any partial form, measured on `origin/main` where `devLogins`
 * and `devHint` printed zero hits across the tree (lit control: the boot-banner
 * grep hit real files; dark control: an impossible name hit none).
 *
 * The delta is therefore exactly: `devHint` (a string) and `devLogins` (an
 * array of `{ label?, email, password? }`) are now WRITABLE at the top level of
 * a stack definition, and nothing else moved. The last `describe` below is the
 * control that keeps that "nothing else" honest — a neighbouring undeclared key
 * must still refuse, or the reading would be "the door opened", not "two keys
 * were declared".
 *
 * ## Why the rejections assert `code` + `path`, never `toThrow()`
 *
 * A bare throw assertion passes on an unrelated failure. Each refusal here
 * names the Zod issue code and the path it is raised at, so a rule that starts
 * refusing for a different reason — or at a different key — reddens instead of
 * staying green on the wrong evidence.
 */

import { describe, it, expect } from 'vitest';

import {
  ObjectStackDefinitionSchema,
  DevLoginSchema,
  defineStack,
  composeStacks,
  COMPOSE_KEY_DISPOSITIONS,
  STACK_DEFINITION_KEYS,
} from './stack.zod';

const manifest = {
  id: 'com.example.hiring',
  name: 'hiring',
  version: '1.0.0',
  type: 'app' as const,
  namespace: 'hiring',
};

/** A legal stack, minus whatever the case under test adds. */
const base = () => ({
  manifest,
  objects: [{ name: 'hiring_role', label: 'Role', fields: { title: { type: 'text', label: 'Title' } } }],
});

const parse = (raw: Record<string, unknown>) => ObjectStackDefinitionSchema.safeParse(raw);

/** The `unrecognized_keys` issue of a failed parse, with its path — or undefined. */
const unrecognized = (verdict: ReturnType<typeof parse>) => {
  if (verdict.success) return undefined;
  const issue = verdict.error.issues.find((i) => i.code === 'unrecognized_keys');
  return issue ? { path: issue.path.map(String), keys: (issue as unknown as { keys: string[] }).keys } : undefined;
};

/** Every issue of a failed parse as `code @ path`, for attributable assertions. */
const issuesOf = (verdict: ReturnType<typeof parse>): string[] =>
  verdict.success ? [] : verdict.error.issues.map((i) => `${i.code} @ ${i.path.map(String).join('.')}`);

// ─── GREEN — what is writable now, and was not before ───────────────

describe('#17556 accept — an application may declare its own first-run credentials', () => {
  it('accepts a full `devLogins` entry and carries every field through the parse', () => {
    const verdict = parse({
      ...base(),
      devLogins: [
        { label: 'Hiring admin', email: 'admin@quillstone.example', password: 'demo1234' },
        { label: 'Job seeker', email: 'candidate01@mail.example', password: 'demo1234' },
      ],
    });

    expect(issuesOf(verdict)).toEqual([]);
    expect(verdict.success).toBe(true);
    if (!verdict.success) return;
    // Parsed, not merely tolerated: a strip-mode accept would also report
    // success, so the VALUE is what proves the key reached the other side.
    expect(verdict.data.devLogins).toEqual([
      { label: 'Hiring admin', email: 'admin@quillstone.example', password: 'demo1234' },
      { label: 'Job seeker', email: 'candidate01@mail.example', password: 'demo1234' },
    ]);
  });

  it('accepts an entry with only an address — a deployment that signs in another way', () => {
    const verdict = parse({ ...base(), devLogins: [{ email: 'sso-user@quillstone.example' }] });
    expect(issuesOf(verdict)).toEqual([]);
    expect(verdict.success && verdict.data.devLogins).toEqual([{ email: 'sso-user@quillstone.example' }]);
  });

  it('accepts `devHint` as free-form text', () => {
    const verdict = parse({ ...base(), devHint: 'run `pnpm seed:demo` first, then sign in as one of the accounts above' });
    expect(issuesOf(verdict)).toEqual([]);
    expect(verdict.success && verdict.data.devHint).toBe('run `pnpm seed:demo` first, then sign in as one of the accounts above');
  });

  it('survives `defineStack`, the authoring path every documented source goes through', () => {
    // The #8687 defect was a key that parsed green and was then stripped before
    // anything could read it. `defineStack` is where that happened, so the
    // round-trip through it is the reading that matters to an author.
    const stack = defineStack({ ...base(), devHint: 'sign in as the Hiring admin', devLogins: [{ email: 'a@b.example' }] });
    expect(stack.devHint).toBe('sign in as the Hiring admin');
    expect(stack.devLogins).toEqual([{ email: 'a@b.example' }]);
  });
});

// ─── RED — the entry is strict from birth, and says so usefully ─────

describe('#17556 refuse — a `devLogins` entry is closed against unknown keys', () => {
  it('refuses an undeclared key inside an entry, at the entry`s path', () => {
    const verdict = parse({ ...base(), devLogins: [{ email: 'a@b.example', totallyBogus: 1 }] });
    expect(verdict.success).toBe(false);
    expect(unrecognized(verdict)).toEqual({ path: ['devLogins', '0'], keys: ['totallyBogus'] });
  });

  it('sends `username` to `email` and `note` to `label` — the curated aliases, not a distance guess', () => {
    const verdict = DevLoginSchema.safeParse({ username: 'a@b.example', note: 'Hiring admin' });
    expect(verdict.success).toBe(false);
    if (verdict.success) return;
    const message = verdict.error.issues.map((i) => i.message).join('\n');
    expect(message).toContain('email');
    expect(message).toContain('label');
  });

  it('refuses an entry with no address — a line that cannot be signed in with is not a credential', () => {
    const verdict = parse({ ...base(), devLogins: [{ label: 'Hiring admin' }] });
    expect(verdict.success).toBe(false);
    expect(issuesOf(verdict)).toContain('invalid_type @ devLogins.0.email');
  });

  it('refuses an address that is not one — it would name an account the operator cannot reach', () => {
    const verdict = parse({ ...base(), devLogins: [{ email: 'not-an-address' }] });
    expect(verdict.success).toBe(false);
    expect(issuesOf(verdict).join('|')).toMatch(/@ devLogins\.0\.email$|@ devLogins\.0\.email\|/);
  });

  it('refuses a `devHint` that is not a string', () => {
    const verdict = parse({ ...base(), devHint: ['two', 'lines'] });
    expect(verdict.success).toBe(false);
    expect(issuesOf(verdict)).toContain('invalid_type @ devHint');
  });
});

// ─── DARK CONTROL — the door did not open, two keys were declared ───

describe('#17556 control — the top-level door is still strict everywhere else', () => {
  it('a neighbouring undeclared key still refuses, so the accept above is about these two keys', () => {
    // If this went green the reading "devHint/devLogins are now writable" would
    // be indistinguishable from "the strict close regressed".
    for (const key of ['devLoginz', 'devHints', 'devCredentials']) {
      const verdict = parse({ ...base(), [key]: [] });
      expect(verdict.success, `'${key}' must still refuse`).toBe(false);
      expect(unrecognized(verdict), `'${key}' must raise unrecognized_keys`).toEqual({ path: [], keys: [key] });
    }
  });

  it('both keys are declared top-level keys carrying the dispositions they were classified with', () => {
    expect(STACK_DEFINITION_KEYS).toContain('devLogins');
    expect(STACK_DEFINITION_KEYS).toContain('devHint');
    expect(COMPOSE_KEY_DISPOSITIONS.devLogins).toBe('concat');
    expect(COMPOSE_KEY_DISPOSITIONS.devHint).toBe('single');
  });
});

// ─── COMPOSITION — both publishers' personas survive; hints refuse ──

describe('#17556 compose — personas concatenate, a contradicting hint is named', () => {
  const hiring = () => defineStack({
    manifest,
    devHint: 'seed first',
    devLogins: [{ label: 'Hiring admin', email: 'admin@quillstone.example' }],
  });
  const seekers = () => defineStack({
    manifest: { ...manifest, id: 'com.example.seekers', name: 'seekers', namespace: 'seekers' },
    devHint: 'seed first',
    devLogins: [{ label: 'Job seeker', email: 'candidate01@mail.example' }],
  });

  it('concatenates personas in stack order — dropping one would hide an audience the composed app still serves', () => {
    const composed = composeStacks([hiring(), seekers()]);
    expect(composed.devLogins).toEqual([
      { label: 'Hiring admin', email: 'admin@quillstone.example' },
      { label: 'Job seeker', email: 'candidate01@mail.example' },
    ]);
  });

  it('passes an identical hint through, and REFUSES two different ones by name', () => {
    expect(composeStacks([hiring(), seekers()]).devHint).toBe('seed first');

    const other = defineStack({
      manifest: { ...manifest, id: 'com.example.other', name: 'other', namespace: 'other' },
      devHint: 'do something else entirely',
    });
    expect(() => composeStacks([hiring(), other])).toThrow("top-level key 'devHint'");
  });
});
