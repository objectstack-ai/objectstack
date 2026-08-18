// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { readdirSync, readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import stack from '../objectstack.config.js';
import { PLATFORM_CAPABILITY_NAMES } from '@objectstack/spec/security';
import { FILE_REFERENCE_TYPES, valueSchemaFor } from '@objectstack/spec/data';
import { healthFor, sweepProjectHealth, bindShowcaseJobRuntime } from '../src/automation/jobs/index.js';
import { POSITION_PERMISSION_SET_BINDINGS } from '../src/security/bind-position-sets.js';
import {
  ADMIN_EMAIL,
  PHONE_DEMO_USER,
  AUDITOR_DEMO_USER,
  PROVISIONED_USER_EMAILS,
} from '../src/security/demo-personas.js';

/**
 * #4774 / #4888 / #4891 — the showcase's DECLARED-BUT-INERT wirings.
 *
 * Each guard below pins one declaration the runtime was accepting at authoring
 * time and then quietly not honouring, announced only by a line in the boot
 * warning block. They are the same bug class as `no-startup-warnings.test.ts`
 * (#3420) — the reference app must not train anyone to skim warnings — but here
 * the warning was the *symptom*: a nightly job that never ran, a permission set
 * granting a capability that never materialized, a retry key scheduled for
 * removal, and seed values the platform's own migration gate rejects.
 */

/** Package root — vitest runs with the example as cwd (same as coverage.test.ts). */
const SRC_ROOT = `${process.cwd()}/src`;

/** Every authored `.ts` under `src/` — the surface a source-text guard scans. */
function sourceFiles(dir: string = SRC_ROOT): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/**
 * Source text with comments removed, so a source-scan guard judges CODE.
 * Documentation must stay free to name a retired key (this file's own comments
 * do, and so do the ones explaining the rename) without tripping the guard that
 * bans authoring it. Block comments go first; then whole-line `//` comments —
 * never a trailing `//`, which would eat the `//` in a URL inside a string.
 */
function codeOf(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line: string) => !line.trimStart().startsWith('//'))
    .join('\n');
}

/** Every `functions` entry, whichever spelling it was authored in. */
function functionNames(): string[] {
  const fns = (stack as { functions?: unknown }).functions;
  if (Array.isArray(fns)) {
    return fns.map((f: { name?: string }) => f?.name).filter((n): n is string => typeof n === 'string');
  }
  if (fns && typeof fns === 'object') return Object.keys(fns as Record<string, unknown>);
  return [];
}

function functionEntry(name: string): unknown {
  const fns = (stack as { functions?: Record<string, unknown> }).functions;
  return fns && !Array.isArray(fns) ? fns[name] : undefined;
}

// ───────────────────────────────────────────────────────────────────────────
// 1. Scheduled job — the handler has to EXIST
// ───────────────────────────────────────────────────────────────────────────
describe('declarative jobs resolve their handler (#4774 ①)', () => {
  const jobs = ((stack as { jobs?: unknown[] }).jobs ?? []) as Array<{
    name: string;
    handler: string;
    enabled?: boolean;
  }>;

  it('declares at least one job (the coverage claim)', () => {
    expect(jobs.length).toBeGreaterThan(0);
  });

  for (const job of jobs) {
    it(`${job.name}: handler '${job.handler}' is a key of defineStack({ functions })`, () => {
      // This is the exact lookup `AppPlugin` performs on `kernel:ready`
      // (`collectBundleFunctions(bundle)[job.handler]`). A miss there is the
      // "job handler not found in bundle.functions — skipping" WARN, and the
      // job is registered but NEVER RUNS.
      expect(
        functionNames(),
        `job '${job.name}' names handler '${job.handler}', which no functions entry provides`,
      ).toContain(job.handler);
    });

    it(`${job.name}: handler '${job.handler}' is callable`, () => {
      const entry = functionEntry(job.handler) as { handler?: unknown } | ((...a: never[]) => unknown);
      const callable = typeof entry === 'function' ? entry : entry?.handler;
      expect(typeof callable).toBe('function');
    });
  }

  it('the sweep DECLARES that it writes — an undeclared writer reads as a broken sweep', () => {
    // The inverse of the guard that stood here until #4976. That one pinned
    // every entry to the BARE form, because the declared spelling could not
    // survive `objectstack build`: the CLI lowers it to
    // `{ handler: 'sweepProjectHealth', effect: 'writes' }` and
    // `FlowFunctionEntrySchema` had no member for a declaration whose handler
    // is a ref, so the reference app was pinned to the dishonest spelling to
    // keep `pnpm build` green.
    //
    // #4976 added that member, so the pin inverts rather than disappears — the
    // thing worth guarding was never "bare", it was that the one entry which
    // genuinely writes says so. `sweepProjectHealth` is a nightly job with no
    // downstream declarative node to count its writes, so undeclared it reports
    // `selected: N, acted: 0` — indistinguishable from the broken sweep #4354
    // exists to detect, permanently, in `sys_automation_run`.
    expect(functionEntry('sweepProjectHealth')).toMatchObject({ effect: 'writes' });
  });
});

describe('sweepProjectHealth computes health from burn vs progress (#4774 ①)', () => {
  it('is green when spending tracks delivery', () => {
    expect(healthFor({ budget: 150_000, spent: 60_000, taskProgress: [100, 80, 45, 0, 0] })).toBe('green');
  });

  it('is yellow when spending drifts ahead of delivery', () => {
    // burn 0.60, done 0.40 → drift 0.20
    expect(healthFor({ budget: 100_000, spent: 60_000, taskProgress: [40] })).toBe('yellow');
  });

  it('is red when spending runs far ahead of delivery', () => {
    // burn 0.978, no delivered progress → drift 0.978
    expect(healthFor({ budget: 90_000, spent: 88_000, taskProgress: [0, 0] })).toBe('red');
  });

  it('is red when over budget regardless of progress', () => {
    expect(healthFor({ budget: 10_000, spent: 12_000, taskProgress: [100] })).toBe('red');
  });

  it('treats a missing budget as no burn rather than a divide-by-zero', () => {
    expect(healthFor({ budget: undefined, spent: 5_000, taskProgress: [] })).toBe('green');
  });

  it('reads numeric columns that arrive as strings', () => {
    expect(healthFor({ budget: '100000', spent: '90000', taskProgress: [10] })).toBe('red');
  });

  it('sweeps only in-play projects and writes only what changed', async () => {
    const projects = [
      { id: 'p_active', status: 'active', health: 'green', budget: 90_000, spent: 88_000 },
      { id: 'p_hold', status: 'on_hold', health: 'red', budget: 100_000, spent: 10_000 },
    ];
    const tasks = [
      { project: 'p_active', progress: 0 },
      { project: 'p_active', progress: 0 },
      { project: 'p_hold', progress: 90 },
    ];
    const reads: Array<{ object: string; query: any }> = [];
    const writes: Array<Record<string, unknown>> = [];

    bindShowcaseJobRuntime({
      ql: {
        find: async (object: string, query: any) => {
          reads.push({ object, query });
          if (object === 'showcase_project') return projects;
          if (object === 'showcase_task') return tasks;
          return [];
        },
        update: async (_object: string, data: Record<string, unknown>) => {
          writes.push(data);
          return data;
        },
      },
    });

    await sweepProjectHealth({ jobId: 'showcase_health_sweep' });

    // Only `active` / `on_hold` are read — settled projects are not relitigated.
    expect(reads[0]?.object).toBe('showcase_project');
    expect(reads[0]?.query?.where?.status?.$in).toEqual(['active', 'on_hold']);
    // p_active: burn 0.978 vs done 0 → red (changed from green).
    // p_hold:   burn 0.10  vs done 0.90 → green (changed from red).
    expect(writes).toEqual([
      { id: 'p_active', health: 'red' },
      { id: 'p_hold', health: 'green' },
    ]);
  });

  it('is a no-op when nothing changed', async () => {
    const writes: unknown[] = [];
    bindShowcaseJobRuntime({
      ql: {
        find: async (object: string) =>
          object === 'showcase_project'
            ? [{ id: 'p1', status: 'active', health: 'green', budget: 100, spent: 10 }]
            : [{ project: 'p1', progress: 100 }],
        update: async (_o: string, d: Record<string, unknown>) => {
          writes.push(d);
          return d;
        },
      },
    });
    await sweepProjectHealth({ jobId: 'showcase_health_sweep' });
    expect(writes).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. Capabilities — declared, granted, and MATERIALIZABLE
// ───────────────────────────────────────────────────────────────────────────
describe('declared capabilities carry an owning package (#4774 ②)', () => {
  const capabilities = ((stack as { capabilities?: unknown[] }).capabilities ?? []) as Array<{
    name: string;
    packageId?: string;
  }>;

  it('declares at least one package capability', () => {
    expect(capabilities.length).toBeGreaterThan(0);
  });

  for (const cap of capabilities) {
    it(`${cap.name}: resolves an owning package`, () => {
      // `bootstrapDeclaredCapabilities` reads `cap._packageId ?? cap.packageId`
      // and REFUSES to materialize a capability with neither (a
      // `managed_by:'package'` row with no `package_id` makes uninstall
      // undefined — ADR-0086 D3). The registry stamp never reaches an
      // app-declared capability today, so the author-declared fallback is what
      // has to be present.
      const owner = (cap as { _packageId?: string })._packageId ?? cap.packageId;
      expect(
        owner,
        `capability '${cap.name}' has no owning package — it would not be materialized into sys_capability`,
      ).toBeTruthy();
    });

    it(`${cap.name}: is owned by this app`, () => {
      const owner = (cap as { _packageId?: string })._packageId ?? cap.packageId;
      expect(owner).toBe((stack as { manifest?: { id?: string } }).manifest?.id);
    });
  }

  it('every granted system permission is a capability that will exist', () => {
    const declared = new Set(capabilities.map((c) => c.name));
    const dangling: string[] = [];
    for (const set of ((stack as { permissions?: unknown[] }).permissions ?? []) as Array<{
      name: string;
      systemPermissions?: string[];
    }>) {
      for (const perm of set.systemPermissions ?? []) {
        if (PLATFORM_CAPABILITY_NAMES.has(perm)) continue;
        if (declared.has(perm)) continue;
        dangling.push(`${set.name} → ${perm}`);
      }
    }
    // A permission set that grants a capability nothing declares reads as
    // enforcement and grants nothing — a security declaration that is inert.
    expect(dangling, `permission set(s) grant undeclared capabilities: ${dangling.join(', ')}`).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. Retry policy — canonical spelling only
// ───────────────────────────────────────────────────────────────────────────
describe('retry policies use the canonical key (#4774 ③)', () => {
  /** Every `retry` / `retryPolicy` block reachable from the stack, with a path. */
  function retryBlocks(): Array<{ path: string; block: Record<string, unknown> }> {
    const out: Array<{ path: string; block: Record<string, unknown> }> = [];
    const walk = (value: unknown, path: string): void => {
      if (Array.isArray(value)) {
        value.forEach((v, i) => walk(v, `${path}[${i}]`));
        return;
      }
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        const childPath = `${path}.${key}`;
        if ((key === 'retry' || key === 'retryPolicy') && child && typeof child === 'object' && !Array.isArray(child)) {
          out.push({ path: childPath, block: child as Record<string, unknown> });
        }
        walk(child, childPath);
      }
    };
    walk((stack as { flows?: unknown }).flows, 'flows');
    walk((stack as { jobs?: unknown }).jobs, 'jobs');
    walk((stack as { hooks?: unknown }).hooks, 'hooks');
    return out;
  }

  it('the stack actually declares retry policies (guard is not vacuous)', () => {
    expect(retryBlocks().length).toBeGreaterThan(0);
  });

  it("no SOURCE file still spells the base delay 'retryDelayMs'", () => {
    // Deliberately reads the source text, not `stack` — the parsed stack CANNOT
    // answer this question. `retryDelayMs` is tombstoned in `RetryPolicySchema`
    // (17.0.0, #4661) and only keeps working because the
    // `retry-policy-converged` conversion rewrites it during `defineStack`, so
    // by the time a test can inspect the object the retired spelling is already
    // gone and every assertion over it passes vacuously. The thing that has to
    // change — and that stops loading when the conversion retires in protocol
    // 18 — is what the author wrote.
    const offenders = sourceFiles()
      .filter((file) => /\bretryDelayMs\s*:/.test(codeOf(file)))
      .map((file) => file.slice(SRC_ROOT.length + 1));
    expect(
      offenders,
      `retired 'retryDelayMs' (rename to 'backoffMs') in: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it("every block states its base delay as 'backoffMs'", () => {
    for (const { path, block } of retryBlocks()) {
      expect(typeof block.backoffMs, `${path} has no backoffMs`).toBe('number');
    }
  });

  it("keeps 'maxRetryDelayMs', which the convergence did NOT rename", () => {
    // Guards the other direction: `maxRetryDelayMs` is a canonical key of
    // `RetryPolicySchema` (the ceiling for one backoff delay), not a casualty
    // of `retry-policy-converged`. Dropping it "for symmetry" would be a
    // behaviour change, so the showcase keeps demonstrating it.
    const withCeiling = retryBlocks().filter(({ block }) => 'maxRetryDelayMs' in block);
    expect(withCeiling.length).toBeGreaterThan(0);
    for (const { path, block } of withCeiling) {
      expect(typeof block.maxRetryDelayMs, `${path}.maxRetryDelayMs`).toBe('number');
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 4. Seed values — ADR-0104 value shapes
// ───────────────────────────────────────────────────────────────────────────
describe('seed values satisfy the ADR-0104 stored contract (#4774 ④ / #4891)', () => {
  const objects = ((stack as { objects?: unknown[] }).objects ?? []) as Array<{
    name: string;
    fields?: Record<string, { type?: string }>;
  }>;
  const seeds = ((stack as { data?: unknown[] }).data ?? []) as Array<{
    object: string;
    externalId?: string;
    records?: Array<Record<string, unknown>>;
  }>;

  it('seeds at least one dataset (guard is not vacuous)', () => {
    expect(seeds.length).toBeGreaterThan(0);
  });

  it('no seeded file-class value is off-shape', () => {
    // The engine tallies every off-shape value it admits, and
    // `attestFreshDatastore` (#4769) refuses to certify a migration the SAME
    // BOOT has already contradicted. One bad `cover` therefore costs a brand
    // new datastore the `adr-0104-file-references` attestation permanently —
    // the gate stays open on day one of a fresh install of the reference app.
    const offenders: string[] = [];
    for (const seed of seeds) {
      const object = objects.find((o) => o.name === seed.object);
      if (!object?.fields) continue;
      const fileFields = Object.entries(object.fields)
        .filter(([, def]) => def?.type && FILE_REFERENCE_TYPES.has(def.type))
        .map(([name, def]) => [name, def] as const);
      if (fileFields.length === 0) continue;
      for (const record of seed.records ?? []) {
        for (const [fieldName, def] of fileFields) {
          const value = record[fieldName];
          if (value === undefined || value === null) continue;
          const parsed = valueSchemaFor(def as { type: string }, 'stored').safeParse(value);
          if (!parsed.success) {
            const key = String(record[seed.externalId ?? 'name'] ?? '?');
            offenders.push(`${seed.object}.${fieldName} ('${key}')`);
          }
        }
      }
    }
    expect(
      offenders,
      `seeded file-class value(s) are not an opaque sys_file id: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('no seed smuggles an inline data: / http(s): image', () => {
    // The narrower, more legible half of the rule above: whatever the field
    // type, a seed must never carry image BYTES or an external link where the
    // platform expects a managed file (ADR-0104 R7).
    const offenders: string[] = [];
    for (const seed of seeds) {
      for (const record of seed.records ?? []) {
        for (const [field, value] of Object.entries(record)) {
          if (typeof value !== 'string') continue;
          if (/^data:image\//i.test(value) || /^https?:\/\/[^ ]*(picsum|placehold)/i.test(value)) {
            offenders.push(`${seed.object}.${field}`);
          }
        }
      }
    }
    expect(offenders, `inline/remote image value(s) in seed data: ${offenders.join(', ')}`).toEqual([]);
  });

  it('still DECLARES the image field and its gallery binding', () => {
    // Dropping the bad data must not quietly drop the coverage: `cover` is
    // still an image field and the task gallery still binds to it, so the
    // capability is demonstrated — it is populated by uploading a cover, which
    // is how a managed file is meant to come into existence.
    const task = objects.find((o) => o.name === 'showcase_task');
    expect(task?.fields?.cover?.type).toBe('image');
    const bound = JSON.stringify((stack as { views?: unknown }).views ?? []).includes('"coverField":"cover"');
    expect(bound, 'no task view binds gallery.coverField to `cover`').toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 5. Seed values — a notify recipient must name a PROVISIONED identity (#7746)
// ───────────────────────────────────────────────────────────────────────────
/**
 * The same bug class as §4, one layer further out: a seed value that is
 * shape-valid, silently accepted, and wrong only where something downstream
 * consumes it.
 *
 * `RecipientResolver` (ADR-0030 P1) resolves an email-shaped recipient against
 * `sys_user` and, on a MISS, keeps the string VERBATIM as the recipient id. So
 * seeding `assignee: 'ada@example.com'` — an address that is no `sys_user` —
 * does not fail: the stock reassignment demo persists a `sys_inbox_message`
 * whose `user_id` is that literal text, a row no authenticated user can read.
 * Nothing in the boot warning block says so; the QA run that found it (#7690)
 * only noticed because it had to sign up its own personas to test notify.
 *
 * The recipient FIELDS are derived from the flows rather than listed here, so a
 * new notify node pulls its object/field into this guard automatically.
 */
describe('seeded notify recipients resolve to a real user (#7746)', () => {
  const objects = ((stack as { objects?: unknown[] }).objects ?? []) as Array<{ name: string }>;
  const seeds = ((stack as { data?: unknown[] }).data ?? []) as Array<{
    object: string;
    externalId?: string | string[];
    records?: Array<Record<string, unknown>>;
  }>;
  const flows = ((stack as { flows?: unknown[] }).flows ?? []) as Array<Record<string, unknown>>;

  /**
   * `showcase_invoice.owner` is the ONE recipient field left addressed to
   * non-users, knowingly. It is the fixture for the ADR-0055
   * controlled-by-parent isolation demo, where an operator SIGNS UP as
   * `ada@example.com` to observe the row scoping (and
   * `showcase-invoice-seed-isolation.dogfood.test.ts` pins those owners). The
   * personas this guard allows hold no credential, so repointing invoices at
   * them would delete that demo rather than fix it — see `demo-personas.ts`.
   * Reported on #7746 as the remaining instance, not silently swept in.
   */
  const KNOWN_EXEMPT = new Set(['showcase_invoice.owner']);

  /** `<object>` → the fields its flows hand to a `notify` node as recipients. */
  function recipientFieldsByObject(): Map<string, Set<string>> {
    const byObject = new Map<string, Set<string>>();
    for (const flow of flows) {
      const nodes = (flow.nodes ?? []) as Array<{ type?: string; config?: Record<string, unknown> }>;
      const object = nodes.find((n) => n?.type === 'start')?.config?.objectName;
      if (typeof object !== 'string') continue;
      // Stringify the WHOLE flow: notify nodes also live nested inside branch
      // bodies (`showcase_project_escalation`), which a top-level scan misses.
      const json = JSON.stringify(flow);
      for (const [, group] of json.matchAll(/"recipients":\s*(\[[^\]]*\]|"[^"]*")/g)) {
        for (const [, field] of group.matchAll(/\{record\.(\w+)\}/g)) {
          if (!byObject.has(object)) byObject.set(object, new Set());
          byObject.get(object)!.add(field);
        }
      }
    }
    return byObject;
  }

  it('derives recipient fields from the flows (guard is not vacuous)', () => {
    const byObject = recipientFieldsByObject();
    // The stock reassignment demo is the whole reason this guard exists — if it
    // stops being discovered, the guard has gone blind rather than clean.
    expect([...(byObject.get('showcase_task') ?? [])]).toContain('assignee');
    expect([...(byObject.get('showcase_project') ?? [])]).toContain('owner');
  });

  it('every recipient field is a real field on its object', () => {
    // A recipient naming a field that does not exist renders empty and notifies
    // nobody — the inert-wiring shape this file exists to catch.
    const offenders: string[] = [];
    for (const [object, fields] of recipientFieldsByObject()) {
      const declared = objects.find((o) => o.name === object) as
        | { fields?: Record<string, unknown> }
        | undefined;
      if (!declared?.fields) continue;
      for (const field of fields) {
        if (!(field in declared.fields)) offenders.push(`${object}.${field}`);
      }
    }
    expect(offenders, `notify recipient names an undeclared field: ${offenders.join(', ')}`).toEqual([]);
  });

  it('no seeded recipient value is an email the app never provisions', () => {
    const byObject = recipientFieldsByObject();
    const allowed = new Set<string>(PROVISIONED_USER_EMAILS);
    const offenders: string[] = [];
    for (const seed of seeds) {
      const fields = byObject.get(seed.object);
      if (!fields) continue;
      for (const record of seed.records ?? []) {
        for (const field of fields) {
          const value = record[field];
          // Only email-SHAPED values are judged. A bare id or an unset field is
          // outside this rule: the resolver only does the lookup that can miss
          // when the value looks like an address.
          if (typeof value !== 'string' || !value.includes('@')) continue;
          if (allowed.has(value)) continue;
          if (KNOWN_EXEMPT.has(`${seed.object}.${field}`)) continue;
          const idKey = Array.isArray(seed.externalId) ? seed.externalId[0] : seed.externalId;
          offenders.push(`${seed.object}.${field}='${value}' ('${String(record[idKey ?? 'name'] ?? '?')}')`);
        }
      }
    }
    expect(
      offenders,
      `seeded notify recipient(s) are not a provisioned sys_user — the inbox row would be unreadable: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('every allowed email is one the app actually provisions', () => {
    // The allow-list is only as good as its agreement with the bootstrap that
    // creates the rows. Both read the same registry; this pins that they do.
    expect(PROVISIONED_USER_EMAILS).toContain(ADMIN_EMAIL);
    expect(PROVISIONED_USER_EMAILS).toContain(PHONE_DEMO_USER.email);
    expect(PROVISIONED_USER_EMAILS).toContain(AUDITOR_DEMO_USER.email);
    const provisioner = readFileSync(`${SRC_ROOT}/security/seed-approval-demo.ts`, 'utf8');
    expect(provisioner, 'the approval demo no longer provisions the persona rows').toContain(
      'ensureDemoUser',
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 6. Sharing rules — the grant must be one a gate would CONSULT (#9237)
// ───────────────────────────────────────────────────────────────────────────
/**
 * The same bug class as §1-§5, on the security surface: a declaration the
 * runtime accepts at authoring time and then refuses at boot, announced only
 * by a line in the boot warning block.
 *
 * Sharing only ever WIDENS an object's OWD baseline, so on an object whose OWD
 * is already the widest there is nothing to widen and a `sys_record_share` row
 * would never be consulted. `SharingService.inertGrantReason` states that as a
 * verdict and `assertNotInertGrant` REFUSES the write, so the rule's boot
 * backfill fails per rule:
 *
 *   WARN SharingServicePlugin: boot rule backfill failed for rule
 *     {"rule":"share_open_tasks_with_manager","error":"SHARING_NOT_ENABLED:
 *      'showcase_task' is not under record-sharing enforcement …"}
 *
 * Measured on the stock showcase before #9237: TWO such WARNs per boot, and a
 * THIRD rule in the same state that produced no diagnostic at all — its
 * compound condition matched zero seeded rows, so `reconcile` never reached
 * `grant` and never threw. The silent one is the reason this guard reads the
 * DECLARATION rather than the boot log: a rule can be just as dead without a
 * warning to notice.
 *
 * ⛔ The runtime's other inertness arm — "no `owner_id` field" — is
 * deliberately NOT reproduced here. `owner_id` is INJECTED by the schema
 * registry for ordinary business objects, so it is absent from the authored
 * metadata this guard reads and present on the schema the runtime judges;
 * asserting it here would fail every object that (correctly) does not declare
 * it by hand.
 */
describe('sharing rules target an object under record-sharing enforcement (#9237)', () => {
  interface AuthoredRule {
    name: string;
    object: string;
    sharedWith?: { type?: string; value?: string };
  }
  interface AuthoredSet {
    name: string;
    isDefault?: boolean;
    objects?: Record<string, { allowRead?: boolean; viewAllRecords?: boolean }>;
  }

  const rules = ((stack as { sharingRules?: unknown[] }).sharingRules ?? []) as AuthoredRule[];
  const objects = ((stack as { objects?: unknown[] }).objects ?? []) as Array<{
    name: string;
    sharingModel?: string;
  }>;
  const sets = ((stack as { permissions?: unknown[] }).permissions ?? []) as AuthoredSet[];

  /** The permission sets a holder of `position` effectively carries. */
  function setsHeldBy(position: string): AuthoredSet[] {
    const held = new Set(
      POSITION_PERMISSION_SET_BINDINGS.filter(([p]) => p === position).map(([, s]) => s),
    );
    // Every authenticated member also holds the `everyone` baseline (the
    // `isDefault` set, ADR-0090 D5) IN ADDITION to their explicit grants.
    return sets.filter((s) => held.has(s.name) || s.isDefault === true);
  }

  it('the stack declares sharing rules (guard is not vacuous)', () => {
    expect(rules.length).toBeGreaterThan(0);
  });

  it('no rule is anchored on an object whose OWD leaves nothing to widen', () => {
    // `effectiveSharingModel` maps BOTH of these to 'public'; the
    // `controlled_by_parent` case has its own refusal ("share the master
    // record instead"). Either way the grant is refused, so either way the
    // declaration is inert.
    const INERT_OWD = new Set(['public_read_write', 'controlled_by_parent']);
    const offenders: string[] = [];
    for (const rule of rules) {
      const target = objects.find((o) => o.name === rule.object);
      if (!target) {
        offenders.push(`${rule.name} → '${rule.object}' (no such object)`);
        continue;
      }
      if (INERT_OWD.has(String(target.sharingModel))) {
        offenders.push(`${rule.name} → ${rule.object} (sharingModel '${target.sharingModel}')`);
      }
    }
    expect(
      offenders,
      `sharing rule(s) on an object not under record-sharing enforcement — the boot backfill `
        + `refuses these with SHARING_NOT_ENABLED: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('every rule names an audience that can READ the object it shares', () => {
    // The second way a grant goes unconsulted: object-level CRUD is decided
    // BEFORE record-level visibility, so a share row minted for a principal
    // holding no `allowRead` on that object widens nothing. This arm is what
    // stops the retired project/task rules being "fixed" by re-homing them
    // onto a private object whose recipient cannot read it either.
    const offenders: string[] = [];
    for (const rule of rules) {
      const recipient = rule.sharedWith ?? {};
      // Non-`position` recipients expand to ordinary members, whose grant is
      // the `everyone` baseline — represented by the isDefault set.
      const candidates =
        recipient.type === 'position'
          ? setsHeldBy(String(recipient.value))
          : sets.filter((s) => s.isDefault === true);
      const canRead = candidates.some((s) => s.objects?.[rule.object]?.allowRead === true);
      if (!canRead) {
        offenders.push(`${rule.name} → ${recipient.type}:${recipient.value} on ${rule.object}`);
      }
    }
    expect(
      offenders,
      `sharing rule(s) whose audience holds no allowRead on the shared object — the share row `
        + `is never reached: ${offenders.join(', ')}`,
    ).toEqual([]);
  });
});
