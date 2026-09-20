// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #17556 — the boot banner prints the first-run credentials the APPLICATION
 * contributes (`devLogins` / `devHint`), beneath the one the platform seeded.
 *
 * ## The half `packages/cli` could not write for itself
 *
 * #17081 closed the platform's own half: the `🔑 Dev admin` line now says what
 * that account will and will not see. What it could not do is name an account
 * that DOES see something, because the platform does not know an application's
 * audiences — measured downstream, four of five personas rendered their group
 * and the one the banner printed rendered none. `@objectstack/spec` now
 * declares the channel; this file pins what the banner does with it.
 *
 * ## Four properties, and why each is a pin rather than a preference
 *
 * 1. **ADDITIVE.** The seeded-admin block still renders, unchanged, above.
 *    An application-controlled key able to suppress a platform disclosure
 *    would let an app hide a live credential the operator was just handed.
 * 2. **DEV ONLY.** A non-development boot renders byte-identically to one
 *    declaring nothing — ADR-0115's attention budget is untouched on the path
 *    that paragraph was written about.
 * 3. **SCRUBBED.** These strings are author-controlled and reach a TTY, where
 *    control bytes are instructions: an escape sequence could erase the rows
 *    above or repaint a forged `🔑 Dev admin` row, making the platform's own
 *    banner lie on the application's behalf. Every C0/C1 byte becomes U+FFFD,
 *    so an entry occupies exactly the rows it was given.
 * 4. **DECLARING IS NOT SEEDING.** The wording says the application declared
 *    these, because that is all a declaration does — nothing creates an
 *    account. An entry naming an unseeded account must read as the app's
 *    claim, not as a platform credential that broke.
 *
 * The exact sentences are pinned for the same reason #17081's are: the
 * deliverable here is words on a terminal, so the wording is the only thing
 * that can regress.
 */

import { describe, expect, it, vi } from 'vitest';
import { printServerReady, type ServerReadyOptions } from './format.js';

/** Strip SGR so assertions hold whether or not chalk colours this run. */
const SGR = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');

function render(opts: Partial<ServerReadyOptions>): string[] {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    lines.push(args.join(' ').replace(SGR, ''));
  });
  try {
    printServerReady({
      externalBaseOrigin: 'http://localhost:4721',
      uiEnabled: true,
      consolePath: '/_console',
      isDev: true,
      pluginCount: 12,
      ...opts,
    } as ServerReadyOptions);
  } finally {
    spy.mockRestore();
  }
  return lines;
}

const SEEDED = { email: 'admin@objectos.ai', password: 'admin123' };

const LOGINS = [
  { label: 'Hiring admin', email: 'admin@quillstone.example', password: 'demo1234' },
  { label: 'Job seeker', email: 'candidate01@mail.example', password: 'demo1234' },
];

/** The application block, verbatim, as a real render emits it under NO_COLOR. */
const APP_LOGIN_BLOCK = [
  '',
  '  👥  App logins: 2 declared by this app',
  '      Hiring admin — admin@quillstone.example / demo1234',
  '      Job seeker — candidate01@mail.example / demo1234',
  '      declared in this app\'s `devLogins` · dev only — the platform seeded none of them',
];

const blockOf = (lines: string[]): string[] => {
  const start = lines.findIndex((l) => l.includes('App logins:'));
  return start < 0 ? [] : lines.slice(start - 1, start - 1 + APP_LOGIN_BLOCK.length);
};

// ─── 1. What an operator sees ───────────────────────────────────────

describe('#17556 — the application\'s own credentials reach the banner', () => {
  it('renders the block verbatim, one row per declared account', () => {
    expect(blockOf(render({ seededAdmin: SEEDED, devLogins: LOGINS }))).toEqual(APP_LOGIN_BLOCK);
  });

  it('prints the address alone when the entry declares no password', () => {
    const lines = render({ devLogins: [{ label: 'SSO admin', email: 'sso@quillstone.example' }] });
    expect(lines).toContain('      SSO admin — sso@quillstone.example');
    // …and does not invent one: no separator where a password would sit.
    expect(lines.some((l) => l.includes('sso@quillstone.example /'))).toBe(false);
  });

  it('prints an unlabelled entry as the credential alone', () => {
    expect(render({ devLogins: [{ email: 'a@b.example', password: 'x' }] }))
      .toContain('      a@b.example / x');
  });

  it('renders `devHint` as its own row', () => {
    const lines = render({ devHint: 'run `pnpm seed:demo` first, then sign in as the Hiring admin' });
    expect(lines).toContain('  💡  App hint:   run `pnpm seed:demo` first, then sign in as the Hiring admin');
  });
});

// ─── 2. ADDITIVE — the platform's disclosure survives ───────────────

describe('#17556 — additive: the seeded-admin block is untouched and comes first', () => {
  it('leaves the #17081 credential block byte-identical', () => {
    const withApp = render({ seededAdmin: SEEDED, devLogins: LOGINS, devHint: 'seed first' });
    const withoutApp = render({ seededAdmin: SEEDED });

    const devAdminBlock = (lines: string[]) => {
      const start = lines.findIndex((l) => l.includes('Dev admin:'));
      return lines.slice(start - 1, start + 4);
    };
    expect(devAdminBlock(withApp)).toEqual(devAdminBlock(withoutApp));
    // Positive control: that slice is five real lines, not two empties agreeing.
    expect(devAdminBlock(withoutApp)).toHaveLength(5);
    expect(devAdminBlock(withoutApp)[1]).toContain('admin@objectos.ai');
  });

  it('renders beneath it, never instead of it', () => {
    const lines = render({ seededAdmin: SEEDED, devLogins: LOGINS });
    expect(lines.findIndex((l) => l.includes('Dev admin:'))).toBeGreaterThan(-1);
    expect(lines.findIndex((l) => l.includes('App logins:')))
      .toBeGreaterThan(lines.findIndex((l) => l.includes('Dev admin:')));
  });

  it('still prints when the platform seeded nothing — an app that seeds its own accounts', () => {
    const lines = render({ devLogins: LOGINS });
    expect(lines.some((l) => l.includes('Dev admin:'))).toBe(false);
    expect(blockOf(lines)).toEqual(APP_LOGIN_BLOCK);
  });
});

// ─── 3. DEV ONLY, and silent when nothing is declared ───────────────

describe('#17556 — the block is gated, and absent by default', () => {
  it('prints nothing on a non-development boot, for either key', () => {
    const lines = render({ isDev: false, seededAdmin: SEEDED, devLogins: LOGINS, devHint: 'seed first' });
    expect(lines.some((l) => l.includes('App logins:'))).toBe(false);
    expect(lines.some((l) => l.includes('App hint:'))).toBe(false);
    expect(lines.some((l) => l.includes('quillstone'))).toBe(false);
  });

  it('is byte-identical to a boot declaring nothing when both keys are absent, empty or blank', () => {
    const baseline = render({ seededAdmin: SEEDED });
    for (const declared of [{}, { devLogins: [] }, { devHint: '' }, { devHint: '   ' }, { devLogins: [], devHint: '' }]) {
      expect(render({ seededAdmin: SEEDED, ...declared })).toEqual(baseline);
    }
    // Positive control: the same comparison DOES move when something is declared.
    expect(render({ seededAdmin: SEEDED, devLogins: LOGINS })).not.toEqual(baseline);
  });

  it('skips an entry with no usable address rather than printing a blank credential', () => {
    const lines = render({ devLogins: [{ email: '' }, { email: 'real@b.example' }] as ServerReadyOptions['devLogins'] });
    expect(lines).toContain('  👥  App logins: 1 declared by this app');
    expect(lines).toContain('      real@b.example');
  });
});

// ─── 4. SCRUBBED — author text cannot repaint the banner ────────────

describe('#17556 — control bytes in author-controlled text are neutralised', () => {
  const ESC = String.fromCharCode(27);

  it('a hint carrying an escape sequence occupies exactly one row, with the bytes replaced', () => {
    const hostile = `${ESC}[2J${ESC}[H🔑  Dev admin: attacker@evil.example / hunter2`;
    const lines = render({ seededAdmin: SEEDED, devHint: hostile });

    const hintRows = lines.filter((l) => l.includes('App hint:'));
    expect(hintRows).toHaveLength(1);
    expect(hintRows[0]).not.toContain(ESC);
    expect(hintRows[0]).toContain('�');
    // The visible characters are passed through — this is neutralisation, not
    // redaction, so an author who wrote one can see what they wrote.
    expect(hintRows[0]).toContain('attacker@evil.example');
    // …and exactly one `🔑 Dev admin:` row exists: the forged one is inside the
    // hint row, not a row of its own.
    expect(lines.filter((l) => l.startsWith('  🔑  Dev admin: '))).toHaveLength(1);
  });

  it('a newline in a credential cannot open a row of its own', () => {
    const lines = render({ devLogins: [{ label: 'x\ny', email: 'a@b.example', password: 'p\rq' }] });
    const rows = lines.filter((l) => l.includes('a@b.example'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toBe('      x�y — a@b.example / p�q');
  });

  it('control-byte-free text is passed through unchanged', () => {
    // The dark control for the two assertions above: the scrubber must be
    // invisible on ordinary input, or "it was replaced" says nothing.
    const lines = render({ devLogins: [{ label: 'Hiring admin', email: 'admin@quillstone.example', password: 'demo1234' }] });
    expect(lines).toContain('      Hiring admin — admin@quillstone.example / demo1234');
    expect(lines.some((l) => l.includes('�'))).toBe(false);
  });
});
