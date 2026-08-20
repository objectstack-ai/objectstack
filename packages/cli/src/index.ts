// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { fileURLToPath } from 'node:url';

import { isProcessEntry, moduleEntryMisuseLines } from './utils/invocation.js';

// ─── oclif Command Classes ──────────────────────────────────────────
// Each command is auto-discovered by oclif from `src/commands/`.
// These re-exports provide programmatic access for testing and integration.

export { default as CompileCommand } from './commands/compile.js';
export { default as ValidateCommand } from './commands/validate.js';
export { default as InfoCommand } from './commands/info.js';
export { default as InitCommand } from './commands/init.js';
export { default as GenerateCommand } from './commands/generate.js';
export { default as CreateCommand } from './commands/create.js';
export { default as BuildCommand } from './commands/build.js';
export { default as DevCommand } from './commands/dev.js';
export { default as ServeCommand } from './commands/serve.js';
export { default as StartCommand } from './commands/start.js';
export { default as TestCommand } from './commands/test.js';
export { default as DoctorCommand } from './commands/doctor.js';

// ─── Migrate topic subcommands (#2186) ──────────────────────────────
export { default as MigrateCommand } from './commands/migrate/index.js';
export { default as MigratePlanCommand } from './commands/migrate/plan.js';
export { default as MigrateApplyCommand } from './commands/migrate/apply.js';
// ADR-0119 D2 (#4617): act on a run the journal says was interrupted. Boot
// discovers (MigrationRecoveryPlugin); this acts, under operator intent.
export { default as MigrateResumeCommand } from './commands/migrate/resume.js';
// #4556: rewrite the legacy `'system'` sentinel in
// `sys_metadata_history.recorded_by` to NULL, through the same journal.
export { default as MigrateRecordedByCommand } from './commands/migrate/recorded-by.js';

// ─── Environments topic subcommands ─────────────────────────────────
export { default as EnvironmentsListCommand } from './commands/environments/list.js';
export { default as EnvironmentsShowCommand } from './commands/environments/show.js';
export { default as EnvironmentsCreateCommand } from './commands/environments/create.js';
export { default as EnvironmentsSwitchCommand } from './commands/environments/switch.js';
export { default as EnvironmentsBindCommand } from './commands/environments/bind.js';

// ─── Cloud topic subcommands ────────────────────────────────────────
export { default as CloudLoginCommand } from './commands/cloud/login.js';
export { default as CloudLogoutCommand } from './commands/cloud/logout.js';
export { default as CloudWhoamiCommand } from './commands/cloud/whoami.js';

// ─── Package topic subcommands ──────────────────────────────────────
export { default as PackagePublishCommand } from './commands/package/publish.js';
export { default as PackageInstallCommand } from './commands/package/install.js';

// ─── Entry-point guard (#10111) ─────────────────────────────────────
// This file is the package `main`. It is a LIBRARY entry — a barrel of
// re-exports with no side effects — so `node packages/cli/dist/index.js` used
// to run it to completion, print nothing and exit 0. Backgrounded, that is
// indistinguishable from a server that booted and died, and it sent the one
// measured reader off to debug the application instead of the invocation
// (#10087). The CLI entry point is `bin/run.js`, and now the barrel says so.
//
// The predicate lives in `./utils/invocation.js` with the reason it is not the
// usual one-line `argv[1] === import.meta.url`: every spelling of that in this
// repo goes silently inert through a symlink (#10086), which is this exact
// defect. `process.exitCode` rather than `process.exit()` because nothing runs
// after this and the write to a piped stderr must be allowed to drain — the
// truncation trap `utils/format.ts` documents for `--json` payloads.
if (isProcessEntry(process.argv[1], import.meta.url)) {
  const lines = moduleEntryMisuseLines(
    fileURLToPath(import.meta.url),
    fileURLToPath(new URL('../bin/run.js', import.meta.url)),
  );
  for (const line of lines) process.stderr.write(`${line}\n`);
  process.exitCode = 1;
}
