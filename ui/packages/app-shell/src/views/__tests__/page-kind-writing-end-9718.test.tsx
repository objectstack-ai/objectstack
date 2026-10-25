/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9718 — THE WRITING END of the page-kind to node-type channel.
 *
 * ## What was unguarded, and how that was measured
 *
 * objectui#9642 declared the channel and pinned it with
 * `page-kind-node-type-channel-9642`, which lives in `@object-ui/components`.
 * A comment at the writing end — the `type: (page as any).type || 'page'`
 * mapping in `PageView` — told the next editor that changing the mapping would
 * turn that pin red "by design". It would not, and the reason is structural:
 * `@object-ui/components` does not depend on `@object-ui/app-shell`, so that
 * pin's module graph cannot reach `PageView` at all.
 *
 * Both directions were measured on objectui#9718 before this file was written:
 *
 * - gutting the mapping to a constant `type: 'page'` left
 *   `page-kind-node-type-channel-9642` GREEN, every case passing;
 * - deleting the `utility` registration — the READING end — turned that same
 *   pin RED, with the failure naming the kind.
 *
 * ⇒ the objectui#9642 pin genuinely guards the READING end. It never guarded
 * the writing end, and this file is the surface that does.
 *
 * ## Why this file lives in `@object-ui/app-shell`
 *
 * The writing end IS an app-shell file, and app-shell already depends on
 * `@object-ui/components` and `@object-ui/core` — so a pin here reaches both
 * ends of the channel with no new dependency edge. ⛔ The mirror-image route
 * (giving `@object-ui/components` an app-shell dependency so the objectui#9642
 * pin could import `PageView`) closes a cycle and was ruled out on objectui#9718.
 *
 * ## What this file asserts, and what it deliberately leaves alone
 *
 * It asserts the WRITE: which node type `PageView` hands to `SchemaRenderer`
 * for a stored page document of each kind. ⛔ It does not re-assert the reading
 * end's split (which kinds resolve to `PageRenderer`) — that is
 * `page-kind-node-type-channel-9642`'s job and it is not weakened here. ⛔ It
 * changes no render path and adds, removes or renames no registration.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { PageTypeSchema } from '@objectstack/spec/ui';
// Side-effect import: the `@object-ui/components` barrel does `import
// './renderers'`, which is what puts the page-kind registrations into
// `ComponentRegistry`. Without it the registry half of this file measures an
// empty registry rather than the channel.
import '@object-ui/components';

const PAGE_NAME = 'the-page';

vi.mock('react-router-dom', () => ({
  useParams: () => ({ pageName: PAGE_NAME }),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
  useNavigate: () => vi.fn(),
  // PageView reads the router's root href for its record navigator (objectui#12233).
  useHref: () => '/',
  useLocation: () => ({ pathname: `/apps/cloud/page/${PAGE_NAME}`, search: '' }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: { id: 'u1', name: 'User', role: 'user', image: null },
    activeOrganization: null,
  }),
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
  createAuthenticatedFetch: () => vi.fn(),
}));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({ t: (k: string, o?: any) => o?.defaultValue ?? o?.name ?? k }),
}));

/** The stored page document the next `render()` will resolve. */
let storedPage: Record<string, unknown> | undefined;

vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ pages: storedPage ? [storedPage] : [], objects: [] }),
}));

vi.mock('../MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false }),
}));

/** Every schema node handed to `SchemaRenderer` since the last render. */
const written: Record<string, any>[] = [];
/** Every interface-mode mount since the last render. */
const interfaceMounts: Record<string, unknown>[] = [];

// Interface mode is the branch that must NOT reach the registry at all, so it
// is stubbed here rather than mounted: the assertion is about which of the two
// surfaces a document reaches, not about what either one renders.
vi.mock('../InterfaceListPage', () => ({
  InterfaceListPage: ({ page }: { page: Record<string, unknown> }) => {
    interfaceMounts.push(page);
    return null;
  },
}));

vi.mock('@object-ui/react', async (orig) => {
  const actual = await (orig as any)();
  return {
    ...actual,
    useAdapter: () => ({}),
    SchemaRenderer: ({ schema }: { schema: Record<string, any> }) => {
      written.push(schema);
      return null;
    },
  };
});

import { PageView } from '../PageView';

/**
 * ⚠️ `'page'` is NOT a member of `PageTypeSchema`. It is the fallback half of
 * the same mapping — a stored document with no `type` still has to resolve —
 * and the only page key `@object-ui/types`' `SchemaRegistry` map declares.
 */
const FALLBACK_NODE_TYPE = 'page';

/**
 * Kinds short-circuited before `SchemaRenderer` by `PageView`'s
 * `interfaceConfig?.source` branch (ADR-0047 interface mode). The live split is
 * re-derived by `page-kind-node-type-channel-9642`; this list is the writing
 * end's half of it, and the interface-mode case below is what keeps the two
 * halves honest.
 */
const INTERFACE_MODE_KINDS = ['list'] as const;

function pageKinds(): string[] {
  // `PageTypeSchema` is a lazy schema; `.options` is the enum's member list.
  return [...(PageTypeSchema as unknown as { options: readonly string[] }).options];
}

function regionComposedKinds(): string[] {
  return pageKinds().filter((kind) => !(INTERFACE_MODE_KINDS as readonly string[]).includes(kind));
}

/** Mount `PageView` over one stored document and return what it wrote. */
function writeFor(doc: Record<string, unknown>): Record<string, any> | undefined {
  cleanup();
  written.length = 0;
  interfaceMounts.length = 0;
  storedPage = { name: PAGE_NAME, label: 'A Page', ...doc };
  render(<PageView />);
  return written[0];
}

describe('objectui#9718 — page kind ↔ node type channel, the WRITING end', () => {
  it('writes every region-composed page kind VERBATIM into the SchemaNode discriminator', () => {
    const served = regionComposedKinds();

    // Firing control: the set under test is non-empty, so a green below is a
    // reading and not an empty loop.
    expect(served.length).toBeGreaterThan(0);

    for (const kind of served) {
      const schema = writeFor({ type: kind });

      // Firing control on the capture itself: absence here means the harness
      // stopped reaching `SchemaRenderer`, ⛔ not that the mapping is correct.
      expect(
        schema,
        `PageView rendered no schema at all for a stored page of kind '${kind}'. This probe ` +
          `measured nothing — repair the harness before reading anything below as green.`,
      ).toBeDefined();

      expect(
        schema!.type,
        `PageView must hand the spec page KIND '${kind}' to SchemaRenderer VERBATIM as the ` +
          `SchemaNode discriminator ComponentRegistry dispatches on — that write is the WRITING ` +
          `end of the page-kind to node-type channel (objectui#9642). It wrote ` +
          `'${String(schema?.type)}' instead. If the mapping was collapsed to a constant, every ` +
          `stored '${kind}' page now renders through the generic 'page' key and loses the ` +
          `kind-specific registration; if the kind is new upstream, the channel has to be ` +
          `re-derived before this is made green.`,
      ).toBe(kind);

      expect(
        schema!.pageType,
        `PageRenderer reads the page kind off 'pageType'; PageView must carry '${kind}' there ` +
          `alongside the discriminator. Without it non-record pages fall back to the record ` +
          `max-width, a wrong data-page-type and a suppressed header.`,
      ).toBe(kind);
    }
  });

  it('the node type it writes selects the kind-specific registry entry, not merely a page renderer', () => {
    const served = regionComposedKinds();
    const registryKeys = [FALLBACK_NODE_TYPE, ...served];

    // Discriminating control for the comparison below: these registry entries
    // are distinguishable from one another, so an entry-equality assertion is a
    // real read and not a tautology over one shared object. ⛔ The distinguishing
    // values are read from the registry here, never written down.
    const labels = registryKeys.map((key) => ComponentRegistry.getMeta(key)?.label);
    expect(
      new Set(labels).size,
      `every page registry key must carry a distinguishable meta for this instrument to ` +
        `discriminate; the registry answered ${JSON.stringify(labels)} for ` +
        `${JSON.stringify(registryKeys)}.`,
    ).toBe(registryKeys.length);

    // Absent-token control: an unregistered key reads undefined, so a miss from
    // this instrument means absence rather than a broken probe.
    expect(ComponentRegistry.getMeta('zzz-not-a-registered-node-type')).toBeUndefined();

    for (const kind of served) {
      const schema = writeFor({ type: kind });

      // Firing control INSIDE the loop, because the comparison below is an
      // equality and two absences are equal: if the kind's own key were
      // unregistered, `undefined` would equal `undefined` and this case would
      // score a miss as a reading. That the key IS registered is the READING
      // end's fact, owned by `page-kind-node-type-channel-9642`; it is asserted
      // here only so the comparison has a reference point.
      expect(
        ComponentRegistry.getMeta(kind),
        `the registry key '${kind}' is unregistered, so the comparison below would compare two ` +
          `absences and pass without measuring anything. That is the READING end breaking, not the ` +
          `writing end: page-kind-node-type-channel-9642, in @object-ui/components, is the pin that ` +
          `owns it.`,
      ).toBeDefined();

      expect(
        ComponentRegistry.getMeta(schema?.type),
        `the node type PageView wrote for a stored '${kind}' page must select that kind's OWN ` +
          `registry entry. It wrote '${String(schema?.type)}', which resolves to the entry ` +
          `labelled '${String(ComponentRegistry.getMeta(schema?.type)?.label)}' where the kind's ` +
          `own key resolves to '${String(ComponentRegistry.getMeta(kind)?.label)}'. Resolving to ` +
          `SOME page renderer is not enough — that is exactly what a collapsed mapping still ` +
          `does, which is why this case compares entries rather than renderers.`,
      ).toEqual(ComponentRegistry.getMeta(kind));
    }
  });

  it('an untyped stored document falls back to the page node type', () => {
    const schema = writeFor({});

    expect(schema).toBeDefined();
    expect(
      schema!.type,
      `a stored page document with no 'type' at all must still resolve, through the fallback half ` +
        `of the same mapping. It wrote '${String(schema?.type)}'.`,
    ).toBe(FALLBACK_NODE_TYPE);
    expect(
      schema!.pageType,
      `there is no kind to carry when the document declares none, so 'pageType' must stay absent ` +
        `rather than be invented.`,
    ).toBeUndefined();

    expect(
      pageKinds().includes(FALLBACK_NODE_TYPE),
      `'${FALLBACK_NODE_TYPE}' must NOT be a member of PageTypeSchema — a page kind by that name ` +
        `would collide with the fallback this channel depends on.`,
    ).toBe(false);
  });

  it('interface-mode kinds are short-circuited before the renderer, so they write no node type', async () => {
    // Firing control: the same harness DOES capture a write when the branch is
    // not taken, so an empty capture below means the short-circuit fired and
    // ⛔ not that the harness went quiet.
    expect(writeFor({ type: INTERFACE_MODE_KINDS[0] })).toBeDefined();

    for (const kind of INTERFACE_MODE_KINDS) {
      writeFor({ type: kind, interfaceConfig: { source: 'view/anything' } });

      // `PageView` loads `InterfaceListPage` through `React.lazy`
      // (objectui#12187), so the mount lands once that import resolves.
      await waitFor(() => {
        expect(
          interfaceMounts.length,
          `page kind '${kind}' carrying interfaceConfig.source is ADR-0047 interface mode: PageView ` +
            `must render InterfaceListPage directly.`,
        ).toBe(1);
      });

      expect(
        written.length,
        `an interface-mode '${kind}' page must never reach SchemaRenderer, so it never reaches ` +
          `ComponentRegistry as a page either — that absence is why the reading end registers no ` +
          `key for it. PageView wrote ${JSON.stringify(written.map((s) => s?.type))} instead.`,
      ).toBe(0);
    }
  });
});
