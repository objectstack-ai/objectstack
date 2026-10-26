// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11357 — the page editor leaves `requires` out of the body it saves,
 * so the server stamps it from the source on every save.
 *
 * ## The defect this file keeps fixed
 *
 * An html page's `requires` is the server's stamp: the save door compiles the
 * `source` against the deployment's SDUI manifest and writes the namespaces
 * the source uses (ADR-0080 §5). The editor seeds its draft from the served
 * document, which carries that stamp, and a source edit patches only
 * `{ source }`. Before this card the edit-mode save sent the draft whole, so
 * the stored stamp travelled back as if the author had written it. When the
 * edit added a plugin component (a Kanban from `plugin-kanban`), the draft
 * saved, and the publish was refused 422 under the rule
 * `page-requires-disagrees-with-source`, naming a key the editor never shows.
 *
 * The fix is the `page` resource's `fromDraft` (registered with the other
 * built-in resources): it drops `requires` from the saved body and nothing
 * else. ⛔ The client does not recompute `requires`: the server owns the stamp,
 * and it still refuses a hand-written list that disagrees with the source.
 *
 * ## The server double
 *
 * `server` below applies the save door's two functions for an html page, as
 * objectstack's `runtime-authoring-gate.ts` defines them
 * (`stampHtmlPageRequires`, `findHtmlPageSourceGaps`):
 *   - a save stamps `requires` from the compiled source when the body has no
 *     `requires` or one that agrees, and leaves a disagreeing one as written
 *     (drafts are not gated);
 *   - a publish refuses a draft whose `requires` disagrees with the source
 *     (`422 INVALID_METADATA`, the disagreeing namespace named), and otherwise
 *     promotes the draft with the same stamp.
 * The "compile" maps each JSX tag to the namespace of the manifest component
 * it names. Only that mapping is invented here; the two rules are the door's,
 * and so is the set of kinds they compile: the double reads the installed
 * `@objectstack/spec`'s `COMPILED_PAGE_KINDS` rather than copying it, so it
 * follows the spec when that set moves (spec 18 dropped the retired `jsx`,
 * objectui#12486).
 *
 * Everything on the client side is shipping code: the page resource config
 * registered at load, `MetadataResourceEditPage` with its Save and Publish
 * doors and its post-save refresh, and the real `PagePreview`, which mounts
 * the real `SourcePageEditor` for an html page. A wrapper around `PagePreview`
 * only prints the draft it is handed, so the read-back is observable.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

type Row = Record<string, unknown>;

/** The rule the save door refuses a disagreeing `requires` under. */
const RULE = 'page-requires-disagrees-with-source';

/** The source the published page was stamped from: intrinsic tags only. */
const SOURCE_UI_ONLY = '<flex>\n  <h1>Pipeline</h1>\n</flex>';
/** The author's edit: a plugin component joins the source. */
const SOURCE_WITH_KANBAN = '<flex>\n  <h1>Pipeline</h1>\n  <Kanban object="opportunity" />\n</flex>';
/** An edit that changes no component: the heading text only. */
const SOURCE_UI_ONLY_RETITLED = '<flex>\n  <h1>Open pipeline</h1>\n</flex>';

/** A published html page, as the server stored it: its `requires` is the server's stamp. */
const PUBLISHED_HTML_PAGE: Row = {
  name: 'pipeline_board',
  label: 'Pipeline board',
  type: 'app',
  kind: 'html',
  source: SOURCE_UI_ONLY,
  requires: ['ui'],
};

const key = (type: string, name: string) => `${type}/${name}`;

/** The page kinds the save door compiles, from the installed spec (hoisted with the double that reads it). */
const { COMPILED_PAGE_KINDS } = await vi.hoisted(async () => await import('@objectstack/spec/ui'));

const server = vi.hoisted(() => {
  /** The manifest's answer per tag: intrinsic tags are `ui`, `Kanban` is the plugin's. */
  const NAMESPACE_OF: Record<string, string> = {
    flex: 'ui',
    grid: 'ui',
    h1: 'ui',
    p: 'ui',
    Kanban: 'plugin-kanban',
  };
  type Doc = Record<string, unknown>;
  /** The kinds the door compiles, read as a list a stored `kind` of any value can be looked up in. */
  const compiledKinds: readonly unknown[] = COMPILED_PAGE_KINDS;
  /** The compiled namespaces of an html page's source, in first-use order; `null` when it is not compiled. */
  const compiledRequires = (body: Doc): string[] | null => {
    if (!compiledKinds.includes(body.kind)) return null;
    if (typeof body.source !== 'string' || body.source.trim() === '') return null;
    const used: string[] = [];
    for (const m of body.source.matchAll(/<([A-Za-z][\w-]*)/g)) {
      const ns = NAMESPACE_OF[m[1]!];
      if (!ns) throw new Error(`server double: no manifest component for <${m[1]}>`);
      if (!used.includes(ns)) used.push(ns);
    }
    return used;
  };
  const sameNamespaces = (a: readonly string[], b: readonly string[]) =>
    new Set(a).size === new Set(b).size && a.every((ns) => b.includes(ns));
  const agrees = (declared: unknown, compiled: string[]) =>
    Array.isArray(declared) && declared.every((ns) => typeof ns === 'string') && sameNamespaces(declared as string[], compiled);
  /** `stampHtmlPageRequires`: stamp when absent or agreeing; a disagreeing list is left as written. */
  const stamp = (body: Doc): Doc => {
    const compiled = compiledRequires(body);
    if (!compiled) return body;
    if (body.requires !== undefined && !agrees(body.requires, compiled)) return body;
    return { ...body, requires: [...compiled] };
  };
  /** `findHtmlPageSourceGaps`, the `requires` half: the refusal a publish answers, or `null`. */
  const requiresRefusal = (body: Doc): { rule: string; path: string; message: string } | null => {
    const compiled = compiledRequires(body);
    if (!compiled || body.requires === undefined || agrees(body.requires, compiled)) return null;
    const declared = (Array.isArray(body.requires) ? body.requires : [body.requires]).filter(
      (ns): ns is string => typeof ns === 'string',
    );
    const clauses = [
      ...declared.filter((ns) => !compiled.includes(ns)).map((ns) => `'${ns}' is not used by the source`),
      ...compiled.filter((ns) => !declared.includes(ns)).map((ns) => `'${ns}' is used by the source but not listed`),
    ];
    return {
      rule: 'page-requires-disagrees-with-source',
      path: `pages.${String(body.name)}.requires`,
      message: `\`requires\` disagrees with the source: ${clauses.join('; ')}.`,
    };
  };
  return {
    stamp,
    requiresRefusal,
    active: new Map<string, Doc>(),
    drafts: new Map<string, Doc>(),
    saves: [] as Array<{ type: string; name: string; body: Doc; opts: Doc | undefined }>,
    publishes: [] as string[],
    refusals: [] as Array<{ rule: string; path: string; message: string }>,
  };
});

const mockClient = vi.hoisted(() => {
  const k = (type: string, name: string) => `${type}/${name}`;
  const toWire = (doc: unknown) => JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
  return {
    list: vi.fn(async () => []),
    listDrafts: vi.fn(async () => []),
    get: vi.fn(async () => null),
    references: vi.fn(async () => []),
    layered: vi.fn(async (type: string, name: string, _opts?: { packageId?: string }) => {
      const eff = server.active.get(k(type, name)) ?? null;
      return { code: null, overlay: eff, overlayScope: eff ? 'env' : null, effective: eff, editable: true, deletable: true, resettable: false, lock: 'none' };
    }),
    getDraft: vi.fn(async (type: string, name: string, _opts?: { packageId?: string }) => {
      const row = server.drafts.get(k(type, name));
      if (!row) {
        throw Object.assign(new Error(`No pending draft exists for ${type}/${name}.`), { code: 'NO_DRAFT', status: 404 });
      }
      return { type, name, item: { ...row } };
    }),
    /** `PUT …?mode=draft`: the door stamps the body, then it lands in the draft slot. */
    save: vi.fn(async (type: string, name: string, item: unknown, opts?: Record<string, unknown>) => {
      const body = toWire(item);
      server.saves.push({ type, name, body, opts });
      server.drafts.set(k(type, name), server.stamp(body));
      return { type, name, item: body };
    }),
    /** `POST …/publish`: the gate judges the draft; a pass promotes it with the same stamp. */
    publish: vi.fn(async (type: string, name: string, _opts?: Record<string, unknown>) => {
      const row = server.drafts.get(k(type, name));
      if (!row) throw Object.assign(new Error('nothing to publish'), { code: 'NO_DRAFT', status: 404 });
      const refusal = server.requiresRefusal(row);
      if (refusal) {
        server.refusals.push(refusal);
        throw Object.assign(new Error(`${refusal.rule}: ${refusal.message}`), {
          code: 'INVALID_METADATA',
          status: 422,
          body: { code: 'INVALID_METADATA', issues: [refusal] },
        });
      }
      server.active.set(k(type, name), server.stamp(row));
      server.drafts.delete(k(type, name));
      server.publishes.push(k(type, name));
      return { success: true, version: 2 };
    }),
    reset: vi.fn(async () => ({})),
  };
});

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({
      entries: [{ type: 'page', name: 'page', label: 'Page', allowEnvironmentOverlay: true, schema: { required: [] } }],
    }),
  };
});

// Monaco's loader fails (offline), so the source editor falls back to its
// textarea — the same `source` patch the Monaco editor's onChange sends.
vi.mock('@monaco-editor/react', () => {
  const Editor = () => null;
  return { Editor, default: Editor, loader: { init: () => Promise.reject(new Error('offline')) } };
});

// The `page` resource config under test is registered here, at load, exactly
// as the package entry registers it.
import '../../services/builtinComponents.js';
import { MetadataResourceEditPage } from './ResourceEditPage';
import { getMetadataResource } from './registry';
import { registerMetadataPreview, getMetadataPreview } from './preview-registry';
import { PagePreview } from './previews/PagePreview';

/** The real `PagePreview`, plus a print of the draft it was handed. */
function PrintingPagePreview(props: React.ComponentProps<typeof PagePreview>) {
  return (
    <>
      <pre data-testid="editor-draft">{JSON.stringify(props.draft)}</pre>
      <PagePreview {...props} />
    </>
  );
}

const realPagePreview = getMetadataPreview('page');

beforeEach(() => {
  server.active.clear();
  server.drafts.clear();
  server.saves.length = 0;
  server.publishes.length = 0;
  server.refusals.length = 0;
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  registerMetadataPreview('page', PrintingPagePreview as never);
  server.active.set(key('page', 'pipeline_board'), JSON.parse(JSON.stringify(PUBLISHED_HTML_PAGE)) as Row);
});

afterEach(() => {
  cleanup();
  if (realPagePreview) registerMetadataPreview('page', realPagePreview);
  window.history.replaceState(null, '', '/');
});

function renderEditor() {
  window.history.replaceState(null, '', '/metadata/page/pipeline_board');
  render(
    <MemoryRouter initialEntries={['/metadata/page/pipeline_board']}>
      <MetadataResourceEditPage type="page" name="pipeline_board" />
    </MemoryRouter>,
  );
}

const editorDraft = (): Row => JSON.parse(screen.getByTestId('editor-draft').textContent ?? '{}') as Row;

async function sourceEditor(): Promise<HTMLTextAreaElement> {
  return (await screen.findByRole('textbox', { name: 'Page source' }, { timeout: 8000 })) as HTMLTextAreaElement;
}

/** Type a new source and press the toolbar Save; wait for the save and its read-back. */
async function editSourceAndSave(source: string, saveCount: number) {
  fireEvent.change(await sourceEditor(), { target: { value: source } });
  const save = await screen.findByRole('button', { name: /^Save/ }, { timeout: 8000 });
  await waitFor(() => expect(save).toBeEnabled(), { timeout: 8000 });
  fireEvent.click(save);
  await waitFor(() => expect(server.saves.length).toBe(saveCount), { timeout: 8000 });
  await waitFor(() => expect(editorDraft().source).toBe(source), { timeout: 8000 });
  await waitFor(() => expect(mockClient.getDraft.mock.calls.length).toBeGreaterThanOrEqual(saveCount + 1), { timeout: 8000 });
}

async function publish() {
  const button = (await screen.findAllByRole('button', { name: /^Publish$/ }, { timeout: 8000 }))[0]!;
  await waitFor(() => expect(button).toBeEnabled(), { timeout: 8000 });
  fireEvent.click(button);
  await waitFor(() => expect(server.publishes.length + server.refusals.length).toBeGreaterThan(0), { timeout: 8000 });
}

describe('page editor — the save body carries no `requires`; the server stamps it (objectui#11357)', () => {
  it('THE PIN: a source edit that adds a plugin component saves and publishes, and the stamp the server returns names the plugin', async () => {
    renderEditor();
    // The editor is seeded from the served document, stamp included.
    await waitFor(() => expect(editorDraft().requires).toEqual(['ui']), { timeout: 8000 });

    await editSourceAndSave(SOURCE_WITH_KANBAN, 1);
    const sent = server.saves[0]!;
    expect(sent.opts).toMatchObject({ mode: 'draft' });
    expect.soft(sent.body, 'the save body carries no `requires`').not.toHaveProperty('requires');
    // Everything else the author has is in the body as it was served.
    expect(sent.body).toMatchObject({ name: 'pipeline_board', label: 'Pipeline board', type: 'app', kind: 'html', source: SOURCE_WITH_KANBAN });

    await publish();
    expect.soft(server.refusals, `no \`${RULE}\` refusal`).toEqual([]);
    expect(server.publishes).toEqual(['page/pipeline_board']);
    // The server's stamp names the plugin the source now uses.
    expect(server.active.get(key('page', 'pipeline_board'))!.requires).toEqual(['ui', 'plugin-kanban']);
  });

  it('READ-BACK: the editor shows the server\'s fresh stamp after a save, and the next save still sends no `requires`', async () => {
    renderEditor();
    await waitFor(() => expect(editorDraft().requires).toEqual(['ui']), { timeout: 8000 });

    await editSourceAndSave(SOURCE_WITH_KANBAN, 1);
    // The re-read draft carries the stamp the server just wrote, not the one it was seeded with.
    expect(editorDraft().requires).toEqual(['ui', 'plugin-kanban']);

    // Take the Kanban back out: the stamp now in the editor would disagree again.
    await editSourceAndSave(SOURCE_UI_ONLY, 2);
    expect(server.saves[1]!.body).not.toHaveProperty('requires');
    expect(editorDraft().requires).toEqual(['ui']);

    await publish();
    expect(server.refusals).toEqual([]);
    expect(server.active.get(key('page', 'pipeline_board'))!.requires).toEqual(['ui']);
  });

  it('CONTROL: an edit that changes no component still publishes, and the stamp is unchanged', async () => {
    renderEditor();
    await waitFor(() => expect(editorDraft().requires).toEqual(['ui']), { timeout: 8000 });

    await editSourceAndSave(SOURCE_UI_ONLY_RETITLED, 1);
    expect(server.saves[0]!.body).not.toHaveProperty('requires');

    await publish();
    expect(server.refusals).toEqual([]);
    expect(server.active.get(key('page', 'pipeline_board'))).toMatchObject({
      source: SOURCE_UI_ONLY_RETITLED,
      requires: ['ui'],
    });
  });

  it('the registered `fromDraft` drops `requires` and nothing else, and never writes one', () => {
    const fromDraft = getMetadataResource('page')?.fromDraft;
    expect(fromDraft).toBeTypeOf('function');

    const withStamp: Row = { ...PUBLISHED_HTML_PAGE, source: SOURCE_WITH_KANBAN };
    const body = fromDraft!(withStamp);
    expect(body).not.toHaveProperty('requires');
    const { requires: _stamp, ...rest } = withStamp;
    expect(body).toStrictEqual(rest);
    // The draft itself is not touched: the editor keeps showing the stamp it read.
    expect(withStamp.requires).toEqual(['ui']);

    // A draft with no `requires` comes back as it is: the client never invents one.
    const withoutStamp: Row = { name: 'p', kind: 'html', source: SOURCE_WITH_KANBAN };
    expect(fromDraft!(withoutStamp)).toBe(withoutStamp);
  });
});
