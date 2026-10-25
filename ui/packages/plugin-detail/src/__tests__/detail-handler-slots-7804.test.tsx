/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Which authored `on*` keys reach the registered `'detail'` renderer — measured
 * per key, driven through the real `SchemaRenderer` — and the guard that a bare
 * deletion of either declaration goes red (objectui#7804, the `plugin-detail`
 * slice of the `KNOWN_UNDECLARED_READS` ledger — ⛔ that ledger's size is NOT
 * written down here: it is whatever `node scripts/check-handler-key-read-sites.mjs`
 * prints, and the hard-coded figure this line used to carry went stale inside
 * the life of this branch. AGENTS.md #9).
 *
 * ## The exposure
 *
 * `BaseSchema` is `.passthrough()`. A key an arm does not declare is NOT
 * refused — it stops being judged and the value is KEPT, then reaches the
 * renderer that reads it. `ComponentRegistry.register('detail', DetailView)`
 * registers `DetailView` RAW (no wrapper, `../index.tsx`), so nothing is
 * interposed: the authored value arrives at `schema.onNavigate` /
 * `schema.onAddComment` BY IDENTITY and is CALLED. An authored
 * `onNavigate: { action: 'toast' }` therefore parses GREEN and is handed to a
 * call site expecting a function — objectui#7664's measured mechanism, and the
 * shape `AlertDialogSchema.onAction` had until objectui#7104 declared it.
 *
 * ## Per-key disposition, MEASURED not assumed (the batch #69 ruling)
 *
 * Both keys measure `'runtime-slot'`, and they do NOT share one channel:
 *
 *   - `onNavigate` — read in `DetailView`'s OWN body (`handleBack`,
 *     `handleEdit`, the post-delete redirect) and CALLED there. Suite 1 drives
 *     the back button and the authored function runs with the arguments the
 *     call site builds.
 *   - `onAddComment` — never called by `DetailView`; it is FORWARDED as a React
 *     prop into `<RecordComments>`, whose `handleSubmit` awaits it. Suite 1
 *     drives the composer, so the leg measures the forward AND the call at the
 *     other end. It is also gated by `schema.comments`, itself an undeclared
 *     key kept alive by the same passthrough.
 *
 * ⇒ two keys, two channels, one disposition — which is a reading, not an
 * assumption: the sibling slice on `object-kanban` took three keys sharing one
 * prefix and measured them into three DIFFERENT channels carrying only TWO
 * dispositions — two of them are RUNTIME SLOTS, and the third, `onCardMove`,
 * is a TOMBSTONE. That is what the kanban slice's own `objectql.zod.ts`
 * docblock says in as many words, and this sentence agrees with it.
 *
 * ⭐ That slice is precisely where the two counts COME APART, which is a
 * SHARPER case for measuring per key than three-out-of-three would have been.
 * Neither count can be read off the other: `HandlerKeyDisposition` offers
 * exactly TWO values, so three keys can never carry three distinct
 * dispositions — while the routes by which a key reaches a renderer are
 * bounded by nothing, and there were three. ⛔ A per-prefix reading collapses
 * both counts to one and cannot say which of the two it lost; only the per-key
 * channel reading recovers them.
 *
 * ## Every control can fire
 *
 * `onNeverReadByAnyKnownReader` is authored on the SAME document, in the SAME
 * render, and must stay at zero calls. Without it a harness that fired every
 * authored function would read exactly like a live channel.
 *
 * ## Predictions, written before the code (red-first, base `a686403b3`)
 *
 *   - suite 1 (reachability) PASSES on the base tree — the channels are what
 *     this change declares, not what it builds;
 *   - suite 2 (the hazard) PASSES on the base tree for the same reason;
 *   - suite 3 (the zod face) FAILS on both keys: `DetailSchema.shape.onNavigate`
 *     and `.onAddComment` are `undefined`, and an authored action object parses
 *     GREEN and survives into the parsed output. `onBack` — already a #6124
 *     runtime-slot refusal on this very arm — is the lit control and is GREEN
 *     before and after;
 *   - suite 4 (the derivation) FAILS on both keys for the same reason.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, fireEvent, screen, waitFor, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DetailSchema as DetailZod } from '@object-ui/types/zod';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// Module-scope side-effect imports: the registry must hold `'detail'` and the
// widgets it renders into before the first render (AGENTS.md, test discipline).
import '@object-ui/components';
import '@object-ui/fields';
import '../index';

afterEach(() => cleanup());

/** The corpus spelling an author learns — a declarative action object where a
 *  function is expected. objectui#7664 measured this exact value surviving. */
const AUTHORED_ACTION_OBJECT = { action: 'toast', title: 'Saved', variant: 'success' };

/** Render an authored `'detail'` document the way production does. */
function renderDetail(schema: Record<string, unknown>) {
  return render(
    <SchemaRendererProvider dataSource={undefined}>
      <SchemaRenderer schema={{ type: 'detail', ...schema } as never} />
    </SchemaRendererProvider>,
  );
}

/* -- Suite 1: reachability, per key, driven ------------------------------- */

describe('an authored handler key reaches the registered `detail` renderer (objectui#7804)', () => {
  it('onNavigate: the authored function is CALLED by DetailView, with the arguments the call site builds', () => {
    const onNavigate = vi.fn();
    const onNeverReadByAnyKnownReader = vi.fn();
    renderDetail({ onNavigate, onNeverReadByAnyKnownReader });

    // No `data` and no fetch inputs -> the not-found panel, whose "Go back"
    // button is wired to the same `handleBack` as the header's.
    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith('/', { replace: true });
    // The control: same document, same render, a key no reader names.
    expect(onNeverReadByAnyKnownReader).toHaveBeenCalledTimes(0);
  });

  it('onAddComment: forwarded into RecordComments as a prop and awaited there', async () => {
    const onAddComment = vi.fn();
    const onNeverReadByAnyKnownReader = vi.fn();
    renderDetail({
      data: { id: '1', name: 'Acme' },
      // `comments` is itself undeclared on the arm and kept by the same
      // passthrough — the gate this key sits behind.
      comments: [{ id: 'c1', author: 'Ada', content: 'first', createdAt: '2026-01-01T00:00:00Z' }],
      onAddComment,
      onNeverReadByAnyKnownReader,
    });

    const box = await screen.findByPlaceholderText(/Add a comment/i);
    fireEvent.change(box, { target: { value: 'measured' } });
    const send = box.parentElement!.querySelector('button')!;
    fireEvent.click(send);

    await waitFor(() => expect(onAddComment).toHaveBeenCalledTimes(1));
    expect(onAddComment).toHaveBeenCalledWith('measured');
    expect(onNeverReadByAnyKnownReader).toHaveBeenCalledTimes(0);
  });
});

/* -- Suite 2: the hazard the disposition names ---------------------------- */

describe('the value the passthrough keeps is handed to a call site expecting a function', () => {
  /**
   * Every string React or the runtime reported while `body()` ran.
   *
   * ⚠️ Shaped by a MISSED prediction, recorded rather than smoothed: this leg
   * was first written as `expect(() => fireEvent.click(...)).toThrow()`, on the
   * assumption that a handler error propagates out of the dispatch. It does
   * not — React 19 REPORTS it (the `TypeError: schema.onNavigate is not a
   * function` this leg now reads) and the click returns normally. An
   * `expect(...).toThrow()` here would have been a green assertion about a
   * hazard that never fired.
   */
  function reportedWhile(body: () => void): string[] {
    const seen: string[] = [];
    const onError = (e: Event) => seen.push(String((e as ErrorEvent).error ?? e));
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      seen.push(args.map((a) => String(a)).join(' '));
    });
    window.addEventListener('error', onError);
    try {
      body();
    } catch (err) {
      seen.push(String(err));
    } finally {
      window.removeEventListener('error', onError);
      spy.mockRestore();
    }
    return seen;
  }

  it('an authored onNavigate action OBJECT reaches the call site and is invoked as a function', () => {
    renderDetail({ onNavigate: AUTHORED_ACTION_OBJECT });
    const reported = reportedWhile(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
    });
    expect(
      reported.some((m) => /onNavigate is not a function/.test(m)),
      `the kept object was never invoked; reported: ${JSON.stringify(reported)}`,
    ).toBe(true);
  });

  it('CONTROL: the same click on a document authoring NO onNavigate reports nothing', () => {
    renderDetail({ title: 'Acme' });
    const reported = reportedWhile(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
    });
    expect(reported.filter((m) => /is not a function/.test(m))).toEqual([]);
  });
});

/* -- Suite 3: the zod face ------------------------------------------------ */

describe('the `detail` arm declares every handler key its renderer reads (objectui#7804)', () => {
  const DECLARED = [['onNavigate'], ['onAddComment']] as const;
  /** The same two plus `onBack` — a named refusal on this arm since
   *  objectui#7344, so it is the LIT CONTROL: it was refused on the base tree
   *  too, and a probe that could not see a refusal would have failed on it
   *  first rather than reporting a clean pair of new ones. */
  const WITH_CONTROL = [...DECLARED, ['onBack']] as const;

  it.each(DECLARED)('DetailSchema.%s is a DECLARED member carrying the objectui#6124 runtime-slot guidance', (key) => {
    // Deliberately `.shape`, not `safeParse`: under `.passthrough()` a DELETED
    // key still parses green, so a parse-only pin stays green through the very
    // deletion it exists to catch.
    const member = DetailZod.shape[key] as { description?: string } | undefined;
    expect(member).toBeDefined();
    expect(member!.description).toContain('objectui#6124');
    expect(member!.description).toContain('RUNTIME SLOT');
    expect(member!.description).not.toContain('RETIRED');
  });

  it.each(WITH_CONTROL)('an authored action object on DetailSchema.%s is refused BY NAME', (key) => {
    const result = DetailZod.safeParse({ type: 'detail', [key]: AUTHORED_ACTION_OBJECT });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => String(i.path[0]) === key);
    expect(issue, `no issue addressed to \`${key}\``).toBeDefined();
    expect(issue!.code).toBe('custom');
    expect(issue!.message).toContain(`\`${key}\``);
  });

  it('the arm still parses GREEN without the keys — the refusal is about the key, not the document', () => {
    expect(DetailZod.safeParse({ type: 'detail', title: 'Acme' }).success).toBe(true);
  });
});

/* -- Suite 4: derived from the read site, so a deletion cannot hide -------- */

describe('the declaration is derived from the read site, not from a list (objectui#7804)', () => {
  const SOURCE = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'DetailView.tsx'),
    'utf8',
  );

  /** `schema.onX` — the reads the repo gate `check:handler-key-reads` judges. */
  const plainReads = [...new Set([...SOURCE.matchAll(/\bschema\.(on[A-Z][A-Za-z]*)/g)].map((m) => m[1]))].sort();
  /** `(schema as any).onX` — the same read, behind a cast. */
  const castReads = [...new Set([...SOURCE.matchAll(/\(schema as any\)\.(on[A-Z][A-Za-z]*)/g)].map((m) => m[1]))].sort();

  it('every plain `schema.on*` read in DetailView is a declared member of the `detail` arm', () => {
    expect(plainReads, 'the census instrument found no read at all').not.toEqual([]);
    const undeclared = plainReads.filter((k) => !(k in DetailZod.shape));
    expect(undeclared).toEqual([]);
  });

  it('the two keys this card owns are exactly the plain reads DetailView names', () => {
    expect(plainReads).toEqual(['onAddComment', 'onNavigate']);
  });

  it('records the ONE cast-spelled read DetailView still has — ledgered here, dispositioned elsewhere', () => {
    // `DetailView.tsx` reads `(schema as any).onTabChange` in its `autoTabs`
    // branch and forwards it into the `<Tabs onValueChange>` it renders.
    //
    // ⚠️ This leg USED TO say that the repo gate could not see a read behind
    // that cast, and that the key was therefore absent from the ledger. Both
    // halves stopped being true inside the life of this branch: the gate now
    // unwraps `as` / `!` / `satisfies` / parens before it names the receiver,
    // so this read IS judged and the key IS carried as a
    // `KNOWN_UNDECLARED_READS` row attributed to objectui#7804. Kept as a
    // record rather than smoothed away, because the assertion below never
    // moved — it was a GREEN assertion narrating a fact that had died, which is
    // the shape AGENTS.md #9 exists to name. ⛔ Neither the row's position nor
    // the ledger's size is written down here; the gate's own
    // `check-handler-key-read-sites.mjs --list` enumerates both.
    //
    // So what this leg measures is the SOURCE spelling, not the gate's reach:
    // that `(schema as any)` is still how `DetailView` reads the key, and that
    // there is exactly ONE such read. The key's objectui#6124 disposition is
    // OPEN — ⛔ not decided here, and ⛔ not decided anywhere else yet. It
    // lands in the zod arms, and the ledger row above carries it on
    // objectui#7804, which is the card `check-handler-key-read-sites.mjs`
    // itself names for this row. `DetailSchema` today declares neither
    // `onTabChange` nor the `onValueChange` spelling `TabsSchema` carries for
    // the same event.
    expect(castReads).toEqual(['onTabChange']);
  });
});
