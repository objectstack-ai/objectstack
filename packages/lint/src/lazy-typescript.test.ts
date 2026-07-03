// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Boot-path contract: importing @objectstack/lint must NOT load the TypeScript
// compiler. The package sits on the kernel boot path, and `typescript` is
// ~9 MB (and has been pruned from production images before — see
// validate-react-page-props.ts); it must load lazily, on the first validated
// `kind:'react'` page.
//
// Guarded at three levels because vitest inlines static imports through its
// transform (they never hit the native require cache), so an in-worker
// require.cache probe alone CANNOT catch a reintroduced eager import:
//   1. structural — no src file may eagerly `import ... from 'typescript'`
//      (only `import type`, which erases at build);
//   2. built dist — child `node` processes import both dist formats and prove
//      the compiler is absent until a react page is validated (skipped when
//      dist has not been built);
//   3. behavioral — the lazy path really loads the compiler on demand and the
//      gate still produces findings.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, it, expect } from 'vitest';

const srcDir = dirname(fileURLToPath(import.meta.url));
const distDir = join(srcDir, '..', 'dist');

describe('lazy typescript loading (kernel boot-path contract)', () => {
  it('no src file eagerly imports typescript (import type only)', () => {
    // Static `import`/`export ... from 'typescript'` executes at module init in
    // both dist formats; `import type` erases. Dynamic import()/createRequire
    // inside functions are the sanctioned lazy forms and are not matched.
    const eagerTsImport =
      /^\s*(?:import\s+['"]typescript['"]|(?:import|export)\s+(?!type[\s{])[^;]*?from\s*['"]typescript['"]|import\s+\w+\s*=\s*require\(\s*['"]typescript['"]\s*\))/m;
    const offenders = readdirSync(srcDir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .filter((f) => eagerTsImport.test(readFileSync(join(srcDir, f), 'utf8')));
    expect(offenders).toEqual([]);
  });

  const reactStack = `{ pages: [{ name: 'r', kind: 'react', source: 'function Page(){ return <ObjectForm mode="edit" />; }' }] }`;
  const childBody = `
    const probe = require('node:module').createRequire(process.cwd() + '/probe.js');
    const tsLoaded = () => Object.keys(probe.cache ?? {}).some((p) => /[/\\\\]node_modules[/\\\\]typescript[/\\\\]/.test(p));
    const fail = (msg) => { console.error(msg); process.exit(1); };
    const check = (mod) => {
      if (tsLoaded()) fail('typescript was loaded eagerly, at import time');
      const findings = mod.validateReactPageProps(${reactStack});
      if (!tsLoaded()) fail('typescript was not loaded by a react-page validation');
      if (!findings.some((f) => f.rule === 'react-prop-missing-required')) fail('gate produced no finding');
      console.log('OK');
    };
  `;

  it.skipIf(!existsSync(join(distDir, 'index.cjs')))('built CJS dist does not load typescript until a react page is validated', () => {
    const out = execFileSync(
      process.execPath,
      ['-e', `${childBody}; check(require(${JSON.stringify(join(distDir, 'index.cjs'))}));`],
      { encoding: 'utf8' },
    );
    expect(out).toContain('OK');
  });

  it.skipIf(!existsSync(join(distDir, 'index.js')))('built ESM dist does not load typescript until a react page is validated', () => {
    const out = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { createRequire } from 'node:module';
         const require = createRequire(process.cwd() + '/probe.js');
         ${childBody};
         check(await import(${JSON.stringify(pathToFileURL(join(distDir, 'index.js')).href)}));`,
      ],
      { encoding: 'utf8' },
    );
    expect(out).toContain('OK');
  });

  it('loads the compiler lazily in-process and the gate still works', async () => {
    const req = createRequire(import.meta.url);
    const tsLoaded = () => Object.keys(req.cache ?? {}).some((p) => /[/\\]node_modules[/\\]typescript[/\\]/.test(p));
    const { validateReactPageProps } = await import('./index.js');

    // Stacks without a react-source page never touch the compiler.
    expect(validateReactPageProps({ pages: [{ name: 'p', kind: 'object' }] })).toEqual([]);
    expect(validateReactPageProps({ pages: [{ name: 'r', kind: 'react', source: '   ' }] })).toEqual([]);
    expect(tsLoaded()).toBe(false);

    // The first react page with source pays the cost — and the gate still works.
    const findings = validateReactPageProps({
      pages: [{ name: 'r', kind: 'react', source: 'function Page(){ return <ObjectForm mode="edit" />; }' }],
    });
    expect(tsLoaded()).toBe(true);
    expect(findings.some((f) => f.rule === 'react-prop-missing-required' && /objectName/.test(f.message))).toBe(true);
  });
});
