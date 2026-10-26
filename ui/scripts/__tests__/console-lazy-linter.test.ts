import { describe, expect, it } from 'vitest';

/**
 * The console config's `assert-lazy-linter-stays-lazy` guard (objectui#5266,
 * objectui#5323): the lazily imported `@objectstack/lint` must stay out of every
 * eagerly loaded chunk, and the guard's counter-probe refuses a verdict when it
 * cannot see the spec chunk it measures against.
 *
 * Moved here from `vite-objectstack-spec-dist.test.ts` when that module's
 * `OBJECTSTACK_SPEC_DIST` injection left with the objectstack pin
 * (objectstack#25711). The baseline cases are kept as they were; the cases that
 * pointed the override at an out-of-tree spec left with it. The workspace
 * spelling of the spec (`<monorepo root>/packages/spec/dist/...`) is held by
 * `vite-objectstack-workspace.test.ts`.
 *
 * These cases drive the REAL plugin off the REAL config over a synthetic bundle,
 * rather than asserting on the regex the config hands it: the defect this guards
 * was never a wrong regex, it was a correct regex reaching one consumer and not
 * the other.
 */

async function loadConsoleConfig(query = ''): Promise<any> {
  const specifier = `../../apps/console/vite.config.ts${query}`;
  return (await import(/* @vite-ignore */ specifier)).default;
}

interface ProbeChunk {
  type: 'chunk';
  fileName: string;
  isEntry: boolean;
  imports: string[];
  modules: Record<string, unknown>;
}

/** A pnpm-store module id for the linter, the spelling a real bundle carries. */
const LINT_MODULE_ID =
  '/repo/node_modules/.pnpm/@objectstack+lint@17.0.0/node_modules/@objectstack/lint/dist/index.js';
/** The installed spec's module id, the spelling a node_modules build emits. */
const INSTALLED_SPEC_MODULE_ID = '/repo/node_modules/@objectstack/spec/dist/index.mjs';

const probeChunk = (
  fileName: string,
  modules: string[],
  extra: Partial<ProbeChunk> = {}
): ProbeChunk => ({
  type: 'chunk',
  fileName,
  isEntry: false,
  imports: [],
  modules: Object.fromEntries(modules.map((id) => [id, {}])),
  ...extra,
});

/**
 * A bundle shaped like the console's: one entry, one statically imported vendor
 * chunk holding the spec, and the linter parked behind a dynamic import — which
 * the plugin's walk deliberately does not follow.
 *
 * @param specModuleId  the spec id the vendor chunk carries
 * @param lintFileName  which chunk holds the linter, or `null` for none at all
 */
function consoleShapedBundle(
  specModuleId: string,
  lintFileName: 'assets/vendor-objectstack.js' | 'assets/lint-lazy.js' | null
): Record<string, ProbeChunk> {
  const vendorModules = [specModuleId];
  if (lintFileName === 'assets/vendor-objectstack.js') vendorModules.push(LINT_MODULE_ID);
  const bundle: Record<string, ProbeChunk> = {
    'assets/index.js': probeChunk('assets/index.js', ['/repo/apps/console/src/main.tsx'], {
      isEntry: true,
      imports: ['assets/vendor-objectstack.js'],
    }),
    'assets/vendor-objectstack.js': probeChunk('assets/vendor-objectstack.js', vendorModules),
  };
  if (lintFileName === 'assets/lint-lazy.js') {
    bundle['assets/lint-lazy.js'] = probeChunk('assets/lint-lazy.js', [LINT_MODULE_ID]);
  }
  return bundle;
}

/** Runs the console's own guard over one bundle; returns its error, or `null`. */
function runLazyLinterProbe(config: any, bundle: Record<string, ProbeChunk>): string | null {
  const plugins = (config.plugins as unknown[]).flat(Infinity) as {
    name?: string;
    generateBundle?: (this: unknown, options: unknown, bundle: unknown) => void;
  }[];
  const plugin = plugins.find((p) => p && p.name === 'assert-lazy-linter-stays-lazy');
  expect(plugin, 'the console config registers assert-lazy-linter-stays-lazy').toBeDefined();
  const context = {
    error(message: string): never {
      throw new Error(message);
    },
  };
  try {
    plugin!.generateBundle!.call(context, {}, bundle);
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

describe('the lazy-linter guard, read off the real console config', () => {
  it('passes a bundle whose eager closure holds the spec and whose linter is lazy', async () => {
    const config = await loadConsoleConfig();
    expect(
      runLazyLinterProbe(config, consoleShapedBundle(INSTALLED_SPEC_MODULE_ID, 'assets/lint-lazy.js'))
    ).toBeNull();
  });

  it('catches an EAGER linter', async () => {
    const config = await loadConsoleConfig();
    const message = runLazyLinterProbe(
      config,
      consoleShapedBundle(INSTALLED_SPEC_MODULE_ID, 'assets/vendor-objectstack.js')
    );
    expect(message).toContain('`@objectstack/lint` is in the EAGER closure');
    expect(message).toContain('assets/vendor-objectstack.js');
  });

  it('refuses a verdict when the eager closure holds no spec, and an eager client is not a spec', async () => {
    const config = await loadConsoleConfig();
    const noSpec: Record<string, ProbeChunk> = {
      'assets/index.js': probeChunk('assets/index.js', ['/repo/apps/console/src/main.tsx'], {
        isEntry: true,
      }),
      'assets/lint-lazy.js': probeChunk('assets/lint-lazy.js', [LINT_MODULE_ID]),
    };
    expect(runLazyLinterProbe(config, noSpec)).toContain('counter-probe failed');
    const clientOnly: Record<string, ProbeChunk> = {
      'assets/index.js': probeChunk('assets/index.js', ['/repo/apps/console/src/main.tsx'], {
        isEntry: true,
        imports: ['assets/vendor-objectstack.js'],
      }),
      'assets/vendor-objectstack.js': probeChunk('assets/vendor-objectstack.js', [
        '/repo/node_modules/@objectstack/client/dist/index.mjs',
      ]),
      'assets/lint-lazy.js': probeChunk('assets/lint-lazy.js', [LINT_MODULE_ID]),
    };
    expect(runLazyLinterProbe(config, clientOnly)).toContain('counter-probe failed');
  });

  it('refuses a verdict when the LINT test itself has gone blind', async () => {
    // The linter half's failure mode is the silent one: the assertion on it is
    // negative, so a regex that stopped matching the emitted ids is
    // indistinguishable from a clean bundle.
    const config = await loadConsoleConfig();
    const message = runLazyLinterProbe(config, consoleShapedBundle(INSTALLED_SPEC_MODULE_ID, null));
    expect(message).toContain('counter-probe failed');
    expect(message).toContain('no chunk at all');
  });
});
