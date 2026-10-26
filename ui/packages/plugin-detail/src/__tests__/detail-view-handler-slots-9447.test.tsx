/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `onNavigate` / `onAddComment` authored on a `detail-view` NODE — measured per
 * key through the real `SchemaRenderer`, and the guard that the named refusals
 * objectui#9447 adds to the mirror cannot be deleted quietly (the `views.zod.ts`
 * half of the pair objectui#7804 closed on `crud.zod.ts#DetailSchema`).
 *
 * ## The exposure
 *
 * `BaseSchemaCore` ends `.passthrough()`, so a key an arm does not declare is
 * not refused — it stops being judged and the value is KEPT. Until this card the
 * `detail-view` arm declared exactly one handler key (`onBack`, objectui#7344),
 * while its twin arm refused these two BY NAME, so the same two keys had two
 * different fates decided only by which `type` literal an author wrote.
 *
 * ## The read path, which is what made this a repair and not a widening
 *
 * `'detail'` registers `DetailView` RAW; `'detail-view'` registers
 * `DetailViewRenderer`, a data-source gate, and the card this pin belongs to was
 * filed without that path being measured. It is measured here. The gate hands
 * `DetailView` the object `useElementDataSourceSchema` returns, which is either
 * the node UNCHANGED (no composed binding) or a shallow `{ ...base }` spread
 * whose only overwrites are the binding keys. Neither branch strips a handler
 * key ⇒ the authored value arrives at `schema.onNavigate` / `schema.onAddComment`
 * BY IDENTITY, and suite 1 drives both to the call site rather than asserting it.
 *
 * ⚠️ `scripts/check-handler-key-read-sites.mjs` was GREEN on both keys for a
 * reason that said nothing about them, until objectui#9700. Its walk stopped at
 * the data-source gate — the render-prop child is handed `bound as
 * DetailViewSchema`, and a type-only cast on that attribute closed the hop — so
 * the read site it derives under the `'detail'` registration had no counterpart
 * here and neither key was ever among its findings, its census or its ledger.
 * That gate now takes the hop and scores both keys under `DetailViewSchema`.
 * ⛔ It still does not replace this file: the gate reads DECLARATION against
 * READ SITE statically, while suites 1 and 2 below drive the authored value to
 * the call site through the real `SchemaRenderer`.
 *
 * ## Every control can fire
 *
 * `onNeverReadByAnyKnownReader` is authored on the SAME document in the SAME
 * render and must stay at zero calls — without it, a harness that invoked every
 * authored function would read exactly like a live channel. On the zod face
 * `onBack` is the LIT CONTROL: a named refusal on this arm since objectui#7344,
 * so it was refused before this change too, and a probe that could not see a
 * refusal at all would fail on it first instead of reporting a clean new pair.
 *
 * ## Predictions, written before the run
 *
 *   - suite 1 (reachability) PASSES on the base tree — the channels are what
 *     this change DECLARES, not what it builds;
 *   - suite 2 (the zod face) FAILS on both keys on the base tree:
 *     `DetailViewSchema.shape.onNavigate` and `.onAddComment` are `undefined`
 *     there and an authored action object parses GREEN, while `onBack` is green
 *     before and after;
 *   - suite 3 (the boundary) PASSES on the base tree — the nested key it pins
 *     is untouched by this card in either direction.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, fireEvent, screen, waitFor, cleanup } from '@testing-library/react';
import { DetailViewSchema as DetailViewZod } from '@object-ui/types/zod';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// Module-scope side-effect imports: the registry must hold `'detail-view'` and
// the widgets it renders into before the first render (AGENTS.md, test discipline).
import '@object-ui/components';
import '@object-ui/fields';
import '../index';

afterEach(() => cleanup());

/** The corpus spelling an author learns — a declarative action object where a
 *  function is expected. The value objectui#7664 measured surviving. */
const AUTHORED_ACTION_OBJECT = { action: 'toast', title: 'Saved', variant: 'success' };

/** Render an authored `'detail-view'` document the way production does: through
 *  the registry, so the `DetailViewRenderer` wrapper is really in the path. */
function renderDetailView(schema: Record<string, unknown>) {
  return render(
    <SchemaRendererProvider dataSource={undefined}>
      <SchemaRenderer schema={{ type: 'detail-view', ...schema } as never} />
    </SchemaRendererProvider>,
  );
}

/* -- Suite 1: the read path, per key, driven through the wrapper ----------- */

describe('an authored handler key survives the `detail-view` wrapper and reaches DetailView (objectui#9447)', () => {
  it('onNavigate: the authored function is CALLED, with the arguments the call site builds', () => {
    const onNavigate = vi.fn();
    const onNeverReadByAnyKnownReader = vi.fn();
    renderDetailView({ onNavigate, onNeverReadByAnyKnownReader });

    // No `data` and no fetch inputs -> the not-found panel, whose "Go back"
    // button is wired to the same `handleBack` as the header's.
    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith('/', { replace: true });
    // The control: same document, same render, a key no reader names.
    expect(onNeverReadByAnyKnownReader).toHaveBeenCalledTimes(0);
  });

  it('onAddComment: forwarded through the wrapper into RecordComments and awaited there', async () => {
    const onAddComment = vi.fn();
    const onNeverReadByAnyKnownReader = vi.fn();
    renderDetailView({
      data: { id: '1', name: 'Acme' },
      // `comments` is itself undeclared on this arm and kept by the same
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

/* -- Suite 2: the zod face, both directions ------------------------------- */

describe('the `detail-view` arm refuses the keys its renderer reads (objectui#9447)', () => {
  const DECLARED = [['onNavigate'], ['onAddComment']] as const;
  /** The same two plus `onBack` — a named refusal on this arm since
   *  objectui#7344, so it is the LIT CONTROL for every refusal leg below. */
  const WITH_CONTROL = [...DECLARED, ['onBack']] as const;

  it.each(DECLARED)('DetailViewSchema.%s is a DECLARED member carrying the objectui#6124 runtime-slot guidance', (key) => {
    // Deliberately `.shape`, not `safeParse`: under `.passthrough()` a DELETED
    // key still parses green, so a parse-only pin stays green through the very
    // deletion it exists to catch.
    const member = DetailViewZod.shape[key] as { description?: string } | undefined;
    expect(member).toBeDefined();
    expect(member!.description).toContain('objectui#6124');
    expect(member!.description).toContain('RUNTIME SLOT');
    expect(member!.description).not.toContain('RETIRED');
  });

  it.each(WITH_CONTROL)('an authored action object on DetailViewSchema.%s is refused BY NAME', (key) => {
    const result = DetailViewZod.safeParse({ type: 'detail-view', [key]: AUTHORED_ACTION_OBJECT });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => String(i.path[0]) === key);
    expect(issue, `no issue addressed to \`${key}\``).toBeDefined();
    expect(issue!.code).toBe('custom');
    expect(issue!.message).toContain(`\`${key}\``);
  });

  it.each(WITH_CONTROL)('the refusal for %s NAMES the alternative, so the message is actionable', (key) => {
    // The other half of a by-name refusal: a message that only says "no" sends
    // the author looking for a different key instead of a different NODE.
    const result = DetailViewZod.safeParse({ type: 'detail-view', [key]: AUTHORED_ACTION_OBJECT });
    expect(result.success).toBe(false);
    if (result.success) return;
    const message = result.error.issues.find((i) => String(i.path[0]) === key)!.message;
    expect(message).toContain('NODE TYPE');
    expect(message).toContain('"type": "toast"');
  });

  it('the arm still parses GREEN without the keys — the refusal is about the key, not the document', () => {
    expect(DetailViewZod.safeParse({ type: 'detail-view', title: 'Acme' }).success).toBe(true);
  });
});

/* -- Suite 3: the boundary this card deliberately did not cross ------------ */

describe('the refusal is the MEMBER, not every key spelled onNavigate (objectui#9447)', () => {
  it('the nested `recordNavigation.onNavigate` is a different key and stays authorable', () => {
    // Different path, different signature — `(recordId) => void`, the prev/next
    // result-set walker — and a different supplier. A refusal that swallowed it
    // would be a widening this card did not measure and was not dispatched for.
    const result = DetailViewZod.safeParse({
      type: 'detail-view',
      title: 'Acme',
      recordNavigation: { recordIds: ['id1', 'id2'], currentIndex: 0, onNavigate: () => {} },
    });
    expect(result.success).toBe(true);
  });

  it('`onTabChange` is NOT refused here — it is still open on objectui#7804', () => {
    // Recorded so the next reader does not mistake this card for a sweep of the
    // arm's handler keys. It stays in the runtime-only ledger in
    // `zod-mirror-parity.test.ts`, which is the thing that will go red when it
    // is finally dispositioned.
    const result = DetailViewZod.safeParse({ type: 'detail-view', onTabChange: AUTHORED_ACTION_OBJECT });
    expect(result.success).toBe(true);
  });
});
