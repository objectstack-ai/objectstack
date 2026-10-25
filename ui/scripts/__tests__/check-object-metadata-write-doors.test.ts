import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyze } from '../check-object-metadata-write-doors.mjs';

/**
 * objectui#8676 — every in-repo DOOR that can PUT an object-metadata document
 * must apply the object-metadata write invariant.
 *
 * objectui#7714 ruled one client behaviour and its PR implemented that ruling by
 * ENUMERATING the writers it knew of. Two. objectui#8057 hit the same defect on a
 * third in that card's own required dogfood; objectui#8676's sweep found nine
 * more, and — the half that outlives the count — showed that the sweep shape the
 * question is naturally asked in cannot see them: `client.save(` returns ZERO
 * over the file objectui#8057 is entirely about.
 *
 * So the gate enumerates DOORS. What this file pins, in the order the gate can
 * go wrong:
 *
 *  1. **The lit control, and a control ON that control.** An unguarded
 *     object-capable door must go RED and be named; the SAME door with the guard
 *     must stay GREEN. Without the second leg, "the plant reddens it" only
 *     proves the gate reacts to edits.
 *  2. **The resolution hop.** The repo's central door spells its URL through a
 *     template, a field and a helper's return value, and says NOTHING at its own
 *     call site. A census that reads the call rather than resolving it reports a
 *     clean run with that door missing — a confident zero over a population it
 *     never searched, which is this card's own subject. Pinned on a fixture
 *     rebuilt in that shape.
 *  3. **As-written beats resolved.** Substitution is textual, so a name that
 *     also occurs in the path (`app`, in `/meta/app/`) must not rewrite a door
 *     that names its own type into one that does not.
 *  4. **Fail-closed on an unknown type.** A door whose type is a runtime value
 *     is CAPABLE, never exempt.
 *  5. **A green is never "the walk found nothing."** The census must collapse
 *     loudly when a transport stops matching.
 *  6. **This repository is green**, with every counter non-zero.
 *  7. **The gate is wired** where the sibling parse-based gates run.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const fixtures: string[] = [];
afterAll(() => {
  for (const dir of fixtures) fs.rmSync(dir, { recursive: true, force: true });
});

/** A throwaway tree in the shape the gate walks: `packages/<name>/src/<file>`. */
function tree(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'write-doors-'));
  fixtures.push(root);
  for (const [rel, source] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, source, 'utf8');
  }
  return root;
}

/** An SDK door with a non-object literal type — present so the census never collapses. */
const EXEMPT_SDK = `
export async function saveView(client: any, name: string, body: unknown) {
  await client.meta.saveItem('view', name, body);
}
`;

describe('the lit control, and a control on that control', () => {
  const rawDoor = (guardCall: string) => `
import { assertObjectMetadataWritable } from '@object-ui/data-objectstack';

export async function importObjectDraft(draft: any) {
  ${guardCall}
  await fetch(\`/api/v1/meta/object/\${draft.name}\`, {
    method: 'PUT',
    body: JSON.stringify(draft.definition),
  });
}
`;

  it('RED — an object-capable door that does not reach the guard is found and named', () => {
    const root = tree({
      'packages/app-shell/src/importer.ts': rawDoor(''),
      'packages/app-shell/src/views.ts': EXEMPT_SDK,
    });
    const { findings, counters } = analyze(root);
    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe(path.join('packages', 'app-shell', 'src', 'importer.ts'));
    expect(findings[0].kind).toBe('raw');
    expect(findings[0].type).toBe('object');
    expect(counters.raw).toBe(1);
  });

  it('GREEN — the SAME door with the guard call is clean', () => {
    const root = tree({
      'packages/app-shell/src/importer.ts': rawDoor("assertObjectMetadataWritable('object', draft.definition, 'importObjectDraft');"),
      'packages/app-shell/src/views.ts': EXEMPT_SDK,
    });
    const { findings, counters, collapsed } = analyze(root);
    expect(findings).toHaveLength(0);
    expect(counters.guarded).toBe(1);
    expect(collapsed).toBe(false);
  });
});

describe('the resolution hop — the door that says nothing at its own call site', () => {
  // Rebuilt in the shape of `MetadataClient.save`: the URL is a local `const`
  // over a field, the field is set from a helper, and the helper returns a
  // template over a module constant. Read AT THE CALL, that URL is the single
  // identifier `url`.
  const indirect = `
const API_PREFIX = '/api/v1';
const META_PREFIX = '/meta';

function buildBase(config: { baseUrl: string }): string {
  return \`\${config.baseUrl}\${API_PREFIX}\${META_PREFIX}\`;
}

export class Client {
  private readonly base: string;
  constructor(config: { baseUrl: string }) {
    this.base = buildBase(config);
  }
  async save(type: string, name: string, item: unknown) {
    const url = \`\${this.base}/\${type}/\${name}\`;
    await fetch(url, { method: 'PUT', body: JSON.stringify(item) });
  }
}
`;

  it('finds it, and judges it CAPABLE because its type is a runtime value', () => {
    const root = tree({
      'packages/data/src/client.ts': indirect,
      'packages/data/src/views.ts': EXEMPT_SDK,
    });
    const { doors, findings } = analyze(root);
    const raw = doors.filter((door) => door.kind === 'raw');
    expect(raw).toHaveLength(1);
    expect(raw[0].type).toBeNull();
    expect(findings.map((finding) => finding.file)).toContain(path.join('packages', 'data', 'src', 'client.ts'));
  });

  it('CONTROL — the same file with the `/meta` segment removed is not a door at all', () => {
    const root = tree({
      'packages/data/src/client.ts': indirect.replace("const META_PREFIX = '/meta';", "const META_PREFIX = '/records';"),
      'packages/data/src/views.ts': EXEMPT_SDK,
    });
    const { doors } = analyze(root);
    expect(doors.filter((door) => door.kind === 'raw')).toHaveLength(0);
  });
});

describe('as-written beats resolved', () => {
  it('keeps the literal type when a local name collides with a path segment', () => {
    // `app` is both the path segment and a local const. Substituting it would
    // turn an exempt `app` door into a CAPABLE one and demand a guard that has
    // no business there.
    const root = tree({
      'packages/app-shell/src/publish.ts': `
export async function publish(app: Record<string, unknown>, routeApp: string) {
  await fetch(\`/api/v1/meta/app/\${routeApp}\`, {
    method: 'PUT',
    body: JSON.stringify({ ...app, _unpublished: false }),
  });
}
`,
      'packages/app-shell/src/views.ts': EXEMPT_SDK,
    });
    const { doors, findings } = analyze(root);
    expect(doors.find((door) => door.kind === 'raw')?.type).toBe('app');
    expect(findings).toHaveLength(0);
  });
});

describe('the SDK door, and the fail-closed direction', () => {
  it('exempts a non-object literal type and judges a runtime type CAPABLE', () => {
    const root = tree({
      'packages/app-shell/src/service.ts': `
export class Service {
  async saveAnything(category: string, name: string, data: Record<string, unknown>) {
    await this.client.meta.saveItem(category, name, data);
  }
  async saveApp(name: string, data: Record<string, unknown>) {
    await this.client.meta.saveItem('app', name, data);
  }
  client: any;
}
`,
      'packages/app-shell/src/importer.ts': `
import { assertObjectMetadataWritable } from '@object-ui/data-objectstack';
export async function put(type: string, body: unknown) {
  assertObjectMetadataWritable(type, body, 'put');
  await fetch(\`/api/v1/meta/\${type}/x\`, { method: 'PUT', body: JSON.stringify(body) });
}
`,
    });
    const { doors, findings } = analyze(root);
    const sdk = doors.filter((door) => door.kind === 'sdk');
    expect(sdk.map((door) => door.type).sort()).toEqual(['app', null].sort());
    // Only the runtime-typed one is a finding; the `'app'` literal is exempt.
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('sdk');
    expect(findings[0].type).toBeNull();
  });

  it('ignores a `saveItem` that is not the metadata door by arity', () => {
    const root = tree({
      'packages/app-shell/src/cart.ts': 'export const put = (store: any, item: unknown) => store.saveItem(item);\n',
      'packages/app-shell/src/views.ts': EXEMPT_SDK,
    });
    const { doors } = analyze(root);
    expect(doors.filter((door) => door.file.endsWith('cart.ts'))).toHaveLength(0);
  });
});

describe('a green is never "the walk found nothing"', () => {
  it('reports a COLLAPSED census when a transport kind has gone missing', () => {
    const root = tree({ 'packages/app-shell/src/views.ts': EXEMPT_SDK });
    const { collapsed, counters, findings } = analyze(root);
    // SDK doors exist, raw doors do not, and nothing is guarded. Findings are
    // empty — which without the collapse flag would read as a clean run.
    expect(findings).toHaveLength(0);
    expect(counters.raw).toBe(0);
    expect(collapsed).toBe(true);
  });

  it('does not collapse on a tree that has all three', () => {
    const root = tree({
      'packages/app-shell/src/views.ts': EXEMPT_SDK,
      'packages/app-shell/src/importer.ts': `
import { assertObjectMetadataWritable } from '@object-ui/data-objectstack';
export async function put(body: unknown) {
  assertObjectMetadataWritable('object', body, 'put');
  await fetch('/api/v1/meta/object/x', { method: 'PUT', body: JSON.stringify(body) });
}
`,
    });
    expect(analyze(root).collapsed).toBe(false);
  });
});

/**
 * objectui#12405 — ONE walk of this repository, in the IMPORT phase, read by
 * both tests below. `analyze(repoRoot)` parses every source file in the
 * `src` directory of each package and app (1,698 files measured on this
 * branch; the parse is ~80% of the walk, so the gate itself has no redundant
 * work to remove). Each test used to run that identical walk inside its own
 * 15 s `testTimeout`, at 5.2–7.0 s apiece here and 8.5 s on a normal CI VM, so
 * a 1.6–2.0x slow runner crosses the timeout with the gate green. Module
 * scope, not `beforeAll`: the import phase is governed by no timeout, whereas
 * a hook would trade the 15 s `testTimeout` for the narrower 10 s
 * `hookTimeout` (objectui `AGENTS.md`, the test discipline section). Safe to
 * share: `analyze` is pure over its root, and neither test mutates what it
 * returns. Each test asserts exactly what it asserted before.
 */
const REPOSITORY_SCAN = analyze(repoRoot);

describe('this repository', () => {
  it('is green, and every counter that makes a green mean something is non-zero', () => {
    const { findings, counters, collapsed } = REPOSITORY_SCAN;
    expect(collapsed).toBe(false);
    expect(counters.raw).toBeGreaterThan(0);
    expect(counters.sdk).toBeGreaterThan(0);
    expect(counters.capable).toBeGreaterThan(0);
    expect(counters.guarded).toBe(counters.capable);
    expect(findings).toEqual([]);
  });

  it('finds the three doors this card measured, by transport rather than by list', () => {
    const { doors, capable } = REPOSITORY_SCAN;
    // Named here as an ASSERTION ABOUT COVERAGE, not as the gate's input: the
    // gate derives these. If a door moves or is renamed, this row is what says
    // the derivation stopped reaching it.
    const capableFiles = capable.map((door) => door.file.split(path.sep).join('/'));
    expect(capableFiles).toContain('packages/data-objectstack/src/metadata-client.ts');
    expect(capableFiles).toContain('packages/app-shell/src/views/metadata-admin/external/api.ts');
    expect(capableFiles).toContain('packages/app-shell/src/services/MetadataService.ts');
    // ...and the exempt remainder is real, so "capable" is a narrowing rather
    // than the whole census wearing a different name.
    expect(doors.length).toBeGreaterThan(capable.length);
  });
});

describe('wiring', () => {
  it('is reachable through the `pnpm check:*` alias the workflow invokes', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    expect(manifest.scripts['check:metadata-write-doors'])
      .toBe('node scripts/check-object-metadata-write-doors.mjs');
  });

  it('runs in CI, beside the sibling gates that parse sources with `typescript`', () => {
    const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
    expect(workflow).toContain('run: pnpm check:metadata-write-doors');
  });
});
