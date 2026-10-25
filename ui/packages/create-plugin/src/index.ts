#!/usr/bin/env node
/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import prompts from 'prompts';
import * as path from 'path';
import fs from 'fs-extra';
import { buildPluginFiles, type PluginTemplateVars } from './templates';
import { LICENSE_PROMPT, resolveLicenseId } from './licenses';

const program = new Command();

interface PluginOptions {
  name?: string;
  description?: string;
  author?: string;
}

/**
 * The answers this generator asks for, each one optional.
 *
 * OPTIONAL is the whole point (objectui#8786): `prompts` hands back the answers
 * given SO FAR when a question is cancelled — the cancelled question and every
 * question after it are simply absent from the object — and a run with no TTY
 * never asks anything, so it starts from an empty one. A type that declares
 * them present is a type that lets `answers.author.trim()` compile.
 */
interface PluginAnswers {
  description?: string;
  author?: string;
  license?: string;
}

/**
 * Whether this run has a terminal to ask its questions on (objectui#8786).
 *
 * ⛔ The check has to happen BEFORE `prompts` is called, never around what it
 * returns, because on a stdin that is not a TTY there is nothing to inspect:
 * readline reports EOF, neither `submit` nor `abort` is ever emitted, the
 * promise never settles, and node runs out of work and exits 0. Measured on the
 * commit that filed objectui#8786: `create-plugin demo` with stdin taken from
 * `/dev/null` printed the first question, wrote nothing at all and exited 0 —
 * silently, while the published README promised that same run takes MIT and
 * still writes the text.
 */
function hasInteractiveStdin(): boolean {
  return process.stdin.isTTY === true;
}

async function createPlugin(pluginName?: string, options: PluginOptions = {}) {
  console.log(chalk.blue('\n🚀 ObjectUI Plugin Generator\n'));

  const interactive = hasInteractiveStdin();

  // Get plugin name if not provided
  if (!pluginName) {
    if (interactive) {
      const response = await prompts({
        type: 'text',
        name: 'name',
        message: 'Plugin name (without prefix):',
        validate: (value) => {
          if (value.length === 0) return 'Plugin name is required';
          // Validate package name format
          if (!/^[a-z0-9-]+$/.test(value)) {
            return 'Plugin name must contain only lowercase letters, numbers, and hyphens';
          }
          // Prevent path traversal
          if (value.includes('..') || value.includes('/') || value.includes('\\')) {
            return 'Plugin name cannot contain path separators or ".."';
          }
          return true;
        }
      });
      pluginName = response.name;
    }

    // ⭐ The plugin name is the ONE answer with no default to fall back on: a
    // scaffolder cannot invent the package it is scaffolding. So this is the
    // single place where not answering stops the run instead of taking a
    // default — and, since objectui#8786, it SAYS so: a non-TTY run used to
    // fall off the end of the event loop and exit 0 without printing this or
    // anything else.
    if (!pluginName) {
      console.log(chalk.red('\n❌ Plugin name is required'));
      process.exit(1);
    }
  }

  // Validate plugin name format and security
  if (!/^[a-z0-9-]+$/.test(pluginName)) {
    console.log(chalk.red('\n❌ Plugin name must contain only lowercase letters, numbers, and hyphens'));
    process.exit(1);
  }
  
  if (pluginName.includes('..') || pluginName.includes('/') || pluginName.includes('\\') || path.isAbsolute(pluginName)) {
    console.log(chalk.red('\n❌ Invalid plugin name: path traversal detected'));
    process.exit(1);
  }

  // Ensure plugin name doesn't include the plugin- prefix
  const cleanName = pluginName.replace(/^plugin-/, '').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-');
  
  if (cleanName.length === 0) {
    console.log(chalk.red('\n❌ Plugin name cannot be empty after sanitization'));
    process.exit(1);
  }
  
  const fullPackageName = `plugin-${cleanName}`;
  const pascalCaseName = cleanName
    .split('-')
    .filter(part => part.length > 0)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

  // Get additional info. Each question's `initial` is BOTH the default the
  // prompt offers and the value an unanswered question falls back to below, so
  // one question's default is written down exactly once — the same reason
  // `PluginTemplateVars.license` is required rather than defaulted twice.
  const descriptionInitial = options.description || `${pascalCaseName} plugin for ObjectUI`;
  const authorInitial = options.author || '';

  const questions = [
    {
      type: 'text' as const,
      name: 'description' as const,
      message: 'Plugin description:',
      initial: descriptionInitial
    },
    {
      type: 'text' as const,
      name: 'author' as const,
      message: 'Author name:',
      initial: authorInitial
    },
    // objectui#8041: the generator used to assert `"license": "MIT"` on an
    // author's package without asking, and then ship no LICENSE text beside
    // the claim. The prompt is the consent half; `buildLicenseFile` is the
    // text half. Taken from `./licenses` rather than written out here so the
    // published prompt contract can be asserted — this module calls
    // `program.parse()` at import time and so cannot be imported by a test.
    LICENSE_PROMPT
  ];

  // A cancel and a non-TTY run are ONE case here, and that is deliberate: both
  // arrive at the merge below with answers missing, and both are promised the
  // same outcome by the published README and by the objectui#8041 ruling —
  // take the defaults, write the whole file set.
  let cancelled = false;
  const answers: PluginAnswers = interactive
    ? await prompts(questions, {
        // Recording the cancel is all this does. Returning nothing keeps
        // `prompts`' own behaviour — stop asking, hand back what was answered
        // — and the questions that never ran take their `initial` below.
        onCancel: () => {
          cancelled = true;
        }
      })
    : {};

  if (!interactive) {
    console.log(chalk.yellow('ℹ️  No TTY on stdin — every prompt takes its default.'));
  } else if (cancelled) {
    console.log(chalk.yellow('\n⚠️  Cancelled — the unanswered prompts take their defaults.'));
  }

  const targetDir = path.join(process.cwd(), 'packages', fullPackageName);

  // Check if directory exists
  if (fs.existsSync(targetDir)) {
    console.log(chalk.red(`\n❌ Directory already exists: ${targetDir}`));
    process.exit(1);
  }

  // Template variables
  const vars: PluginTemplateVars = {
    packageName: `@object-ui/${fullPackageName}`,
    pluginName: cleanName,
    pascalName: pascalCaseName,
    // ⛔ Never `answers.description` / `answers.author` raw. Both are absent
    // after a cancel and after a non-TTY run, and `licenseCopyrightHolder`
    // dereferences the author — reading them raw is exactly what turned a
    // cancel at the second or third question into `TypeError: Cannot read
    // properties of undefined (reading 'trim')`, thrown AFTER the target
    // directory had already been created (objectui#8786).
    description: answers.description ?? descriptionInitial,
    author: answers.author ?? authorInitial,
    // Never `answers.license` directly: a non-TTY stdin or a cancelled prompt
    // leaves it undefined, and the ruling says such a run takes MIT and still
    // writes the text.
    license: resolveLicenseId(answers.license),
    version: '0.1.0',
    year: new Date().getFullYear()
  };

  // ⭐ Every file's contents is built BEFORE anything is created on disk
  // (objectui#8786). `fs.mkdirpSync` used to run first and the templates
  // afterwards, so a throw anywhere in `buildPluginFiles` left an empty
  // `packages/plugin-NAME/` behind, and the obvious retry then died on
  // "Directory already exists" instead of on the real fault. Templating is
  // pure, so doing it first costs nothing and makes the half-created state
  // unreachable rather than merely unreached.
  const files = buildPluginFiles(vars);

  console.log(chalk.green(`\n✨ Creating plugin: ${fullPackageName}...\n`));

  // Create the directory structure and write every templated file. The
  // templates themselves live in `./templates` so they can be unit-tested
  // without executing this CLI.
  fs.mkdirpSync(targetDir);
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = path.join(targetDir, relativePath);
    fs.mkdirpSync(path.dirname(filePath));
    fs.writeFileSync(filePath, contents);
  }

  console.log(chalk.green('✅ Plugin created successfully!\n'));
  console.log(chalk.blue('Next steps:\n'));
  console.log(chalk.gray(`  cd packages/${fullPackageName}`));
  console.log(chalk.gray('  pnpm install'));
  console.log(chalk.gray('  pnpm build\n'));
  console.log(chalk.blue('To use the plugin:\n'));
  console.log(chalk.gray(`  import { ${pascalCaseName} } from '${vars.packageName}';\n`));
}

program
  .name('create-plugin')
  .description('Create a new ObjectUI plugin')
  .argument('[plugin-name]', 'Name of the plugin (without plugin- prefix)')
  .option('-d, --description <description>', 'Plugin description')
  .option('-a, --author <author>', 'Author name')
  .action(createPlugin);

program.parse();
