// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #18490 — the artifact package-id rule has ONE owner again, and importing it
 * DECIDED the one input the two copies disagreed on.
 *
 * ## What this file measures, and against what
 *
 * `packages/cli/src/utils/artifact-packages.ts` declares itself the sole owner
 * of "which package is this". `nav-contribution-groups.ts` carried a second
 * implementation, `artifactPackagesOf`, differing from the owner in a single
 * guard — a non-empty check on `manifest.name`. For a package whose
 * `manifest.id` AND `manifest.name` are both `''` the owner answered `''` and
 * the copy answered `packages[<index>]`.
 *
 * Deleting the copy chose `''`. What this file pins is not that string but the
 * REASON it is the right one: `''` is what the RUNTIME fold names that package,
 * and `packages[<index>]` is a spelling the runtime cannot produce at all
 * (`ObjectQL.registerApp` derives `manifest.id || manifest.name`, with no
 * positional fallback). `nav-contribution-groups.ts`'s own header says the id
 * it carries is "the string the runtime registers a contribution under, so a
 * command names a package the same way the fold does" — this is that sentence,
 * measured.
 *
 * ⛔ NEITHER side's rule is re-spelled here. The build's answer comes out of
 * the shipped `findNavGroupDiagnostics`, the runtime's out of a real
 * `ObjectQL`, and the assertion is that the two STRINGS match — so the day
 * either rule moves, this reds instead of agreeing with itself.
 *
 * ## ⭐ #17534 — the divergent input is no longer reachable through the parse
 *
 * This file's first case used to be a floor: `ManifestSchema` constrained
 * NEITHER id key to be non-empty, so `''` parsed and the two rules could
 * disagree on a stack `os build` would accept. It said, in as many words, that
 * a spec change refusing that input should red HERE first. #17534 is that
 * change: `ManifestSchema.id` carries `MANIFEST_ID_PATTERN`, so a composed
 * artifact whose `manifest.id` is `''` is refused at the parse door, by name.
 *
 * What that does to this file is structural, not cosmetic — the owner derives
 * `manifest.id || manifest.name`, and after #17534 a parsed package's `id` is
 * always a pattern-matching, non-empty string, so the fallback never runs and
 * the two rules can no longer disagree on ANY parsed input. So the first case
 * is now the closure itself (the refusal, quoted), and the cross-door cases
 * keep measuring what they were written to measure — that the build names a
 * package EXACTLY as the runtime fold does, and never with the deleted copy's
 * positional spelling — at an identity a command can actually hand down.
 * ⛔ The degenerate fixture is not kept alive by bypassing the parse: a pin on
 * an input no command can produce measures nothing and reads as if it did.
 *
 * ## Why this is a file of its own, and why it is INTEGRATION tier
 *
 * The cross-door half constructs `new ObjectQL(`, which is a KERNEL signal in
 * `vitest-tiers.ts`'s predicate — so a file carrying it is integration tier by
 * derivation, not by naming. Folding these cases into the unit-tier
 * `nav-contribution-groups.test.ts` would have moved that whole file, and its
 * nine existing #14553 pins with it, out of the tier they were written for.
 * Splitting keeps the tier change confined to the cases that actually boot a
 * registry. ⛔ Do not merge this file back into that one.
 */

import { describe, it, expect } from 'vitest';
import { composeStacks, normalizeStackInput, ObjectStackDefinitionSchema } from '@objectstack/spec';
import { ObjectQL } from '@objectstack/objectql/core';
import { findNavGroupDiagnostics } from './nav-contribution-groups.js';
import { artifactPackages } from './artifact-packages.js';

type AnyRec = Record<string, unknown>;

const APP = 'multi_crm';
const GROUP = 'sales_group';
const TYPO = 'sales_grp';
const CORE_ID = 'com.example.multi.core';
/** The contributing package's id — reverse-domain, as #17534 requires of every parsed manifest. */
const ORDERS_ID = 'com.example.multi.orders';

/** The App package — owns the app and the group container the module aims at. */
const coreStack = () => ({
  manifest: {
    id: CORE_ID,
    name: 'Multi-Package Core',
    namespace: 'crm',
    version: '1.0.0',
    type: 'app' as const,
  },
  objects: [{
    name: 'crm_account',
    label: 'Account',
    sharingModel: 'private' as const,
    fields: { name: { name: 'name', type: 'text' as const, label: 'Account Name', required: true } },
  }],
  apps: [{
    name: APP,
    label: 'Multi-Package CRM',
    navigation: [{
      id: GROUP,
      type: 'group' as const,
      label: 'Sales',
      children: [{ id: 'nav_accounts', type: 'object' as const, objectName: 'crm_account', label: 'Accounts' }],
    }],
  }],
});

/**
 * The contributing package.
 *
 * ⚠️ Its own namespace, not the app package's. The composed-artifact leg does
 * not care, but the runtime leg INSTALLS both packages into one registry and
 * ADR-0048 refuses a second package under a namespace another already owns —
 * a conflict that would make this file red for a reason that has nothing to do
 * with what it measures.
 *
 * ⭐ #17534: `id` is the identity both doors derive; `name` stays `''` so the
 * owner's `id || name` is still exercised on a manifest that gives the fallback
 * nothing to fall back TO — the nearest reachable neighbour of the input this
 * file was written around.
 */
const ordersStack = (group: string, id: string = ORDERS_ID) => ({
  manifest: {
    id,
    name: '',
    namespace: 'ord',
    version: '1.0.0',
    type: 'module' as const,
    navigationContributions: [{
      app: APP,
      group,
      items: [{ id: 'nav_orders', type: 'object' as const, objectName: 'ord_order', label: 'Orders' }],
    }],
  },
  objects: [{
    name: 'ord_order',
    label: 'Order',
    sharingModel: 'private' as const,
    fields: { name: { name: 'name', type: 'text' as const, label: 'Order Number', required: true } },
  }],
});

/** The composed artifact, up to but NOT through the parse — the parse is what two cases below read. */
const composedArtifact = (group: string, id: string = ORDERS_ID): AnyRec => {
  const composed = composeStacks(
    [ordersStack(group, id), coreStack()],
    { manifest: 'preserve' },
  ) as unknown as Record<string, unknown>;
  return normalizeStackInput(composed, { onConversionNotice: () => {} }) as unknown as AnyRec;
};

/** The artifact as the commands actually hand it down — through their own parse. */
const parsedArtifact = (group: string, id: string = ORDERS_ID): AnyRec => {
  const result = ObjectStackDefinitionSchema.safeParse(composedArtifact(group, id));
  if (!result.success) {
    throw new Error(`fixture does not parse: ${JSON.stringify(result.error.issues.slice(0, 3))}`);
  }
  return result.data as unknown as AnyRec;
};

describe('#18490 — one package, two doors, one name', () => {
  it('⭐ #17534 — an empty `manifest.id` no longer REACHES this check: the parse door refuses it by name', () => {
    // The floor, inverted. It used to read: `ManifestSchema` constrains NEITHER
    // id key to be non-empty, so `''` parses and the two rules can disagree on
    // a stack `os build` would accept — and it promised to red FIRST if a spec
    // change started refusing that input. This is that red, converted into the
    // pin it asked for: `ManifestSchema.id` carries `MANIFEST_ID_PATTERN`, so
    // the composed artifact is refused at the parse, on `manifest.id`, with the
    // value echoed. ⇒ Every parsed package now has a non-empty id, the owner's
    // `id || name` never falls back, and the divergence this file was written
    // around cannot occur on any input a command hands down.
    const refused = ObjectStackDefinitionSchema.safeParse(composedArtifact(GROUP, ''));
    expect(refused.success).toBe(false);
    const issues = refused.success ? [] : refused.error.issues;
    expect(issues.some((issue) => issue.path.join('.') === 'packages.0.manifest.id')).toBe(true);
    expect(issues.map((issue) => issue.message).join('\n')).toContain("Invalid package id ''");

    // Lit control — the id is what decides it: the same fixture with a
    // reverse-domain id parses, and the owner names both packages.
    expect(artifactPackages(parsedArtifact(GROUP)).map((pkg) => pkg.id).sort())
      .toEqual([CORE_ID, ORDERS_ID]);
  });

  it('the build names that package EXACTLY as the runtime fold does', async () => {
    // The build door: the shipped derivation, reached the way both commands
    // reach it — `findNavGroupDiagnostics(result.data)`, one argument.
    const built = await findNavGroupDiagnostics(parsedArtifact(TYPO));
    expect(built).toHaveLength(1);

    // The runtime door: the same two packages installed into a real registry.
    // `registerApp` derives the id it registers the contribution under, the
    // read-time fold relocates the mis-aimed items, and recording that
    // relocation is what produces the diagnostic.
    const engine = new ObjectQL();
    const core = coreStack();
    engine.registerApp({ ...core.manifest, apps: core.apps });
    engine.registerApp({ ...ordersStack(TYPO).manifest });
    engine.registry.getApp(APP);
    const folded = engine.registry.getAppNavDiagnostics(APP);
    expect(folded).toHaveLength(1);

    // The card, in two lines: the `packageId` field a consumer reads, and the
    // sentence an author reads.
    expect(built[0].packageId).toBe(folded[0].packageId);
    expect(built[0].message).toBe(folded[0].message);
  });

  it('⛔ and that shared name is NOT the deleted copy\'s positional spelling', async () => {
    // Its own assertion, because the pin above would also pass if BOTH doors
    // moved to `packages[0]`. The runtime has no positional fallback, so a
    // build printing one is a build naming a package the runtime never will.
    const built = await findNavGroupDiagnostics(parsedArtifact(TYPO));
    expect(built[0].packageId).toBe(ORDERS_ID);
    expect(built[0].packageId).not.toBe('packages[0]');
    expect(built[0].message).not.toContain('packages[0]');
  });

  it('two packages that both resolve to the empty id still produce TWO findings', async () => {
    // The id is CARRIED and PRINTED on this path — never a map key, a dedupe
    // key or a sort key. Pinned because "both collapse into one finding" is the
    // failure a SHARED id would cause if it ever became one, and it would
    // present as the report going QUIET rather than as an error. ⭐ #17534 moved
    // the shared value from `''` to a reverse-domain id; the property under
    // test — two packages resolving to ONE name still produce two findings — is
    // unchanged, and a duplicate id is still reachable here because this path
    // carries the id rather than keying on it.
    const second = {
      manifest: {
        id: ORDERS_ID,
        name: '',
        navigationContributions: [{
          app: APP,
          group: TYPO,
          items: [{ id: 'nav_second', type: 'object' as const, objectName: 'ord_order', label: 'Second' }],
        }],
      },
    };
    const parsed = parsedArtifact(TYPO);
    const widened: AnyRec = {
      ...parsed,
      packages: [...((parsed.packages ?? []) as unknown[]), second],
    };
    const found = await findNavGroupDiagnostics(widened);
    expect(found).toHaveLength(2);
    expect(found.map((d) => d.packageId)).toEqual([ORDERS_ID, ORDERS_ID]);
  });
});
