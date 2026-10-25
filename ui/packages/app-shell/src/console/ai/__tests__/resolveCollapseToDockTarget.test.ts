/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * ADR-0057 P3c — the `/ai` page's "collapse to dock" landing: the remembered
 * maximize origin wins, else history back when react-router has an in-app
 * entry to return to, else home (deep link / fresh tab — nothing behind us
 * worth going "back" to).
 *
 * objectui#7373 made that last rung a PARAMETER. The page passes
 * `useHomePath()`, so a deployment that declares a landing gets its own home
 * here, and one that declares none gets `HOME_LAUNCHER_PATH` — which is why
 * both spellings appear below: the declared answer is what the card changed,
 * the launcher answer is the status quo it must not disturb.
 */
import { describe, it, expect } from 'vitest';
import { resolveCollapseToDockTarget } from '../AiChatPage';
import { HOME_LAUNCHER_PATH } from '../../../utils/homePath';

/** A control plane's declared landing — what `useHomePath()` answers there. */
const DECLARED = '/apps/cloud_control';

describe('resolveCollapseToDockTarget', () => {
  it('prefers the remembered maximize origin over history', () => {
    expect(resolveCollapseToDockTarget(3, '/apps/crm/objects/deal', DECLARED)).toBe(
      '/apps/crm/objects/deal',
    );
    // Even a deep-linked page (idx 0) returns to the stored origin.
    expect(resolveCollapseToDockTarget(0, '/studio/com.example/interfaces', DECLARED)).toBe(
      '/studio/com.example/interfaces',
    );
  });

  it('goes back when react-router stamped a positive history index', () => {
    expect(resolveCollapseToDockTarget(1, undefined, DECLARED)).toBe(-1);
    expect(resolveCollapseToDockTarget(7, undefined, HOME_LAUNCHER_PATH)).toBe(-1);
  });

  it('lands on the DECLARED home when this page is the entry point (idx 0)', () => {
    // objectui#7373: the case the card is about. A control-plane customer who
    // deep-linked into `/ai` must not be tipped out into the environment
    // launcher, whose cards act on an environment they do not have.
    expect(resolveCollapseToDockTarget(0, undefined, DECLARED)).toBe(DECLARED);
  });

  it('lands on the declared home when the index is missing or not a number', () => {
    expect(resolveCollapseToDockTarget(undefined, undefined, DECLARED)).toBe(DECLARED);
    expect(resolveCollapseToDockTarget(null, undefined, DECLARED)).toBe(DECLARED);
    expect(resolveCollapseToDockTarget('2', undefined, DECLARED)).toBe(DECLARED);
    expect(resolveCollapseToDockTarget(NaN, undefined, DECLARED)).toBe(DECLARED);
  });

  it('keeps the launcher where the deployment declares no landing — the status quo', () => {
    // `useHomePath()` answers `HOME_LAUNCHER_PATH` for every ordinary
    // environment, so this is the unchanged behaviour of every rung above.
    expect(resolveCollapseToDockTarget(0, undefined, HOME_LAUNCHER_PATH)).toBe('/home');
    expect(resolveCollapseToDockTarget(NaN, undefined, HOME_LAUNCHER_PATH)).toBe('/home');
  });
});
