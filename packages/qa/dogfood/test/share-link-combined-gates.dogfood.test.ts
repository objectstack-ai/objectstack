// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#26571] `access-security.share-link-combined-gates`, acceptance[1] to
// acceptance[3] and negative[0], over HTTP on the stock showcase.
//
// `share-links-refusal-order.test.ts` and `share-links-messages-audience.test.ts`
// drive both mounts' route entries over a real engine through a minimal
// IHttpServer stand-in — no Hono, no HTTP. This file mints two links through
// the real mint door on a seeded showcase record and drives the public token
// routes anonymously:
//
//   - link A, audience `signed_in` + a password: `/resolve` answers 401
//     SIGN_IN_REQUIRED for no password, a wrong one and the right one (sent
//     in the UTF-8 header form), byte-identical — the password is never
//     evaluated first, so a password-correct anonymous caller reads nothing
//     (negative[0]);
//   - link B, audience `email` + a password: every non-entitled variant
//     answers the same 404 INVALID_OR_EXPIRED body, which is also what an
//     unknown token answers; an allowlisted email with the right password is
//     the one that resolves (the control);
//   - `/messages` on the same call: refused (404 NOT_FOUND) exactly where
//     `/resolve` refused, open where it passed — 400 UNSUPPORTED, since a
//     showcase brief is no `ai_conversations` record.
//
// Isolated boot: the file mints links.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const SYS = { isSystem: true } as const;
const OBJECT = 'showcase_client_brief';
const PUBLISHED_BRIEF = 'Northwind — Website Relaunch brief';
const PW_A = 'pässwort-A-26571';
const PW_B = 'pässwort-B-26571';
const ALLOWED = 'allowed.reader@example.com';
const OFF_LIST = 'stranger@example.com';

interface Answer { status: number; code: unknown; text: string }

const codeOf = (body: any) =>
  (body?.error && typeof body.error === 'object' ? body.error.code : undefined) ?? body?.code ?? null;

/** The password the way the console's landing page sends it: UTF-8, percent-encoded, declared. */
const passwordHeaders = (password?: string): Record<string, string> =>
  password === undefined ? {} : { 'x-share-password': encodeURIComponent(password), 'x-share-password-encoding': 'utf-8' };

describe('share-link combined gates, anonymously over HTTP', () => {
  let stack: VerifyStack;
  let tokenA: string;
  let tokenB: string;

  const anon = async (path: string, password?: string): Promise<Answer> => {
    const res = await stack.raw(`/api/v1${path}`, { method: 'GET', headers: passwordHeaders(password) });
    const text = await res.text();
    let body: any = null;
    try { body = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, code: codeOf(body), text };
  };
  const both = async (token: string, query: string, password?: string) => ({
    resolve: await anon(`/share-links/${token}/resolve${query}`, password),
    messages: await anon(`/share-links/${token}/messages${query}`, password),
  });

  beforeAll(async () => {
    stack = await bootShowcase();
    const admin = await stack.signIn();
    const ql: any = await stack.kernel.getServiceAsync('objectql');
    const briefId = String((await ql.findOne(OBJECT, { where: { title: PUBLISHED_BRIEF }, context: SYS }))?.id ?? '');
    expect(briefId, 'the seeded published brief').toBeTruthy();

    const mint = async (body: Record<string, unknown>) => {
      const res = await stack.apiAs(admin, 'POST', '/share-links', { object: OBJECT, recordId: briefId, ...body });
      const text = await res.text();
      expect(res.status, `mint: ${text}`).toBe(201);
      return String(JSON.parse(text)?.data?.token ?? '');
    };
    tokenA = await mint({ audience: 'signed_in', password: PW_A, label: 'combined-gates A' });
    tokenB = await mint({ audience: 'email', emailAllowlist: [ALLOWED], password: PW_B, label: 'combined-gates B' });
    expect(tokenA && tokenB, 'both tokens minted').toBeTruthy();
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('acceptance[1] / negative[0]: link A answers 401 SIGN_IN_REQUIRED for no, a wrong and the right password — byte-identical', async () => {
    const answers = [await anon(`/share-links/${tokenA}/resolve`), await anon(`/share-links/${tokenA}/resolve`, 'wrong-password'), await anon(`/share-links/${tokenA}/resolve`, PW_A)];
    for (const a of answers) expect([a.status, a.code], a.text).toEqual([401, 'SIGN_IN_REQUIRED']);
    expect(new Set(answers.map((a) => a.text)).size, 'no anonymous password oracle').toBe(1);
  });

  it('acceptance[2]: link B answers one 404 INVALID_OR_EXPIRED body to every non-entitled variant — the unknown token\'s body', async () => {
    const variants = [
      await anon(`/share-links/${tokenB}/resolve`),
      await anon(`/share-links/${tokenB}/resolve`, PW_B),
      await anon(`/share-links/${tokenB}/resolve?email=${encodeURIComponent(OFF_LIST)}`, PW_B),
      await anon(`/share-links/${tokenB}/resolve?email=${encodeURIComponent(ALLOWED)}`, 'wrong-password'),
      await anon(`/share-links/${tokenB}/resolve?email=${encodeURIComponent(ALLOWED)}`),
    ];
    for (const v of variants) expect([v.status, v.code], v.text).toEqual([404, 'INVALID_OR_EXPIRED']);
    const unknown = await anon('/share-links/not-a-real-token-26571/resolve');
    expect(new Set([...variants, unknown].map((v) => v.text)).size, 'one body, the unknown token\'s too').toBe(1);
  });

  it('control: an allowlisted email with the right password resolves link B', async () => {
    const ok = await anon(`/share-links/${tokenB}/resolve?email=${encodeURIComponent(ALLOWED)}`, PW_B);
    expect(ok.status, ok.text).toBe(200);
  });

  it('acceptance[3]: /messages is refused exactly where /resolve refuses, and open exactly where it passes', async () => {
    const calls = [
      await both(tokenA, ''),
      await both(tokenA, '', 'wrong-password'),
      await both(tokenA, '', PW_A),
      await both(tokenB, ''),
      await both(tokenB, '', PW_B),
      await both(tokenB, `?email=${encodeURIComponent(OFF_LIST)}`, PW_B),
      await both(tokenB, `?email=${encodeURIComponent(ALLOWED)}`, 'wrong-password'),
      await both(tokenB, `?email=${encodeURIComponent(ALLOWED)}`, PW_B),
    ];
    for (const { resolve, messages } of calls) {
      const resolveOpen = resolve.status === 200;
      if (resolveOpen) {
        expect([messages.status, messages.code], `open: ${messages.text}`).toEqual([400, 'UNSUPPORTED']);
      } else {
        expect([401, 404, 410], resolve.text).toContain(resolve.status);
        expect([messages.status, messages.code], `refused: ${messages.text}`).toEqual([404, 'NOT_FOUND']);
      }
    }
    expect(calls.filter((c) => c.resolve.status === 200), 'the open pairing is exercised').toHaveLength(1);
  });
});
