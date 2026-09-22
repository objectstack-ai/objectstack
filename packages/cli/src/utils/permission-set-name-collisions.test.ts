// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #18024 — `os build` / `os validate`'s compile-time half of the #17516
 * permission-set name-collision ruling.
 *
 * ## What this file measures, and against what
 *
 * #17516 gave the refusal a RUNTIME door: a package that declares a set whose
 * name another package owns has its ENTIRE declaration dropped (ADR-0086 D4,
 * correct and unchanged), and since that card the drop reaches the author at
 * boot. The runtime half is pinned in
 * `packages/plugins/plugin-security/src/permission-set-name-collision.test.ts`;
 * this file is the compile half, which reports the same finding from the
 * composed artifact before anything is deployed.
 *
 * The inputs run through the REAL `composeStacks(…, { manifest: 'preserve' })`
 * rather than a hand-written artifact literal, for the reason the sibling nav
 * suite records: the whole question is what a COMPOSED artifact looks like, so
 * a literal would pin this check against a shape nothing produces and would go
 * on passing the day composition changes.
 *
 * ## ⭐ The assertion that fails on the WRONG fix
 *
 * A "report duplicate permission-set names" check passes every happy-path
 * reading in this file and is wrong: a package re-declaring its OWN set name is
 * an idempotent re-seed at runtime, not a refusal. `permissionSetNameIsForeign`
 * is the shipped function that draws that line, and the intra-package case
 * below is what proves the door consults it rather than counting names. The
 * wording assertions are the other half: the diagnostic is compared against the
 * shipped PRODUCER's own output, so a door that re-spelled the sentence — the
 * exact drift this card exists to prevent — fails here rather than shipping two
 * doors that say different things about one refusal.
 */

// [#7668 family, `check:test-source-alias`] A MODULE-TOP side-effect load of
// the dependency `findPermissionSetNameCollisions` imports dynamically. This
// package resolves `@objectstack/plugin-security` through its `dist/`, so the
// first call transforms that whole module graph — paying it during COLLECTION
// (which vitest clocks against nothing) rather than inside a test body, which
// is a CLOCKED window. ⛔ Do not "fix" a timeout here by widening it.
//
// The production import stays lazy and stays where it is: this line decides
// only WHERE the first load is paid in THIS suite, and `os build`'s cold path
// must not pull the security plugin in to judge a stack with no collisions.
import '@objectstack/plugin-security';
import { describe, it, expect } from 'vitest';
import { composeStacks, normalizeStackInput, ObjectStackDefinitionSchema } from '@objectstack/spec';
import {
  PERMISSION_SET_NAME_COLLISION,
  formatPermissionSetNameCollisionDiagnostic,
  permissionSetNameCollisionDiagnostic,
} from '@objectstack/plugin-security';
import { artifactPackages } from './artifact-packages.js';
import {
  collectPermissionSetDeclarations,
  findPermissionSetNameCollisions,
  formatPermissionSetNameCollisions,
} from './permission-set-name-collisions.js';

type AnyRec = Record<string, unknown>;

const CORE_ID = 'com.example.multi.core';
const ORDERS_ID = 'com.example.multi.orders';
const SHARED_NAME = 'crm_admin';
const OWN_NAME = 'orders_admin';

type Set_ = { name: string; label?: string; objects: Record<string, AnyRec>; packageId?: string };

const coreSet = (name: string): Set_ => ({
  name,
  label: 'CRM Administrator',
  objects: { crm_account: { allowRead: true, allowEdit: true } },
});

const ordersSet = (name: string, packageId?: string): Set_ => ({
  name,
  label: 'Orders Administrator',
  objects: { crm_order: { allowRead: true } },
  ...(packageId === undefined ? {} : { packageId }),
});

/** The App package — owns the object the shared set name is declared over. */
const coreStack = (permissions: Set_[]) => ({
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
  permissions,
});

/** The Module package — ships alongside it in the same artifact. */
const ordersStack = (permissions: Set_[]) => ({
  manifest: {
    id: ORDERS_ID,
    name: 'Multi-Package Orders',
    namespace: 'crm',
    version: '1.0.0',
    type: 'module' as const,
    dependencies: { [CORE_ID]: '^1.0.0' },
  },
  objects: [{
    name: 'crm_order',
    label: 'Order',
    sharingModel: 'private' as const,
    fields: { name: { name: 'name', type: 'text' as const, label: 'Order Number', required: true } },
  }],
  permissions,
});

/** Compose exactly as `examples/app-multi-package/objectstack.config.ts` does. */
const artifact = (stacks: unknown[]): AnyRec =>
  composeStacks(stacks as never, { manifest: 'preserve' }) as unknown as AnyRec;

/** The two-package artifact, with the Module package's set name as the variable. */
const twoPackages = (ordersName: string) =>
  artifact([ordersStack([ordersSet(ordersName)]), coreStack([coreSet(SHARED_NAME)])]);

/**
 * The composed artifact as the commands actually hand it to this check —
 * through the SAME `normalizeStackInput` + `ObjectStackDefinitionSchema` parse
 * they run, and `result.data` is the object they pass.
 *
 * ⚠️ Load-bearing, and the one thing a raw `composeStacks` reading cannot
 * establish. The check walks `parsed.packages[].manifest.permissions`, and if
 * the parse reshaped, renamed or dropped any part of that path the derivation
 * would silently see an artifact with no declarations — reporting nothing,
 * which is indistinguishable from a clean stack.
 */
const parsedArtifact = (stacks: unknown[]): AnyRec => {
  const normalized = normalizeStackInput(artifact(stacks) as Record<string, unknown>, {
    onConversionNotice: () => {},
  });
  const result = ObjectStackDefinitionSchema.safeParse(normalized);
  if (!result.success) {
    throw new Error(`fixture does not parse: ${JSON.stringify(result.error.issues.slice(0, 3))}`);
  }
  return result.data as unknown as AnyRec;
};

describe('#18024 — `os build` reports a permission-set name another package in the artifact owns', () => {
  it('the fixture really is a two-package artifact carrying two declarations — the floor under every reading below', () => {
    // Without this, a composition change that stopped emitting `packages[]`, or
    // a parse that dropped `permissions` from an assembled body, would make
    // every assertion here vacuously true: the derivation would see no
    // declarations and report nothing, which is also what "clean" looks like.
    // Asserted on the CLEAN leg, so the file cannot go green by measuring an
    // empty artifact.
    const parsed = parsedArtifact([ordersStack([ordersSet(OWN_NAME)]), coreStack([coreSet(SHARED_NAME)])]);
    expect(artifactPackages(parsed).map((p) => p.id).sort()).toEqual([CORE_ID, ORDERS_ID]);
    expect(collectPermissionSetDeclarations(parsed).sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: SHARED_NAME, declaredBy: CORE_ID },
      { name: OWN_NAME, declaredBy: ORDERS_ID },
    ]);
  });

  it('two packages, two distinct set names — reports NOTHING', async () => {
    expect(await findPermissionSetNameCollisions(twoPackages(OWN_NAME))).toEqual([]);
    expect(await findPermissionSetNameCollisions(parsedArtifact(
      [ordersStack([ordersSet(OWN_NAME)]), coreStack([coreSet(SHARED_NAME)])],
    ))).toEqual([]);
  });

  it('needs only the parsed stack — the commands call it with one argument', async () => {
    // Both `os build` and `os validate` reach this through
    // `findPermissionSetNameCollisions(result.data)`, letting the package walk
    // default to `artifactPackages`. Pinned because the explicit-packages form
    // is what the floor above exercises, so a default that silently stopped
    // deriving would leave this file green while both commands went blind.
    const parsed = parsedArtifact([ordersStack([ordersSet(SHARED_NAME)]), coreStack([coreSet(SHARED_NAME)])]);
    expect(await findPermissionSetNameCollisions(parsed)).toEqual(
      await findPermissionSetNameCollisions(parsed, artifactPackages(parsed)),
    );
    expect(await findPermissionSetNameCollisions(parsed)).toHaveLength(1);
  });

  it('ONE colliding name reports the SHIPPED diagnostic, produced by the shipped producer', async () => {
    // Artifact order is registration order, so the Module package — listed
    // first, exactly as `examples/app-multi-package` lists it — creates the row
    // and the App package's later declaration is the one the runtime refuses.
    const parsed = parsedArtifact([ordersStack([ordersSet(SHARED_NAME)]), coreStack([coreSet(SHARED_NAME)])]);
    const found = await findPermissionSetNameCollisions(parsed);

    expect(found).toHaveLength(1);
    // ⭐ Compared against the PRODUCER, not against a transcription of what it
    // currently says. A door that re-derived the wording — the drift this card
    // is about — fails here on the first character that differs, and a reword
    // at the producer travels to both doors without touching this file.
    expect(found[0]).toEqual(permissionSetNameCollisionDiagnostic({
      name: SHARED_NAME,
      declaredBy: CORE_ID,
      ownedBy: ORDERS_ID,
    }));
    expect(found[0].event).toBe(PERMISSION_SET_NAME_COLLISION);
    // `severity: 'warning'` is what says the build still succeeds: this card
    // makes an existing refusal visible, it does not narrow what `os build`
    // accepts.
    expect(found[0].severity).toBe('warning');
    // The facts an author has to act on, in the printed text.
    expect(found[0].message).toContain(SHARED_NAME);
    expect(found[0].message).toContain(CORE_ID);
    expect(found[0].message).toContain(ORDERS_ID);
    expect(found[0].fix).toContain(CORE_ID);
  });

  it('⭐ the SAME package declaring its own set name twice is NOT a collision', async () => {
    // The assertion a name-duplicate counter cannot pass. At runtime this is
    // `permissionSetNameIsForeign(pkg, pkg) === false` — an idempotent re-seed
    // of the package's own row, not a refusal — so a compile door that reported
    // it would be announcing a drop that never happens. ⛔ The door consults
    // the shipped predicate; it does not compare names and stop.
    const parsed = parsedArtifact([coreStack([coreSet(SHARED_NAME), coreSet(SHARED_NAME)])]);
    expect(collectPermissionSetDeclarations(parsed)).toEqual([
      { name: SHARED_NAME, declaredBy: CORE_ID },
      { name: SHARED_NAME, declaredBy: CORE_ID },
    ]);
    expect(await findPermissionSetNameCollisions(parsed)).toEqual([]);
  });

  it('reports the collision ONCE, not once per surface an artifact carries it on', async () => {
    // A multi-package artifact built before #14512's emitter half carries BOTH
    // surfaces: `permissions` composes by `concat`, so its top-level collection
    // is the union of every package's sets with their per-package provenance
    // flattened away, beside the bodies that still carry them. Such artifacts
    // are on disk and D4's read-both rule still loads them, so the hazard this
    // case exists for is live: a walk reading both levels reports each
    // collision twice — the second time attributed to whichever manifest
    // composition picked.
    const parsed = parsedArtifact([ordersStack([ordersSet(SHARED_NAME)]), coreStack([coreSet(SHARED_NAME)])]);
    expect(parsed.permissions, 'today the composer emits ONE surface (#14512)').toBeUndefined();
    expect(await findPermissionSetNameCollisions(parsed)).toHaveLength(1);

    // The legacy shape, synthesized: the flattened union written back beside
    // the bodies, which is exactly what this walk must not double-count.
    const legacy = {
      ...parsed,
      permissions: (parsed.packages as Array<{ manifest: { permissions?: unknown[] } }>)
        .flatMap((entry) => entry.manifest.permissions ?? []),
    };
    expect((legacy.permissions as unknown[]).length, 'the legacy top level really does carry both sets').toBe(2);
    expect(await findPermissionSetNameCollisions(legacy)).toHaveLength(1);
  });

  it('a set whose name no OTHER package here declares is not a finding — the cross-artifact case stays supported', async () => {
    // The bound that keeps this a report a build can stand behind. A name owned
    // by a package installed from some OTHER artifact is invisible without a
    // database, and guessing would report a package's own re-seed as a
    // collision. Only the composed case can be judged.
    const parsed = parsedArtifact([ordersStack([ordersSet(OWN_NAME)])]);
    expect(collectPermissionSetDeclarations(parsed)).toHaveLength(1);
    expect(await findPermissionSetNameCollisions(parsed)).toEqual([]);
  });

  it('the author-declared `packageId` answers only where no package ships the set', () => {
    // The seeder owns a set under `_packageId ?? packageId` — registry
    // provenance first, ADR-0086 D3's author-declared id as the fallback. Inside
    // an artifact the package IS the registry provenance, so a set carrying a
    // different `packageId` is still declared by the package that ships it;
    // reading the key there would attribute a package's own sets to someone
    // else and invent a collision with itself.
    const inArtifact = parsedArtifact([ordersStack([ordersSet(SHARED_NAME, 'com.example.elsewhere')])]);
    expect(collectPermissionSetDeclarations(inArtifact)).toEqual([
      { name: SHARED_NAME, declaredBy: ORDERS_ID },
    ]);

    // With no package around the declaration at all, the key is the only owner
    // there is — the shape the seeder's fallback exists for.
    expect(collectPermissionSetDeclarations({
      permissions: [ordersSet(SHARED_NAME, 'com.example.elsewhere')],
    })).toEqual([{ name: SHARED_NAME, declaredBy: 'com.example.elsewhere' }]);
  });

  it('a declaration with no resolvable owner is dropped, never reported as a collision', async () => {
    // The seeder returns at `if (!packageId)` with a different warning and never
    // reaches the collision branch, so a compile door that reported one would be
    // announcing a refusal the runtime does not make.
    const unowned = { permissions: [ordersSet(SHARED_NAME), coreSet(SHARED_NAME)] };
    expect(collectPermissionSetDeclarations(unowned)).toEqual([]);
    expect(await findPermissionSetNameCollisions(unowned)).toEqual([]);
    // A set with no `name` is dropped at the same door, for the same reason.
    expect(collectPermissionSetDeclarations({
      manifest: { id: CORE_ID },
      permissions: [{ objects: {} }, coreSet(SHARED_NAME)],
    })).toEqual([{ name: SHARED_NAME, declaredBy: CORE_ID }]);
  });

  it('the printed line is the SHIPPED formatter\'s, carrying the shared token', async () => {
    const parsed = parsedArtifact([ordersStack([ordersSet(SHARED_NAME)]), coreStack([coreSet(SHARED_NAME)])]);
    const found = await findPermissionSetNameCollisions(parsed);
    const lines = await formatPermissionSetNameCollisions(found);

    expect(lines).toEqual(found.map((d) => formatPermissionSetNameCollisionDiagnostic(d)));
    // The token an operator greps for is ONE string across both doors.
    expect(lines[0]).toContain(PERMISSION_SET_NAME_COLLISION);
    expect(lines[0]).toContain('Fix:');
    expect(await formatPermissionSetNameCollisions([])).toEqual([]);
  });
});
