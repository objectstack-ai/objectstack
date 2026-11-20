// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import {
  printHeader,
  printSuccess,
  printWarning,
  printError,
  printInfo,
  printStep,
  isExitSignal,
} from '../../utils/format.js';
import { bootSchemaStack } from '../../utils/schema-migrate.js';
import { composeProviderForDeclarations } from '../../utils/schema-migration-plugins.js';

/**
 * `os user set-password <email>` — the operator's password reset, run on the
 * server against the project database.
 *
 * A server outside development mode refuses a development seed credential
 * (`@objectstack/plugin-auth`, `dev-seed-credential.ts`) and opens no session
 * in which it could be changed: whoever signed in first could change it. Its
 * refusal names this command. The reset itself is plugin-auth's
 * `setOperatorPassword`: it writes the account's password credential with
 * better-auth's own hash, clears the development seed stamp and a sign-in
 * lock, and ends every session, API key and linked sign-in account of the
 * account.
 *
 * - **The password never travels on the command line**, where a shell history
 *   and the process table keep it: it is asked for twice, unechoed, on a
 *   terminal, or read from standard input with `--password-stdin`.
 * - **The account is resolved first**, so an address no account holds is
 *   refused before any password is asked for.
 * - **Operator-only.** No HTTP surface: it runs where the database is.
 */
export default class UserSetPassword extends Command {
  static override description =
    'Set a user\'s password in the project database, ending the account\'s sessions, API keys and linked '
    + 'sign-in accounts. '
    + 'The reset a server outside development mode names when it refuses a development seed credential.';

  static override examples = [
    '<%= config.bin %> user set-password admin@example.com',
    '<%= config.bin %> user set-password admin@example.com --password-stdin',
  ];

  static override args = {
    email: Args.string({ description: 'The email address of the account', required: true }),
  };

  static override flags = {
    'password-stdin': Flags.boolean({
      description: 'Read the new password from standard input instead of asking for it',
      default: false,
    }),
    'database-url': Flags.string({
      description: 'Database URL (defaults to $OS_DATABASE_URL / the project DB)',
      env: 'OS_DATABASE_URL',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(UserSetPassword);
    printHeader('User · set password');
    printStep('Booting…');

    const { createIdentityObjectsPlugin, findAccountByEmail, operatorPasswordRefusal, setOperatorPassword } =
      await import('@objectstack/plugin-auth');

    let stack;
    try {
      stack = await bootSchemaStack({
        jsonOutput: false,
        databaseUrl: flags['database-url'],
        // The identity objects (`sys_user`, `sys_account`, `sys_session`,
        // `sys_api_key`) for their declarations only: no auth manager, no
        // authentication, nothing started.
        extraPlugins: [composeProviderForDeclarations(createIdentityObjectsPlugin())],
      });
    } catch (error) {
      if (isExitSignal(error)) throw error;
      printError(error instanceof Error ? error.message : String(error));
      this.exit(1);
      return;
    }

    let failure: string | undefined;
    try {
      const engine = stack.kernel.getService('objectql');
      if (!engine) {
        failure = 'No ObjectQL engine on this runtime, so no account can be read.';
      } else if (!(await findAccountByEmail(engine, args.email))) {
        failure = `No account has the email address ${args.email.trim()}.`;
      } else {
        const given = flags['password-stdin'] ? await readStdin() : await askTwice();
        const refusal = 'refused' in given ? given.refused : operatorPasswordRefusal(given.password)?.message;
        if ('refused' in given || refusal !== undefined) {
          failure = refusal;
        } else {
          const outcome = await setOperatorPassword(engine, { email: args.email, password: given.password }, {
            logger: { warn: (message: string) => printWarning(message) },
          });
          if (outcome.outcome === 'refused') {
            failure = outcome.message;
          } else {
            printSuccess(`The password of ${args.email.trim()} is set.`);
            printInfo(
              `${outcome.sessionsEnded} session(s) ended, ${outcome.apiKeysRevoked} API key(s) revoked and `
                + `${outcome.signInAccountsUnlinked} linked sign-in account(s) unlinked; `
                + 'the account signs in with the new password.',
            );
            if (!outcome.revocationComplete) {
              printWarning(
                'Not every session, API key or linked sign-in account could be ended: end the rest by hand.',
              );
            }
          }
        }
      }
    } finally {
      await stack.shutdown();
    }
    if (failure !== undefined) {
      printError(failure);
      this.exit(1);
    }
  }
}

/** A password the operator gave, or why none was taken. */
type GivenPassword = { password: string } | { refused: string };

/** The whole of standard input, without one trailing line break. */
async function readStdin(): Promise<GivenPassword> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  const text = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
  return text === '' ? { refused: 'Standard input held no password.' } : { password: text };
}

/** Ask for the password twice on a terminal, without echoing it. */
async function askTwice(): Promise<GivenPassword> {
  if (!process.stdin.isTTY) {
    return { refused: 'Standard input is not a terminal, so no password can be asked for: pass --password-stdin.' };
  }
  const first = await askUnechoed('New password: ');
  const second = await askUnechoed('Repeat it: ');
  if (first !== second) return { refused: 'The two passwords differ, so none was set.' };
  return first === '' ? { refused: 'No password was given.' } : { password: first };
}

function askUnechoed(question: string): Promise<string> {
  process.stdout.write(question);
  const silent = new Writable({ write: (_chunk, _encoding, done) => done() });
  const rl = createInterface({ input: process.stdin, output: silent, terminal: true });
  return new Promise((resolve) => {
    rl.question('', (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}
