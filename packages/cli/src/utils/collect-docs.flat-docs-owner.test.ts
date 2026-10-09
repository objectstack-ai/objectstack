// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22190 — a multi-package artifact's FLAT `src/docs/` rides the body of the
 * package that owns the artifact's manifest, and the metadata door stops
 * warning about it.
 *
 * ## The defect, as the card measured it
 *
 * `os build` placed the stack's own flat `src/docs/` on the artifact's TOP
 * LEVEL whatever the artifact's shape. A multi-package artifact carries its
 * metadata once, in `packages[]` (ADR-0130 D4, the 2026-09-22 addendum), so
 * those docs were the only thing at its top level, and the metadata door's
 * residual sweep registered them under the artifact's `manifest.id` and warned
 * on EVERY boot that no package body claimed them. The warning's remedy
 * ("rebuild the artifact so each collection it ships is carried by the package
 * that owns it") could not be followed: in an ADR-0130 layout the app package
 * lives in a directory such as `src/sales/`, which names no package, so no docs
 * directory the build reads attaches to its body.
 *
 * ## What is pinned here, and at which tier
 *
 * The fixture is the card's shape, composed by the real composer: an app
 * package whose directory names no package, and a service package whose
 * `src/service/docs/` resolves by its id's last segment. Everything runs in the
 * unit tier, so it runs on the pull request that would regress it — the
 * command-level twin in `test/build-package-docs-attachment.e2e.test.ts`
 * carries the `.e2e.` name and runs nightly.
 *
 *   - PLACEMENT: the flat docs land on the app package's body, the service's
 *     directory docs stay on the service body, and the artifact keeps no
 *     top-level `docs`;
 *   - THE DOOR: the real `MetadataPlugin`, booted on the placed artifact in
 *     `artifact-only` mode, logs no warning at all and serves the same docs
 *     under the same owners. Its lit control is the SAME artifact with the flat
 *     docs put back on the top level — the pre-fix placement — which draws
 *     exactly one warning from the same door, so the zero is not the silence
 *     of an instrument that cannot hear. The warnings are COUNTED, never read:
 *     the sentence is the metadata package's to word;
 *   - NO GUESS: a manifest id that names no package entry, or two of them, or
 *     no manifest id at all, keeps the flat docs on the top level;
 *   - NOTHING EXISTING MOVES: a stack with no `packages[]` gets back the very
 *     `docs` array it handed in.
 *
 * ⚠️ Pedigree, not counts: every doc on disk carries a marker written into
 * exactly one file, and the placement assertions read the marker back.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { composeStacks, defineStack } from '@objectstack/spec';
import { MetadataPlugin } from '@objectstack/metadata';

import {
  collectAndLintDocs,
  docsPackageRefs,
  flatDocsOwner,
  placeCollectedDocs,
  type DocItem,
} from './collect-docs.js';

const APP_ID = 'app.example.acme';
const SERVICE_ID = 'app.example.acme.service';

/** The app package. Its source directory is `src/sales/`, which names no package. */
const appStack = {
  manifest: { id: APP_ID, name: 'acme', namespace: 'acme', version: '1.0.0', type: 'app' },
  objects: [
    { name: 'acme_account', label: 'Account', sharingModel: 'private', fields: { name: { type: 'text', label: 'Name' } } },
  ],
};

/**
 * The second package. A DIFFERENT version from the app on purpose: the door
 * stamps `_packageVersion` from the body it found the item in, so a shared
 * version would let a doc stamped from the wrong body pass unnoticed.
 */
const serviceStack = {
  manifest: { id: SERVICE_ID, name: 'service', namespace: 'acme', version: '2.4.0', type: 'module' },
  objects: [
    { name: 'acme_case', label: 'Case', sharingModel: 'private', fields: { name: { type: 'text', label: 'Subject' } } },
  ],
};

/**
 * The artifact `composeStacks(…, { manifest: 'preserve' })` writes for the
 * card's project — the app listed LAST, so the artifact's own `manifest` is the
 * app's (`'last'`), the way an ADR-0130 project composes its consumer-facing
 * App over its modules.
 */
const composedArtifact = (): Record<string, any> =>
  JSON.parse(JSON.stringify(composeStacks(
    [defineStack(serviceStack as never, { strict: false }), defineStack(appStack as never, { strict: false })],
    { manifest: 'preserve' },
  )));

const MARKER_FLAT_GUIDE = 'MARKER-22190-flat-guide';
const MARKER_FLAT_FAQ = 'MARKER-22190-flat-faq';
const MARKER_SERVICE = 'MARKER-22190-service-runbook';

let tmp: string;
let configPath: string;

const writeDoc = (dir: string, name: string, marker: string): void => {
  const target = path.join(tmp, 'src', dir);
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, `${name}.md`), `# ${name}\n\n${marker}\n`);
};

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'os-flat-docs-owner-'));
  configPath = path.join(tmp, 'objectstack.config.ts');
  fs.writeFileSync(configPath, '// stub');
  // The card's layout: the app's own source directory exists and carries no
  // docs; the stack's docs are flat; the service ships its own.
  fs.mkdirSync(path.join(tmp, 'src', 'sales'), { recursive: true });
  writeDoc('docs', 'acme_guide', MARKER_FLAT_GUIDE);
  writeDoc('docs', 'acme_faq', MARKER_FLAT_FAQ);
  writeDoc(path.join('service', 'docs'), 'acme_service_runbook', MARKER_SERVICE);
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/**
 * Collect, lint and place exactly as `compile.ts` step 4 does, and hand back
 * the artifact it would write.
 */
function build(stack: Record<string, any>) {
  const collected = collectAndLintDocs(configPath, stack);
  const placed = placeCollectedDocs(stack, collected);
  const artifact: Record<string, any> = { ...stack };
  if (placed.docs.length > 0) artifact.docs = placed.docs;
  if (placed.packages !== artifact.packages) artifact.packages = placed.packages;
  return { collected, placed, artifact };
}

const bodyOf = (artifact: Record<string, any>, id: string): Record<string, any> =>
  (artifact.packages as Array<{ manifest: Record<string, any> }>).find((entry) => entry.manifest.id === id)!.manifest;

const docNames = (docs: unknown): string[] => (Array.isArray(docs) ? (docs as DocItem[]).map((doc) => doc.name) : []);

/**
 * Boot the REAL metadata door on `artifact` — `MetadataPlugin.start` in
 * `artifact-only` mode over a file, the path `os start` takes — and report how
 * many warnings it logged and which docs it registered under which package.
 */
async function door(artifact: Record<string, any>): Promise<{
  warnings: number;
  docs: Array<{ name: string; packageId?: string; packageVersion?: string; content?: string }>;
}> {
  const file = path.join(tmp, `artifact-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(file, JSON.stringify(artifact));
  const warn = vi.fn();
  const ctx = {
    logger: { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn },
    registerService: vi.fn(),
    getService: vi.fn(() => undefined),
    trigger: vi.fn(),
    hook: vi.fn(),
  } as any;
  const plugin = new MetadataPlugin({
    watch: false,
    artifactWatch: false,
    artifactSource: { mode: 'local-file', path: file },
    config: { bootstrap: 'artifact-only' },
  } as any) as any;
  try {
    await plugin.start(ctx);
    const docs = (await plugin.manager.list('doc')) as Array<Record<string, any>>;
    return {
      warnings: warn.mock.calls.length,
      docs: docs
        .map((doc) => ({
          name: doc.name,
          packageId: doc._packageId,
          packageVersion: doc._packageVersion ?? undefined,
          content: doc.content,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  } finally {
    await plugin.destroy?.();
  }
}

describe('#22190 the fixture is the card shape (premise guard)', () => {
  it('a composed two-package artifact: nothing at the top level, the app owns the manifest, its directory names no package', () => {
    const artifact = composedArtifact();
    expect(artifact.manifest.id).toBe(APP_ID);
    expect(artifact.packages.map((entry: any) => entry.manifest.id)).toEqual([SERVICE_ID, APP_ID]);
    // ADR-0130 D4's 2026-09-22 addendum: a multi-package artifact carries its
    // collections once, in the bodies — so the top level is no package's body.
    expect(artifact.objects).toBeUndefined();
    expect(artifact.docs).toBeUndefined();
    // The reason the remedy could not be followed: `src/sales/` is not a
    // spelling any package answers to, so the app has no docs directory.
    const spellings = docsPackageRefs(artifact.packages).flatMap((ref) => ref.directoryNames);
    expect(spellings).not.toContain('sales');
    expect(spellings).toContain('service');
  });
});

describe('#22190 flatDocsOwner — the entry whose id IS the artifact manifest id, or nobody', () => {
  it('answers the app package of the composed artifact', () => {
    const owner = flatDocsOwner(composedArtifact());
    expect(owner?.index).toBe(1);
    expect(owner?.id).toBe(APP_ID);
    expect(owner?.namespace).toBe('acme');
  });

  it('answers nobody for a stack with no packages[] — its top level IS its one package', () => {
    expect(flatDocsOwner({ manifest: { ...appStack.manifest } })).toBeUndefined();
  });

  it('answers nobody when the manifest id names no package entry', () => {
    const artifact = composedArtifact();
    artifact.manifest = { ...artifact.manifest, id: 'app.example.elsewhere' };
    expect(flatDocsOwner(artifact)).toBeUndefined();
  });

  it('answers nobody when TWO entries carry the manifest id — ⛔ never a guess between them', () => {
    const artifact = composedArtifact();
    artifact.packages[0].manifest = { ...artifact.packages[0].manifest, id: APP_ID };
    expect(docsPackageRefs(artifact.packages).filter((ref) => ref.id === APP_ID)).toHaveLength(2);
    expect(flatDocsOwner(artifact)).toBeUndefined();
  });

  it('answers nobody when the artifact declares no manifest id', () => {
    const artifact = composedArtifact();
    delete artifact.manifest;
    expect(flatDocsOwner(artifact)).toBeUndefined();
  });
});

describe('#22190 placement — the two-package build', () => {
  it('puts the flat docs on the APP package body and keeps no top-level docs', () => {
    const { collected, artifact } = build(composedArtifact());

    // Asserted first: an error would make the build exit before placing.
    expect(collected.issues).toEqual([]);
    expect(artifact).not.toHaveProperty('docs');

    const app = bodyOf(artifact, APP_ID);
    expect(docNames(app.docs).sort()).toEqual(['acme_faq', 'acme_guide']);
    const byName = new Map((app.docs as DocItem[]).map((doc) => [doc.name, doc.content]));
    expect(byName.get('acme_guide')).toContain(MARKER_FLAT_GUIDE);
    expect(byName.get('acme_faq')).toContain(MARKER_FLAT_FAQ);
  });

  it('control: `src/service/docs` still lands on the SERVICE body, and only there', () => {
    const { artifact } = build(composedArtifact());

    const service = bodyOf(artifact, SERVICE_ID);
    expect(docNames(service.docs)).toEqual(['acme_service_runbook']);
    expect((service.docs as DocItem[])[0].content).toContain(MARKER_SERVICE);
    expect(JSON.stringify(bodyOf(artifact, APP_ID).docs ?? [])).not.toContain(MARKER_SERVICE);
  });

  it('appends after the owner\'s OWN directory docs — a second set for one package is not dropped', () => {
    // The app's id tail is `acme`, so `src/acme/docs/` is a directory it
    // answers to; that set and the flat set both address the same body.
    writeDoc(path.join('acme', 'docs'), 'acme_overview', 'MARKER-22190-app-directory');
    const { collected, artifact } = build(composedArtifact());

    expect(collected.issues).toEqual([]);
    expect(docNames(bodyOf(artifact, APP_ID).docs)).toEqual(['acme_overview', 'acme_faq', 'acme_guide']);
    expect(artifact).not.toHaveProperty('docs');
  });

  it('keeps an inline top-level doc where it was — only the flat src/docs/ set moves', () => {
    const inline: DocItem = { name: 'acme_inline', content: '# Inline' };
    const stack = { ...composedArtifact(), docs: [inline] };
    const { artifact } = build(stack);

    expect(artifact.docs).toEqual([inline]);
    expect(docNames(bodyOf(artifact, APP_ID).docs).sort()).toEqual(['acme_faq', 'acme_guide']);
  });
});

describe('#22190 the metadata door — no residual warning, same docs, same owners', () => {
  it('boots the placed artifact with ZERO warnings, serving every doc under the package that owns it', async () => {
    const { artifact } = build(composedArtifact());
    const read = await door(artifact);

    expect(read.warnings).toBe(0);
    expect(read.docs.map(({ name, packageId, packageVersion }) => ({ name, packageId, packageVersion }))).toEqual([
      { name: 'acme_faq', packageId: APP_ID, packageVersion: '1.0.0' },
      { name: 'acme_guide', packageId: APP_ID, packageVersion: '1.0.0' },
      { name: 'acme_service_runbook', packageId: SERVICE_ID, packageVersion: '2.4.0' },
    ]);
    expect(read.docs.find((doc) => doc.name === 'acme_guide')?.content).toContain(MARKER_FLAT_GUIDE);
  });

  it('lit control: the SAME docs on the top level draw exactly one warning from the same door, under the same owners', async () => {
    const { collected, artifact } = build(composedArtifact());
    // The pre-fix artifact, built from the collection rather than from the
    // placement, so this control reads the same whether the fix is in or not:
    // the flat set on the top level, and on no body.
    const flat = new Set<DocItem>(collected.flatDocs);
    expect(docNames(collected.flatDocs).sort()).toEqual(['acme_faq', 'acme_guide']);
    const prefix = {
      ...artifact,
      docs: [...collected.flatDocs],
      packages: (artifact.packages as Array<{ manifest: Record<string, any> }>).map((entry) => {
        const { docs, ...rest } = entry.manifest;
        const kept = ((docs ?? []) as DocItem[]).filter((doc) => !flat.has(doc));
        return { ...entry, manifest: kept.length > 0 ? { ...rest, docs: kept } : rest };
      }),
    };

    const read = await door(prefix);
    expect(read.warnings).toBe(1);
    // ...and it is the docs' OWNER and COUNT that the fix keeps: the residual
    // sweep stamped the same package id, so no door's answer moves.
    expect(read.docs.map(({ name, packageId }) => ({ name, packageId }))).toEqual([
      { name: 'acme_faq', packageId: APP_ID },
      { name: 'acme_guide', packageId: APP_ID },
      { name: 'acme_service_runbook', packageId: SERVICE_ID },
    ]);
  });
});

describe('#22190 no owner, no move — every case it cannot decide keeps today\'s placement', () => {
  it('a manifest id naming no package entry: the flat docs stay on the top level, the bodies untouched', () => {
    const stack = composedArtifact();
    stack.manifest = { ...stack.manifest, id: 'app.example.elsewhere' };
    const { collected, placed, artifact } = build(stack);

    expect(docNames(artifact.docs).sort()).toEqual(['acme_faq', 'acme_guide']);
    expect(placed.docs).toBe(collected.docs);
    expect(bodyOf(artifact, APP_ID)).not.toHaveProperty('docs');
    expect(docNames(bodyOf(artifact, SERVICE_ID).docs)).toEqual(['acme_service_runbook']);
  });

  it('two entries carrying the manifest id: the flat docs stay on the top level', () => {
    const stack = composedArtifact();
    stack.packages[0].manifest = { ...stack.packages[0].manifest, id: APP_ID, name: 'acme-twin' };
    const { artifact } = build(stack);

    expect(docNames(artifact.docs).sort()).toEqual(['acme_faq', 'acme_guide']);
    for (const entry of artifact.packages as Array<{ manifest: Record<string, any> }>) {
      expect(JSON.stringify(entry.manifest.docs ?? [])).not.toContain('MARKER-22190-flat');
    }
  });

  it('a stack with no packages[]: the very same docs array comes back, and no packages key appears', () => {
    const single = { manifest: { ...appStack.manifest }, objects: appStack.objects };
    const { collected, placed, artifact } = build(single);

    expect(placed.docs).toBe(collected.docs);
    expect(placed.packages).toBeUndefined();
    expect(artifact).not.toHaveProperty('packages');
    expect(docNames(artifact.docs).sort()).toEqual(['acme_faq', 'acme_guide']);
    // The single-package shape still reports a per-package directory it does
    // not read, exactly as before.
    expect(collected.issues.map((issue) => [issue.rule, issue.path])).toEqual([
      ['docs/uncollected-directory', 'src/service/docs'],
    ]);
  });
});
