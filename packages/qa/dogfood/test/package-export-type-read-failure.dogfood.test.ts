// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#29760] A package export is the package's whole content or no answer: when
// the read of one metadata type the runtime serves fails, `GET
// /packages/:id/export` refuses, naming the package and the type, instead of
// answering 200 without that type's collection.
//
// ## What was measured before the fix
//
// `assemblePackageManifest` caught every per-type read failure as an
// "unknown/unsupported type" and skipped it. The read below fails the way a
// storage fault does on the real protocol: the overlay rows of `dashboard`
// cannot be read, which the protocol rethrows (only an unprovisioned
// `sys_metadata` licenses it to answer without them). The export then answered
// 200 with the showcase's objects and no `dashboards` key at all, so a
// reinstall from it would land without a dashboard and tell nobody.
//
// ## What this file pins, on one showcase boot
//
//   1. CONTROL: the showcase's export answers 200 and carries its dashboards;
//   2. the dashboard overlay read failing: the export answers 500, naming the
//      package and `dashboard`, and serves no manifest;
//   3. CONTROL: the read restored, the export answers 200 with the dashboards
//      again (the failure was the read's, not the boot's).
//
// The fault is injected on the protocol's own overlay read
// (`readActiveOverlayRows`, which the moved list body reaches through the
// host's call-time closure), never on the export door, so the whole real read
// path runs. It boots a stack of its own, so it stays out of `SHARED_SHOWCASE`.

import { describe, it, expect, beforeAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const SHOWCASE = 'com.example.showcase';
const FAILING = 'dashboard';

type Answer = { status: number; body: any };

async function call(stack: VerifyStack, token: string, method: string, path: string): Promise<Answer> {
  const res = await stack.apiAs(token, method, path);
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe('dogfood: a package export refuses when the read of a type the runtime serves fails', () => {
  let before: Answer;
  let failed: Answer;
  let after: Answer;
  let overlayReadsRefused = 0;

  beforeAll(async () => {
    const stack = await bootShowcase();
    try {
      const token = await stack.signIn();
      before = await call(stack, token, 'GET', `/packages/${SHOWCASE}/export`);

      const protocol = stack.kernel.getService('protocol') as {
        readActiveOverlayRows(request: { type: string }): Promise<unknown>;
      };
      const original = protocol.readActiveOverlayRows;
      protocol.readActiveOverlayRows = async function (this: unknown, request: { type: string }) {
        if (request.type === FAILING) {
          overlayReadsRefused += 1;
          throw new Error(`dogfood: the ${FAILING} overlay rows could not be read`);
        }
        return original.call(protocol, request);
      };
      try {
        failed = await call(stack, token, 'GET', `/packages/${SHOWCASE}/export`);
      } finally {
        protocol.readActiveOverlayRows = original;
      }

      after = await call(stack, token, 'GET', `/packages/${SHOWCASE}/export`);
    } finally {
      await stack.stop();
    }
  }, 600_000);

  it('CONTROL: the showcase\'s export answers 200 and carries its dashboards', () => {
    expect(before.status, JSON.stringify(before.body)).toBe(200);
    expect((before.body?.data?.dashboards ?? []).length).toBeGreaterThan(0);
  });

  it('a failed dashboard read refuses the export, naming the package and the type, and serves no manifest', () => {
    // The injected fault was reached: the export read the type through it.
    expect(overlayReadsRefused).toBeGreaterThan(0);
    expect(failed.status, JSON.stringify(failed.body)).toBe(500);
    expect(failed.body?.success).toBe(false);
    expect(failed.body?.data).toBeUndefined();
    expect(failed.body?.error?.code).toBe('INTERNAL_ERROR');
    const message = String(failed.body?.error?.message ?? '');
    expect(message).toContain(`'${SHOWCASE}'`);
    expect(message).toContain(`'${FAILING}'`);
  });

  it('CONTROL: the read restored, the export answers 200 with the dashboards again', () => {
    expect(after.status, JSON.stringify(after.body)).toBe(200);
    expect((after.body?.data?.dashboards ?? []).map((d: any) => d.name))
      .toEqual((before.body?.data?.dashboards ?? []).map((d: any) => d.name));
  });
});
