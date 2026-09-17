// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #17936 — `validateRetiredPermissionResidue` at the runtime authoring door.
 *
 * The rule closes the one channel #17425's ruling D named: an author who writes
 * permission metadata as JSON and never runs `os lint`. Until this crossing it
 * was registered `CLI_ONLY`, which left exactly that population — Studio, REST
 * `/meta`, MCP — with no signal at all, because the door most tenants have is
 * the one the rule did not run on.
 *
 * ## The measurement the crossing rests on, and why it was not assumable
 *
 * The entry's own `surfaceReason` said the crossing "needs a measurement this
 * round did not take — whether the gate's `body` reaches it BEFORE the per-type
 * `safeParse`, whose residue stage strips the only evidence this rule reads".
 * That measurement is taken here rather than asserted: the door hands the gate
 * the AUTHORED body, not `parsed.data`. `saveMetaItem` keeps the body verbatim
 * by design (`parsed.data` would drop the Studio-only auxiliary fields that ride
 * along with an overlay) and grafts back exactly two normalizations — filter
 * `operator` spellings and the form `groups` → `sections` key move — each by a
 * walk over the AUTHORED keys that adds nothing and removes nothing else. So the
 * residue survives to the gate, `evaluateRuntimeAuthoringGate` passes it through
 * as `item: args.body`, and `buildRuntimeWriteSnapshots` puts that same object
 * into `candidate.permissions`. The end-to-end half of this is pinned at the
 * door itself (`@objectstack/metadata-protocol`'s
 * `protocol.runtime-authoring-gate.test.ts`, the #17936 block); what is pinned
 * HERE is the dispatch and the differential, at the layer that owns them.
 *
 * `input: 'normalized'` stays load-bearing for the same reason it always was —
 * the snapshot the gate builds is an unparsed body, which is precisely the tier
 * this rule reads.
 *
 * ## The fences
 *
 * Advisory, never a refusal: ruling D set the severity and the crossing does not
 * touch it. `permission` is the only type that crosses — the rule reads
 * `stack.permissions` and nothing else, so declaring another type would wire it
 * onto a collection it never inspects.
 */
import { describe, expect, it } from 'vitest';
import {
  AUTHORING_COMMANDS,
  AUTHORING_RULES,
  authoringRulesFor,
  runAuthoringRules,
} from './authoring-rules.js';
import {
  runRuntimeAuthoringRules,
  runtimeAuthoringRulesFor,
  runtimeGatedTypes,
  stackKeyForType,
} from './runtime-gate.js';
import {
  PERMISSION_RETIRED_LIFECYCLE_RESIDUE,
  validateRetiredPermissionResidue,
} from './validate-retired-permission-residue.js';

const RULE_NAME = 'validateRetiredPermissionResidue';

const entry = () => {
  const found = AUTHORING_RULES.find((r) => r.name === RULE_NAME);
  expect(found, `${RULE_NAME} left AUTHORING_RULES — re-point this pin or retire it`).toBeDefined();
  return found!;
};

/** A permission set carrying the ONE value the tombstone's residue stage swallows. */
const residueSet = () => ({
  name: 'sales_team',
  label: 'Sales Team',
  objects: {
    // `readScope` authored on purpose: without it `validateSecurityPosture`
    // adds a `security-private-no-readscope` info advisory to every one of
    // these writes, and the DARK readings below would be "one advisory instead
    // of two" rather than a true zero.
    crm_ticket: { allowRead: true, allowEdit: true, readScope: 'own', allowRestore: false },
  },
});

/** The same set with the retired key removed — the author's fixed document. */
const cleanSet = () => ({
  name: 'sales_team',
  label: 'Sales Team',
  objects: {
    crm_ticket: { allowRead: true, allowEdit: true, readScope: 'own' },
  },
});

describe('#17936 — the residue rule dispatches on `permission` writes', () => {
  it('the registry entry declares the runtime surface for `permission`, at advisory tier', () => {
    const rule = entry();
    expect(rule.tier, 'ruling D set advisory — a refusal here was never on the table').toBe('advisory');
    expect(rule.surfaces).toEqual(['cli', 'runtime-publish']);
    expect(rule.runtimeTypes).toEqual(['permission']);
    // A crossed rule states its types; a stale "why not" would contradict the
    // crossing it now sits beside.
    expect(
      rule.surfaceReason,
      'the surfaceReason answering "why NOT the runtime gate" must not outlive the crossing',
    ).toBeUndefined();
  });

  it('the gate really dispatches it — declared, mapped, and reachable', () => {
    expect(runtimeAuthoringRulesFor('permission').map((r) => r.name)).toContain(RULE_NAME);
    expect(runtimeGatedTypes()).toContain('permission');
    // Without the stack-key mapping the gate finds the rule, builds no snapshot
    // and returns clean — wired, enforcing nothing.
    expect(stackKeyForType('permission')).toBe('permissions');
  });

  it('DARK — no other metadata type reaches it', () => {
    // The rule reads `stack.permissions` and nothing else. Declaring a second
    // type would run it against a collection the snapshot never carries for
    // that write, which is the "wired onto nothing" shape one surface over.
    for (const type of runtimeGatedTypes().filter((t) => t !== 'permission')) {
      expect(
        runtimeAuthoringRulesFor(type).map((r) => r.name),
        `'${type}' writes must not reach ${RULE_NAME}`,
      ).not.toContain(RULE_NAME);
    }
  });
});

describe('#17936 — the door verdict on a permission write', () => {
  it('⭐ LIT — a write carrying `allowRestore: false` ADVISES and does not refuse', () => {
    const result = runRuntimeAuthoringRules({ type: 'permission', item: residueSet() });

    expect(
      result.errors,
      'ruling D set advisory — a residue key must never block a publish',
    ).toEqual([]);
    expect(result.rulesRun).toContain(RULE_NAME);

    expect(
      result.advisories.map((f) => f.rule),
      `advisories: ${JSON.stringify(result.advisories)}`,
    ).toEqual([PERMISSION_RETIRED_LIFECYCLE_RESIDUE]);
    const advisory = result.advisories.find((f) => f.rule === PERMISSION_RETIRED_LIFECYCLE_RESIDUE);
    expect(advisory!.severity).toBe('warning');
    // [#10064] The wire shape keys the collection entry by NAME, not by the
    // gate's private snapshot index — which here would read `permissions[0]`
    // only because the context is empty.
    expect(advisory!.path).toBe('permissions.sales_team.objects.crm_ticket.allowRestore');
    expect(advisory!.where).toContain('sales_team');
    expect(advisory!.where).toContain('crm_ticket');
    expect(advisory!.message).toContain('allowRestore');
    // The prescription is READ from the tombstone's own description, never
    // retyped here — an empty hint means the resolution broke.
    expect(advisory!.hint.length).toBeGreaterThan(10);
  });

  it('⭐ LIT — `allowPurge` is the second arm, and both together advise twice', () => {
    const both = {
      name: 'sales_team',
      objects: {
        crm_ticket: { allowRead: true, readScope: 'own', allowRestore: false, allowPurge: false },
      },
    };
    const result = runRuntimeAuthoringRules({ type: 'permission', item: both });
    const paths = result.advisories
      .filter((f) => f.rule === PERMISSION_RETIRED_LIFECYCLE_RESIDUE)
      .map((f) => f.path)
      .sort();
    expect(paths).toEqual([
      'permissions.sales_team.objects.crm_ticket.allowPurge',
      'permissions.sales_team.objects.crm_ticket.allowRestore',
    ]);
    expect(result.errors).toEqual([]);
  });

  it('⭐ DARK — a clean write produces no residue advisory at all', () => {
    const result = runRuntimeAuthoringRules({ type: 'permission', item: cleanSet() });
    expect(result.rulesRun, 'the rule must have RUN — a silent rule is not a clean verdict')
      .toContain(RULE_NAME);
    expect(
      result.advisories,
      `clean write advised anyway: ${JSON.stringify(result.advisories)}`,
    ).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('DARK — a value that is NOT the residue literal is left to the tombstone', () => {
    // `true` is a hard ADR-0049 violation and the parse refuses it with the
    // prescription already attached; a second voice here would say the same
    // thing one layer earlier and in different words.
    const result = runRuntimeAuthoringRules({
      type: 'permission',
      item: {
        name: 'sales_team',
        objects: { crm_ticket: { allowRead: true, readScope: 'own', allowRestore: true } },
      },
    });
    expect(result.advisories.filter((f) => f.rule === PERMISSION_RETIRED_LIFECYCLE_RESIDUE)).toEqual([]);
  });

  it("DARK — a STORED set's residue is not charged to this write (the differential)", () => {
    // #4463 D4: the gate judges what this write ADDS, never the tenant's
    // pre-existing rows. A stored set carrying its own residue appears in both
    // passes and cancels.
    const stored = {
      name: 'support_team',
      objects: { crm_case: { allowRead: true, readScope: 'own', allowPurge: false } },
    };
    const result = runRuntimeAuthoringRules({
      type: 'permission',
      item: cleanSet(),
      context: { permissions: [stored] },
    });
    expect(
      result.advisories.filter((f) => f.rule === PERMISSION_RETIRED_LIFECYCLE_RESIDUE),
      'somebody else\'s stored residue is not this write\'s to answer for',
    ).toEqual([]);

    // Non-vacuous: the same stored row present, the WRITTEN body dirty, and the
    // write's own residue is still reported.
    const dirty = runRuntimeAuthoringRules({
      type: 'permission',
      item: residueSet(),
      context: { permissions: [stored] },
    });
    expect(
      dirty.advisories
        .filter((f) => f.rule === PERMISSION_RETIRED_LIFECYCLE_RESIDUE)
        .map((f) => f.path),
    ).toEqual(['permissions.sales_team.objects.crm_ticket.allowRestore']);
  });
});

describe('#17936 — ⭐ DARK: the CLI door is unchanged by the crossing', () => {
  it('all three commands still run it, and the finding is the rule\'s own, unrewritten', () => {
    for (const command of AUTHORING_COMMANDS) {
      expect(
        authoringRulesFor(command).map((r) => r.name),
        `${command} lost ${RULE_NAME}`,
      ).toContain(RULE_NAME);
    }

    const stack = { permissions: [residueSet()] };
    const direct = validateRetiredPermissionResidue(stack);
    expect(direct.map((f) => f.path)).toEqual([
      'permissions[0].objects.crm_ticket.allowRestore',
    ]);

    for (const command of AUTHORING_COMMANDS) {
      const viaCommand = runAuthoringRules(command, { normalized: stack })
        .filter((f) => f.rule === PERMISSION_RETIRED_LIFECYCLE_RESIDUE);
      // POSITIONAL on the CLI surface — the name-keying above is the runtime
      // gate's WIRE rewrite and must not have leaked onto the commands.
      expect(viaCommand.map((f) => f.path), `${command} path`).toEqual([
        'permissions[0].objects.crm_ticket.allowRestore',
      ]);
      expect(viaCommand.map((f) => f.severity), `${command} severity`).toEqual(['warning']);
      expect(viaCommand[0]!.message, `${command} message`).toBe(direct[0]!.message);
      expect(viaCommand[0]!.hint, `${command} hint`).toBe(direct[0]!.hint);
    }
  });

  it('a clean stack reads 0 on every command', () => {
    for (const command of AUTHORING_COMMANDS) {
      expect(
        runAuthoringRules(command, { normalized: { permissions: [cleanSet()] } })
          .filter((f) => f.rule === PERMISSION_RETIRED_LIFECYCLE_RESIDUE),
        `${command} advised on a clean stack`,
      ).toEqual([]);
    }
  });
});
