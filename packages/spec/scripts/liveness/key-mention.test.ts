// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The census that designed this check (#11457) measured 403 (entry, cited file)
// pairs and found 11 whose cited file never named the key — SEVEN real rots and
// one structural false-positive class. These tests pin both halves: the rots the
// matcher must keep reporting, and the class it must never report. Every case
// below is drawn from a measured entry rather than invented, so a future
// loosening of the matcher fails against the population it was calibrated on.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  findUnanchoredCitations,
  isKeyMentioned,
  leafKeyOf,
  namingVariants,
  parseKeyMentionBaseline,
  reconcileKeyMentions,
} from './key-mention.mts';
import type { KeyMentionExemption } from './key-mention.mts';

const here = dirname(fileURLToPath(import.meta.url));

/** A `readFile` that serves a fixed map and returns null for anything else. */
const filesOf = (m: Record<string, string>) => (p: string) => m[p] ?? null;

describe('namingVariants — Prime Directive #3, read in both directions', () => {
  it('folds a camelCase authoring key to the snake_case machine name', () => {
    expect(namingVariants('bodyHtml')).toContain('body_html');
    expect(namingVariants('managedBy')).toContain('managed_by');
  });

  it('folds a snake_case key back to camelCase', () => {
    expect(namingVariants('body_html')).toContain('bodyHtml');
  });

  it('always keeps the key itself', () => {
    expect(namingVariants('allowExport')).toContain('allowExport');
  });

  it('handles a digit boundary without splitting mid-token', () => {
    expect(namingVariants('layer0Filter')).toContain('layer0_filter');
  });
});

describe('isKeyMentioned — the exception CLASS the census found', () => {
  // Measured: `email_template.bodyHtml` cites email-service.ts, which reads the
  // persisted column and never the authoring key. Reporting this class is what
  // made the naive matcher unshippable.
  it('accepts the snake_case consumer of a camelCase key (email_template.bodyHtml)', () => {
    expect(isKeyMentioned('const html = row.body_html;', 'bodyHtml')).toBe(true);
  });

  it('accepts the snake_case consumer of permission.managedBy', () => {
    expect(isKeyMentioned("upsert({ managed_by: 'package' })", 'managedBy')).toBe(true);
  });

  it('accepts a direct mention', () => {
    expect(isKeyMentioned('const wildExport = objects?.[\'*\']?.allowExport;', 'allowExport')).toBe(true);
  });

  // The false NEGATIVE guard, and the reason the match is word-bounded. The
  // `field.requiredWhen` citation pointed at record-validator.ts, which mentions
  // `required` on twenty lines and `requiredWhen` on none — an unbounded
  // substring match would have called that rot anchored and missed it.
  it('does NOT let a PREFIX of the key satisfy it (required !== requiredWhen)', () => {
    const recordValidator = 'if (field.required && isEmpty(value)) reject("required");';
    expect(isKeyMentioned(recordValidator, 'requiredWhen')).toBe(false);
  });

  it('does not let a longer word containing the key satisfy it', () => {
    expect(isKeyMentioned('const targetless = 1;', 'target')).toBe(false);
  });

  it('reports a file that names neither spelling (action.target in http-dispatcher)', () => {
    expect(isKeyMentioned('return handleActionsRequest(this.domainDeps, path);', 'target')).toBe(false);
  });
});

describe('leafKeyOf — the ledger coordinate is not what a consumer names', () => {
  it('drops the `children` nesting spelling', () => {
    expect(leafKeyOf('objects.children.allowExport')).toBe('allowExport');
    expect(leafKeyOf('tenancy.children.organizationField')).toBe('organizationField');
  });

  it('leaves a top-level key alone', () => {
    expect(leafKeyOf('requiredWhen')).toBe('requiredWhen');
  });
});

describe('findUnanchoredCitations', () => {
  it('reports the pair whose file never names the key', () => {
    const out = findUnanchoredCitations('action/target', 'target', ['a.ts'], filesOf({ 'a.ts': 'no mention here' }));
    expect(out).toEqual([{ entry: 'action/target', path: 'a.ts' }]);
  });

  it('is silent when one of several cited files anchors it — the check is PER PAIR', () => {
    // permission.objects.allowExport is exactly this shape: three pointers, one
    // rotted. An entry-level check (does ANY cited file name the key) would have
    // passed it, which is why the granularity is the pair and not the entry.
    const out = findUnanchoredCitations(
      'permission/objects.children.allowExport',
      'allowExport',
      ['rest-server.ts', 'hono-plugin.ts'],
      filesOf({ 'rest-server.ts': 'enforceExportPermission(allowExport)', 'hono-plugin.ts': 'nothing' }),
    );
    expect(out).toEqual([{ entry: 'permission/objects.children.allowExport', path: 'hono-plugin.ts' }]);
  });

  it('SKIPS an unreadable file — the existence check owns that verdict', () => {
    // Reporting one rot under two headings teaches a reader to discount both.
    expect(findUnanchoredCitations('x/y', 'y', ['gone.ts'], filesOf({}))).toEqual([]);
  });
});

describe('reconcileKeyMentions — the shrink-only ratchet', () => {
  const observed = [{ entry: 'email_template/fromOverride', path: 'email-service.ts' }];

  it('passes a pair the baseline records', () => {
    const r = reconcileKeyMentions({
      observed,
      baseline: [{ entry: 'email_template/fromOverride', path: 'email-service.ts', why: 'from_address' }],
    });
    expect(r.unanchored).toEqual([]);
    expect(r.stale).toEqual([]);
    expect(r.exempt).toBe(1);
  });

  it('FAILS a pair the baseline does not record', () => {
    const r = reconcileKeyMentions({ observed, baseline: [] });
    expect(r.unanchored).toEqual(observed);
  });

  it('FAILS a baseline row whose pair now anchors — the debt cannot be overstated', () => {
    const r = reconcileKeyMentions({
      observed: [],
      baseline: [{ entry: 'action/target', path: 'http-dispatcher.ts', why: 'stale once repointed' }],
    });
    expect(r.stale).toHaveLength(1);
    expect(r.stale[0]).toContain('action/target → http-dispatcher.ts');
    expect(r.exempt).toBe(0);
  });

  it('matches on the PAIR, not on the entry alone', () => {
    const r = reconcileKeyMentions({
      observed: [{ entry: 'e', path: 'rotted.ts' }],
      baseline: [{ entry: 'e', path: 'other.ts', why: 'a different pointer of the same entry' }],
    });
    expect(r.unanchored).toEqual([{ entry: 'e', path: 'rotted.ts' }]);
    expect(r.stale).toHaveLength(1);
  });
});

describe('parseKeyMentionBaseline', () => {
  it('rejects a row missing `why` — an exemption with no reason is the note #4956 was about', () => {
    expect(() => parseKeyMentionBaseline({ exemptions: [{ entry: 'a', path: 'b' }] })).toThrow(/entry, path, why/);
  });

  it('rejects a missing `exemptions` array', () => {
    expect(() => parseKeyMentionBaseline({})).toThrow(/exemptions/);
  });

  // ── the row-quality rule, and the pair that keeps it discriminating ──
  //
  // `key-mention.baseline.json` declares itself, in its own `_note`, a
  // `SHRINK-ONLY RATCHET (#11457)`: a finite, enumerated debt ledger that
  // exists to be driven to zero. Everything below follows from that one fact.
  //
  // What stood here was ONE case that read the shipped file and then asserted
  // `doc.exemptions.length > 0` before looping over the rows. It conflated two
  // claims, and got both of them wrong at the same moment:
  //
  //   * the floor was a pin on the DEBT BEING PRESENT. It goes red on the
  //     commit that deletes the last exemption — i.e. exactly when the
  //     burn-down SUCCEEDS. The two reactions available to the seat that hits
  //     it are "park a row to keep the test green" and "weaken the assertion",
  //     and both are wrong.
  //   * deleting the floor alone would not have been the repair either:
  //     `for (const row of [])` asserts nothing, so it trades the red for a
  //     silent no-op — the `[].every(...)` second-order defect the witness
  //     pair below exists to prevent.
  //
  // So the two claims are split: a SYNTHETIC witness pair carries the rule (it
  // keeps discriminating at zero), and the shipped ledger is held to the rule
  // CONDITIONALLY on rows existing rather than being required to have them.
  // The rule is named once, here, so the pair and the ledger case cannot be
  // held to two definitions of it that drift apart.
  //
  // 40 characters is the original threshold, carried over unchanged: a `why`
  // shorter than that is the reassuring sentence the file's own `_exemptions`
  // note forbids — "a row that only asserts 'this is fine'" — rather than a
  // statement of WHICH name the cited file actually uses.
  const explainsWhichNameIsUsed = (row: KeyMentionExemption): boolean => row.why.length > 40;

  // Both witnesses are SYNTHETIC — neither reads the shipped file — which is
  // the whole point: this pair goes on discriminating after the ledger burns
  // down to zero, where a rule carried on the live rows alone would not.
  // PR #12050 is the worked instance of the idiom.
  const WITNESS_EXPLAINED: KeyMentionExemption = {
    entry: 'email_template/fromOverride',
    path: 'email-service.ts',
    why: 'the file reads the compound remap `from_address`; no camelCase→snake_case fold reaches that spelling',
  };
  const WITNESS_REASSURING: KeyMentionExemption = {
    entry: 'email_template/fromOverride',
    path: 'email-service.ts',
    why: 'this is fine',
  };

  it('accepts a conforming row, and the row-quality rule REJECTS one that only reassures', () => {
    // Positive half — the parser accepts a conforming row and hands it back
    // intact, and the rule holds for it.
    const parsed = parseKeyMentionBaseline({ exemptions: [WITNESS_EXPLAINED] });
    expect(parsed.exemptions).toEqual([WITNESS_EXPLAINED]);
    expect(parsed.exemptions.every(explainsWhichNameIsUsed)).toBe(true);

    // Negative half — and the rule can FAIL. `WITNESS_REASSURING` is
    // STRUCTURALLY valid, so the parser accepts it: that is precisely why row
    // quality is a claim of its own and not one the parse already covers.
    expect(() => parseKeyMentionBaseline({ exemptions: [WITNESS_REASSURING] })).not.toThrow();
    expect(explainsWhichNameIsUsed(WITNESS_REASSURING)).toBe(false);
  });

  it('reads the SHIPPED ledger, and every row that IS there explains which name the file uses', () => {
    const raw = JSON.parse(readFileSync(join(here, 'key-mention.baseline.json'), 'utf8')) as {
      _note?: unknown;
    };

    // PROOF OF READ, asserted independently of how many rows come back — the
    // rule #11694 carries. An empty ledger is the burn-down SUCCEEDING; a file
    // that was never read is this case losing its subject; the two must not
    // look alike from here. `readFileSync` and `parseKeyMentionBaseline` throw
    // on the ways that can happen, and this says so out loud instead of
    // leaving it implicit in a loop that would be silent at zero.
    const note = raw._note;
    expect(typeof note).toBe('string');
    expect(String(note)).toContain('SHRINK-ONLY RATCHET');

    const doc = parseKeyMentionBaseline(raw);

    // ⛔ Deliberately no `toBeGreaterThan(0)`: zero rows is this ledger
    // reaching its goal. The check below is CONDITIONAL on rows existing and
    // vacuous at zero BY DESIGN — the witness pair above is what still
    // discriminates at that point. Reported as a list so a failure names the
    // offending pairs rather than a bare count.
    const unexplained = doc.exemptions
      .filter((row) => !explainsWhichNameIsUsed(row))
      .map((row) => `${row.entry} → ${row.path}`);
    expect(unexplained).toEqual([]);
  });
});
