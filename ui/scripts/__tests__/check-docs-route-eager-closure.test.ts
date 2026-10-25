import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Plain-JS CI helper; its types are INFERRED from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here.
import {
  analyse,
  evaluateDeclared,
  evaluateGauge,
  evaluateLedger,
  extractImports,
  maskFences,
  MEASURED_PAYLOAD,
  REGISTRAR,
} from '../check-docs-route-eager-closure.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * objectui#6316. `check:eager-closure` weighs `apps/console` and nothing weighs
 * the docs route, so the budget objectui#4616 set (+50% over a hand-taken
 * `7738.7 kB / 29 chunks`) has never had an instrument. The ruled shape is
 * structural rather than byte-level, and its ONE failure mode is vacuity: a
 * reachability computation that answers "reachable" for every input passes on
 * the current tree, passes on a genuinely new graph, and reads exactly like a
 * working gate.
 *
 * So the cases below are weighted toward the RED direction. Every one of them
 * builds a fixture tree mirroring the real layout (`apps/site/app/...`,
 * `content/docs/...`) and drives the real `analyse()` over it, because a model
 * of the traversal would agree with a broken traversal.
 */

/**
 * A fixture tree, path -> contents. `null` means "this file is absent", applied
 * after the base tree so a case can take a file away.
 *
 * `null` and not a string sentinel: the first spelling of this used an
 * impossible-character sentinel, and the two U+0000 bytes it needed reached
 * disk as raw bytes -- caught by `pnpm check:control-bytes`, which is exactly
 * what that gate is for. A type that cannot be a filename needs no impossible
 * character at all.
 */
type Files = Record<string, string | null>;

/** A minimal tree with the same SHAPE as this repository's docs route. */
function baseTree(): Record<string, string> {
  return {
    'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n  - 'apps/*'\n",

    'apps/site/package.json': JSON.stringify({ name: '@fx/site', private: true }),
    'apps/site/app/layout.tsx': 'export default function RootLayout() { return null; }\n',
    'apps/site/app/docs/layout.tsx': 'export default function DocsLayout() { return null; }\n',
    'apps/site/app/docs/[[...slug]]/page.tsx':
      "import { getMDXComponents } from '@/mdx-components';\nexport default function Page() { return getMDXComponents(); }\n",
    'apps/site/mdx-components.tsx': 'export function getMDXComponents() { return {}; }\n',

    // The real chain is schema-catalog.mdx -> SchemaCatalogIndex ->
    // SchemaThumbnail -> the registrar. One hop is dropped; the property that
    // matters (the registrar is on the route ONLY through MDX) is kept.
    'apps/site/app/components/SchemaCatalogIndex.tsx':
      "import './registerCatalogBlocks';\nexport function SchemaCatalogIndex() { return null; }\n",
    [REGISTRAR]: "import '@fx/hub';\nimport '@fx/free';\n",
    'content/docs/guide/catalog.mdx':
      "---\ntitle: Catalog\n---\n\nimport { SchemaCatalogIndex } from '@/app/components/SchemaCatalogIndex';\n\n<SchemaCatalogIndex />\n",

    ...workspacePackage('hub', "import '@fx/free';\nexport const hub = 1;\n"),
    ...workspacePackage('free', 'export const free = 1;\n'),
    ...workspacePackage('orphan', 'export const orphan = 1;\n'),
  };
}

function workspacePackage(name: string, source: string): Record<string, string> {
  return {
    [`packages/${name}/package.json`]: JSON.stringify({
      name: `@fx/${name}`,
      exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
    }),
    [`packages/${name}/src/index.ts`]: source,
  };
}

const LEDGER = Object.freeze({ '@fx/hub': 'fixture -- the payload this tree argued for when it landed.' });

function withTree<T>(overrides: Files, run: (root: string) => T): T {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-route-closure-'));
  try {
    for (const [rel, contents] of Object.entries({ ...baseTree(), ...overrides })) {
      const full = path.join(root, rel);
      if (contents === null) {
        fs.rmSync(full, { force: true });
        continue;
      }
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, contents);
    }
    return run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const verdicts = (root: string) => {
  const model = analyse({ root, ledger: LEDGER });
  return {
    model,
    declared: evaluateDeclared(model),
    ledger: evaluateLedger(model),
    gauge: evaluateGauge(model),
  };
};

describe('the three buckets a declared package falls into', () => {
  it('passes when every declaration is recorded payload or already reachable', () => {
    withTree({}, (root) => {
      const { declared, ledger, gauge } = verdicts(root);
      expect(gauge.status).toBe('pass');
      expect(ledger.status).toBe('pass');
      expect(declared.status).toBe('pass');
      expect(declared.recorded.map((e: { spec: string }) => e.spec)).toEqual(['@fx/hub']);
      // FREE is a MEASUREMENT, and this is the shape of the objectui#6314 case:
      // the package is reachable through another package's module-scope import,
      // so the declaration adds no payload -- and the gate can say through what.
      expect(declared.free.map((e: { spec: string }) => e.spec)).toEqual(['@fx/free']);
      expect(declared.free[0].via).toContain(path.join('packages', 'hub', 'src', 'index.ts'));
    });
  });

  it('FAILS on a package nothing on the route reaches -- the case that decides this gate is real', () => {
    withTree({ [REGISTRAR]: "import '@fx/hub';\nimport '@fx/free';\nimport '@fx/orphan';\n" }, (root) => {
      const { declared, gauge } = verdicts(root);
      // The gauge must still be sound, or the red below would be about the
      // instrument rather than about the tree.
      expect(gauge.status).toBe('pass');
      expect(declared.status).toBe('fail');
      expect(declared.newGraph.map((e: { spec: string }) => e.spec)).toEqual(['@fx/orphan']);
      expect(declared.message).toContain('@fx/orphan');
      expect(declared.message).toContain('NEW graph');
      expect(declared.message).toContain('MEASURED_PAYLOAD');
    });
  });

  it('fails on a non-workspace package too -- a graph it cannot weigh is not a graph it may pass', () => {
    withTree({ [REGISTRAR]: "import '@fx/hub';\nimport 'some-npm-widget';\n" }, (root) => {
      const { declared } = verdicts(root);
      expect(declared.status).toBe('fail');
      expect(declared.newGraph[0].spec).toBe('some-npm-widget');
    });
  });
});

describe('the ways a traversal could silently answer "everything is reachable"', () => {
  it('does not count a fenced MDX code block as an import', () => {
    // 87 files under content/docs open a line with `import`, and the ones
    // naming plugin packages are all inside fences. Counting them would make a
    // package read FREE for a reason that does not exist.
    withTree(
      {
        'content/docs/guide/fenced.mdx': [
          '---',
          'title: Fenced',
          '---',
          '',
          '```ts',
          "import '@fx/orphan';",
          '```',
          '',
        ].join('\n'),
        [REGISTRAR]: "import '@fx/hub';\nimport '@fx/orphan';\n",
      },
      (root) => {
        const { declared } = verdicts(root);
        expect(declared.status).toBe('fail');
        expect(declared.newGraph[0].spec).toBe('@fx/orphan');
      },
    );
  });

  it('does not count a type-only import as payload', () => {
    withTree(
      {
        'apps/site/app/docs/layout.tsx':
          "import type { Orphan } from '@fx/orphan';\nexport default function DocsLayout(_: Orphan) { return null; }\n",
        [REGISTRAR]: "import '@fx/hub';\nimport '@fx/orphan';\n",
      },
      (root) => {
        expect(verdicts(root).declared.status).toBe('fail');
      },
    );
  });

  it('does not count a dynamic import as eager -- that distinction IS the gate', () => {
    // `PluginLoader` is built on `import()` precisely so those graphs stay off
    // this route. A traversal that followed them would report every lazily
    // loaded plugin as already reachable.
    withTree(
      {
        'apps/site/app/docs/layout.tsx':
          "export default async function DocsLayout() { const m = await import('@fx/orphan'); return m; }\n",
        [REGISTRAR]: "import '@fx/hub';\nimport '@fx/orphan';\n",
      },
      (root) => {
        expect(verdicts(root).declared.status).toBe('fail');
      },
    );
  });

  it('does not read a package named in the registrar OWN PROSE as declared', () => {
    // Not hypothetical: the real file's header quotes
    // `import { ObjectForm } from '@object-ui/plugin-form'` in a comment.
    withTree(
      {
        [REGISTRAR]:
          "/**\n * Once upon a time this file did `import '@fx/orphan';`.\n */\nimport '@fx/hub';\nimport '@fx/free';\n",
      },
      (root) => {
        const { declared } = verdicts(root);
        expect(declared.status).toBe('pass');
        expect([...declared.recorded, ...declared.free].map((e: { spec: string }) => e.spec)).toEqual([
          '@fx/hub',
          '@fx/free',
        ]);
      },
    );
  });

  it('ERRORS when every workspace package reads as reachable', () => {
    withTree(
      {
        'apps/site/app/docs/layout.tsx':
          "import '@fx/orphan';\nexport default function DocsLayout() { return null; }\n",
      },
      (root) => {
        const { gauge } = verdicts(root);
        expect(gauge.status).toBe('error');
        expect(gauge.message).toContain('reads as reachable');
      },
    );
  });
});

describe('the gauge refuses to judge what it cannot see', () => {
  it('ERRORS when the registrar is not on the route at all', () => {
    withTree({ 'content/docs/guide/catalog.mdx': null }, (root) => {
      const { gauge } = verdicts(root);
      expect(gauge.status).toBe('error');
      expect(gauge.message).toContain('NOT reachable');
    });
  });

  it('ERRORS on a specifier it must resolve and could not', () => {
    withTree(
      {
        'apps/site/app/docs/layout.tsx':
          "import './not-a-file.js';\nexport default function DocsLayout() { return null; }\n",
      },
      (root) => {
        const { gauge } = verdicts(root);
        expect(gauge.status).toBe('error');
        expect(gauge.message).toContain('not-a-file.js');
      },
    );
  });

  it('ERRORS when a route entry has moved out from under it', () => {
    withTree({ 'apps/site/app/docs/layout.tsx': null }, (root) => {
      const { gauge } = verdicts(root);
      expect(gauge.status).toBe('error');
      expect(gauge.message).toContain('do not exist');
    });
  });

  it('treats an unresolvable EXTERNAL package as a leaf, not a failure', () => {
    withTree(
      {
        'apps/site/app/docs/layout.tsx':
          "import { notFound } from 'next/navigation';\nimport 'fumadocs-mdx:collections/server';\nexport default function DocsLayout() { return notFound; }\n",
      },
      (root) => {
        expect(verdicts(root).gauge.status).toBe('pass');
      },
    );
  });
});

describe('the ledger stays honest or the gate says so', () => {
  it('fails on an entry the registrar no longer names', () => {
    withTree({ [REGISTRAR]: "import '@fx/free';\n" }, (root) => {
      const model = analyse({ root, ledger: LEDGER });
      const ledger = evaluateLedger(model);
      expect(ledger.status).toBe('fail');
      expect(ledger.message).toContain('@fx/hub');
      expect(ledger.message).toContain('no longer named');
    });
  });

  it('fails on an entry the route now reaches on its own -- the ledger would overstate', () => {
    withTree(
      {
        'apps/site/app/docs/layout.tsx':
          "import '@fx/hub';\nexport default function DocsLayout() { return null; }\n",
      },
      (root) => {
        const { ledger } = verdicts(root);
        expect(ledger.status).toBe('fail');
        expect(ledger.message).toContain('no longer payload');
      },
    );
  });
});

describe('the extraction primitives', () => {
  it('keeps line numbers stable across a masked fence', () => {
    const masked = maskFences(['a', '```ts', "import 'x';", '```', 'b', ''].join('\n'));
    expect(masked.split('\n')).toHaveLength(6);
    expect(masked).not.toContain('import');
  });

  it('reads every static form and no lazy one', () => {
    const specs = extractImports(
      [
        "import 'side-effect';",
        "import def from 'default';",
        "import { a, b } from 'named';",
        "import * as ns from 'namespace';",
        "export { c } from 'reexport';",
        "export * from 'star';",
        "import type { T } from 'types-only';",
        "export type { U } from 'types-only-too';",
        "const lazy = () => import('dynamic');",
        "  const indented = await import('also-dynamic');",
      ].join('\n'),
    ).map((s: { spec: string }) => s.spec);

    expect(specs).toEqual(['side-effect', 'default', 'named', 'namespace', 'reexport', 'star']);
  });
});

describe('the real tree -- the properties that keep this gate from being decorative', () => {
  const model = analyse({});

  it('walks a route the registrar is actually on', () => {
    // If this ever fails, the gate is judging a file the docs route does not
    // load and must be re-derived rather than relaxed.
    expect(model.full.files.has(path.join(repoRoot, REGISTRAR))).toBe(true);
    expect(model.mdxCount).toBeGreaterThan(100);
  });

  it('still discriminates: real packages sit outside the closure', () => {
    const gauge = evaluateGauge(model);
    expect(gauge.status).toBe('pass');
    expect(gauge.outside.length).toBeGreaterThan(0);
  });

  it('states a reason for every ledger entry, and lists only workspace packages', () => {
    for (const [name, reason] of Object.entries(MEASURED_PAYLOAD)) {
      expect(model.packages.has(name), `${name} is not a workspace package`).toBe(true);
      expect((reason as string).length, `${name} needs a reason, not just an entry`).toBeGreaterThan(40);
    }
  });

  // Deliberately NOT asserted here: that `evaluateDeclared` passes. The gate
  // itself runs in CI and is the one place that verdict belongs; asserting it
  // here too would turn one legitimate red into two, in two different jobs, and
  // teach readers to fix the test rather than the import.
});

describe('wiring -- the gate is actually reachable and actually runs', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const workflowPath = path.join(repoRoot, '.github/workflows/repo-gates.yml');

  it('is exposed as a root package script', () => {
    expect(pkg.scripts['check:docs-route-closure']).toBe(
      'node scripts/check-docs-route-eager-closure.mjs',
    );
  });

  it('has a workflow that gates pull requests and reports on a queue build', () => {
    expect(fs.existsSync(workflowPath), 'a check nothing runs is not a gate').toBe(true);
    const workflow = fs.readFileSync(workflowPath, 'utf8');
    expect(workflow).toMatch(/pull_request:/);
    expect(workflow).toMatch(/merge_group:/);
    expect(workflow).toContain('pnpm check:docs-route-closure');
  });

  it('does NOT filter that workflow by path', () => {
    // Its inputs are the whole route graph -- `packages/**`, `apps/site/**`,
    // `content/docs/**` -- plus its own closure in `scripts/`. A filter listing
    // all of that is indistinguishable from no filter, and a filter that misses
    // one of them cannot be exercised by the PR that changes it (objectui#6321).
    const workflow = fs.readFileSync(workflowPath, 'utf8');
    expect(workflow).not.toMatch(/paths-ignore:/);
    expect(workflow).not.toMatch(/^\s+paths:/m);
  });
});
