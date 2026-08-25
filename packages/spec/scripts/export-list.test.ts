// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pin for WHICH exports the skill-reference `Exports: …` fallback publishes —
 * #12201.
 *
 * The fallback ranked by SOURCE ORDER and had no notion of authorable surface,
 * so `slice(0, 5)` kept whichever five exports happened to be declared first.
 * Three rows in the published catalog therefore headlined machine constants
 * whose own names say they are not for authoring —
 * `DEPRECATED_APPROVER_TYPES`, `NON_AUTHORABLE_APPROVER_TYPES`,
 * `CORE_PLUGIN_TYPES`, `CONSUMER_INSTALLABLE_TYPES`,
 * `LEGACY_OBJECT_FIRST_KEYS` — on a surface loaded whole into a customer
 * agent's context window to teach it what it may author.
 *
 * No gate could see it: `check:skill-refs` compares the artifact against the
 * generator, and the generator reproduced the ranking faithfully. That is the
 * same blind spot #5059 found one layer up, and the answer is the same one —
 * the rule is extracted to a pure module and this file IS its enforcement.
 *
 * MEASURED (reverse verification) — and the two halves of this file fail
 * DIFFERENTLY, which is why both exist. Dropping the `MACHINE_CONSTANT` test
 * from `exportListDescription` (keeping everything else) turns four of the six
 * unit cases below red immediately — the three about which names survive, plus
 * the fall-through case, whose `null` exists only because filtering can empty a
 * list. The corpus gate meanwhile stays GREEN: it reads the checked-in
 * artifacts, and those only move when someone regenerates.
 * What turns the corpus gate red is regenerating with the rule dropped — i.e.
 * the state this card found, measured before the fix as 7 offenders across the
 * 3 rows (`DEPRECATED_APPROVER_TYPES`, `NON_AUTHORABLE_APPROVER_TYPES`,
 * `ORG_MEMBERSHIP_LEVELS`, `APPROVER_EXPRESSION_ROOTS`,
 * `LEGACY_OBJECT_FIRST_KEYS`, `CORE_PLUGIN_TYPES`,
 * `CONSUMER_INSTALLABLE_TYPES`).
 *
 * So the unit cases catch a rule that was weakened, and the corpus gate catches
 * an artifact that was regenerated from one — including from a `.zod.ts` that
 * grew a new constant. Neither subsumes the other. The "keeps a lone all-caps
 * token", "no exports at all" and cap-of-five cases stay green under that
 * ablation either way, because for those inputs the two rules agree; that
 * asymmetry is the point, since the defect was invisible on exactly the inputs
 * anyone would have thought to check.
 *
 * The corpus gate at the end is the part that cannot rot. It re-derives the
 * verdict from the checked-in `skills/**` artifacts — the bytes a customer
 * agent actually loads — so a future `.zod.ts` that declares a new
 * `SCREAMING_SNAKE` const above its schemas cannot quietly re-acquire a
 * hazardous row.
 */

import fs from 'fs';
import path from 'path';
import url from 'url';

import { describe, expect, it } from 'vitest';

import { exportListDescription } from './lib/export-list';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../..');
const SKILLS_DIR = path.resolve(REPO_ROOT, 'skills');

/** Same convention the filter encodes, restated so the gate is self-contained. */
const SCREAMING_SNAKE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;

describe('exportListDescription — machine constants never headline a pointer row', () => {
  it('drops SCREAMING_SNAKE constants and keeps source order for the rest', () => {
    // `automation/approval.zod.ts`, reduced. The published row opened
    // "Exports: ApproverType, DEPRECATED_APPROVER_TYPES,
    // NON_AUTHORABLE_APPROVER_TYPES, ORG_MEMBERSHIP_LEVELS,
    // APPROVER_EXPRESSION_ROOTS" — four of five names unusable by an author.
    const source = [
      "export const ApproverType = z.enum(['user', 'role']);",
      'export const DEPRECATED_APPROVER_TYPES = [] as const;',
      'export const NON_AUTHORABLE_APPROVER_TYPES = [] as const;',
      'export const ORG_MEMBERSHIP_LEVELS = [] as const;',
      'export const APPROVER_EXPRESSION_ROOTS = [] as const;',
      "export const ApprovalDecision = z.enum(['approve']);",
      'export const ApprovalNodeApproverSchema = z.object({});',
    ].join('\n');

    expect(exportListDescription(source)).toBe(
      'Exports: ApproverType, ApprovalDecision, ApprovalNodeApproverSchema',
    );
  });

  it('keeps source order — it does NOT sort *Schema exports first', () => {
    // Adjudicated on #12201 and pinned here so it is not "improved" later:
    // Schema-first ranking demotes `ApproverType`, the enum an author actually
    // writes, below the schema objects — worse by this surface's own standard.
    const source = [
      'export const PluginContextSchema = z.object({});',
      'export const CORE_PLUGIN_TYPES = [] as const;',
      'export const ApproverType = z.enum([]);',
      'export const PluginSchema = z.object({});',
    ].join('\n');

    expect(exportListDescription(source)).toBe(
      'Exports: PluginContextSchema, ApproverType, PluginSchema',
    );
  });

  it('applies the cap of five AFTER filtering, so authorable names are promoted', () => {
    // Slicing first would let the constants consume the row's five slots and
    // then be deleted from it, shortening the row instead of repairing it.
    const source = [
      'export const A_CONST = 1;',
      'export const B_CONST = 1;',
      'export const One = 1;',
      'export const Two = 1;',
      'export const Three = 1;',
      'export const Four = 1;',
      'export const Five = 1;',
      'export const Six = 1;',
    ].join('\n');

    expect(exportListDescription(source)).toBe('Exports: One, Two, Three, Four, Five');
  });

  it('keeps a lone all-caps token — the boundary is deliberate', () => {
    // No export in the eleven-module fallback corpus is a lone all-caps token,
    // so the corpus cannot distinguish "all caps" from "all caps with an
    // underscore". The narrower rule is chosen; widening it is a decision, and
    // this case is where that decision gets made.
    expect(exportListDescription('export const URL = 1;')).toBe('Exports: URL');
  });

  it('falls through (null) when every export is a machine constant', () => {
    // Not `Exports:` with nothing after it — the caller prints no description.
    const source = ['export const CORE_PLUGIN_TYPES = [];', 'export const OTHER_KEYS = [];'].join('\n');
    expect(exportListDescription(source)).toBeNull();
  });

  it('falls through (null) when the module exports no const at all', () => {
    expect(exportListDescription('export function f() {}\n')).toBeNull();
  });
});

describe('published catalog — no Exports: row names a machine constant', () => {
  /** Every `Exports: …` pointer row in the checked-in skill references. */
  const publishedRows = (): { file: string; source: string; names: string[] }[] => {
    const rows: { file: string; source: string; names: string[] }[] = [];
    for (const skill of fs.readdirSync(SKILLS_DIR)) {
      const index = path.resolve(SKILLS_DIR, skill, 'references/_index.md');
      if (!fs.existsSync(index)) continue;
      for (const line of fs.readFileSync(index, 'utf-8').split('\n')) {
        const match = /^- `([^`]+)` — Exports: (.+)$/.exec(line);
        if (match) {
          rows.push({
            file: path.relative(REPO_ROOT, index),
            source: match[1],
            names: match[2].split(',').map(n => n.trim()),
          });
        }
      }
    }
    return rows;
  };

  it('finds the fallback rows at all', () => {
    // Nothing parsed means nothing compared, and "no hazardous row" would read
    // as green — the same failure mode the generator's own emptiness guard has.
    expect(publishedRows().length).toBeGreaterThan(0);
  });

  it('names no SCREAMING_SNAKE constant on any published row', () => {
    const offenders = publishedRows().flatMap(row =>
      row.names.filter(name => SCREAMING_SNAKE.test(name)).map(name => `${row.file}: ${row.source} → ${name}`),
    );
    expect(offenders).toEqual([]);
  });
});
