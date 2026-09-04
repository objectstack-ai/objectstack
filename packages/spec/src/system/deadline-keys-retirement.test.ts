// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import type { ZodTypeAny } from 'zod';

import {
  IncidentNotificationMatrixSchema,
  IncidentNotificationRuleSchema,
  IncidentResponsePhaseSchema,
  IncidentResponsePolicySchema,
  IncidentSchema,
  type IncidentNotificationRule,
  type IncidentResponsePhase,
  type IncidentResponsePolicy,
} from './incident-response.zod';
import {
  TrainingCourseSchema,
  TrainingPlanSchema,
  type TrainingCourse,
  type TrainingPlan,
} from './training.zod';
import {
  ChangeImpactSchema,
  ChangeRequestSchema,
  RollbackPlanSchema,
  type ChangeImpact,
  type ChangeRequest,
  type RollbackPlan,
} from './change-management.zod';
import { MIGRATIONS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';

// ─── [#14477] the fourteen inert deadline keys are REMOVED ──────────────────
//
// ADR-0049 enforce-or-remove; maintainer ruling 2026-09-02, ruled A (retire
// per family). Fourteen hour/minute/day-shaped deadline, SLA and duration keys
// on the incident-response, training and change-management schemas sat on the
// published authorable surface and in the generated reference docs, and were
// read by NOTHING: the schemas are exported, mounted by no stack key,
// registered as no metadata type, absent from the 2026-06 liveness ledgers,
// and the reader census over every package outside `packages/spec` (tests and
// changelogs excluded) and over objectui at the pinned sha returned zero hits
// for every key. Six carried defaults that were materialized into every parsed
// document without ever being consulted.
//
// Route: `retiredKey()` tombstones, NOT plain deletion — none of the schemas
// is `.strict()`, so a bare deletion would make zod strip the key in silence,
// replacing an inert declaration with an invisible one (ADR-0104). Audible in
// two channels: `tsc` (the input type is `never`) and the parse (the
// prescription is the message). No D2 conversion: none of the schemas is a
// stack collection member, so the chain has no seam that ever runs (the
// `kernel/MetadataPluginConfig:additionalTypes` precedent) — the registration
// is fourteen `RETIRED_KEYS_BY_MAJOR[18]` entries plus three D3 semantic
// entries, one per family.
//
// On the assertion set (the #8586 / #14676 precedent): a schema refusal raises
// a `ZodError` whose issues carry `code` and `path` but no ADR-0112 `status` —
// that envelope belongs to the API error surface. So these pins assert the
// strongest set this surface really has: refusal, the issue `code`, the `path`
// naming WHICH site refused, and the prescription text (#5240: where the
// wording is the contract, pin the wording).

// ── Well-formed fixtures: every required key, none of the retired ones ──────

const PHASE: IncidentResponsePhase = {
  phase: 'containment',
  description: 'Isolate affected systems',
  assignedTo: 'security_team',
};
const RULE: IncidentNotificationRule = {
  severity: 'critical',
  channels: ['pagerduty'],
  recipients: ['security_team'],
};
const MATRIX = { rules: [RULE] };
const POLICY: IncidentResponsePolicy = {
  notificationMatrix: MATRIX,
  defaultResponseTeam: 'security_team',
};
const INCIDENT = {
  id: 'INC-2024-001',
  title: 'Unauthorized API Access Detected',
  description: 'Multiple failed authentication attempts from an unknown IP range',
  severity: 'high',
  category: 'unauthorized_access',
  status: 'investigating',
  reportedBy: 'monitoring_system',
  reportedAt: 1704067200000,
  affectedSystems: ['api-gateway'],
};
const COURSE: TrainingCourse = {
  id: 'COURSE-SEC-001',
  title: 'Information Security Fundamentals',
  description: 'Annual security awareness training for all employees',
  category: 'security_awareness',
  targetRoles: ['all_employees'],
};
const PLAN: TrainingPlan = { courses: [COURSE] };
const STEP = { order: 1, description: 'Restore database backup' };
const IMPACT: ChangeImpact = {
  level: 'high',
  affectedSystems: ['crm-api'],
  downtime: { required: true },
};
const ROLLBACK: RollbackPlan = { description: 'Restore from backup', steps: [STEP] };
const CHANGE: ChangeRequest = {
  id: 'CHG-2024-001',
  title: 'Upgrade CRM Database Schema',
  description: 'Migrate the customer database to schema version 2.0',
  type: 'normal',
  priority: 'high',
  status: 'approved',
  requestedBy: 'user_123',
  requestedAt: 1704067200000,
  impact: IMPACT,
  implementation: { description: 'Execute the migration scripts', steps: [STEP] },
  rollbackPlan: ROLLBACK,
};

/** One retired declaration site, as the schema, the registry and the prescription each spell it. */
interface RetiredSite {
  /** The exact `RETIRED_KEYS_BY_MAJOR` spelling. */
  registered: string;
  /** How the prescription opens (its backtick-wrapped qualified key). */
  qualified: string;
  schema: ZodTypeAny;
  /** Parses green as-is. */
  wellFormed: unknown;
  /** The same document with the retired key authored. */
  authored: unknown;
  /** Where the refusal must surface. */
  issuePath: (string | number)[];
}

const SITES: RetiredSite[] = [
  {
    registered: 'system/IncidentResponsePhase:targetHours',
    qualified: 'IncidentResponsePhase.targetHours',
    schema: IncidentResponsePhaseSchema,
    wellFormed: PHASE,
    authored: { ...PHASE, targetHours: 2 },
    issuePath: ['targetHours'],
  },
  {
    registered: 'system/IncidentNotificationRule:withinMinutes',
    qualified: 'IncidentNotificationRule.withinMinutes',
    schema: IncidentNotificationRuleSchema,
    wellFormed: RULE,
    authored: { ...RULE, withinMinutes: 15 },
    issuePath: ['withinMinutes'],
  },
  {
    registered: 'system/IncidentNotificationRule:regulatorDeadlineHours',
    qualified: 'IncidentNotificationRule.regulatorDeadlineHours',
    schema: IncidentNotificationRuleSchema,
    wellFormed: RULE,
    authored: { ...RULE, notifyRegulators: true, regulatorDeadlineHours: 72 },
    issuePath: ['regulatorDeadlineHours'],
  },
  {
    registered: 'system/IncidentNotificationMatrix:escalationTimeoutMinutes',
    qualified: 'IncidentNotificationMatrix.escalationTimeoutMinutes',
    schema: IncidentNotificationMatrixSchema,
    wellFormed: MATRIX,
    authored: { ...MATRIX, escalationTimeoutMinutes: 30 },
    issuePath: ['escalationTimeoutMinutes'],
  },
  {
    registered: 'system/IncidentResponsePolicy:triageDeadlineHours',
    qualified: 'IncidentResponsePolicy.triageDeadlineHours',
    schema: IncidentResponsePolicySchema,
    wellFormed: POLICY,
    authored: { ...POLICY, triageDeadlineHours: 1 },
    issuePath: ['triageDeadlineHours'],
  },
  {
    registered: 'system/IncidentResponsePolicy:retentionDays',
    qualified: 'IncidentResponsePolicy.retentionDays',
    schema: IncidentResponsePolicySchema,
    wellFormed: POLICY,
    authored: { ...POLICY, retentionDays: 2555 },
    issuePath: ['retentionDays'],
  },
  {
    registered: 'system/TrainingCourse:durationMinutes',
    qualified: 'TrainingCourse.durationMinutes',
    schema: TrainingCourseSchema,
    wellFormed: COURSE,
    authored: { ...COURSE, durationMinutes: 60 },
    issuePath: ['durationMinutes'],
  },
  {
    registered: 'system/TrainingCourse:validityDays',
    qualified: 'TrainingCourse.validityDays',
    schema: TrainingCourseSchema,
    wellFormed: COURSE,
    authored: { ...COURSE, validityDays: 365 },
    issuePath: ['validityDays'],
  },
  {
    registered: 'system/TrainingPlan:recertificationIntervalDays',
    qualified: 'TrainingPlan.recertificationIntervalDays',
    schema: TrainingPlanSchema,
    wellFormed: PLAN,
    authored: { ...PLAN, recertificationIntervalDays: 365 },
    issuePath: ['recertificationIntervalDays'],
  },
  {
    registered: 'system/TrainingPlan:gracePeriodDays',
    qualified: 'TrainingPlan.gracePeriodDays',
    schema: TrainingPlanSchema,
    wellFormed: PLAN,
    authored: { ...PLAN, gracePeriodDays: 30 },
    issuePath: ['gracePeriodDays'],
  },
  {
    registered: 'system/TrainingPlan:reminderDaysBefore',
    qualified: 'TrainingPlan.reminderDaysBefore',
    schema: TrainingPlanSchema,
    wellFormed: PLAN,
    authored: { ...PLAN, reminderDaysBefore: 14 },
    issuePath: ['reminderDaysBefore'],
  },
  {
    registered: 'system/ChangeImpact:downtime.durationMinutes',
    qualified: 'ChangeImpact.downtime.durationMinutes',
    schema: ChangeImpactSchema,
    wellFormed: IMPACT,
    authored: { ...IMPACT, downtime: { required: true, durationMinutes: 30 } },
    issuePath: ['downtime', 'durationMinutes'],
  },
  {
    registered: 'system/RollbackPlan:steps.estimatedMinutes',
    qualified: 'RollbackPlan.steps[].estimatedMinutes',
    schema: RollbackPlanSchema,
    wellFormed: ROLLBACK,
    authored: { ...ROLLBACK, steps: [{ ...STEP, estimatedMinutes: 15 }] },
    issuePath: ['steps', 0, 'estimatedMinutes'],
  },
  {
    registered: 'system/ChangeRequest:implementation.steps.estimatedMinutes',
    qualified: 'ChangeRequest.implementation.steps[].estimatedMinutes',
    schema: ChangeRequestSchema,
    wellFormed: CHANGE,
    authored: {
      ...CHANGE,
      implementation: { description: 'Execute the migration scripts', steps: [{ ...STEP, estimatedMinutes: 10 }] },
    },
    issuePath: ['implementation', 'steps', 0, 'estimatedMinutes'],
  },
];

/** The carriers that nest a retired site: the refusal must travel through them. */
const CARRIERS: Array<Pick<RetiredSite, 'qualified' | 'schema' | 'wellFormed' | 'authored' | 'issuePath'>> = [
  {
    qualified: 'IncidentResponsePhase.targetHours',
    schema: IncidentSchema,
    wellFormed: { ...INCIDENT, responsePhases: [PHASE] },
    authored: { ...INCIDENT, responsePhases: [{ ...PHASE, targetHours: 2 }] },
    issuePath: ['responsePhases', 0, 'targetHours'],
  },
  {
    qualified: 'IncidentNotificationRule.withinMinutes',
    schema: IncidentResponsePolicySchema,
    wellFormed: POLICY,
    authored: { ...POLICY, notificationMatrix: { rules: [{ ...RULE, withinMinutes: 15 }] } },
    issuePath: ['notificationMatrix', 'rules', 0, 'withinMinutes'],
  },
  {
    qualified: 'IncidentNotificationMatrix.escalationTimeoutMinutes',
    schema: IncidentResponsePolicySchema,
    wellFormed: POLICY,
    authored: { ...POLICY, notificationMatrix: { ...MATRIX, escalationTimeoutMinutes: 45 } },
    issuePath: ['notificationMatrix', 'escalationTimeoutMinutes'],
  },
  {
    qualified: 'TrainingCourse.validityDays',
    schema: TrainingPlanSchema,
    wellFormed: PLAN,
    authored: { courses: [{ ...COURSE, validityDays: 365 }] },
    issuePath: ['courses', 0, 'validityDays'],
  },
  {
    qualified: 'ChangeImpact.downtime.durationMinutes',
    schema: ChangeRequestSchema,
    wellFormed: CHANGE,
    authored: { ...CHANGE, impact: { ...IMPACT, downtime: { required: true, durationMinutes: 30 } } },
    issuePath: ['impact', 'downtime', 'durationMinutes'],
  },
  {
    qualified: 'RollbackPlan.steps[].estimatedMinutes',
    schema: ChangeRequestSchema,
    wellFormed: CHANGE,
    authored: { ...CHANGE, rollbackPlan: { ...ROLLBACK, steps: [{ ...STEP, estimatedMinutes: 15 }] } },
    issuePath: ['rollbackPlan', 'steps', 0, 'estimatedMinutes'],
  },
];

const SEMANTIC_IDS = [
  'incident-response-deadline-keys-retired',
  'training-deadline-keys-retired',
  'change-management-duration-keys-retired',
] as const;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function expectTombstoneRefusal(site: Pick<RetiredSite, 'qualified' | 'schema' | 'authored' | 'issuePath'>) {
  const result = site.schema.safeParse(site.authored);
  expect(result.success, `${site.qualified} must be refused`).toBe(false);
  if (result.success) return; // narrowing; the assertion above already failed

  const wanted = site.issuePath.join('.');
  const issue = result.error.issues.find((i) => i.path.join('.') === wanted);
  expect(issue, `the refusal must surface at ${wanted}`).toBeDefined();
  // The machine-readable half of the envelope this surface actually has: a
  // `retiredKey()` tombstone raises `invalid_type` from its `z.never()`.
  expect(issue!.code).toBe('invalid_type');
  expect(issue!.path).toEqual(site.issuePath);
  // The prescription IS the migration doc for whoever hits it — contract, not
  // commentary: it opens with the qualified key, names the version and the
  // ADR, says why the key was inert, and tells the author what to do.
  expect(issue!.message).toMatch(
    new RegExp('^`' + escapeRegExp(site.qualified) + '` was removed in @objectstack/spec 17 \\(ADR-0049 enforce-or-remove\\) — nothing ever read it'),
  );
  expect(issue!.message).toMatch(/Delete the key/);
  // Customer-facing text carries the ADR, never an issue id — a `#NNNN`
  // token resolves to nothing for the reader who meets this refusal.
  expect(issue!.message).not.toMatch(/#\d{3,}/);
  // Deliberately NO `os migrate meta` sentence: no conversion covers these
  // schemas (not stack collection members), so the sentence would promise an
  // edit list the tool cannot produce (`retired-key.ts`: the sentence must be
  // TRUE of the tool).
  expect(issue!.message).not.toMatch(/os migrate meta/);
}

describe('[#14477] inert deadline keys retirement — refusal at every site', () => {
  for (const site of SITES) {
    it(`REJECTS an authored \`${site.qualified}\` at path \`${site.issuePath.join('.')}\`, carrying the prescription`, () => {
      expectTombstoneRefusal(site);
      // Attribution control: the same document WITHOUT the key is accepted, so
      // the refusal above is attributable to the retired key and nothing else.
      expect(site.schema.safeParse(site.wellFormed).success, `${site.qualified}: well-formed control must parse`).toBe(true);
    });
  }

  for (const carrier of CARRIERS) {
    it(`REJECTS \`${carrier.qualified}\` through its carrier, at path \`${carrier.issuePath.join('.')}\``, () => {
      expectTombstoneRefusal(carrier);
      expect(carrier.schema.safeParse(carrier.wellFormed).success).toBe(true);
    });
  }

  it('the `retentionDays` prescription names the live retention mechanism, so nobody re-declares a number here as a repair', () => {
    const result = IncidentResponsePolicySchema.safeParse({ ...POLICY, retentionDays: 3650 });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.path[0] === 'retentionDays');
    expect(issue!.message).toMatch(/object-level `lifecycle` block \(ADR-0057\)/);
    expect(issue!.message).toMatch(/LifecycleService/);
  });

  it('every prescription with a former default names the default it used to materialize', () => {
    const expected: Array<[string, RegExp]> = [
      ['IncidentNotificationMatrix.escalationTimeoutMinutes', /default of 30 minutes/],
      ['IncidentResponsePolicy.triageDeadlineHours', /default of 1 hour/],
      ['IncidentResponsePolicy.retentionDays', /default of 2555 days/],
      ['TrainingPlan.recertificationIntervalDays', /default of 365 days/],
      ['TrainingPlan.gracePeriodDays', /default of 30 days/],
      ['TrainingPlan.reminderDaysBefore', /default of 14 days/],
    ];
    for (const [qualified, pattern] of expected) {
      const site = SITES.find((s) => s.qualified === qualified)!;
      const result = site.schema.safeParse(site.authored);
      expect(result.success).toBe(false);
      if (result.success) continue;
      const issue = result.error.issues.find((i) => i.path.join('.') === site.issuePath.join('.'))!;
      expect(issue.message, qualified).toMatch(pattern);
    }
  });
});

describe('[#14477] no-materialize: parsed documents carry none of the keys and none of the six former defaults', () => {
  it('incident-response', () => {
    const rule = IncidentNotificationRuleSchema.parse(RULE);
    expect(rule.notifyRegulators).toBe(false); // control: a live default still applies
    expect(rule).not.toHaveProperty('withinMinutes');
    expect(rule).not.toHaveProperty('regulatorDeadlineHours');

    const matrix = IncidentNotificationMatrixSchema.parse(MATRIX);
    expect(matrix.escalationChain).toEqual([]); // control
    // Used to materialize `30` into every parsed matrix.
    expect(matrix).not.toHaveProperty('escalationTimeoutMinutes');

    const policy = IncidentResponsePolicySchema.parse(POLICY);
    expect(policy.enabled).toBe(true); // control
    expect(policy.requirePostIncidentReview).toBe(true); // control
    // Used to materialize `1` and `2555`.
    expect(policy).not.toHaveProperty('triageDeadlineHours');
    expect(policy).not.toHaveProperty('retentionDays');

    const phase = IncidentResponsePhaseSchema.parse(PHASE);
    expect(phase.phase).toBe('containment');
    expect(phase).not.toHaveProperty('targetHours');
  });

  it('training', () => {
    const course = TrainingCourseSchema.parse(COURSE);
    expect(course.mandatory).toBe(false); // control
    expect(course).not.toHaveProperty('durationMinutes');
    expect(course).not.toHaveProperty('validityDays');

    const plan = TrainingPlanSchema.parse(PLAN);
    expect(plan.enabled).toBe(true); // control
    expect(plan.sendReminders).toBe(true); // control
    // Used to materialize `365`, `30` and `14`.
    expect(plan).not.toHaveProperty('recertificationIntervalDays');
    expect(plan).not.toHaveProperty('gracePeriodDays');
    expect(plan).not.toHaveProperty('reminderDaysBefore');
  });

  it('change-management', () => {
    const impact = ChangeImpactSchema.parse(IMPACT);
    expect(impact.downtime?.required).toBe(true); // control
    expect(impact.downtime).not.toHaveProperty('durationMinutes');

    const rollback = RollbackPlanSchema.parse(ROLLBACK);
    expect(rollback.steps[0]?.order).toBe(1); // control
    expect(rollback.steps[0]).not.toHaveProperty('estimatedMinutes');

    const change = ChangeRequestSchema.parse(CHANGE);
    expect(change.implementation.steps[0]?.description).toBe(STEP.description); // control
    expect(change.implementation.steps[0]).not.toHaveProperty('estimatedMinutes');
    expect(change.rollbackPlan.steps[0]).not.toHaveProperty('estimatedMinutes');
    expect(change.impact.downtime).not.toHaveProperty('durationMinutes');
  });
});

describe('[#14477] the tsc channel: the input type of every retired key is `never`', () => {
  it('fails tsc at every authoring site', () => {
    const phase: IncidentResponsePhase = {
      ...PHASE,
      // @ts-expect-error — `targetHours` is a retiredKey() tombstone: its input type is `never`.
      targetHours: 2,
    };
    const rule: IncidentNotificationRule = {
      ...RULE,
      // @ts-expect-error — `withinMinutes` is a retiredKey() tombstone.
      withinMinutes: 15,
      // @ts-expect-error — `regulatorDeadlineHours` is a retiredKey() tombstone.
      regulatorDeadlineHours: 72,
    };
    const policy: IncidentResponsePolicy = {
      ...POLICY,
      notificationMatrix: {
        ...MATRIX,
        // @ts-expect-error — `escalationTimeoutMinutes` is a retiredKey() tombstone.
        escalationTimeoutMinutes: 30,
      },
      // @ts-expect-error — `triageDeadlineHours` is a retiredKey() tombstone.
      triageDeadlineHours: 1,
      // @ts-expect-error — `retentionDays` is a retiredKey() tombstone.
      retentionDays: 2555,
    };
    const course: TrainingCourse = {
      ...COURSE,
      // @ts-expect-error — `durationMinutes` is a retiredKey() tombstone.
      durationMinutes: 60,
      // @ts-expect-error — `validityDays` is a retiredKey() tombstone.
      validityDays: 365,
    };
    const plan: TrainingPlan = {
      ...PLAN,
      // @ts-expect-error — `recertificationIntervalDays` is a retiredKey() tombstone.
      recertificationIntervalDays: 365,
      // @ts-expect-error — `gracePeriodDays` is a retiredKey() tombstone.
      gracePeriodDays: 30,
      // @ts-expect-error — `reminderDaysBefore` is a retiredKey() tombstone.
      reminderDaysBefore: 14,
    };
    const impact: ChangeImpact = {
      ...IMPACT,
      downtime: {
        required: true,
        // @ts-expect-error — the nested `downtime.durationMinutes` is a retiredKey() tombstone.
        durationMinutes: 30,
      },
    };
    const rollback: RollbackPlan = {
      ...ROLLBACK,
      steps: [{
        ...STEP,
        // @ts-expect-error — `steps[].estimatedMinutes` is a retiredKey() tombstone.
        estimatedMinutes: 15,
      }],
    };
    const change: ChangeRequest = {
      ...CHANGE,
      implementation: {
        description: 'Execute the migration scripts',
        steps: [{
          ...STEP,
          // @ts-expect-error — `implementation.steps[].estimatedMinutes` is a retiredKey() tombstone.
          estimatedMinutes: 10,
        }],
      },
    };
    // The parse channel agrees with the type channel on the same literals.
    for (const [schema, value] of [
      [IncidentResponsePhaseSchema, phase],
      [IncidentNotificationRuleSchema, rule],
      [IncidentResponsePolicySchema, policy],
      [TrainingCourseSchema, course],
      [TrainingPlanSchema, plan],
      [ChangeImpactSchema, impact],
      [RollbackPlanSchema, rollback],
      [ChangeRequestSchema, change],
    ] as Array<[ZodTypeAny, unknown]>) {
      expect(schema.safeParse(value).success).toBe(false);
    }
  });
});

describe('[#14477] ADR-0087 registration', () => {
  it('declares all fourteen sites under major 18, with the three D3 semantic entries wired and no D2 conversion', () => {
    for (const site of SITES) {
      expect(RETIRED_KEYS_BY_MAJOR[18], `${site.registered} must be declared`).toContain(site.registered);
    }
    const step = MIGRATIONS_BY_MAJOR[18];
    expect(step).toBeDefined();
    const ids = step!.semantic.map((s) => s.id);
    for (const id of SEMANTIC_IDS) {
      expect(ids, `${id} must be wired into the step-18 chain`).toContain(id);
      const entry = step!.semantic.find((s) => s.id === id)!;
      expect(entry.reason.length).toBeGreaterThan(0);
      expect(entry.acceptanceCriteria.length).toBeGreaterThan(0);
      // The route is stated where the next reader looks: why D3 semantic and
      // not D2 — no stack seam (the additionalTypes precedent).
      expect(entry.reason).toMatch(/not a D2 conversion/);
    }
    // Deliberately no mechanical conversion: a transform over a stack that
    // never carries these documents would be a seam that never runs.
    expect(step!.conversionIds.filter((id) => /incident|training|change-management|deadline/.test(id))).toEqual([]);
  });
});

// What this leg guarantees, and what it does not. The walk below reads the
// whole repo tree from REPO_ROOT, but the inputs it reaches outside
// `@objectstack/spec`'s declared cross-package globs in `turbo.json` are not
// hashed by turbo. So a resurrection authored in `examples/**`, `apps/**`,
// hand-written `content/docs/**` or most `packages/*/src/**` does not put this
// suite into `turbo ls --affected`, and the PR that authors it can replay a
// cached green. Read this leg as a FULL-RUN guarantee — the merge queue and a
// plain `pnpm test` — rather than an affected-path one.
//
// `check:cross-package-test-inputs` is green here as designed: every literal
// path this file names is declared, and the gate's declaration file states the
// trade for a walk that descends on a loop variable (the escape verdict
// resolves and the name does not). Widening spec's declared inputs to the
// walk's real radius would put this suite on every docs PR, so nothing is
// widened here; the playbook-vs-gate question is filed as #15528 and is not
// this PR's to answer.
//
// Independently of turbo, every *typed* TypeScript resurrection is caught at
// author time by the `never` channel pinned above, which needs no tree walk.
// The residue this leg covers is the untyped rest: JSON, YAML, MDX and
// unannotated literals.
describe('[#14477] tree-scoped absence: nothing in the repo authors a retired key any more', () => {
  const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
  const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

  /** Names unique to the three families — an authored occurrence anywhere is a resurrection. */
  const UNIQUE_KEYS = [
    'targetHours',
    'withinMinutes',
    'regulatorDeadlineHours',
    'escalationTimeoutMinutes',
    'triageDeadlineHours',
    'validityDays',
    'recertificationIntervalDays',
    'gracePeriodDays',
    'reminderDaysBefore',
  ];
  /**
   * Names other, LIVE schemas also declare (`AuditPolicy.retentionDays`,
   * `TenantBackup.retentionDays`, …): judged only in a file that also names one
   * of the three families, so a live key on an unrelated schema is never
   * misread as a resurrection. The bound is deliberate and stated: a document
   * authored for these families in a file that names none of them is
   * invisible to this leg — no such file exists, because none of the families
   * is a metadata type with a file-based authoring path.
   */
  const SHARED_KEYS = ['retentionDays', 'durationMinutes', 'estimatedMinutes'];
  const FAMILY = /\b(IncidentResponsePhase|IncidentNotificationRule|IncidentNotificationMatrix|IncidentResponsePolicy|IncidentSchema|TrainingCourse|TrainingPlan|ChangeImpact|RollbackPlan|ChangeRequest)\b/;
  /** An AUTHORING (`key:` / `"key":` / `key?:`), never a prose mention. */
  const authoring = (keys: readonly string[]) => new RegExp(`["']?\\b(${keys.join('|')})\\b["']?\\s*\\??\\s*:`);

  const SCANNED_EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.mts', '.cts', '.json', '.md', '.mdx', '.yaml', '.yml']);
  /** Build, SCM and cache state — not authored sources. */
  const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', '.cache', '.objectstack', 'coverage']);
  /** Structural exclusions, each with its reason. NOT an allowlist file: these are the retirement kit and its projections. */
  const EXCLUDED = [
    // The tombstones declare the key they refuse.
    'packages/spec/src/system/incident-response.zod.ts',
    'packages/spec/src/system/training.zod.ts',
    'packages/spec/src/system/change-management.zod.ts',
    // Refusal fixtures author the key to prove the refusal — this pin included.
    'packages/spec/src/system/incident-response.test.ts',
    'packages/spec/src/system/training.test.ts',
    'packages/spec/src/system/change-management.test.ts',
    path.relative(REPO_ROOT, fileURLToPath(import.meta.url)),
  ];
  const EXCLUDED_PREFIXES = [
    // Registers the retirement by key (entries + the generated registry).
    'packages/spec/src/migrations/',
    // Generated projections of the tombstone: the `[RETIRED]` / `[REMOVED]` rows.
    'packages/spec/authorable-surface/',
    'packages/spec/json-schema/',
    'packages/spec/json-schema.manifest/',
    'packages/spec/spec-changes.json',
    'docs/protocol-upgrade-guide.md',
    'content/docs/references/',
    // Release prose records the removal (release-owned; never edited by a code PR).
    'content/docs/releases/',
    '.changeset/',
  ];

  it('the matcher recognises the authored shape (anti-vacuity, on a file the scan deliberately excludes)', () => {
    const tombstoned = fs.readFileSync(path.join(THIS_DIR, 'incident-response.zod.ts'), 'utf-8');
    expect(authoring(UNIQUE_KEYS).test(tombstoned)).toBe(true);
    expect(FAMILY.test(tombstoned) && authoring(SHARED_KEYS).test(tombstoned)).toBe(true);
    // And a bare prose mention is NOT an authoring.
    expect(authoring(UNIQUE_KEYS).test('the `targetHours` key was removed')).toBe(false);
    expect(authoring(UNIQUE_KEYS).test('`IncidentResponsePhase.targetHours` was removed')).toBe(false);
  });

  it('no authored occurrence survives outside the retirement kit and its generated projections', () => {
    const offenders: string[] = [];
    let visited = 0;
    const unique = authoring(UNIQUE_KEYS);
    const shared = authoring(SHARED_KEYS);
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const rel = path.relative(REPO_ROOT, full).split(path.sep).join('/');
        if (entry.isDirectory()) {
          if (SKIPPED_DIRS.has(entry.name)) continue;
          // Other dot-directories are generated caches (`.source`, `.next`, …);
          // the two hand-authored ones are scanned.
          if (entry.name.startsWith('.') && entry.name !== '.claude' && entry.name !== '.github') continue;
          walk(full);
          continue;
        }
        if (!entry.isFile()) continue;
        if (!SCANNED_EXT.has(path.extname(entry.name))) continue;
        if (entry.name === 'CHANGELOG.md') continue; // release prose records the removal
        if (EXCLUDED.includes(rel) || EXCLUDED_PREFIXES.some((p) => rel.startsWith(p))) continue;
        visited += 1;
        const text = fs.readFileSync(full, 'utf-8');
        const u = unique.exec(text);
        if (u) offenders.push(`${rel} authors \`${u[1]}\``);
        if (FAMILY.test(text)) {
          const s = shared.exec(text);
          if (s) offenders.push(`${rel} names a family and authors \`${s[1]}\``);
        }
      }
    };
    walk(REPO_ROOT);
    // Anti-vacuity: the walk really covered the tree.
    expect(visited).toBeGreaterThan(1000);
    expect(offenders, 'an authored retired key means the retirement is being undone — re-read #14477').toEqual([]);
  });
});
