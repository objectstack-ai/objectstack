// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui-SHA drift guard — the seat on the boot path itself (#7752).
 *
 * `pnpm check:console-sha` guards the root `pnpm dev` / `dev:showcase` /
 * `dev:crm` / `dev:todo` scripts. Every other way to boot reaches the server
 * without passing it: `objectstack dev` run inside an example dir, an
 * example's own `dev` script (`objectstack dev --seed-admin`), a
 * `.claude/launch.json` config driving `pnpm exec objectstack dev`. A QA sweep
 * booted that way and spent the run measuring a console two days behind the
 * repo's pin, with a warning the boot log scrolled past.
 *
 * `decideConsoleMount` is what closes it: on drift it can *prove*, the dev
 * server does not mount the Console at all, so the stale bundle is
 * unreachable rather than silently authoritative. Detection semantics
 * (`detectConsoleShaDrift`) are pinned in `test/console-resolve.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import {
  decideConsoleMount,
  formatConsoleShaDriftRefusal,
  formatConsoleShaDriftWarning,
  DRIFT_OVERRIDE_ENV,
} from './console.js';

/** The exact gap #7752 measured: pin two days ahead of the served bundle. */
const drift = {
  pin: '6314e87f2d49b1ff3b158c296f1b2a52d14dff68',
  stamp: '09987b680aa1c3e4f5061d2b7c8a9e0f1a2b3c4d',
  pinFile: '/repo/.objectui-sha',
};

describe('decideConsoleMount', () => {
  it('refuses to mount a drifted console under `os dev`', () => {
    expect(decideConsoleMount({ hasDist: true, drift, isDev: true, env: {} })).toEqual({
      mount: false,
      refusedForDrift: true,
    });
  });

  it('mounts when the dist matches the pin — no false positive', () => {
    expect(decideConsoleMount({ hasDist: true, drift: null, isDev: true, env: {} })).toEqual({
      mount: true,
      refusedForDrift: false,
    });
  });

  it('leaves non-dev serves advisory — a published install carries no pin anyway', () => {
    expect(decideConsoleMount({ hasDist: true, drift, isDev: false, env: {} })).toEqual({
      mount: true,
      refusedForDrift: false,
    });
  });

  it(`boots the stale bundle deliberately when ${DRIFT_OVERRIDE_ENV} is set`, () => {
    for (const value of ['1', 'true', 'yes', 'on', 'TRUE']) {
      expect(
        decideConsoleMount({
          hasDist: true,
          drift,
          isDev: true,
          env: { [DRIFT_OVERRIDE_ENV]: value },
        }),
      ).toEqual({ mount: true, refusedForDrift: false });
    }
  });

  it('does not read an unset-looking value as an override', () => {
    for (const value of ['0', 'false', 'no', '']) {
      expect(
        decideConsoleMount({
          hasDist: true,
          drift,
          isDev: true,
          env: { [DRIFT_OVERRIDE_ENV]: value },
        }),
      ).toEqual({ mount: false, refusedForDrift: true });
    }
  });

  it('keeps "no dist at all" distinct from "refused for drift"', () => {
    // Both leave the Console unmounted, but they need different messages —
    // "run objectui:build" vs the existing "console dist not found" hint.
    expect(decideConsoleMount({ hasDist: false, drift: null, isDev: true, env: {} })).toEqual({
      mount: false,
      refusedForDrift: false,
    });
  });
});

describe('drift messages', () => {
  it('names the rebuild, never the pin bump — refresh would move the pin instead', () => {
    for (const message of [
      formatConsoleShaDriftWarning(drift),
      formatConsoleShaDriftRefusal(drift),
    ]) {
      expect(message).toContain('pnpm objectui:build');
    }
    // `objectui:refresh` appears only as the explicitly-labelled wrong turn.
    expect(formatConsoleShaDriftRefusal(drift)).toContain(
      "(Use 'pnpm objectui:refresh' only when you intend to move the pin",
    );
  });

  it('shows both SHAs and the escape hatch, so the boot log is self-explaining', () => {
    const message = formatConsoleShaDriftRefusal(drift);
    expect(message).toContain(drift.pin.slice(0, 12));
    expect(message).toContain(drift.stamp.slice(0, 12));
    expect(message).toContain(drift.pinFile);
    expect(message).toContain(DRIFT_OVERRIDE_ENV);
  });
});
