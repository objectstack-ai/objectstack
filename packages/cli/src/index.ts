// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

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
