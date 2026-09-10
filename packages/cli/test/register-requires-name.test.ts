// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os register` and the door it actually knocks on must agree about `name`.
 *
 * MEASURED, not inferred (a fresh showcase environment with no human user yet,
 * so the audience gate's bootstrap bypass admits the sign-up and the only
 * judge left is the route's own validation):
 *
 *   empty Name answer -> POST /api/v1/auth/sign-up/email
 *                        400 VALIDATION_ERROR
 *                        "[body.name] Invalid input: expected string, received undefined"
 *   same run, name supplied (positive control, same environment, same route)
 *                     -> 200, account created
 *
 * So the route REQUIRES `name`, `RegisterRequestSchema` declares it correctly,
 * and the command was advertising a field as "(optional)" that the first-use
 * path cannot omit. The request-side `as any` at the call site is what kept
 * that disagreement off the compiler: with it gone the payload is annotated
 * with the declared `RegisterRequest`, so a future divergence is a type error
 * instead of a runtime 400 a user meets on their first command.
 *
 * Both halves are pinned here, and neither is optional:
 *
 *   REFUSAL     — an empty answer is refused by the CLI, BEFORE any request is
 *                 made (the route was never called). A test that only asserted
 *                 "it fails" would pass just as well on the pre-fix command,
 *                 which also failed — one HTTP round trip later, with the
 *                 server's field-path message instead of the CLI's own.
 *   PRESERVATION— when a name IS supplied, the wire body is exactly the three
 *                 declared members. This is what stops the refusal from being
 *                 "fixed" by sending an empty string, which the route's
 *                 `z.string()` accepts and which would create an account whose
 *                 display name is blank.
 *
 * The prompt text is pinned alongside them: the false promise lived in that
 * string, and nothing else in the tree carries it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Register from '../src/commands/register.js';

/** Answers handed to `rl.question`, in prompt order. */
let answers: string[] = [];
/** Every prompt string the command actually asked. */
let asked: string[] = [];

vi.mock('node:readline/promises', () => ({
  createInterface: () => ({
    question: async (prompt: string) => {
      asked.push(prompt);
      return answers.shift() ?? '';
    },
    close: () => {},
  }),
}));

vi.mock('../src/utils/auth-config.js', () => ({
  writeAuthConfig: vi.fn(async () => {}),
}));

const URL_FLAG = 'http://route.test';
const EMAIL = 'first-run@example.com';
const PASSWORD = 'Passw0rd123';

/** A `fetch` stub that records its calls and answers like the real route. */
function stubFetch(): ReturnType<typeof vi.fn> {
  const impl = vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => null },
    json: async () => ({ token: 'tok_1', user: { id: 'usr_1', email: EMAIL } }),
  }) as any);
  vi.stubGlobal('fetch', impl);
  return impl;
}

/** Run the command, capturing everything it printed. */
async function runRegister(argv: string[]): Promise<{ output: string; threw: unknown }> {
  const lines: string[] = [];
  const capture = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  vi.spyOn(console, 'log').mockImplementation(capture);
  vi.spyOn(console, 'error').mockImplementation(capture);
  let threw: unknown;
  try {
    await Register.run(argv);
  } catch (error) {
    threw = error;
  }
  return { output: lines.join('\n'), threw };
}

describe('os register — the prompt, the payload and the route agree about `name`', () => {
  let exitCode: number | undefined;

  beforeEach(() => {
    answers = [];
    asked = [];
    exitCode = process.exitCode;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    // oclif's default `catch` sets process.exitCode on the refusal case; leaving
    // it set would fail the whole vitest run on a suite that passed.
    process.exitCode = exitCode;
  });

  it('refuses an empty name WITHOUT calling the route', async () => {
    const fetchImpl = stubFetch();
    answers = ['']; // the Name prompt, answered with a bare Enter

    const { output, threw } = await runRegister([
      '--url', URL_FLAG, '--email', EMAIL, '--password', PASSWORD,
    ]);

    expect(threw).toBeDefined();
    expect(output).toContain('Name is required');
    // The half that distinguishes this fix from the defect: no request went out.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('no longer advertises the field as optional', async () => {
    stubFetch();
    answers = ['Jane Doe'];

    await runRegister(['--url', URL_FLAG, '--email', EMAIL, '--password', PASSWORD]);

    expect(asked).toContain('Name: ');
    expect(asked.join('\n')).not.toMatch(/optional/i);
  });

  it('sends exactly the declared request members when a name is supplied', async () => {
    const fetchImpl = stubFetch();
    answers = ['Jane Doe'];

    const { threw } = await runRegister([
      '--url', URL_FLAG, '--email', EMAIL, '--password', PASSWORD,
    ]);

    expect(threw).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${URL_FLAG}/api/v1/auth/sign-up/email`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      email: EMAIL,
      password: PASSWORD,
      name: 'Jane Doe',
    });
  });

  it('accepts the name from the flag without prompting for it', async () => {
    const fetchImpl = stubFetch();

    await runRegister([
      '--url', URL_FLAG, '--email', EMAIL, '--password', PASSWORD, '--name', 'Flagged Name',
    ]);

    expect(asked).toEqual([]);
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body)).name).toBe('Flagged Name');
  });
});
