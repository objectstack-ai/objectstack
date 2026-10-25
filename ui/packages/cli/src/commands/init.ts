/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import chalk from 'chalk';

import {
  platformPackageRange,
  REACT_RANGE,
  SCAFFOLD_DEV_DEPENDENCIES
} from '../utils/scaffold-dependencies.js';

interface InitOptions {
  template: string;
}

const templates = {
  simple: {
    type: 'div',
    className: 'min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100',
    children: {
      type: 'card',
      className: 'w-full max-w-md shadow-lg',
      title: 'Welcome to Object UI',
      description: 'Start building your application with JSON schemas',
      children: {
        type: 'div',
        className: 'p-6 space-y-4',
        children: [
          {
            type: 'text',
            content: 'This is a simple example. Edit app.json to customize your application.',
            className: 'text-sm text-muted-foreground',
          },
          {
            type: 'button',
            label: 'Get Started',
            className: 'w-full',
          },
        ],
      },
    },
  },
  form: {
    type: 'div',
    className: 'min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 to-pink-100 p-4',
    children: {
      type: 'card',
      className: 'w-full max-w-2xl shadow-xl',
      title: 'Contact Form',
      description: 'Fill out the form below to get in touch',
      children: {
        type: 'div',
        className: 'p-6 space-y-6',
        children: [
          {
            type: 'div',
            className: 'grid grid-cols-2 gap-4',
            children: [
              {
                type: 'input',
                label: 'First Name',
                placeholder: 'John',
                required: true,
              },
              {
                type: 'input',
                label: 'Last Name',
                placeholder: 'Doe',
                required: true,
              },
            ],
          },
          {
            type: 'input',
            label: 'Email Address',
            inputType: 'email',
            placeholder: 'john.doe@example.com',
            required: true,
          },
          {
            type: 'input',
            label: 'Phone Number',
            inputType: 'tel',
            placeholder: '+1 (555) 000-0000',
          },
          {
            type: 'textarea',
            label: 'Message',
            placeholder: 'Tell us what you need...',
            rows: 4,
          },
          {
            type: 'div',
            className: 'flex gap-3',
            children: [
              {
                type: 'button',
                label: 'Submit',
                className: 'flex-1',
              },
              {
                type: 'button',
                label: 'Reset',
                variant: 'outline',
                className: 'flex-1',
              },
            ],
          },
        ],
      },
    },
  },
  dashboard: {
    type: 'div',
    className: 'min-h-screen bg-muted/10',
    children: [
      {
        type: 'div',
        className: 'border-b bg-background',
        children: {
          type: 'div',
          className: 'container mx-auto px-6 py-4',
          children: {
            type: 'div',
            className: 'flex items-center justify-between',
            children: [
              {
                type: 'div',
                className: 'text-2xl font-bold',
                children: { type: 'text', content: 'Dashboard' },
              },
              {
                type: 'button',
                label: 'New Item',
                size: 'sm',
              },
            ],
          },
        },
      },
      {
        type: 'div',
        className: 'container mx-auto p-6 space-y-6',
        children: [
          {
            type: 'div',
            className: 'grid gap-4 md:grid-cols-2 lg:grid-cols-4',
            children: [
              {
                type: 'card',
                className: 'shadow-sm',
                children: [
                  {
                    type: 'div',
                    className: 'p-6 pb-2',
                    children: {
                      type: 'div',
                      className: 'text-sm font-medium text-muted-foreground',
                      children: { type: 'text', content: 'Total Revenue' },
                    },
                  },
                  {
                    type: 'div',
                    className: 'p-6 pt-0',
                    children: [
                      {
                        type: 'div',
                        className: 'text-2xl font-bold',
                        children: { type: 'text', content: '$45,231.89' },
                      },
                      {
                        type: 'div',
                        className: 'text-xs text-muted-foreground mt-1',
                        children: { type: 'text', content: '+20.1% from last month' },
                      },
                    ],
                  },
                ],
              },
              {
                type: 'card',
                className: 'shadow-sm',
                children: [
                  {
                    type: 'div',
                    className: 'p-6 pb-2',
                    children: {
                      type: 'div',
                      className: 'text-sm font-medium text-muted-foreground',
                      children: { type: 'text', content: 'Active Users' },
                    },
                  },
                  {
                    type: 'div',
                    className: 'p-6 pt-0',
                    children: [
                      {
                        type: 'div',
                        className: 'text-2xl font-bold',
                        children: { type: 'text', content: '+2,350' },
                      },
                      {
                        type: 'div',
                        className: 'text-xs text-muted-foreground mt-1',
                        children: { type: 'text', content: '+180.1% from last month' },
                      },
                    ],
                  },
                ],
              },
              {
                type: 'card',
                className: 'shadow-sm',
                children: [
                  {
                    type: 'div',
                    className: 'p-6 pb-2',
                    children: {
                      type: 'div',
                      className: 'text-sm font-medium text-muted-foreground',
                      children: { type: 'text', content: 'Sales' },
                    },
                  },
                  {
                    type: 'div',
                    className: 'p-6 pt-0',
                    children: [
                      {
                        type: 'div',
                        className: 'text-2xl font-bold',
                        children: { type: 'text', content: '+12,234' },
                      },
                      {
                        type: 'div',
                        className: 'text-xs text-muted-foreground mt-1',
                        children: { type: 'text', content: '+19% from last month' },
                      },
                    ],
                  },
                ],
              },
              {
                type: 'card',
                className: 'shadow-sm',
                children: [
                  {
                    type: 'div',
                    className: 'p-6 pb-2',
                    children: {
                      type: 'div',
                      className: 'text-sm font-medium text-muted-foreground',
                      children: { type: 'text', content: 'Active Now' },
                    },
                  },
                  {
                    type: 'div',
                    className: 'p-6 pt-0',
                    children: [
                      {
                        type: 'div',
                        className: 'text-2xl font-bold',
                        children: { type: 'text', content: '+573' },
                      },
                      {
                        type: 'div',
                        className: 'text-xs text-muted-foreground mt-1',
                        children: { type: 'text', content: '+201 since last hour' },
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            type: 'card',
            className: 'shadow-sm',
            title: 'Recent Activity',
            description: 'Your latest updates and notifications',
            children: {
              type: 'div',
              className: 'p-6 pt-0 space-y-4',
              children: [
                {
                  type: 'div',
                  className: 'flex items-center gap-4 border-b pb-4',
                  children: [
                    {
                      type: 'div',
                      className: 'flex-1',
                      children: [
                        {
                          type: 'div',
                          className: 'font-medium',
                          children: { type: 'text', content: 'New user registration' },
                        },
                        {
                          type: 'div',
                          className: 'text-sm text-muted-foreground',
                          children: { type: 'text', content: '2 minutes ago' },
                        },
                      ],
                    },
                  ],
                },
                {
                  type: 'div',
                  className: 'flex items-center gap-4 border-b pb-4',
                  children: [
                    {
                      type: 'div',
                      className: 'flex-1',
                      children: [
                        {
                          type: 'div',
                          className: 'font-medium',
                          children: { type: 'text', content: 'Payment received' },
                        },
                        {
                          type: 'div',
                          className: 'text-sm text-muted-foreground',
                          children: { type: 'text', content: '15 minutes ago' },
                        },
                      ],
                    },
                  ],
                },
                {
                  type: 'div',
                  className: 'flex items-center gap-4',
                  children: [
                    {
                      type: 'div',
                      className: 'flex-1',
                      children: [
                        {
                          type: 'div',
                          className: 'font-medium',
                          children: { type: 'text', content: 'New order placed' },
                        },
                        {
                          type: 'div',
                          className: 'text-sm text-muted-foreground',
                          children: { type: 'text', content: '1 hour ago' },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          },
        ],
      },
    ],
  },
};

/**
 * The `package.json` `objectui init` writes into a new user project.
 *
 * Split out of `init()` so it can be judged without running the command:
 * `app-generator.test.ts`'s `DEPENDENCY_ANCHORS` now covers this manifest
 * alongside the two temp-app generators, which is the gate it had none of
 * before (objectui#3892 — the literals live in `.ts` source, so objectui#3711's
 * version-claims scan never saw them either).
 *
 * Not one range is written here. Every value comes from
 * `utils/scaffold-dependencies.ts`, which is also what the app generators read;
 * see that module for why the `@object-ui/*` range is derived from the CLI's
 * own version rather than declared.
 */
export function buildInitPackageJson(name: string): Record<string, unknown> {
  const platformRange = platformPackageRange();
  return {
    name,
    version: '0.1.0',
    private: true,
    type: 'module',
    scripts: {
      dev: 'vite',
      build: 'tsc && vite build',
      preview: 'vite preview',
    },
    dependencies: {
      '@object-ui/components': platformRange,
      '@object-ui/react': platformRange,
      react: REACT_RANGE,
      'react-dom': REACT_RANGE,
    },
    devDependencies: { ...SCAFFOLD_DEV_DEPENDENCIES },
  };
}

/**
 * Every file `objectui init` writes, as `relative path -> contents`.
 *
 * Split out of `init()` for the same reason `buildInitPackageJson` was
 * (objectui#3892): the command writes with `fs` directly, so until the map is a
 * value there is nothing for a structural gate to judge. `app-generator.ts`
 * exports `buildAppFiles` / `buildRoutedAppFiles` for exactly this, and the two
 * gates `app-generator.test.ts` runs over those maps — every import declared,
 * every versioned declaration imported — are what objectui#4061 and
 * objectui#4062 were both invisible to. This scaffold is the third generator and
 * had never been under either.
 *
 * `init()` below writes this map and nothing else, and a test pins that
 * equivalence through the real bin, so the map cannot drift from the artifact.
 */
export function buildInitFiles(name: string, templateName: string): Record<string, string> {
  const template = templates[templateName as keyof typeof templates];
  if (!template) {
    throw new Error(
      `Unknown template: ${templateName}\nAvailable templates: ${Object.keys(templates).join(', ')}`
    );
  }

  const readme = `# ${name}

An Object UI application built from JSON schemas.

## Getting Started

1. Install dependencies:
   \`\`\`bash
   npm install
   \`\`\`

2. Start the development server:
   \`\`\`bash
   npm run dev
   \`\`\`

3. Open your browser and visit http://localhost:3000

## Customize Your App

Edit \`app.json\` to customize your application. The dev server will automatically reload when you save changes.

## Available Templates

- **simple**: A minimal getting started template
- **form**: A contact form example
- **dashboard**: A full dashboard with metrics and activity feed

## Learn More

- [Object UI Documentation](https://www.objectui.org)
- [Schema Reference](https://www.objectui.org/docs/protocol/overview)
- [Component Library](https://www.objectui.org/docs/api/components)

## Commands

- \`npm run dev\` - Start development server
- \`npm run build\` - Build for production
- \`npm run preview\` - Preview production build

Built with ❤️ using [Object UI](https://www.objectui.org)
`;

  const gitignore = `.objectui-tmp
node_modules
dist
.DS_Store
*.log
`;

  const viteConfig = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
  },
});
`;

  // No tailwind.config.js is written: this scaffold's CSS pipeline is Tailwind 4
  // (`postcss.config.js` names `@tailwindcss/postcss`, `src/index.css` does
  // `@import 'tailwindcss'`), and v4 reads a JS config only when a stylesheet
  // points `@config` at one — none does. The file this used to write was
  // therefore inert: an authoritative-looking `content` list that nothing
  // consumed, while v4's own source detection already covers `index.html` and
  // `src/**` from the project root. objectui#3852 removed the same dead file
  // from the temp-app generators; objectui#3892 removes it here.

  const postcssConfig = `export default {
  plugins: {
    '@tailwindcss/postcss': {},
    autoprefixer: {},
  },
};
`;

  const indexHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${name}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;

  // The component library's PREBUILT stylesheet, not a `@source` scan of it.
  //
  // The theme utilities these templates lean on (`text-muted-foreground` and
  // `bg-muted/10` in `simple`/`dashboard`, `shadow-sm` on every `card`) resolve
  // through tokens declared in a `@theme` block that lives in
  // `packages/components/src/index.css` — a file `files` does not publish, so an
  // installed consumer cannot compile it and cannot obtain those tokens by
  // scanning `node_modules` either. objectui#3884 measured both halves against a
  // real install: the full class surface a `node_modules` glob reaches is 1331
  // rules, all of them already inside the published `dist/index.css`'s 1410 — the
  // prebuilt sheet is a strict superset, and the `@source` lines are the
  // redundant ~100 kB. `@object-ui/components` exports it as `./style.css`
  // (objectui#4062).
  //
  // Components only. `@object-ui/fields` publishes a `style.css` too and
  // quick-start names it, but `@object-ui/fields@17.3.0` ships ZERO css
  // (measured on the published tarball, objectui#4059) and this scaffold does not
  // depend on it — importing it would be a declaration in the wrong direction
  // (objectui#3755) pointing at an empty file.
  const indexCss = `@import 'tailwindcss';
@import '@object-ui/components/style.css';
`;

  const mainTsx = `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`;

  // `import '@object-ui/components'` is what fills the component registry, and
  // nothing else does it.
  //
  // `SchemaRenderer` resolves each node through `ComponentRegistry.get(type)`
  // and renders `Unknown component type: <type>` on a miss; registration happens
  // as a side effect of importing `@object-ui/components`, which
  // `@object-ui/react` does not depend on. Without this line every node of all
  // three templates — `div`, `card`, `text`, `button`, `input`, `textarea` — took
  // the miss path, so the scaffold's entire visible output was error boxes
  // (objectui#4061).
  //
  // Components alone, no `@object-ui/plugin-*`: all six types above are
  // registered by this one package (measured), and none of the three templates
  // names a plugin type. The temp-app generator imports nine packages because it
  // renders arbitrary user schemas; adding nine dependencies to a minimal
  // scaffold that uses none of them is the declared-but-unused direction
  // objectui#3755 removed.
  const appTsx = `import { SchemaRenderer } from '@object-ui/react';
// Registers the component renderers SchemaRenderer looks up. Side-effect
// import — removing it makes every node render "Unknown component type".
import '@object-ui/components';
import schema from '../app.json';

export default function App() {
  return <SchemaRenderer schema={schema} />;
}
`;

  // The ambient declaration that makes `src/main.tsx`'s `import './index.css'`
  // compile under the `tsconfig` written below.
  //
  // TypeScript has no built-in notion of a `.css` module, so without this the
  // entry fails that config with "Cannot find module or type declarations for
  // side-effect import of './index.css'" (TS2882) — and unlike the two temp-app
  // generators objectui#3853 fixed, the error is LIVE here: the `package.json`
  // this scaffold writes declares `build: "tsc && vite build"`, so `objectui
  // init` followed by the `npm run build` the generated README names fails on a
  // file the tool itself produced, before Vite is ever reached (objectui#4111).
  //
  // `vite/client` is where the `declare module '*.css'` declarations live,
  // `vite` is already in `SCAFFOLD_DEV_DEPENDENCIES`, and this is the file
  // `create-vite`'s own React+TS template writes for the same reason — the
  // ecosystem's spelling of the fix rather than a local invention.
  //
  // Byte-identical to `APP_VITE_ENV_D_TS` in `utils/app-generator.ts`;
  // `app-generator.test.ts` pins all three generators to the one string rather
  // than trusting them not to drift. It is also the one generated `src/**` file
  // deliberately unreachable from `src/main.tsx`: an ambient declaration enters
  // the program through the tsconfig's `include`, never through the module
  // graph, which is why that suite's reachability gate exempts `.d.ts`.
  const viteEnvDts = `/// <reference types="vite/client" />\n`;

  const tsconfig = {
    compilerOptions: {
      target: 'ES2020',
      useDefineForClassFields: true,
      lib: ['ES2020', 'DOM', 'DOM.Iterable'],
      module: 'ESNext',
      skipLibCheck: true,
      moduleResolution: 'bundler',
      allowImportingTsExtensions: true,
      isolatedModules: true,
      moduleDetection: 'force',
      noEmit: true,
      jsx: 'react-jsx',
      strict: true,
      noUnusedLocals: true,
      noUnusedParameters: true,
      noFallthroughCasesInSwitch: true,
      resolveJsonModule: true,
    },
    include: ['src'],
  };

  // Insertion order is the order `init()` writes and logs them.
  return {
    'app.json': JSON.stringify(template, null, 2),
    'README.md': readme,
    '.gitignore': gitignore,
    'package.json': JSON.stringify(buildInitPackageJson(name), null, 2),
    'vite.config.ts': viteConfig,
    'postcss.config.js': postcssConfig,
    'index.html': indexHtml,
    'src/index.css': indexCss,
    'src/main.tsx': mainTsx,
    'src/App.tsx': appTsx,
    'src/vite-env.d.ts': viteEnvDts,
    'tsconfig.json': JSON.stringify(tsconfig, null, 2),
  };
}

export async function init(name: string, options: InitOptions) {
  const cwd = process.cwd();
  const projectDir = join(cwd, name);

  // Check if directory already exists
  if (existsSync(projectDir) && name !== '.') {
    throw new Error(`Directory "${name}" already exists. Please choose a different name.`);
  }

  const targetDir = name === '.' ? cwd : projectDir;
  // Built before the directory is created, so an unknown template is refused
  // with nothing left behind (objectui#11500).
  const files = buildInitFiles(name, options.template);

  // Create project directory if needed
  if (name !== '.') {
    mkdirSync(projectDir, { recursive: true });
  }

  console.log(chalk.blue('🎨 Creating Object UI application...'));
  console.log(chalk.dim(`   Template: ${options.template}`));
  console.log();

  // Writes the file map and nothing else — see `buildInitFiles`.
  for (const [relativePath, contents] of Object.entries(files)) {
    const target = join(targetDir, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
    console.log(chalk.green(`✓ Created ${relativePath}`));
  }

  console.log();
  console.log(chalk.green('✨ Application created successfully!'));
  console.log();
  console.log(chalk.bold('Next steps:'));
  console.log();
  if (name !== '.') {
    console.log(chalk.cyan(`  cd ${name}`));
  }
  console.log(chalk.cyan('  npm install'));
  console.log(chalk.cyan('  npm run dev'));
  console.log();
  console.log(chalk.dim('  The development server will start on http://localhost:3000'));
  console.log();
}
