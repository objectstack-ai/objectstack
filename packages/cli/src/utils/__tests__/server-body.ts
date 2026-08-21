// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Build a response body the way the SERVER builds it.
 *
 * Shared by the tests that drive CLI commands against real response bodies
 * (#10675). It exists so those fixtures are produced by `sendOk` / `sendError`
 * — the one writer of the declared envelope — instead of being typed out as
 * literals: the defect they cover was a hand-copied server shape that went on
 * agreeing with itself for as long as nobody re-derived it, and a transcribed
 * fixture reproduces that failure mode one layer up.
 *
 * Lives under `__tests__/` (not `*.test.ts`) deliberately: that glob is already
 * excluded from `tsconfig.build.json`, so this helper is type-checked with the
 * package but never shipped in `dist/`, and vitest does not collect it as a
 * suite of its own.
 */

import type { EnvelopeResponse } from '@objectstack/types';

/**
 * Run one `sendOk`/`sendError` call against a capture-only response and return
 * the JSON body it wrote.
 */
export function serverBody(write: (res: EnvelopeResponse) => void): unknown {
  let captured: unknown;
  const res: EnvelopeResponse = {
    status() {
      return res;
    },
    json(body: unknown) {
      captured = body;
      return body;
    },
  };
  write(res);
  return captured;
}
