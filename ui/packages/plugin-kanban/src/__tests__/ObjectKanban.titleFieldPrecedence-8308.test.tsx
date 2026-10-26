/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * One authored card-title choice, ONE answer — objectui#8308.
 *
 * ## The defect
 *
 * `ObjectKanban.tsx` resolved the same authoring choice ("which record field
 * titles a card", spelled `cardTitle` with `titleField` as its legacy alias) in
 * two places with two different operators: `schema.cardTitle ||
 * schema.titleField` in the card list's `effectiveData` memo, and
 * `schema.cardTitle ?? schema.titleField` in the record-detail drawer's
 * heading. `||` and `??` differ on exactly the falsy-but-present values, and on
 * a string key that value is `''`, so a board authored
 * `{ cardTitle: '', titleField: 'name' }` titled its CARDS from `name` while
 * its DRAWER heading fell through to the object-label floor.
 *
 * ## What is asserted here, and in which direction
 *
 * SUBJECT (`{ cardTitle: '', titleField: 'name' }`) — the two surfaces must
 * answer the same field. RED before the fix: the card read `'Ada Lovelace'`
 * while the drawer was named `'Contacts Detail'`.
 *
 * CONTROLS — green BEFORE and AFTER, which is what makes them controls:
 *   - `{ cardTitle: 'subject', titleField: 'name' }` resolves `'subject'` on
 *     both surfaces (`||` and `??` already agreed on a non-empty `cardTitle`).
 *   - `{ titleField: 'name' }` resolves `'name'` on both (they already agreed
 *     on an ABSENT `cardTitle` too).
 * If either control moves with the subject it is no longer a control and the
 * fix has changed something objectui#8308 did not rule on.
 *
 * STRUCTURAL PIN — the fence the card and triage both made load-bearing: the
 * pair is read ONCE, through the exported `resolveKanbanTitleField`, so a THIRD
 * read site cannot invent a third precedence. The census below reddens on a
 * property read of either key anywhere in this package's shipped source outside
 * that resolver — which is the failure a "just make both operators `||`" fix
 * would NOT have produced.
 *
 * ## The `''` ruling this file pins
 *
 * `cardTitle` names a record FIELD and `''` cannot name any field, so `''` has
 * no meaningful reading on this key and is treated as unset — `cardTitle` wins
 * only when NON-EMPTY. See `resolveKanbanTitleField`'s docblock, which is where
 * that ruling is written down; before objectui#8308 nothing in the tree said
 * what `''` meant here, which is the condition that let the two operators drift.
 *
 * ⛔ Do not mount `I18nProvider` in this file. `createI18n` registers its
 * instance as react-i18next's module-global default and that registration
 * survives `cleanup()`, so a provider here would silently decide what the
 * no-provider English fallback below resolves to (the reason
 * `ObjectKanban.overlayTitleNoProviderFallback.test.tsx` is a separate file).
 */

import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { registerAllFields } from '@object-ui/fields';
/**
 * Comments are blanked before the census below derives anything from text,
 * through the tree's ONE answer to "is this span a comment, or code?" — not a
 * hand-rolled stripper. `ObjectKanban.tsx` documents itself in prose that
 * NAMES both keys (the tombstone paragraph quotes `(schema as any).titleField`
 * verbatim) and carries regex literals and URLs, which is exactly where a naive
 * regex form opens a phantom comment and blanks the real code underneath —
 * reporting a clean census over source it never looked at. `maskComments`
 * blanks in place, so every offset below still addresses the original text
 * (`scripts/js-comment-mask.mjs`, and the corpus gate that keeps it honest).
 */
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../../scripts/js-comment-mask.mjs';
import { ObjectKanban, resolveKanbanTitleField } from '../ObjectKanban';

/** Local annotation, since the import above is untyped — the call site stays checked. */
const mask: (source: string) => string = maskComments;

// Pay the board's lazy chunk at import time rather than racing it against a
// `findBy` budget (AGENTS.md §测试纪律): `KanbanRenderer` renders
// `React.lazy(() => import('./KanbanImpl'))` behind Suspense and every render
// assertion below sits after that boundary.
import '../KanbanImpl';

registerAllFields();

/**
 * Two record fields that can title a card, plus a third the board never names.
 * `name` and `subject` hold DIFFERENT values on purpose — an assertion that
 * cannot tell the two apart cannot tell a precedence bug from a correct read.
 */
const cards = [
  { id: '1', name: 'Ada Lovelace', subject: 'Renewal call', status: 'todo' },
  { id: '2', name: 'Grace Hopper', subject: 'Onboarding', status: 'todo' },
];

/** The object-label floor the drawer heading falls to when no field answers. */
const DRAWER_FLOOR = 'Contacts Detail';

function renderKanban(schemaExtra: Record<string, unknown>) {
  return render(
    <ObjectKanban
      schema={{
        type: 'object-kanban',
        objectName: 'contacts',
        groupBy: 'status',
        columns: [{ id: 'todo', title: 'To Do' }],
        data: cards,
        ...schemaExtra,
      // ⚠️ Escaped for the same reason as every other static fixture in this
      // package (objectui#7322 item ②, pending objectui#7780): `columns` plus
      // inline `data` needs no fetch, but `ObjectKanbanSchema` still declares
      // `objectName` required and `cardTitle` is declared only on the sibling
      // `KanbanSchema` arm, so no single declared type accepts this node.
      } as never}
    />,
  );
}

/** Open the detail drawer the way a user does: click the card. */
async function openDrawerOnCard(cardTitleText: string) {
  const card = await screen.findByText(cardTitleText);
  fireEvent.click(card);
  await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
}

/* ─────────────────────────────────────────────────────────────────────────────
 * objectui#7307 — this file's `/api/v1/security/explain` escape, served here.
 *
 * The drawer this file opens reaches `useRecordEditable`
 * (`plugin-detail/src/useRecordEditable.ts`), whose `apiFetch ?? fetch` degrades
 * to the GLOBAL fetch with no host supplying one — under happy-dom a real HTTP
 * client against `http://localhost:3000`. Answered from the same RECORDING
 * double the two sibling drawer files carry: it records every URL and
 * `afterEach` fails on any that is not the explain route, so an escape
 * elsewhere reds here instead of vanishing into that hook's best-effort catch.
 * The verdict it serves changes no assertion in this file — the hook initialises
 * `allowed` to `true` and the drawer's accessible name is not derived from it.
 * ─────────────────────────────────────────────────────────────────────────── */

const EXPLAIN_ROUTE = '/api/v1/security/explain';

/** Every URL this render handed the global `fetch`, in request order. */
let explainCalls: string[] = [];

/** Serve `POST /api/v1/security/explain` permissively; record everything. */
function installExplainDouble() {
  explainCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: unknown) => {
      const url = String(
        input && typeof input === 'object' && 'url' in input ? (input as { url: unknown }).url : input,
      );
      explainCalls.push(url);
      if (url !== EXPLAIN_ROUTE) return { ok: false, status: 404, json: async () => ({}) };
      let body: { recordId?: unknown; recordIds?: unknown } = {};
      try {
        body = JSON.parse(String((init as { body?: unknown } | undefined)?.body ?? '{}'));
      } catch {
        /* a non-JSON body is not a request this route can answer */
      }
      const recordIds = Array.isArray(body.recordIds) ? body.recordIds : null;
      return {
        ok: true,
        status: 200,
        json: async () =>
          recordIds
            ? { records: recordIds.map((recordId) => ({ recordId, visible: true })) }
            : { record: { visible: true } },
      };
    }),
  );
}

beforeEach(() => installExplainDouble());

afterEach(() => {
  expect(explainCalls.filter((url) => url !== EXPLAIN_ROUTE)).toEqual([]);
  // Unmount BEFORE restoring the real `fetch` — vitest runs `afterEach` in
  // reverse registration order, so unstubbing first would leave the tree
  // mounted with the real global back in place (objectui#7439).
  cleanup();
  vi.unstubAllGlobals();
});

describe('resolveKanbanTitleField — the one precedence (objectui#8308)', () => {
  it('SUBJECT: an empty `cardTitle` is unset and falls through to `titleField`', () => {
    expect(resolveKanbanTitleField({ cardTitle: '', titleField: 'name' })).toBe('name');
  });

  it('CONTROL: a non-empty `cardTitle` still wins over `titleField`', () => {
    expect(resolveKanbanTitleField({ cardTitle: 'subject', titleField: 'name' })).toBe('subject');
  });

  it('CONTROL: an absent `cardTitle` falls through to `titleField`', () => {
    expect(resolveKanbanTitleField({ titleField: 'name' })).toBe('name');
  });

  it('reads `cardTitle` alone when it is the only key authored', () => {
    expect(resolveKanbanTitleField({ cardTitle: 'subject' })).toBe('subject');
  });

  it('answers `undefined` when neither key names a field, so the caller falls through', () => {
    // `undefined` — not `''` — is the signal the callers branch on: both fall
    // back to the shared ADR-0079 record-display chain rather than indexing a
    // record by a field name no object can declare.
    expect(resolveKanbanTitleField({})).toBeUndefined();
    expect(resolveKanbanTitleField({ cardTitle: '', titleField: '' })).toBeUndefined();
    expect(resolveKanbanTitleField(undefined)).toBeUndefined();
    expect(resolveKanbanTitleField(null)).toBeUndefined();
  });
});

describe('ObjectKanban card list and detail drawer agree on the title field (objectui#8308)', () => {
  it('SUBJECT: `{ cardTitle: "", titleField: "name" }` titles BOTH surfaces from `name`', async () => {
    renderKanban({ cardTitle: '', titleField: 'name' });

    // The card list's answer.
    await openDrawerOnCard('Ada Lovelace');

    // The drawer's answer — the same authored document, so the same field.
    // Before the fix this was the `Contacts Detail` floor: the drawer's `??`
    // kept the empty string, `'' && rec['']` is falsy, and the heading fell
    // through while the cards above it were titled from `name`.
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Ada Lovelace');
    expect(screen.getByRole('dialog')).not.toHaveAccessibleName(DRAWER_FLOOR);
  });

  it('CONTROL: `{ cardTitle: "subject", titleField: "name" }` titles BOTH from `subject`', async () => {
    renderKanban({ cardTitle: 'subject', titleField: 'name' });

    await openDrawerOnCard('Renewal call');

    expect(screen.getByRole('dialog')).toHaveAccessibleName('Renewal call');
    // The losing spelling never TITLES either surface. Asserted on the heading
    // rather than on the document: `name` is a field of the open record, so
    // `'Ada Lovelace'` is legitimately on screen inside the drawer's body.
    expect(screen.getByRole('dialog')).not.toHaveAccessibleName('Ada Lovelace');
  });

  it('CONTROL: `{ titleField: "name" }` alone titles BOTH from `name`', async () => {
    renderKanban({ titleField: 'name' });

    await openDrawerOnCard('Grace Hopper');

    expect(screen.getByRole('dialog')).toHaveAccessibleName('Grace Hopper');
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
 * STRUCTURAL PIN — the pair is read ONCE.
 *
 * A behavioural test alone would have been satisfied by making the drawer say
 * `||`, which repairs today's two sites and leaves the property that produced
 * them — the pair is readable ad hoc, anywhere — fully intact. This census is
 * the half that reddens on the THIRD read site.
 * ─────────────────────────────────────────────────────────────────────────── */

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Every shipped source file of this package — tests and fixtures excluded. */
function shippedSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__') walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      if (/\.test\.tsx?$/.test(entry.name)) continue;
      out.push(full);
    }
  };
  walk(SRC_DIR);
  return out.sort();
}

/** A PROPERTY read of either spelling — `x.cardTitle`, `x?.titleField`. */
const TITLE_KEY_READ = /\.\s*(?:cardTitle|titleField)\b/g;

/** `[start, end)` of the resolver, from its source-of-truth shape declaration. */
function resolverRegion(masked: string): [number, number] {
  const start = masked.indexOf('interface KanbanTitleFieldSource');
  expect(start).toBeGreaterThan(-1);
  const fnStart = masked.indexOf('export function resolveKanbanTitleField', start);
  expect(fnStart).toBeGreaterThan(-1);
  let i = masked.indexOf('{', fnStart);
  expect(i).toBeGreaterThan(-1);
  let depth = 0;
  for (; i < masked.length; i += 1) {
    if (masked[i] === '{') depth += 1;
    else if (masked[i] === '}') {
      depth -= 1;
      if (depth === 0) return [start, i + 1];
    }
  }
  throw new Error('unterminated resolveKanbanTitleField body');
}

describe('the `cardTitle` / `titleField` pair is read exactly once (objectui#8308)', () => {
  it('has no property read of either spelling outside `resolveKanbanTitleField`', () => {
    const objectKanban = path.join(SRC_DIR, 'ObjectKanban.tsx');
    const offenders: string[] = [];
    let insideRegionReads = 0;

    for (const file of shippedSources()) {
      const masked = mask(fs.readFileSync(file, 'utf8'));
      const region = file === objectKanban ? resolverRegion(masked) : null;
      for (const match of masked.matchAll(TITLE_KEY_READ)) {
        const at = match.index ?? 0;
        if (region && at >= region[0] && at < region[1]) {
          insideRegionReads += 1;
          continue;
        }
        offenders.push(
          `${path.relative(SRC_DIR, file)}: ${match[0].trim()} at char ${at}`,
        );
      }
    }

    // A third read site — wherever in this package it is added — lands here by
    // name instead of quietly inventing a third precedence.
    expect(offenders).toEqual([]);
    // POSITIVE CONTROL for the census itself: the reads the resolver DOES make
    // were seen. A mask or a region scan that erased everything would zero this
    // out while leaving `offenders` empty — green for the wrong reason.
    expect(insideRegionReads).toBeGreaterThan(0);
  });

  it('routes BOTH of `ObjectKanban`\'s read points through the resolver', () => {
    const masked = mask(
      fs.readFileSync(path.join(SRC_DIR, 'ObjectKanban.tsx'), 'utf8'),
    );
    const [, regionEnd] = resolverRegion(masked);
    const callSites = masked
      .slice(regionEnd)
      .match(/resolveKanbanTitleField\s*\(/g);

    // The card list's `effectiveData` memo and the detail drawer's heading.
    // Two, not "at least two": a third CALL is fine, but it would mean a third
    // surface reads the title field, and that is worth a look rather than a
    // silent pass.
    expect(callSites?.length).toBe(2);
  });

  it('exports the resolver, so the pair is testable without mounting a board', () => {
    expect(typeof resolveKanbanTitleField).toBe('function');
  });
});
