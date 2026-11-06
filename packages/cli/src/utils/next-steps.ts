// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * What the CLI tells a developer to do next — so nobody has to remember a
 * command to find the next one.
 *
 * - {@link BUILD_NEXT_STEP}: printed after a successful `os build` (not
 *   `os compile`, which `os dev` runs on every boot and rebuild, where a line
 *   per rebuild would be noise).
 * - {@link EVERYDAY_COMMANDS}: the first block of bare `os` (and `os --help`),
 *   ahead of oclif's full alphabetical listing (`src/help.ts`).
 *
 * Every id here must resolve to a real command; `test/next-steps.test.ts`
 * holds them to the built command table.
 */

/** The line after a successful `os build`. */
export const BUILD_NEXT_STEP =
  'Next: `os deploy` builds, publishes and installs this app on your ObjectOS Cloud environment.';

/** The few commands of the everyday loop, in the order they are used. */
export const EVERYDAY_COMMANDS: ReadonlyArray<{ id: string; summary: string }> = [
  { id: 'dev', summary: 'run this app locally, rebuilding on save (press d to deploy)' },
  { id: 'build', summary: 'compile objectstack.config.ts into dist/objectstack.json' },
  { id: 'deploy', summary: 'put this app on your ObjectOS Cloud environment and wait until it is live' },
  { id: 'cloud login', summary: 'sign in to ObjectOS Cloud (once per machine)' },
  { id: 'validate', summary: 'check the metadata without building' },
];

/** The everyday block as printed, `bin` being the invoked binary name (`os`). */
export function formatEverydayCommands(bin: string): string {
  const width = Math.max(...EVERYDAY_COMMANDS.map((c) => `${bin} ${c.id}`.length));
  const rows = EVERYDAY_COMMANDS.map((c) => `  ${`${bin} ${c.id}`.padEnd(width)}  ${c.summary}`);
  return ['EVERYDAY COMMANDS', ...rows].join('\n');
}
