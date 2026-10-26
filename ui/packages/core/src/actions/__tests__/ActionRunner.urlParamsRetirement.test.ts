/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `params.newTab` is RETIRED on a url action — and the sanctioned spellings it
 * used to shadow are pinned here so the removal cannot quietly come back.
 *
 * The objectstack maintainer ruling of 2026-08-10 (objectstack#6828, comment
 * 5237221393) retired the url-side readings of an OBJECT-form `params`. The
 * contract half shipped in objectstack PR #7375; the spec's refusal message now
 * says so in as many words — measured against the installed
 * `@objectstack/spec@17.0.0-rc.6`:
 *
 *   "The url-side readings of an object `params` — a static `${param.X}` scope,
 *    and `params.newTab` — are RETIRED, not renamed (#6828)."
 *
 * This file removes the `params.newTab` half only. The `${param.X}` scope half
 * is NOT dead in this repo and is deliberately left standing — four internal
 * callers synthesize a non-array `params` as the runtime VALUE bag that the
 * scope reads (ActionRunner's own collected-params merge, plugin-grid's
 * aggregate `_selectedIds` dispatch, the record-header `_rowRecord` stash, and
 * the nav-item value bag). Retiring it needs a non-authorable channel for those
 * values, which is a cross-package contract change — see objectui#4097.
 *
 * `params.newTab` has no such caller: every synthesized bag carries collected
 * dialog values, `_selectedIds` or `_rowRecord`, never a navigation directive.
 * The only shape that could reach it is an AUTHORED object `params`, which the
 * spec has always refused at parse time — so the read could only ever fire on a
 * stack that never validated.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { ActionRunner, type NavigationHandler } from '../ActionRunner';

// Every `navHandler` below is typed with `setNavigationHandler`'s own signature.
// `ReturnType<typeof vi.fn>` resolves to the un-instantiated `Mock<Procedure |
// Constructable>`, which the setter does not accept and whose `mock.calls[0]`
// is the EMPTY tuple — so the `calls[0][0]` assertions in this file were reading
// element 0 of an empty tuple as far as the compiler was concerned
// (objectui#4040).

describe('url action: `openIn` is the sanctioned new-tab spelling (objectstack#6828)', () => {
  let runner: ActionRunner;
  let navHandler: Mock<NavigationHandler>;

  beforeEach(() => {
    runner = new ActionRunner({});
    navHandler = vi.fn();
    runner.setNavigationHandler(navHandler);
  });

  // ── The sanctioned spelling, positive ──────────────────────────────────────
  it('`openIn: "new-tab"` opens a new tab', async () => {
    await runner.execute({ type: 'url', name: 'print', target: '/print/a4', openIn: 'new-tab' });

    expect(navHandler).toHaveBeenCalledWith(
      '/print/a4',
      expect.objectContaining({ newTab: true }),
    );
  });

  it('`openIn: "self"` keeps an EXTERNAL url in the same tab — it outranks the heuristic', async () => {
    await runner.execute({ type: 'url', name: 'docs', target: 'https://example.com/docs', openIn: 'self' });

    expect(navHandler).toHaveBeenCalledWith(
      'https://example.com/docs',
      expect.objectContaining({ newTab: false }),
    );
  });

  // ── The retirement, negative ───────────────────────────────────────────────
  // Red against the unfixed tree: `params.newTab` used to be read below `openIn`
  // and above the external/relative default, so it forced a new tab here.
  it('object-form `params.newTab` no longer opens a new tab — the read is RETIRED', async () => {
    await runner.execute({
      type: 'url',
      name: 'open_report',
      target: '/reports/r1',
      // The retired shape. No author can produce it (the spec refuses object
      // `params`), and no internal caller synthesizes a navigation directive
      // into the value bag — so nothing legitimate reaches this read.
      params: { newTab: true } as never,
    });

    expect(navHandler).toHaveBeenCalledWith(
      '/reports/r1',
      // Relative url with no `openIn` ⇒ the surviving default is same-tab.
      expect.objectContaining({ newTab: false }),
    );
  });

  it('`params.newTab` cannot override an explicit `openIn: "self"` either', async () => {
    await runner.execute({
      type: 'url',
      name: 'open_report',
      target: 'https://example.com/r1',
      openIn: 'self',
      params: { newTab: true } as never,
    });

    expect(navHandler).toHaveBeenCalledWith(
      'https://example.com/r1',
      expect.objectContaining({ newTab: false }),
    );
  });

  // ── What the retirement must NOT touch ─────────────────────────────────────
  it('the external-url default still opens a new tab without any `openIn`', async () => {
    await runner.execute({ type: 'url', name: 'docs', target: 'https://example.com/docs' });

    expect(navHandler).toHaveBeenCalledWith(
      'https://example.com/docs',
      expect.objectContaining({ newTab: true }),
    );
  });

  it('the legacy `navigate.newTab` escape hatch is a DIFFERENT read and survives', async () => {
    // `source.newTab` on the nested `navigate` block is the `navigation` shape's
    // own modifier, not the retired `params` reading. #6828 does not touch it.
    await runner.execute({ type: 'navigation', name: 'print', navigate: { to: '/print/a3', newTab: true } });

    expect(navHandler).toHaveBeenCalledWith(
      '/print/a3',
      expect.objectContaining({ newTab: true }),
    );
  });
});

describe('url action: `${param.X}` still interpolates the COLLECTED dialog values', () => {
  let runner: ActionRunner;
  let navHandler: Mock<NavigationHandler>;

  beforeEach(() => {
    runner = new ActionRunner({});
    navHandler = vi.fn();
    runner.setNavigationHandler(navHandler);
  });

  // The live mechanism the ruling explicitly keeps — the spec's own refusal
  // message names it: "`${param.X}` interpolates a value collected by the
  // params dialog". Green on BOTH sides of the `params.newTab` removal.
  it('interpolates a value the params dialog collected, URL-encoded', async () => {
    runner.setParamCollectionHandler(async () => ({ provider: 'acme corp' }));

    await runner.execute({
      type: 'url',
      name: 'sign_in',
      // Deliberately NOT an `/api/…` path: those short-circuit to a full-page
      // `window.location.href` navigation before the handler is consulted.
      target: '/reports/social?provider=${param.provider}',
      // ARRAY `params` — the surviving meaning of the key: a DEFINITION list the
      // runner collects through the dialog before executing.
      params: [{ name: 'provider', label: 'Provider', type: 'text' }] as never,
    });

    expect(navHandler.mock.calls[0][0]).toBe('/reports/social?provider=acme%20corp');
  });

  it('degrades a token the dialog did not collect to an empty string', async () => {
    runner.setParamCollectionHandler(async () => ({ provider: 'acme' }));

    await runner.execute({
      type: 'url',
      name: 'sign_in',
      target: '/go?provider=${param.provider}&team=${param.team}',
      params: [{ name: 'provider', label: 'Provider', type: 'text' }] as never,
    });

    expect(navHandler.mock.calls[0][0]).toBe('/go?provider=acme&team=');
  });
});

describe('url action: `${ctx.X}` is untouched by the retirement (control)', () => {
  let runner: ActionRunner;
  let navHandler: Mock<NavigationHandler>;

  beforeEach(() => {
    navHandler = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('interpolates `${ctx.recordId}` and `${ctx.user.*}` from the action context', async () => {
    runner = new ActionRunner({ recordId: 'rec 42', user: { id: 'u1' } });
    runner.setNavigationHandler(navHandler);

    await runner.execute({
      type: 'url',
      name: 'audit',
      target: '/audit?rec=${ctx.recordId}&by=${ctx.user.id}',
    });

    expect(navHandler.mock.calls[0][0]).toBe('/audit?rec=rec%2042&by=u1');
  });

  it('interpolates `${ctx.selection.ids}` from the grid selection', async () => {
    runner = new ActionRunner({ selectedRecords: [{ id: 'd1' }, { id: 'd2' }] });
    runner.setNavigationHandler(navHandler);

    await runner.execute({ type: 'url', name: 'zip', target: '/qr/zip?ids=${ctx.selection.ids}' });

    expect(navHandler.mock.calls[0][0]).toBe('/qr/zip?ids=d1%2Cd2');
  });
});
