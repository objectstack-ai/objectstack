/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import chalk from 'chalk';
import * as yaml from 'js-yaml';

import {
  platformPackageRange,
  REACT_RANGE,
  SCAFFOLD_DEV_DEPENDENCIES
} from './scaffold-dependencies.js';

export interface RouteInfo {
  path: string;
  filePath: string;
  schema: unknown;
  isDynamic: boolean;
  paramName?: string;
}

// Helper function to check if a file is a supported schema file
export function isSupportedSchemaFile(filename: string): boolean {
  return filename.endsWith('.json') || 
         filename.endsWith('.yml') ||
         filename.endsWith('.yaml');
}

// Helper function to extract the base filename without extension
export function getBaseFileName(filename: string): string {
  // Remove supported extensions
  return filename
    .replace(/\.(json|yml|yaml)$/, '');
}

// Helper function to parse schema file (JSON or YAML)
export function parseSchemaFile(filePath: string): unknown {
  const content = readFileSync(filePath, 'utf-8');
  
  if (filePath.endsWith('.json')) {
    return JSON.parse(content);
  } else if (filePath.endsWith('.yml') || filePath.endsWith('.yaml')) {
    return yaml.load(content);
  }
  
  throw new Error(`Unsupported file format: ${filePath}`);
}

export function scanPagesDirectory(pagesDir: string): RouteInfo[] {
  const routes: RouteInfo[] = [];
  
  const scanDir = (dir: string, routePrefix: string = '') => {
    const entries = readdirSync(dir);
    
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      
      if (stat.isDirectory()) {
        // Recursively scan subdirectories
        const newPrefix = routePrefix + '/' + entry;
        scanDir(fullPath, newPrefix);
      } else if (isSupportedSchemaFile(entry)) {
        // Process schema file
        const fileName = getBaseFileName(entry);
        let routePath: string;
        let isDynamic = false;
        let paramName: string | undefined;
        
        if (fileName === 'index') {
          // index.schema.json or index.page.json maps to the directory path
          routePath = routePrefix || '/';
        } else if (fileName.startsWith('[') && fileName.endsWith(']')) {
          // Dynamic route: [id].schema.json -> /:id
          paramName = fileName.slice(1, -1);
          routePath = routePrefix + '/:' + paramName;
          isDynamic = true;
        } else {
          // Regular file: about.schema.json -> /about
          routePath = routePrefix + '/' + fileName;
        }
        
        // Read and parse schema
        try {
          const schema = parseSchemaFile(fullPath);
          
          routes.push({
            path: routePath,
            filePath: fullPath,
            schema,
            isDynamic,
            paramName,
          });
        } catch (error) {
          console.warn(chalk.yellow(`⚠ Warning: Failed to parse ${fullPath}: ${error instanceof Error ? error.message : error}`));
        }
      }
    }
  };
  
  scanDir(pagesDir);
  
  // Sort routes: exact routes first, then dynamic routes
  routes.sort((a, b) => {
    if (a.isDynamic && !b.isDynamic) return 1;
    if (!a.isDynamic && b.isDynamic) return -1;
    return a.path.localeCompare(b.path);
  });
  
  return routes;
}

/**
 * `@object-ui/*` packages the generated apps IMPORT, and therefore must declare.
 *
 * Every entry is imported by a generated `src/App.tsx` — the two platform
 * packages by name, the seven plugins as side-effect imports that register
 * their components with the registry. Until objectui#3827 only the first two
 * were declared, so a generated app asked npm for nine packages having named
 * two of them; the seven plugins resolved in this workspace purely because the
 * temp app is created under `<cwd>` and hoisting reached the root
 * `node_modules`.
 *
 * `@object-ui/core` and `@object-ui/types` are deliberately absent: the
 * generated sources never import them (only `commands/dev.ts` aliases them for
 * Vite), and declaring a versioned dependency nothing imports is the defect
 * objectui#3755 removed from the sibling generator. `app-generator.test.ts`
 * gates both directions.
 */
const PLATFORM_RUNTIME_PACKAGES = [
  '@object-ui/react',
  '@object-ui/components',
  '@object-ui/plugin-charts',
  '@object-ui/plugin-editor',
  '@object-ui/plugin-kanban',
  '@object-ui/plugin-markdown',
  '@object-ui/plugin-form',
  '@object-ui/plugin-grid',
  '@object-ui/plugin-view'
] as const;

/**
 * `dependencies` for an app generated WITHOUT routing (`createTempApp`).
 *
 * Exactly the packages `src/main.tsx` and `src/App.tsx` import. No
 * `react-router-dom` and no `lucide-react`: this variant generates neither a
 * router nor a layout.
 */
function buildAppDependencies(): Record<string, string> {
  const range = platformPackageRange();
  return {
    react: REACT_RANGE,
    'react-dom': REACT_RANGE,
    ...Object.fromEntries(PLATFORM_RUNTIME_PACKAGES.map((name) => [name, range]))
  };
}

/**
 * `dependencies` for a routed app (`createTempAppWithRouting`).
 *
 * Adds the two packages the routed variant's own sources import and the plain
 * one's do not: `react-router-dom` (router in `src/App.tsx`) and `lucide-react`
 * (icons in `src/Layout.tsx`).
 *
 * `lucide-react` was imported and never declared until objectui#3827 — at the
 * time twice over, a namespace import plus a named `{ Moon, Sun }`, both live in
 * the generated layout. (objectui#7472 retired the namespace half: the layout
 * resolves authored icon names through `@object-ui/components`' seam now, and
 * reaches lucide only by the named import, so this range is still load-bearing
 * but has one consumer rather than two.) `commands/dev.ts` had been papering
 * over it in the
 * consumer, aliasing `lucide-react` to a path resolved out of
 * `packages/components` with the comment "avoid dependency not found in temp
 * app"; that alias only runs in monorepo mode, so every other path was left
 * with an unsatisfiable import. Declaring it at the producer is the fix — the
 * alias becomes a workspace convenience rather than the only thing holding the
 * import up.
 *
 * Both ranges here are QUOTED from this repo, per the objectui#3742 /
 * objectui#3754 anchoring discipline: `react-router-dom` from the root
 * manifest, `lucide-react` from the sibling manifests that declare it (the root
 * does not). `app-generator.test.ts`'s `DEPENDENCY_ANCHORS` names the anchor for
 * each and fails when a bump on either side leaves this file behind — which is
 * the whole reason the values are allowed to be literals at all.
 *
 * That gate is not decoration; it has fired. objectui#4968: a dependabot bump
 * moved `lucide-react` across all 22 sibling manifests and this literal stayed
 * a minor behind, so the pin went red on every open PR's merge ref until the
 * literal caught up. Deriving the value instead was considered and rejected in
 * that PR — 9 of the 13 anchored ranges quote the repo ROOT manifest, which is
 * not published with this CLI, so there is no one derivation the whole table
 * could share and a bespoke one for this single name would buy nothing. The
 * durable cure is upstream of this file: the shards carrying the gate have to
 * finish before a dependency PR can merge.
 */
function buildRoutedAppDependencies(): Record<string, string> {
  const range = platformPackageRange();
  return {
    react: REACT_RANGE,
    'react-dom': REACT_RANGE,
    'react-router-dom': '^7.18.2',
    'lucide-react': '^1.43.0',
    ...Object.fromEntries(PLATFORM_RUNTIME_PACKAGES.map((name) => [name, range]))
  };
}


/**
 * The generated `src/vite-env.d.ts`, identical for both generators.
 *
 * Both entries do `import './index.css'`, and TypeScript has no idea what a
 * `.css` module is: without this the entry file fails its own `tsconfig.json`
 * with "Cannot find module or type declarations for side-effect import of
 * './index.css'". `vite/client` is where the `declare module '*.css'` ambient
 * declarations live, `vite` is already in the generated `devDependencies`, and
 * this is the file `create-vite`'s own React+TS template writes for the same
 * reason — so the fix is the ecosystem's spelling of it rather than a local
 * invention (objectui#3853).
 *
 * It is the one generated `src/**` file that is deliberately unreachable from
 * `src/main.tsx`: an ambient declaration is pulled in by the tsconfig's
 * `include`, never by the module graph. `app-generator.test.ts`'s reachability
 * gate exempts `.d.ts` for exactly that reason and pins the exemption's width.
 */
const APP_VITE_ENV_D_TS = `/// <reference types="vite/client" />\n`;

/** The generated `tsconfig.json`, identical for both generators. */
const APP_TSCONFIG = {
  compilerOptions: {
    target: 'ES2020',
    useDefineForClassFields: true,
    lib: ['ES2020', 'DOM', 'DOM.Iterable'],
    module: 'ESNext',
    skipLibCheck: true,
    moduleResolution: 'bundler',
    allowImportingTsExtensions: true,
    resolveJsonModule: true,
    isolatedModules: true,
    noEmit: true,
    jsx: 'react-jsx',
    strict: true,
    noUnusedLocals: true,
    noUnusedParameters: true,
    noFallthroughCasesInSwitch: true
  },
  include: ['src']
};

/**
 * The generated `postcss.config.js`, identical for both generators.
 *
 * Tailwind 4 moved the PostCSS plugin out of `tailwindcss` into
 * `@tailwindcss/postcss`; naming the old `tailwindcss` key resolves to a shim
 * whose only job is to throw ("It looks like you're trying to use `tailwindcss`
 * directly as a PostCSS plugin"). Spelled exactly like
 * `packages/components/postcss.config.js` — objectui#3852.
 */
const APP_POSTCSS_CONFIG = `export default {
  plugins: {
    '@tailwindcss/postcss': {},
    autoprefixer: {},
  },
};`;

/**
 * Where the generator is running, as far as the generated files are concerned.
 *
 * Passed in rather than read from `process.cwd()` inside the builders so the
 * file map is a pure function of its inputs and can be asserted over directly.
 */
export interface AppGeneratorContext {
  /** The directory `objectui` was invoked from. */
  cwd: string;
  /** Whether `cwd` is a pnpm workspace root (root `node_modules` is reachable). */
  isMonorepo: boolean;
}

/** The context the CLI commands themselves generate under. */
function currentContext(): AppGeneratorContext {
  const cwd = process.cwd();
  return { cwd, isMonorepo: existsSync(join(cwd, 'pnpm-workspace.yaml')) };
}

/**
 * The generated `package.json` for an app without routing.
 *
 * In a monorepo both maps are written EMPTY, which is pre-existing behaviour:
 * the temp app lives under `<cwd>` and resolves everything by hoisting, and
 * `commands/dev.ts` skips `npm install` entirely there. The consequence worth
 * naming is that the ranges below are never the ranges exercised in this repo
 * (objectui#3742's second cost), which is exactly why the tests anchor them to
 * in-repo manifests instead of trusting a green command.
 */
export function buildAppPackageJson(context: Pick<AppGeneratorContext, 'isMonorepo'>): Record<string, unknown> {
  return {
    name: 'objectui-temp-app',
    private: true,
    type: 'module',
    // In monorepo, we use root node_modules, so we don't need dependencies here
    dependencies: context.isMonorepo ? {} : buildAppDependencies(),
    devDependencies: context.isMonorepo ? {} : { ...SCAFFOLD_DEV_DEPENDENCIES }
  };
}

/**
 * The generated `package.json` for a routed app.
 *
 * Unlike the variant above this one has no monorepo branch — it always writes
 * the full manifest, so a missing declaration here is missing everywhere and
 * cannot be explained away by hoisting.
 */
export function buildRoutedAppPackageJson(): Record<string, unknown> {
  return {
    name: 'objectui-temp-app',
    private: true,
    type: 'module',
    dependencies: buildRoutedAppDependencies(),
    devDependencies: { ...SCAFFOLD_DEV_DEPENDENCIES }
  };
}

/**
 * The `@source` directives the generated `src/index.css` registers.
 *
 * Tailwind 4's replacement for v3's `content` globs, and a 1:1 translation of
 * the ones the generated `tailwind.config.js` carried until objectui#3852:
 * the app's own `index.html` and `src/**`, widened inside a workspace to the
 * component library and every `plugin-*` package (the two absolute globs the v3
 * config built from `cwd`, semantics unchanged).
 *
 * Two things are load-bearing and were measured rather than assumed:
 *
 * 1. Relative `@source` paths resolve against the directory of the CSS file
 *    that declares them, NOT the app root — this file is written to
 *    `src/index.css`, so the app's own sources are `../src/**`, spelled exactly
 *    as `packages/components/src/index.css` spells its own.
 * 2. Outside a workspace the platform packages are installed rather than
 *    aliased, and their classes live in built JS. v4 does not auto-scan
 *    `node_modules` (it is gitignored), so an explicit `@source` over the
 *    installed `dist` is the only thing that compiles the library's utilities —
 *    the gap the v3 `content` list also had, in the form v4 gives us to close
 *    it.
 */
function buildAppSourceDirectives(context: AppGeneratorContext): string[] {
  const sources = [`@source '../index.html';`, `@source '../src/**/*.{js,ts,jsx,tsx,json}';`];
  if (context.isMonorepo) {
    sources.push(`@source '${join(context.cwd, 'packages/components/src/**/*.{ts,tsx}')}';`);
    sources.push(`@source '${join(context.cwd, 'packages/plugin-*/src/**/*.{ts,tsx}')}';`);
  } else {
    sources.push(`@source '../node_modules/@object-ui/*/dist/**/*.js';`);
  }
  return sources;
}

/**
 * The generated `@theme` block: v4's replacement for v3's `theme.extend`.
 *
 * Token-for-token the set `packages/components/src/index.css` declares, because
 * the generated app owns the single Tailwind entrypoint for everything it
 * renders — the component library deliberately does NOT inject its own sheet
 * (see the note at the top of `packages/components/src/index.ts`), so a token
 * the library's classes need and this block omits simply does not compile. The
 * v3 config's `theme.extend.colors` omitted the eight `sidebar-*` tokens that
 * the generated `src/Layout.tsx` itself uses (`bg-sidebar-primary`,
 * `data-[state=open]:bg-sidebar-accent`, …); `app-generator.test.ts` pins the
 * two sets equal so the omission cannot come back.
 */
const APP_THEME_TOKENS = `@theme {
  /* Border radius tokens */
  --radius-lg: var(--radius);
  --radius-md: calc(var(--radius) - 2px);
  --radius-sm: calc(var(--radius) - 4px);

  /* Color tokens mapped to the CSS variables declared below */
  --color-border: hsl(var(--border));
  --color-input: hsl(var(--input));
  --color-ring: hsl(var(--ring));
  --color-background: hsl(var(--background));
  --color-foreground: hsl(var(--foreground));
  --color-primary: hsl(var(--primary));
  --color-primary-foreground: hsl(var(--primary-foreground));
  --color-secondary: hsl(var(--secondary));
  --color-secondary-foreground: hsl(var(--secondary-foreground));
  --color-destructive: hsl(var(--destructive));
  --color-destructive-foreground: hsl(var(--destructive-foreground));
  --color-muted: hsl(var(--muted));
  --color-muted-foreground: hsl(var(--muted-foreground));
  --color-accent: hsl(var(--accent));
  --color-accent-foreground: hsl(var(--accent-foreground));
  --color-popover: hsl(var(--popover));
  --color-popover-foreground: hsl(var(--popover-foreground));
  --color-card: hsl(var(--card));
  --color-card-foreground: hsl(var(--card-foreground));
  --color-sidebar: hsl(var(--sidebar));
  --color-sidebar-foreground: hsl(var(--sidebar-foreground));
  --color-sidebar-primary: hsl(var(--sidebar-primary));
  --color-sidebar-primary-foreground: hsl(var(--sidebar-primary-foreground));
  --color-sidebar-accent: hsl(var(--sidebar-accent));
  --color-sidebar-accent-foreground: hsl(var(--sidebar-accent-foreground));
  --color-sidebar-border: hsl(var(--sidebar-border));
  --color-sidebar-ring: hsl(var(--sidebar-ring));

  /* Chart colors */
  --color-chart-1: hsl(var(--chart-1));
  --color-chart-2: hsl(var(--chart-2));
  --color-chart-3: hsl(var(--chart-3));
  --color-chart-4: hsl(var(--chart-4));
  --color-chart-5: hsl(var(--chart-5));
}`;

/**
 * The light/dark custom properties every token above resolves through.
 *
 * Plain CSS at the top level rather than inside `@layer base`, matching
 * `packages/components/src/index.css`: `@theme` already emits into `:root`, and
 * `.dark` only has to override the values. Every `var(--x)` named by
 * `APP_THEME_TOKENS` is declared here — pinned by a test, since a token that
 * resolves to nothing is a class that silently renders unstyled.
 */
const APP_THEME_VARIABLES = `:root {
  color-scheme: light;

  --background: 0 0% 100%;
  --foreground: 222.2 84% 4.9%;
  --card: 0 0% 100%;
  --card-foreground: 222.2 84% 4.9%;
  --popover: 0 0% 100%;
  --popover-foreground: 222.2 84% 4.9%;
  --primary: 222.2 47.4% 11.2%;
  --primary-foreground: 210 40% 98%;
  --secondary: 210 40% 96.1%;
  --secondary-foreground: 222.2 47.4% 11.2%;
  --muted: 210 40% 96.1%;
  --muted-foreground: 215.4 16.3% 46.9%;
  --accent: 210 40% 96.1%;
  --accent-foreground: 222.2 47.4% 11.2%;
  --destructive: 0 84.2% 60.2%;
  --destructive-foreground: 210 40% 98%;
  --border: 214.3 31.8% 91.4%;
  --input: 214.3 31.8% 91.4%;
  --ring: 222.2 84% 4.9%;
  --radius: 0.5rem;
  --chart-1: 12 76% 61%;
  --chart-2: 173 58% 39%;
  --chart-3: 197 37% 24%;
  --chart-4: 43 74% 66%;
  --chart-5: 27 87% 67%;

  /* Sidebar colors */
  --sidebar: 0 0% 98%;
  --sidebar-foreground: 240 5.3% 26.1%;
  --sidebar-primary: 240 5.9% 10%;
  --sidebar-primary-foreground: 0 0% 98%;
  --sidebar-accent: 240 4.8% 95.9%;
  --sidebar-accent-foreground: 240 5.9% 10%;
  --sidebar-border: 220 13% 91%;
  --sidebar-ring: 217.2 91.2% 59.8%;
}

.dark {
  color-scheme: dark;

  --background: 222.2 84% 4.9%;
  --foreground: 210 40% 98%;
  --card: 222.2 84% 4.9%;
  --card-foreground: 210 40% 98%;
  --popover: 222.2 84% 4.9%;
  --popover-foreground: 210 40% 98%;
  --primary: 210 40% 98%;
  --primary-foreground: 222.2 47.4% 11.2%;
  --secondary: 217.2 32.6% 17.5%;
  --secondary-foreground: 210 40% 98%;
  --muted: 217.2 32.6% 17.5%;
  --muted-foreground: 215 20.2% 65.1%;
  --accent: 217.2 32.6% 17.5%;
  --accent-foreground: 210 40% 98%;
  --destructive: 0 62.8% 30.6%;
  --destructive-foreground: 210 40% 98%;
  --border: 217.2 32.6% 17.5%;
  --input: 217.2 32.6% 17.5%;
  --ring: 212.7 26.8% 83.9%;
  --chart-1: 220 70% 50%;
  --chart-2: 160 60% 45%;
  --chart-3: 30 80% 55%;
  --chart-4: 280 65% 60%;
  --chart-5: 340 75% 55%;

  /* Sidebar colors for dark mode */
  --sidebar: 240 5.9% 10%;
  --sidebar-foreground: 240 4.8% 95.9%;
  --sidebar-primary: 224.3 76.3% 48%;
  --sidebar-primary-foreground: 0 0% 100%;
  --sidebar-accent: 240 3.7% 15.9%;
  --sidebar-accent-foreground: 240 4.8% 95.9%;
  --sidebar-border: 240 3.7% 15.9%;
  --sidebar-ring: 217.2 91.2% 59.8%;
}`;

/**
 * The generated `src/index.css` — one Tailwind 4 entrypoint, both generators.
 *
 * Replaces the v3 trio (`@tailwind base/components/utilities` directives, a
 * `tailwind.config.js`, and a `tailwindcss`-keyed PostCSS config) with the
 * CSS-first form this repo uses everywhere: `@import 'tailwindcss'`,
 * `@custom-variant dark`, `@source`, `@theme`. No `tailwind.config.js` is
 * written at all — in v4 a config file is inert unless a stylesheet points
 * `@config` at it, and every source of truth it used to hold now lives here
 * (objectui#3852; the repo itself has carried zero `tailwind.config.*` files
 * since its own v4 migration).
 *
 * The two generators emitted byte-identical CSS apart from three utilities on
 * `body`, so they now share this one builder; the `body` rules below are the
 * routed variant's (`font-sans antialiased min-h-screen`), written as the plain
 * CSS that `packages/components/src/index.css` uses instead of `@apply`.
 */
function buildAppIndexCss(context: AppGeneratorContext): string {
  return `@import 'tailwindcss';

/* Class-based dark variant: follow \`.dark\` on <html> — the routed app's
   \`src/theme-provider.tsx\` toggles exactly that class — instead of the OS
   \`prefers-color-scheme\`. Same spelling as packages/components/src/index.css. */
@custom-variant dark (&:where(.dark, .dark *));

/* Sources to scan for utility classes (v4's replacement for v3 \`content\`) */
${buildAppSourceDirectives(context).join('\n')}

${APP_THEME_TOKENS}

${APP_THEME_VARIABLES}

* {
  border-color: hsl(var(--border));
}

body {
  background-color: hsl(var(--background));
  color: hsl(var(--foreground));
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  min-height: 100vh;
}`;
}

/** Writes a generated file map onto `tmpDir`, creating nested directories. */
function writeGeneratedFiles(tmpDir: string, files: Record<string, string>): void {
  for (const [relativePath, contents] of Object.entries(files)) {
    const target = join(tmpDir, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
}

export function createTempApp(tmpDir: string, schema: unknown) {
  writeGeneratedFiles(tmpDir, buildAppFiles(schema, currentContext()));
}

/**
 * Every file `createTempApp` writes, as `relative path -> contents`.
 *
 * Exported so the tests assert over the SAME artifact the CLI writes rather
 * than over this file's source text — the shape objectui#3733/#3826 settled on
 * for the sibling generator, and the only way a structural gate (imports vs
 * declarations, entry reachability) can be written at all.
 */
export function buildAppFiles(schema: unknown, context: AppGeneratorContext): Record<string, string> {
  // Create index.html
  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Object UI App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`;

  // Create main.tsx
  const mainTsx = `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);`;

  // Create App.tsx
  const appTsx = `import { SchemaRenderer } from '@object-ui/react';
import '@object-ui/components';
import '@object-ui/plugin-charts';
import '@object-ui/plugin-editor';
import '@object-ui/plugin-kanban';
import '@object-ui/plugin-markdown';
import '@object-ui/plugin-form';
import '@object-ui/plugin-grid';
import '@object-ui/plugin-view';

const schema = ${JSON.stringify(schema, null, 2)};

function App() {
  return <SchemaRenderer schema={schema} />;
}

export default App;`;

  return {
    'index.html': html,
    'src/main.tsx': mainTsx,
    'src/App.tsx': appTsx,
    'src/vite-env.d.ts': APP_VITE_ENV_D_TS,
    'src/index.css': buildAppIndexCss(context),
    'postcss.config.js': APP_POSTCSS_CONFIG,
    'package.json': JSON.stringify(buildAppPackageJson(context), null, 2),
    'tsconfig.json': JSON.stringify(APP_TSCONFIG, null, 2)
  };
}

export function createTempAppWithRouting(tmpDir: string, routes: RouteInfo[], appConfig?: unknown) {
  writeGeneratedFiles(tmpDir, buildRoutedAppFiles(routes, appConfig, currentContext()));
}

/**
 * Every file `createTempAppWithRouting` writes, as `relative path -> contents`.
 *
 * `src/main.tsx` is the entry — `index.html` loads exactly that one module — so
 * every other generated `src/**` module has to be reachable from it, which is
 * the reachability gate objectui#3826 established for the sibling generator and
 * `app-generator.test.ts` ports here. `src/Layout.tsx` is written only when
 * `appConfig` is present, precisely because that is the only case in which
 * `src/App.tsx` imports it.
 */
export function buildRoutedAppFiles(
  routes: RouteInfo[],
  appConfig: unknown,
  context: AppGeneratorContext
): Record<string, string> {
  const files: Record<string, string> = {};

  // Create index.html
  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${(appConfig as any)?.title || 'Object UI App'}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`;

  files['index.html'] = html;

  const schemaImports: string[] = [];
  const routeComponents: string[] = [];

  routes.forEach((route, index) => {
    const schemaVarName = `schema${index}`;
    const schemaFileName = `page${index}.json`;

    // Add schema to the schemas directory
    files[`src/schemas/${schemaFileName}`] = JSON.stringify(route.schema, null, 2);

    // Add import statement
    schemaImports.push(`import ${schemaVarName} from './schemas/${schemaFileName}';`);

    // Add route component
    routeComponents.push(`        <Route path="${route.path}" element={<SchemaRenderer schema={${schemaVarName}} />} />`);
  });

  // Create theme-provider.tsx
  const themeProviderTsx = `import { createContext, useContext, useEffect, useState } from "react"

type Theme = "dark" | "light" | "system"

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
}

type ThemeProviderState = {
  theme: Theme
  setTheme: (theme: Theme) => void
}

const initialState: ThemeProviderState = {
  theme: "system",
  setTheme: () => null,
}

const ThemeProviderContext = createContext<ThemeProviderState>(initialState)

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "vite-ui-theme",
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(storageKey) as Theme) || defaultTheme
  )

  useEffect(() => {
    const root = window.document.documentElement

    root.classList.remove("light", "dark")

    if (theme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dark"
        : "light"

      root.classList.add(systemTheme)
      return
    }

    root.classList.add(theme)
  }, [theme])

  const value = {
    theme,
    setTheme: (theme: Theme) => {
      localStorage.setItem(storageKey, theme)
      setTheme(theme)
    },
  }

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  )
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext)

  if (context === undefined)
    throw new Error("useTheme must be used within a ThemeProvider")

  return context
}`;
  files['src/theme-provider.tsx'] = themeProviderTsx;

  // Create main.tsx
  const mainTsx = `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { ThemeProvider } from "./theme-provider"

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <App />
    </ThemeProvider>
  </React.StrictMode>
);`;

  files['src/main.tsx'] = mainTsx;

  // Generate Layout Code if appConfig is present
  let layoutImport = '';
  let layoutWrapperStart = '';
  let layoutWrapperEnd = '';
  
  if (appConfig) {
      // Very basic Layout implementation for now
      // Logic: If appConfig is present, current version assumes it's just a config object, 
      // but we need a Layout component that renders navigation.
      // Since we don't have a Layout component in @object-ui/components yet, we generate a simple one.

      const layoutCode = `
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronsUpDown, Monitor, Moon, Sun } from "lucide-react"
import { useTheme } from "./theme-provider"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
  SidebarInset,
  SidebarTrigger,
  Separator,
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
  LazyIcon,
  isLucideIconName
} from '@object-ui/components';

/** One entry of \`app.json\`'s \`menu\`, as this layout reads it. */
type MenuItem = {
  label?: string;
  path?: string;
  icon?: string;
  children?: MenuItem[];
};

/** The \`app.json\` fields this layout renders. */
type AppConfig = {
  title?: string;
  logo?: string;
  menu?: MenuItem[];
};

// An authored \`icon\` name is resolved by the platform seam
// (\`@object-ui/components\`), never by a lookup this template rolls itself.
// That is objectui#5935's ruling — one tokeniser and one icon-name vocabulary
// for every container — and this generated layout is a container like any
// other, even though it runs in the user's app rather than in this repo.
//
// \`isLucideIconName\` is asked FIRST because this call site has a better
// fallback than the seam's: a sidebar entry with an unresolvable icon renders
// no glyph at all, where \`LazyIcon\` alone would substitute a stray database
// icon. The seam exports the predicate for exactly this ("ask first, then
// choose"), so preferring it costs no second vocabulary.
const DynamicIcon = ({ name, className }: { name: string; className?: string }) => {
  if (!isLucideIconName(name)) return null;
  return <LazyIcon name={name} className={className} />;
};

export function ModeToggle() {
  const { setTheme } = useTheme()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
          <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          </div>
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-semibold">Switch Theme</span>
            <span className="truncate text-xs">Light / Dark</span>
          </div>
          <ChevronsUpDown className="ml-auto size-4" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg" side="bottom" align="end" sideOffset={4}>
        <DropdownMenuItem onClick={() => setTheme("light")}>
          <Sun className="mr-2 size-4" />
          Light
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}>
          <Moon className="mr-2 size-4" />
          Dark
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")}>
          <Monitor className="mr-2 size-4" />
          System
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const AppLayout = ({ app, children }: { app: AppConfig; children: ReactNode }) => {
  const location = useLocation();
  const menu = app.menu || [];
  
  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
           <div className="flex items-center gap-2 px-2 py-2">
             <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
               {app.logo && <DynamicIcon name={app.logo} className="size-4" />}
               {!app.logo && <span className="text-xl font-bold">O</span>}
             </div>
             <div className="grid flex-1 text-left text-sm leading-tight">
               <span className="truncate font-semibold">{app.title || "Object UI"}</span>
               <span className="truncate text-xs">Showcase</span>
             </div>
           </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarMenu>
              {menu.map((item, idx) => {
                 // Collapsible Item (Children present)
                 if (item.children && item.children.length > 0) {
                   const isActive = item.children.some(child => child.path === location.pathname);
                   return (
                     <Collapsible key={idx} asChild defaultOpen={isActive} className="group/collapsible">
                       <SidebarMenuItem>
                         <CollapsibleTrigger asChild>
                           <SidebarMenuButton tooltip={item.label}>
                             {item.icon && <DynamicIcon name={item.icon} />}
                             <span>{item.label}</span>
                             <DynamicIcon name="ChevronRight" className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                           </SidebarMenuButton>
                         </CollapsibleTrigger>
                         <CollapsibleContent>
                           <SidebarMenuSub>
                             {item.children.map((child, cIdx) => (
                               <SidebarMenuSubItem key={cIdx}>
                                 <SidebarMenuSubButton asChild isActive={location.pathname === child.path}>
                                   <Link to={child.path || '#'}>
                                      <span>{child.label}</span>
                                   </Link>
                                 </SidebarMenuSubButton>
                               </SidebarMenuSubItem>
                             ))}
                           </SidebarMenuSub>
                         </CollapsibleContent>
                       </SidebarMenuItem>
                     </Collapsible>
                   );
                 }

                 // Single Item
                 if (item.path) {
                   return (
                     <SidebarMenuItem key={idx}>
                       <SidebarMenuButton asChild isActive={location.pathname === item.path} tooltip={item.label}>
                         <Link to={item.path}>
                           {item.icon && <DynamicIcon name={item.icon} />}
                           <span>{item.label}</span>
                         </Link>
                       </SidebarMenuButton>
                     </SidebarMenuItem>
                   );
                 }
                 return null;
              })}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <ModeToggle />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 border-b bg-background px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <div className="flex flex-1 items-center justify-between">
              <span className="font-medium">{app.title}</span>
            </div>
        </header>
        <div className="flex-1 flex flex-col min-h-0 bg-muted/20 p-4">
          <div className="mx-auto max-w-full w-full">
            {children}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
};

export default AppLayout;
`;
      files['src/Layout.tsx'] = layoutCode;
      
      layoutImport = `import AppLayout from './Layout';\nconst appConfig = ${JSON.stringify(appConfig)};`;
      layoutWrapperStart = `<AppLayout app={appConfig}>`;
      layoutWrapperEnd = `</AppLayout>`;
  }

  // Create App.tsx with routing
  //
  // `Link` is deliberately absent from this import: the only `<Link>` in the
  // generated app is in `src/Layout.tsx`, which imports it itself. Naming it
  // here bought nothing and cost a TS6133 under the `noUnusedLocals` this
  // generator's own `tsconfig.json` declares (objectui#3853).
  const appTsx = `import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { SchemaRenderer } from '@object-ui/react';
import '@object-ui/components';
import '@object-ui/plugin-charts';
import '@object-ui/plugin-editor';
import '@object-ui/plugin-kanban';
import '@object-ui/plugin-markdown';
import '@object-ui/plugin-form';
import '@object-ui/plugin-grid';
import '@object-ui/plugin-view';
${schemaImports.join('\n')}
${layoutImport}

function App() {
  return (
    <BrowserRouter>
      ${layoutWrapperStart}
      <Routes>
${routeComponents.join('\n')}
      </Routes>
      ${layoutWrapperEnd}
    </BrowserRouter>
  );
}

export default App;`;

  files['src/App.tsx'] = appTsx;

  files['src/vite-env.d.ts'] = APP_VITE_ENV_D_TS;
  files['src/index.css'] = buildAppIndexCss(context);
  files['postcss.config.js'] = APP_POSTCSS_CONFIG;
  files['package.json'] = JSON.stringify(buildRoutedAppPackageJson(), null, 2);
  files['tsconfig.json'] = JSON.stringify(APP_TSCONFIG, null, 2);

  return files;
}
