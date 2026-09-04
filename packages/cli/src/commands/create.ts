// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { PROTOCOL_MAJOR } from '@objectstack/spec/kernel';
import { sanitizeNamespace } from './init.js';

export const templates = {
  plugin: {
    description: 'Create a new ObjectStack plugin',
    files: {
      'package.json': (name: string) => ({
        name: `@objectstack/plugin-${name}`,
        version: '0.1.0',
        description: `ObjectStack Plugin: ${name}`,
        main: 'dist/index.js',
        types: 'dist/index.d.ts',
        scripts: {
          build: 'tsc',
          dev: 'tsc --watch',
          test: 'vitest',
        },
        keywords: ['objectstack', 'plugin', name],
        author: '',
        license: 'MIT',
        dependencies: {
          '@objectstack/spec': 'workspace:*',
          zod: '^4.3.6',
        },
        devDependencies: {
          '@types/node': '^22.0.0',
          typescript: '^5.8.0',
          vitest: '^4.0.0',
        },
      }),
      'tsconfig.json': () => ({
        extends: '../../tsconfig.json',
        compilerOptions: {
          outDir: 'dist',
          rootDir: 'src',
        },
        include: ['src/**/*'],
      }),
      'src/index.ts': (name: string) => `import type { Plugin } from '@objectstack/spec/contracts';

/**
 * ${name} Plugin for ObjectStack
 */
export const ${toCamelCase(name)}Plugin: Plugin = {
  name: '${name}',
  version: '0.1.0',
  
  async initialize(context) {
    console.log('Initializing ${name} plugin...');
    // Plugin initialization logic
  },
  
  async destroy() {
    console.log('Destroying ${name} plugin...');
    // Plugin cleanup logic
  },
};

export default ${toCamelCase(name)}Plugin;
`,
      'README.md': (name: string) => `# @objectstack/plugin-${name}

ObjectStack Plugin: ${name}

## Installation

\`\`\`bash
pnpm add @objectstack/plugin-${name}
\`\`\`

## Usage

\`\`\`typescript
import { ${toCamelCase(name)}Plugin } from '@objectstack/plugin-${name}';

// Use the plugin in your ObjectStack configuration
export default {
  plugins: [
    ${toCamelCase(name)}Plugin,
  ],
};
\`\`\`

## License

MIT
`,
    },
  },
  
  example: {
    description: 'Create a new ObjectStack example application',
    files: {
      'package.json': (name: string) => ({
        name: `@example/${name}`,
        version: '0.1.0',
        private: true,
        description: `ObjectStack Example: ${name}`,
        scripts: {
          build: 'objectstack compile',
          dev: 'objectstack dev',
          test: 'vitest',
        },
        dependencies: {
          '@objectstack/spec': 'workspace:*',
          '@objectstack/cli': 'workspace:*',
          zod: '^4.3.6',
        },
        devDependencies: {
          '@types/node': '^22.0.0',
          tsx: '^4.21.0',
          typescript: '^5.8.0',
          vitest: '^4.0.0',
        },
      }),
      'objectstack.config.ts': (name: string) => {
        const namespace = sanitizeNamespace(name);
        return `import { defineStack } from '@objectstack/spec';

// Barrel imports — add more as you create new type folders
// import * as objects from './src/objects';
// import * as actions from './src/actions';
// import * as apps from './src/apps';

export default defineStack({
  manifest: {
    id: 'com.example.${namespace}',
    namespace: '${namespace}',
    version: '0.1.0',
    type: 'app',
    name: '${name}',
    description: '${name} example application',
    // Protocol compatibility range: the metadata-protocol major this app is
    // authored against. The runtime checks it before it loads anything, so a
    // runtime outside the range refuses this app at the boundary with the
    // exact migration command instead of crashing later. Scaffolding stamped
    // it to match the ObjectStack version you installed — change it when you
    // deliberately move to a new protocol major, not to silence a mismatch.
    // Guide: https://objectstack.ai/docs/upgrading
    engines: { protocol: '^${PROTOCOL_MAJOR}' },
  },
  
  objects: [
    // Object.values(objects),  // Uncomment after creating src/objects/index.ts
  ],
  
  apps: [
    // Object.values(apps),     // Uncomment after creating src/apps/index.ts
  ],
});
`;
      },
      'README.md': (name: string) => `# ${name} Example

ObjectStack example application: ${name}

## Quick Start

\`\`\`bash
# Build the configuration
pnpm build

# Run in development mode
pnpm dev
\`\`\`

## Structure

- \`objectstack.config.ts\` - Main configuration file
- \`dist/objectstack.json\` - Compiled artifact

## Learn More

- [ObjectStack Documentation](../../content/docs)
- [Examples](../)
`,
      'tsconfig.json': () => ({
        extends: '../../tsconfig.json',
        compilerOptions: {
          outDir: 'dist',
          rootDir: '.',
        },
        include: ['*.ts', 'src/**/*'],
      }),
    },
  },
};

function toCamelCase(str: string): string {
  return str.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
}

export default class Create extends Command {
  static override description = 'Create a new package, plugin, or example from template';

  static override args = {
    type: Args.string({ description: 'Type of project to create (plugin, example)', required: true }),
    name: Args.string({ description: 'Name of the project', required: false }),
  };

  static override flags = {
    dir: Flags.string({ char: 'd', description: 'Target directory' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Create);

    console.log(chalk.bold(`\n📦 ObjectStack Project Creator`));
    console.log(chalk.dim(`-------------------------------`));
    
    if (!templates[args.type as keyof typeof templates]) {
      console.error(chalk.red(`\n❌ Unknown type: ${args.type}`));
      console.log(chalk.dim('Available types: plugin, example'));
      process.exit(1);
    }
    
    if (!args.name) {
      console.error(chalk.red('\n❌ Project name is required'));
      console.log(chalk.dim(`Usage: objectstack create ${args.type} <name>`));
      process.exit(1);
    }
    
    const template = templates[args.type as keyof typeof templates];
    const cwd = process.cwd();
    
    // Determine target directory
    let targetDir: string;
    if (flags.dir) {
      targetDir = path.resolve(cwd, flags.dir);
    } else {
      const baseDir = args.type === 'plugin' ? 'packages/plugins' : 'examples';
      const projectName = args.type === 'plugin' ? `plugin-${args.name}` : args.name;
      targetDir = path.join(cwd, baseDir, projectName);
    }
    
    // Check if directory already exists
    if (fs.existsSync(targetDir)) {
      console.error(chalk.red(`\n❌ Directory already exists: ${targetDir}`));
      process.exit(1);
    }
    
    console.log(`📁 Creating ${args.type}: ${chalk.blue(args.name)}`);
    console.log(`📂 Location: ${chalk.dim(targetDir)}`);
    console.log('');
    
    try {
      // Create directory
      fs.mkdirSync(targetDir, { recursive: true });
      
      // Create files from template
      for (const [filePath, contentFn] of Object.entries(template.files)) {
        const fullPath = path.join(targetDir, filePath);
        const dir = path.dirname(fullPath);
        
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        
        const content = contentFn(args.name);
        const fileContent = typeof content === 'string' 
          ? content 
          : JSON.stringify(content, null, 2);
        
        fs.writeFileSync(fullPath, fileContent);
        console.log(chalk.green(`✓ Created ${filePath}`));
      }
      
      console.log('');
      console.log(chalk.green('✅ Project created successfully!'));
      console.log('');
      console.log(chalk.bold('Next steps:'));
      console.log(chalk.dim(`  cd ${path.relative(cwd, targetDir)}`));
      console.log(chalk.dim('  pnpm install'));
      console.log(chalk.dim('  pnpm build'));
      console.log('');
      
    } catch (error: any) {
      console.error(chalk.red('\n❌ Failed to create project:'));
      console.error(error.message || error);
      
      // Clean up on error
      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true });
      }
      
      process.exit(1);
    }
  }
}
