// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11663 L2] The config anchor's PARSE and MATCH halves, unit-tested apart
 * from the resolver that consumes them.
 *
 * The derivation itself (does a request resolve `PLATFORM_ADMIN`?) is pinned
 * next door in `resolve-authz-context.platform-admin-config.test.ts`. This file
 * covers the two things that file cannot show cheaply: every arm of the
 * fail-closed parse (Choice 2B), and that the match predicate never looks at a
 * row it has no business looking at.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  isConfiguredPlatformAdminEmail,
  matchesConfiguredPlatformAdmin,
  normalizePlatformAdminEmail,
  parsePlatformAdminEmails,
  resetPlatformAdminEmailMemo,
  resolvePlatformAdminEmails,
  setPlatformAdminConfigSink,
  type PlatformAdminConfigSink,
} from './platform-admin.js';

const ENV = 'OS_PLATFORM_OWNER_EMAIL';

function makeSink(): PlatformAdminConfigSink & { errors: string[]; warns: string[] } {
  const errors: string[] = [];
  const warns: string[] = [];
  return { errors, warns, error: (m) => errors.push(m), warn: (m) => warns.push(m) };
}

let ambient: string | undefined;
let sink: ReturnType<typeof makeSink>;

beforeEach(() => {
  ambient = process.env[ENV];
  delete process.env[ENV];
  resetPlatformAdminEmailMemo();
  sink = makeSink();
  setPlatformAdminConfigSink(sink);
});

afterEach(() => {
  if (ambient === undefined) delete process.env[ENV];
  else process.env[ENV] = ambient;
  resetPlatformAdminEmailMemo();
  setPlatformAdminConfigSink(undefined);
});

describe('normalizePlatformAdminEmail — ONE normalization, both sides', () => {
  it('trims and lowercases, and answers empty for a non-string', () => {
    expect(normalizePlatformAdminEmail('  Ada@Example.COM ')).toBe('ada@example.com');
    expect(normalizePlatformAdminEmail(undefined)).toBe('');
    expect(normalizePlatformAdminEmail(null)).toBe('');
    expect(normalizePlatformAdminEmail(42)).toBe('');
  });
});

describe('[Choice 2B] parsePlatformAdminEmails', () => {
  it('unset and blank are the same outcome: zero administrators, no refusal', () => {
    for (const raw of [undefined, '', '   ', '\t\n']) {
      const parsed = parsePlatformAdminEmails(raw);
      expect(parsed.emails, `raw=${JSON.stringify(raw)}`).toEqual([]);
      expect(parsed.refusal).toBeUndefined();
    }
  });

  it('normalizes once, collapses duplicates, drops blanks, keeps declared order', () => {
    const parsed = parsePlatformAdminEmails(' Ops@Corp.example , , second@corp.example ,ops@corp.example,');
    expect(parsed.emails).toEqual(['ops@corp.example', 'second@corp.example']);
    expect(parsed.refusal).toBeUndefined();
  });

  it('accepts the shapes a deployment legitimately declares', () => {
    // `a@b.c` is this leg's own acceptance-criterion value and `admin@localhost`
    // is an ordinary development address. Both are REJECTED by zod 4's
    // `.email()`, which is why this predicate is a shape check — see the note
    // on `isParseableAddress`. A tightening that breaks this test is a
    // tightening that locks a deployment out of its own administration.
    const parsed = parsePlatformAdminEmails('a@b.c,admin@localhost,ops+admin@corp.example');
    expect(parsed.emails).toEqual(['a@b.c', 'admin@localhost', 'ops+admin@corp.example']);
    expect(parsed.refusal).toBeUndefined();
  });

  it('⛔ one unparseable entry fails the WHOLE variable closed — never skip-and-continue', () => {
    for (const bad of ['not-an-email', '@corp.example', 'ops@', 'a@b@c', 'two words@corp.example']) {
      const parsed = parsePlatformAdminEmails(`good@corp.example,${bad},also.good@corp.example`);
      // The point of the arm: the two VALID entries do not survive either. A
      // parse that kept them would hand the deployment a narrower administrator
      // set than the operator declared, with nothing anywhere to notice.
      expect(parsed.emails, `bad=${JSON.stringify(bad)}`).toEqual([]);
      expect(parsed.refusal, `bad=${JSON.stringify(bad)}`).toContain(ENV);
      expect(parsed.refusal).toContain(bad);
      expect(parsed.raw).toContain('good@corp.example');
    }
  });

  it('[#13147] declaredSpellings: the as-typed form of every entry, index-aligned with emails', () => {
    // The reason the field exists: two readers need the operator's own spelling
    // (the by-email `sys_user` lookup, whose driver `where` is an exact match,
    // and the boot diagnostic that quotes the addresses back) and NEITHER may
    // split `raw` a second time to get it.
    const parsed = parsePlatformAdminEmails(' Ops@Corp.example , second@corp.example ,OPS@corp.EXAMPLE ');
    expect(parsed.emails).toEqual(['ops@corp.example', 'second@corp.example']);
    expect(parsed.declaredSpellings).toEqual(['Ops@Corp.example', 'second@corp.example']);
    // Trimmed but NOT lowercased — byte-for-byte what `resolvePlatformOwnerEmail()`
    // used to hand a single-value reader, which is what makes this a
    // behaviour-preserving substitution at those call sites.
    expect(parsed.declaredSpellings[0]).toBe('Ops@Corp.example');
    // The duplicate collapsed on the NORMALIZED form, and the spelling that
    // survives is the one that won the position — so the arrays cannot drift.
    expect(parsed.declaredSpellings).toHaveLength(parsed.emails.length);
  });

  it('[#13147] declaredSpellings is empty for every zero-administrator outcome', () => {
    for (const raw of [undefined, '', '   ', 'good@corp.example,nonsense']) {
      const parsed = parsePlatformAdminEmails(raw);
      expect(parsed.emails, `raw=${JSON.stringify(raw)}`).toEqual([]);
      expect(parsed.declaredSpellings, `raw=${JSON.stringify(raw)}`).toEqual([]);
    }
  });

  it('a refused variable is reported as refused, not as unset', () => {
    // Both answer "zero config-derived administrators"; only one of them is an
    // operator mistake, and a caller must be able to tell them apart.
    expect(parsePlatformAdminEmails(undefined).refusal).toBeUndefined();
    expect(parsePlatformAdminEmails('nonsense').refusal).toBeDefined();
  });
});

describe('[Choice 3A] resolvePlatformAdminEmails — live read, memo keyed on the raw string', () => {
  it('reads process.env live: a changed value is picked up on the next call', () => {
    expect(resolvePlatformAdminEmails().emails).toEqual([]);
    process.env[ENV] = 'first@corp.example';
    expect(resolvePlatformAdminEmails().emails).toEqual(['first@corp.example']);
    process.env[ENV] = 'second@corp.example';
    expect(resolvePlatformAdminEmails().emails).toEqual(['second@corp.example']);
    delete process.env[ENV];
    expect(resolvePlatformAdminEmails().emails).toEqual([]);
  });

  it('returns the SAME parse object while the raw string is unchanged', () => {
    process.env[ENV] = 'ops@corp.example, second@corp.example';
    const a = resolvePlatformAdminEmails();
    const b = resolvePlatformAdminEmails();
    // Identity, not equality: this is what makes the memo observable at all,
    // and re-parsing per request is the cost 3A's memo exists to avoid on the
    // authorization hot path.
    expect(b).toBe(a);
  });

  it('is LOUD about a refused variable, exactly once per distinct raw value', () => {
    process.env[ENV] = 'nonsense';
    resolvePlatformAdminEmails();
    resolvePlatformAdminEmails();
    resolvePlatformAdminEmails();
    expect(sink.errors).toHaveLength(1);
    expect(sink.errors[0]).toContain(ENV);
    expect(sink.errors[0]).toContain('ZERO config-derived platform');

    process.env[ENV] = 'also nonsense';
    resolvePlatformAdminEmails();
    expect(sink.errors).toHaveLength(2);
  });

  it('says NOTHING about an unset variable', () => {
    // The shipped default for every `single`-posture deployment. Warning on it
    // is how a log people read becomes a log people skim; a walled posture with
    // the variable unset already refuses boot one layer up.
    resolvePlatformAdminEmails();
    expect(sink.errors).toEqual([]);
    expect(sink.warns).toEqual([]);
  });
});

describe('matchesConfiguredPlatformAdmin — verified match only, fail closed', () => {
  const config = parsePlatformAdminEmails('ops@corp.example, second@corp.example');

  it('a verified row whose email is on the list matches', () => {
    expect(matchesConfiguredPlatformAdmin({ email: 'ops@corp.example', email_verified: true }, config)).toBe(true);
    // Every representation the drivers hand back for the boolean column.
    expect(matchesConfiguredPlatformAdmin({ email: 'second@corp.example', email_verified: 1 }, config)).toBe(true);
    expect(matchesConfiguredPlatformAdmin({ email: 'ops@corp.example', email_verified: '1' }, config)).toBe(true);
    expect(matchesConfiguredPlatformAdmin({ email: 'ops@corp.example', email_verified: 'true' }, config)).toBe(true);
  });

  it('matches case-insensitively on BOTH sides', () => {
    const mixed = parsePlatformAdminEmails('Ops@Corp.Example');
    expect(matchesConfiguredPlatformAdmin({ email: 'OPS@corp.EXAMPLE', email_verified: true }, mixed)).toBe(true);
  });

  it('⛔ an UNVERIFIED account holding a configured address confers nothing', () => {
    for (const v of [false, 0, '0', 'false', null, undefined, 'TRUE', 'yes']) {
      expect(
        matchesConfiguredPlatformAdmin({ email: 'ops@corp.example', email_verified: v }, config),
        `email_verified=${JSON.stringify(v)}`,
      ).toBe(false);
    }
    // An ABSENT column reads unverified — the arm that matters for every row
    // that predates the column.
    expect(matchesConfiguredPlatformAdmin({ email: 'ops@corp.example' }, config)).toBe(false);
  });

  it('an address that is not on the list confers nothing, however verified', () => {
    expect(matchesConfiguredPlatformAdmin({ email: 'nobody@corp.example', email_verified: true }, config)).toBe(false);
    expect(matchesConfiguredPlatformAdmin({ email: '', email_verified: true }, config)).toBe(false);
    expect(matchesConfiguredPlatformAdmin({ email_verified: true }, config)).toBe(false);
  });

  it('a REFUSED variable confers nothing on anybody', () => {
    const refused = parsePlatformAdminEmails('ops@corp.example,nonsense');
    expect(refused.refusal).toBeDefined();
    expect(matchesConfiguredPlatformAdmin({ email: 'ops@corp.example', email_verified: true }, refused)).toBe(false);
  });

  it('[pin P2] an EMPTY list answers false WITHOUT reading the row at all', () => {
    // Not a style preference: the resolver relies on this short-circuit to keep
    // the `sys_user` read conditional on config, which is what leaves the
    // pinned batch-equivalence query multiset untouched for a deployment that
    // declared no administrators. A `Proxy` that throws on any property access
    // is the only way to assert "did not read" rather than "read and ignored".
    const explodes = new Proxy(
      { email: 'ops@corp.example', email_verified: true },
      {
        get(_t, prop) {
          throw new Error(`matchesConfiguredPlatformAdmin read '${String(prop)}' on an empty config`);
        },
      },
    );
    expect(matchesConfiguredPlatformAdmin(explodes, parsePlatformAdminEmails(undefined))).toBe(false);
  });

  it('a missing row is not an administrator', () => {
    expect(matchesConfiguredPlatformAdmin(undefined, config)).toBe(false);
    expect(matchesConfiguredPlatformAdmin(null, config)).toBe(false);
    expect(matchesConfiguredPlatformAdmin('usr_1', config)).toBe(false);
  });
});

/**
 * [#11663 L5] The migration pointer is RETIRED — an ABSENCE pin, because absence
 * is the only thing left to assert about it.
 *
 * L4 opened a time-boxed, loud migration window and this module carried its
 * pointer: `reportLegacyPlatformAdminGrant`, latched once per process, plus
 * `resetLegacyPlatformAdminGrantReport` to drop the latch for tests. L5 closed
 * the window — under a walled posture the row the pointer pointed away from is
 * no longer an anchor at all (`resolve-authz-context.ts` §6b), and under
 * `single` the pointer never fired (it was posture-keyed by #13667). Both
 * symbols are gone, from this module AND from `@objectstack/core`'s published
 * entry.
 *
 * ⛔ This pin is not decoration. The suites that USED to cover these symbols all
 * asserted a message or a latch count; deleting them leaves nothing that notices
 * a well-meaning later edit re-adding a "helpful" deprecation warn to the
 * authorization path — which is a per-request cost on every walled rig and a
 * second, silent dual-track of the very kind the window existed to close. If a
 * future leg genuinely needs a pointer again, ⛔ do not re-add it here: the
 * operator-facing line belongs at BOOT, in
 * `plugin-security/src/bootstrap-platform-admin.ts`, where an operator can act
 * on it. Re-authoring this pin is then a deliberate act, which is the point.
 */
describe('[#11663 L5] the legacy-grant deprecation pointer is retired', () => {
  it('⛔ neither symbol is exported by this module any more', async () => {
    const mod: Record<string, unknown> = await import('./platform-admin.js');
    expect('reportLegacyPlatformAdminGrant' in mod).toBe(false);
    expect('resetLegacyPlatformAdminGrantReport' in mod).toBe(false);
    // Positive control — the same probe on the same module object finds the
    // symbols this leg KEEPS, so an absence read here is an absence and not a
    // module that failed to load.
    expect('matchesConfiguredPlatformAdmin' in mod).toBe(true);
    expect('resolvePlatformAdminEmails' in mod).toBe(true);
  });

  it("⛔ nor by `@objectstack/core`'s security entry — the published surface lost them", async () => {
    const entry: Record<string, unknown> = await import('./index.js');
    expect('reportLegacyPlatformAdminGrant' in entry).toBe(false);
    expect('resetLegacyPlatformAdminGrantReport' in entry).toBe(false);
    // Positive control on the same entry: its sibling config exports are still
    // re-exported, so the two absences above are about these two names.
    expect('matchesConfiguredPlatformAdmin' in entry).toBe(true);
    expect('setPlatformAdminConfigSink' in entry).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('[#13147] isConfiguredPlatformAdminEmail — the ONE membership expression', () => {
  const LIST = parsePlatformAdminEmails('ops@corp.example, Second@Corp.Example');

  it('answers for EVERY member of a comma-separated list, not just the first', () => {
    // The defect this predicate closes: the five single-value readers held the
    // operator's whole raw value as ONE address, so `'a@b.c,d@e.f'` could never
    // equal any single candidate and matched NOBODY.
    expect(isConfiguredPlatformAdminEmail('ops@corp.example', LIST)).toBe(true);
    expect(isConfiguredPlatformAdminEmail('second@corp.example', LIST)).toBe(true);
    expect(isConfiguredPlatformAdminEmail('stranger@corp.example', LIST)).toBe(false);
    // ⛔ And the raw list is not itself an address.
    expect(isConfiguredPlatformAdminEmail('ops@corp.example, Second@Corp.Example', LIST)).toBe(false);
  });

  it('applies the ONE normalization to the candidate — trim AND lowercase', () => {
    expect(isConfiguredPlatformAdminEmail('  OPS@Corp.EXAMPLE  ', LIST)).toBe(true);
    // The trim is the half a hand-rolled `.toLowerCase()` compare drops, which
    // is exactly how a seventh dialect would be born.
    expect(isConfiguredPlatformAdminEmail(' second@corp.example', LIST)).toBe(true);
  });

  it('fail-closed on every other shape', () => {
    for (const empty of [
      parsePlatformAdminEmails(undefined),
      parsePlatformAdminEmails('   '),
      parsePlatformAdminEmails('ops@corp.example,nonsense'), // REFUSED
    ]) {
      expect(isConfiguredPlatformAdminEmail('ops@corp.example', empty)).toBe(false);
    }
    for (const candidate of [undefined, null, '', '   ', 42, {}]) {
      expect(isConfiguredPlatformAdminEmail(candidate, LIST), String(candidate)).toBe(false);
    }
  });

  it('is the membership half of matchesConfiguredPlatformAdmin — one expression, not two', () => {
    // Same list, same address: the row predicate adds the verified check and
    // nothing else. If these two ever disagree about membership, the config
    // anchor and the plugin readers have split again.
    expect(matchesConfiguredPlatformAdmin({ email: 'second@corp.example', email_verified: true }, LIST)).toBe(true);
    expect(isConfiguredPlatformAdminEmail('second@corp.example', LIST)).toBe(true);
    // Verified is the ONLY difference.
    expect(matchesConfiguredPlatformAdmin({ email: 'second@corp.example' }, LIST)).toBe(false);
    expect(isConfiguredPlatformAdminEmail('second@corp.example', LIST)).toBe(true);
  });
});
