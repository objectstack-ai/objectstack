/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import chalk from 'chalk';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

export async function generate(type: string, name: string) {
  const cwd = process.cwd();

  switch (type) {
    case 'resource':
    case 'object':
      generateResource(cwd, name);
      break;
    case 'page':
      generatePage(cwd, name);
      break;
    case 'plugin':
      generatePlugin(cwd, name);
      break;
    default:
      console.log(chalk.red(`Unknown type: ${type}`));
      console.log(`Available types: resource, page, plugin`);
      process.exit(1);
  }
}

function generateResource(cwd: string, name: string) {
  const dir = join(cwd, 'objects');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const fileName = `${name.toLowerCase()}.json`;
  const filePath = join(dir, fileName);

  if (existsSync(filePath)) {
    console.log(chalk.yellow(`Object ${name} already exists at ${filePath}`));
    return;
  }

  const content = {
    name: name,
    fields: {
      name: { type: 'text', label: 'Name', required: true }
    }
  };

  writeFileSync(filePath, JSON.stringify(content, null, 2));
  console.log(chalk.green(`✓ Generated resource schema: ${filePath}`));
}

function generatePage(cwd: string, name: string) {
  const dir = join(cwd, 'pages');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const fileName = `${name.toLowerCase()}.json`;
  const filePath = join(dir, fileName);

  if (existsSync(filePath)) {
    console.log(chalk.yellow(`Page ${name} already exists at ${filePath}`));
    return;
  }

  // A page with no `pageType` is a `record` page, which draws neither `title`
  // nor `description`; `app` draws `title` as the page's one `h1`. So the
  // markdown under it opens with prose, not a `#` heading that would draw a
  // second `h1` (one page, one h1: objectui#3434; objectui#11450).
  const content = {
    type: "page",
    pageType: "app",
    title: name,
    children: [
      {
        type: "markdown",
        content: `Welcome to ${name}`
      }
    ]
  };

  writeFileSync(filePath, JSON.stringify(content, null, 2));
  console.log(chalk.green(`✓ Generated page schema: ${filePath}`));
}

function generatePlugin(cwd: string, name: string) {
  const dir = join(cwd, 'plugins', name);
  if (existsSync(dir)) {
    console.log(chalk.yellow(`Plugin ${name} already exists`));
    return;
  }
  mkdirSync(dir, { recursive: true });

  const content = `
export const ${name}Plugin = {
  name: '${name}',
  install(app) {
    console.log('${name} plugin installed');
  }
};
`;

  writeFileSync(join(dir, 'index.ts'), content.trim());
  console.log(chalk.green(`✓ Generated plugin: ${dir}`));
}
