// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { createInterface } from 'node:readline';

/**
 * A yes/no question on the terminal, for a command that can offer a
 * confirmation inline instead of only printing the retry line.
 *
 * Asked only when a person is there to answer: stdin AND stdout are both a
 * TTY. Piped, in CI, or under `os dev`'s backgrounded runs, nothing is asked
 * and the caller prints its retry line as before — a question nobody can
 * answer would hang the command.
 *
 * `os dev`'s deploy key runs `os deploy` as a child on the same terminal and
 * hands the terminal back (raw mode off) while the child runs
 * (`utils/dev-deploy-key.ts`), so the child reads the answer as typed.
 *
 * Its own module so a test can answer the question without a terminal.
 */
export function canAskOnTerminal(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/** Ask `question`; true only for an explicit `y` / `yes`. Anything else, an empty line included, is no. */
export async function askYesNo(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer: string = await new Promise((resolve) => rl.question(question, resolve));
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}
