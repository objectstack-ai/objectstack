import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MARKER,
  renderClaimsComment,
  renderFromFile,
  spellOutTags,
} from '../render-changeset-claims-comment.mjs';

/**
 * objectui#9140 — the finding is DELIVERED, not archived.
 *
 * `check-changeset-claims.mjs` addresses its finding to the seat whose diff may
 * have falsified a pending changeset, and objectui#9140 measured that request at
 * zero answers out of four because it was addressed to a job log. The director's
 * ruling (maintainer 「同意」) moved it onto the pull request. Report-only did
 * NOT move: exit 0, not a required context, nothing blocks.
 *
 * What this file pins, in the order this rendering can fail:
 *
 *  1. **The marker survives the channel.** One comment per pull request,
 *     updated in place, requires the job to find its own previous comment. This
 *     repository has MEASURED that GitHub deletes tag-shaped fragments from a
 *     stored body — including an HTML comment alone on the first line
 *     (AGENTS.md) — so a hidden marker would vanish and every re-run would
 *     stack a new comment. The marker is therefore plain text on line 1, and
 *     the whole body is pinned free of tag-shaped fragments.
 *  2. **One copy of the marker.** The workflow reads it off the body it is
 *     about to post. A second spelling in the YAML is drift waiting to happen,
 *     so its absence is pinned.
 *  3. **An empty finding set never reads as a request.** That inversion is
 *     objectui#3152's bug in this gate's costume, and it would mute the channel
 *     the ruling exists to un-mute.
 *  4. **A missing measurement is never rendered as "nothing to re-read".**
 *  5. **Delivery says out loud that it does not block** — the gate's own
 *     「REQUEST TO READ」self-description becomes true by delivery, and it stays
 *     true only while the comment keeps saying what the gate does not do.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WORKFLOW = '.github/workflows/changeset-presence.yml';

/** The shape GitHub deletes on save — the reason the marker is plain text. */
const TAG_SHAPED = /<[^<>\s][^<>]*>/;

/**
 * The pending declaration the fixtures describe.
 *
 * ⛔ Never a filename this repository's own `.changeset/` directory carries,
 * and that is correctness rather than tidiness (objectui#9472).
 * `scripts/markdown-test-inputs.mjs` resolves markdown path literals out of
 * every test's source and offers only the ones that EXIST in the tree, so a
 * literal naming a PENDING declaration becomes a ledger entry — and
 * `pnpm changeset:version` deletes exactly those files, which turns that entry
 * into a `stale-not-read` finding and reddens `Validate the post-version tree`
 * on every scheduled release run afterwards.
 *
 * The `fixture-` prefix belongs to neither namespace a committed name can come
 * from: `pnpm changeset` generates `adjective-animal-verb`, and this repository
 * commits an issue-number-and-slug name. The tail still says what the fixture
 * is ABOUT — objectui#9140's fifth instance, the body that coordinates itself
 * by symbol and names no file at all — because that is why this shape is worth
 * a fixture, and the name is the only place left to say it.
 */
const PENDING_CHANGESET = '.changeset/fixture-grid-dependent-values.md';

/** A second pending declaration, for the "count changesets, not findings" pin. */
const OTHER_PENDING_CHANGESET = '.changeset/fixture-other-declaration.md';

function finding(overrides: Record<string, unknown> = {}) {
  return {
    changeset: PENDING_CHANGESET,
    span: 'packages/plugin-grid/src/ObjectGrid.tsx',
    file: 'packages/plugin-grid/src/ObjectGrid.tsx',
    severity: 'edited',
    paragraph: 'The staged row is carried as `pendingRow` by the grid.',
    ...overrides,
  };
}

function result(findings: unknown[] = []) {
  return {
    base: 'c5fbe0b99aaaaaaaa',
    baseHow: 'merge-base with origin/main',
    head: null,
    changed: 3,
    pending: 1597,
    considered: 1096,
    findings,
  };
}

// ── 1. the marker survives the channel ───────────────────────────────────────

describe('the marker the in-place update depends on', () => {
  it('is the first line of the body, in plain text', () => {
    for (const body of [renderClaimsComment(result()), renderClaimsComment(result([finding()]))]) {
      expect(body.split('\n')[0]).toBe(MARKER);
    }
  });

  it('is matched by the pattern the workflow validates it with', () => {
    // The delivery step warns and posts without an in-place update when the
    // first line does not look like a marker. Pinned here so a marker that the
    // workflow would reject can never ship.
    expect(MARKER).toMatch(/^[a-z][a-z0-9-]{4,}$/);
  });

  it('carries NO tag-shaped fragment anywhere in the body — the failure that would stack comments', () => {
    // AGENTS.md, measured: tag-shaped fragments are deleted from a stored body,
    // backticks and fenced blocks do not protect them, and an HTML comment alone
    // on the first line is eaten too. A marker that vanishes means every re-run
    // fails to find its predecessor and posts again.
    const body = renderClaimsComment(result([finding()]), { runUrl: 'https://example.invalid/run/1' });
    expect(body).not.toMatch(TAG_SHAPED);
    expect(body).not.toContain('<!--');
  });

  it('is spelled ONCE — the workflow reads it off the body rather than repeating it', () => {
    const yaml = fs.readFileSync(path.join(repoRoot, WORKFLOW), 'utf8');
    expect(yaml).not.toContain(MARKER);
  });
});

// ── 2. quoted prose is repaired rather than silently eaten ───────────────────

describe('spellOutTags', () => {
  it('rewrites an angle-bracketed name the channel would otherwise delete', () => {
    expect(spellOutTags('the SchemaRenderer is spelled <SchemaRenderer> here')).toBe(
      'the SchemaRenderer is spelled ANGLE-BRACKETS(SchemaRenderer) here',
    );
  });

  it('leaves prose without one byte-for-byte alone', () => {
    const prose = 'The staged row is carried as `pendingRow`, per objectui#7241.';
    expect(spellOutTags(prose)).toBe(prose);
  });

  it('is announced only when it actually fired', () => {
    // A standing note about a repair that did not happen teaches the reader to
    // discount every quote, including the verbatim ones.
    const plain = renderClaimsComment(result([finding()]));
    expect(plain).not.toContain('ANGLE-BRACKETS(name)');

    const repaired = renderClaimsComment(
      result([finding({ paragraph: 'The <SchemaRenderer> forwards the rest.' })]),
    );
    expect(repaired).toContain('ANGLE-BRACKETS(SchemaRenderer)');
    expect(repaired).toContain('ANGLE-BRACKETS(name)');
  });
});

// ── 3. both directions of the verdict ────────────────────────────────────────

describe('a finding set with something to re-read', () => {
  const body = renderClaimsComment(result([finding(), finding({ changeset: OTHER_PENDING_CHANGESET })]), {
    runUrl: 'https://example.invalid/run/1',
  });

  it('names every changeset, the span, and the file it resolved to', () => {
    expect(body).toContain(PENDING_CHANGESET);
    expect(body).toContain(OTHER_PENDING_CHANGESET);
    expect(body).toContain('packages/plugin-grid/src/ObjectGrid.tsx');
  });

  it('counts CHANGESETS, not findings', () => {
    expect(body).toContain('2 pending changeset(s)');
  });

  it('quotes the PARAGRAPH (objectui#8617)', () => {
    expect(body).toContain('The staged row is carried as `pendingRow` by the grid.');
  });

  it('says out loud that it does not block and is not a verdict', () => {
    expect(body).toContain('Nothing here blocks');
    expect(body).toContain('exits 0');
    expect(body).toContain('not a required context');
  });

  it('says it judges name resolution and refuses to judge meaning', () => {
    expect(body).toContain('name resolution, never meaning');
  });

  it('reports the population it read, so a reader can tell a green from a blind spot', () => {
    expect(body).toContain('1096 pending declaration(s)');
    expect(body).toContain('1597 pending in total');
  });

  it('marks a file the change DELETES at the louder severity', () => {
    const gone = renderClaimsComment(result([finding({ severity: 'gone' })]));
    expect(gone).toContain('this change leaves no such file');
  });

  it('links back to the run that measured it', () => {
    expect(body).toContain('https://example.invalid/run/1');
  });
});

describe('an empty finding set', () => {
  const body = renderClaimsComment(result());

  it('renders the RESOLVED body, never a request to re-read', () => {
    // The inversion this pins is objectui#3152's in this gate's costume:
    // rendering "not measured" or "nothing found" as a finding is how a channel
    // gets muted — and this channel was just un-muted by ruling.
    // ⚠️ The resolved body now speaks for BOTH halves (objectui#9509): a stale
    // request at the top of a thread is as misleading about the born-false half
    // as about the went-false one.
    expect(body).toContain('Nothing to re-read');
    expect(body).toContain('No pending changeset names a file this change touches');
    expect(body).toContain("no address in this pull request's own prose");
    expect(body).not.toContain('pending changeset(s) describe a file');
    expect(body).not.toContain('⚠️');
  });

  it('explains why it is still here rather than deleted', () => {
    expect(body).toContain('updated in place');
  });
});

// ── 4. a missing measurement fails loud ──────────────────────────────────────

describe('the hand-off from the gate', () => {
  it('renders a written hand-off', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claims-render-'));
    const file = path.join(dir, 'claims.json');
    fs.writeFileSync(file, JSON.stringify(result([finding()])));
    try {
      expect(renderFromFile(file, {})).toContain(PENDING_CHANGESET);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a hand-off with no finding list rather than rendering it as "nothing to re-read"', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claims-render-'));
    const file = path.join(dir, 'claims.json');
    fs.writeFileSync(file, JSON.stringify({ base: 'abc' }));
    try {
      expect(() => renderFromFile(file, {})).toThrow(/measured nothing/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a hand-off that is not there at all', () => {
    expect(() => renderFromFile(path.join(os.tmpdir(), 'absent-claims-hand-off.json'), {})).toThrow();
  });
});

// ── the born-false half (objectui#9509) ──────────────────────────────────────

describe('the born-false section', () => {
  const moved = {
    origin: 'the pull request body',
    span: ':246',
    file: 'packages/types/src/zod/imported-defaults.ts',
    line: 246,
    verdict: 'moved',
    movedTo: 274,
    sentence: 'The shape recurs exactly twice: `:223` and `:246`.',
  };
  const unanchored = {
    // ⛔ A name no committed declaration can wear. `pnpm changeset` generates
    // `adjective-animal-verb` and this repository commits an issue-number-and-slug
    // name, so a `fixture-` prefix belongs to neither namespace — and the file does
    // not exist, so `scripts/markdown-test-inputs.mjs` never offers it as a ledger
    // candidate. Naming a LIVE pending declaration here made `changeset:version`
    // delete the thing a ledger entry pointed at, and reddened the release lane days
    // later (objectui#9583).
    origin: '.changeset/fixture-born-false-origin.md',
    span: 'pin.test.ts:281',
    file: 'packages/types/src/__tests__/pin.test.ts',
    line: 281,
    verdict: 'unanchored',
    movedTo: null,
    sentence: 'The deep-clean control is at `pin.test.ts:281`.',
  };

  it('is rendered even when NO pending changeset names anything', () => {
    // The two halves are independent. A born-false-only run must still produce
    // a body, or the half nothing later will ever turn red is delivered to the
    // job log objectui#9140 measured at zero answers out of four.
    const body = renderClaimsComment({ findings: [], bornFalse: [moved] });
    expect(body).toContain("address(es) in this pull request's own prose name a tree it replaced");
    expect(body).not.toContain('Nothing to re-read');
  });

  it('says where the number went, rather than only that it is wrong', () => {
    const body = renderClaimsComment({ findings: [], bornFalse: [moved] });
    expect(body).toContain('to **`:274`**');
  });

  it('names an added file as having no tree outside the pull request', () => {
    const body = renderClaimsComment({ findings: [], bornFalse: [unanchored] });
    expect(body).toContain('added by this change');
    expect(body).toContain('exists in no tree outside this pull request');
  });

  it('⛔ asks for the number to be BOUND, never for it to be corrected', () => {
    // Correcting `:246` to `:274` is true today and born false again on the
    // next insertion. A comment that asked for the correction would manufacture
    // the next instance of the class it reports.
    const body = renderClaimsComment({ findings: [], bornFalse: [moved] });
    expect(body).toContain('The repair is not to correct the number');
    expect(body).toContain('Bind the number to the tree it was read from');
  });

  it('⛔ prints no went-false heading when that half found nothing', () => {
    // A heading over an empty list reads as a measurement that came back clean.
    const body = renderClaimsComment({ findings: [], bornFalse: [moved] });
    expect(body).not.toContain('pending changeset(s) describe a file');
  });

  it('repairs tag-shaped spans in the quoted sentence too', () => {
    // GitHub deletes tag-shaped fragments from a stored body, and this half
    // quotes prose that was never written for this channel either.
    const body = renderClaimsComment({
      findings: [],
      bornFalse: [{ ...moved, sentence: 'The frame is in `FieldWidgetProps<T>` at `:246`.' }],
    });
    expect(body).toContain('ANGLE-BRACKETS(T)');
    expect(body).not.toContain('<T>');
  });

  it('renders both halves together, born-false first', () => {
    const body = renderClaimsComment({
      findings: [{ changeset: '.changeset/a.md', span: 'x.ts', file: 'packages/alpha/src/x.ts', severity: 'edited', paragraph: 'p' }],
      bornFalse: [moved],
    });
    expect(body.indexOf("this pull request's own prose")).toBeLessThan(
      body.indexOf('pending changeset(s) describe a file'),
    );
  });

  it('opens with the marker whichever halves fired', () => {
    // The workflow finds its own earlier comment by the FIRST LINE of the body
    // it is about to post. A body that opened with a section heading instead
    // would stack one comment per push.
    for (const result of [
      { findings: [], bornFalse: [moved] },
      { findings: [], bornFalse: [] },
    ]) {
      expect(renderClaimsComment(result).split('\n', 1)[0]).toBe(MARKER);
    }
  });
});
