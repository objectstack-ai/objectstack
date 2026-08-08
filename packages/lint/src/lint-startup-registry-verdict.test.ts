// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #4776 — the startup "provider not registered YET" vs "no provider at all"
// misdiagnosis, as a lint vocabulary.
//
// The fixtures are organised as the maintainer's ruling asked: the three
// same-shape defects one showcase cold start produced (#4769 / #4771 / #4772)
// are reconstructed as POSITIVE fixtures where this rule's declared vocabulary
// reaches them, the three shapes their fixes took are NEGATIVE fixtures, and the
// two shapes this rule deliberately does NOT reach have their own tests so the
// boundary is asserted rather than assumed. A rule whose limits are only in its
// prose is a rule whose limits move.
import { describe, expect, it } from 'vitest';

import {
  findStartupRegistryVerdicts,
  OPEN_VOCABULARY_PROBES,
  PRE_SEAL_PHASES,
  STARTUP_OPEN_VOCABULARY_VERDICT,
  STARTUP_VERDICT_ASSERTIVE_WORDING,
  STARTUP_VERDICT_HINT,
} from './lint-startup-registry-verdict.js';

const ruleIds = (source: string) => findStartupRegistryVerdicts(source, { file: 'plugin.ts' }).map((f) => f.rule);

// ── Positive fixtures: the defects, reconstructed ────────────────────────────

describe('the #4771 shape — a flow node-type verdict drawn while the vocabulary is still filling', () => {
  // The original: AutomationServicePlugin.start() pulled flows and judged their
  // node types against the executor registry ~0.8s before ApprovalsServicePlugin
  // registered the `approval` executor. Eight ADR-0019 approval flows were
  // reported as "will fail at execution time"; all eight were false.
  const source = `
    export class AutomationServicePlugin {
      name = 'com.objectstack.service-automation';
      async init(ctx) { this.engine = new AutomationEngine(); }
      async start(ctx) {
        const known = this.engine.getRegisteredNodeTypes();
        for (const flow of await this.pullFlows()) {
          const unknown = flow.nodes.filter((n) => !known.includes(n.type));
          if (unknown.length > 0) {
            this.logger.warn(
              \`Flow '\${flow.name}' references node type(s) with no registered executor — these nodes will fail at execution time with NO_EXECUTOR.\`,
            );
          }
        }
      }
    }
  `;

  it('flags the recorded verdict, naming the rule and the two worlds it cannot tell apart', () => {
    const findings = findStartupRegistryVerdicts(source, { file: 'plugin.ts' });
    const structural = findings.filter((f) => f.rule === STARTUP_OPEN_VOCABULARY_VERDICT);
    expect(structural).toHaveLength(1);
    expect(structural[0].severity).toBe('warning');
    expect(structural[0].where).toBe('AutomationServicePlugin.start()');
    expect(structural[0].message).toContain('`getRegisteredNodeTypes()`');
    expect(structural[0].message).toContain('announced: warn log');
    expect(structural[0].message).toContain('ADR-0018');
    expect(structural[0].message).toContain('no provider in this deployment, or a provider that registers later');
  });

  it('flags the WORDING too — the half the CI gate never reads', () => {
    const findings = findStartupRegistryVerdicts(source, { file: 'plugin.ts' });
    const wording = findings.filter((f) => f.rule === STARTUP_VERDICT_ASSERTIVE_WORDING);
    expect(wording).toHaveLength(1);
    expect(wording[0].message).toContain('"will fail"');
    expect(wording[0].message).toContain('#4771');
    expect(wording[0].message).toContain('the identical eight');
  });

  it('every finding prescribes all three sanctioned cures, by the change that shipped each', () => {
    for (const finding of findStartupRegistryVerdicts(source, { file: 'plugin.ts' })) {
      expect(finding.hint).toBe(STARTUP_VERDICT_HINT);
      expect(finding.hint).toContain('createLazyCacheRateLimitStorage()');
      expect(finding.hint).toContain('sealNodeTypeVocabulary()');
      expect(finding.hint).toContain('#4769');
      expect(finding.hint).toContain('#4771');
      expect(finding.hint).toContain('#4772');
    }
  });

  it("the hint makes no assertive claim of its own — the mistake it exists to remove", () => {
    // A hint that said "this WILL misreport" would be the same defect wearing
    // the rule's badge: the rule cannot execute the boot it reasons about.
    expect(STARTUP_VERDICT_HINT.toLowerCase()).not.toMatch(/\bthis will fail\b/);
    expect(STARTUP_VERDICT_HINT).toContain('keep the two worlds apart in the wording');
  });
});

describe('the #4771 shape seen from a CONSUMER package — where the CI gate cannot look', () => {
  // check:startup-registry-verdict's Rule B keys on the OWNING class's
  // `this.nodeExecutors` / `this.actionDescriptors` properties, so a caller in
  // another package reaching the same vocabulary through its public accessor is
  // invisible to it. This rule matches the accessor, so it is not.
  it('flags a cached verdict taken through the public accessor', () => {
    const source = `
      export class ReportingPlugin {
        name = 'com.acme.reporting';
        async init(ctx) {
          const automation = ctx.getService('automation');
          const descriptors = automation.getActionDescriptors();
          this.canRenderApprovals = descriptors.some((d) => d.type === 'approval');
        }
        async start() {}
      }
    `;
    const findings = findStartupRegistryVerdicts(source, { file: 'reporting-plugin.ts' });
    expect(findings.map((f) => f.rule)).toEqual([STARTUP_OPEN_VOCABULARY_VERDICT]);
    expect(findings[0].message).toContain('cached: this.canRenderApprovals');
    expect(findings[0].where).toBe('ReportingPlugin.init()');
  });
});

describe("the #4772 shape — a misdirecting remedy, transposed onto a vocabulary this rule reaches", () => {
  // #4772's own registry (the kernel SERVICE registry) belongs to
  // check:startup-registry-verdict — see the boundary test below. What travels
  // to this rule is its WORDING failure: the remedy told operators to provision
  // Redis for a problem they did not have, and following it changed nothing.
  it('flags both the record and the remedy that cannot be acted on', () => {
    const source = `
      export class RateLimitPlugin {
        name = 'com.acme.ratelimit';
        async init() {}
        async start(ctx) {
          const connectors = ctx.registry.listConnectors();
          if (!connectors.includes('redis')) {
            ctx.logger.warn('No shared store connector is registered — you need Redis for multi-node rate limiting.');
          }
        }
      }
    `;
    expect(ruleIds(source)).toEqual([STARTUP_OPEN_VOCABULARY_VERDICT, STARTUP_VERDICT_ASSERTIVE_WORDING]);
  });
});

describe('the #4769 shape — a verdict PERSISTED during the boot that contradicts it', () => {
  it('flags a durable write of an open-vocabulary verdict', () => {
    const source = `
      export class AttestationPlugin {
        name = 'com.acme.attestation';
        async init(ctx) {
          const tools = ctx.ai.getRegisteredTools();
          await ctx.api.object('sys_attestation').insert({ toolCount: tools.length, verdict: 'complete' });
        }
        async start() {}
      }
    `;
    const findings = findStartupRegistryVerdicts(source, { file: 'attestation-plugin.ts' });
    expect(findings.map((f) => f.rule)).toEqual([STARTUP_OPEN_VOCABULARY_VERDICT]);
    expect(findings[0].message).toContain('persisted: insert()');
  });
});

// ── Negative fixtures: the three shapes the fixes took ───────────────────────

describe('the three sanctioned cures pass', () => {
  it('cure 1 — deferral to kernel:ready (#4771 / #4772)', () => {
    // The verdict moves into a callback that runs once the registry is complete.
    const source = `
      export class AutomationServicePlugin {
        name = 'com.objectstack.service-automation';
        async init() {}
        async start(ctx) {
          ctx.hook('kernel:bootstrapped', () => {
            const known = this.engine.getRegisteredNodeTypes();
            for (const flow of this.flows) {
              if (!known.includes(flow.type)) this.logger.warn('unknown node type');
            }
          });
        }
      }
    `;
    expect(findStartupRegistryVerdicts(source, { file: 'plugin.ts' })).toEqual([]);
  });

  it('cure 1 — lazy re-resolution, the createLazyCacheRateLimitStorage() shape (#4772)', () => {
    // The read happens inside the accessor that is HANDED OUT, so every call
    // resolves against the registry as it stands then, not as it stood at start.
    const source = `
      export class ToolingPlugin {
        name = 'com.acme.tooling';
        async init(ctx) {
          this.resolveTools = () => {
            const tools = ctx.ai.getRegisteredTools();
            if (tools.length === 0) ctx.logger.warn('no tools registered');
            return tools;
          };
        }
        async start() {}
      }
    `;
    expect(findStartupRegistryVerdicts(source, { file: 'plugin.ts' })).toEqual([]);
  });

  it('cure 2 — seal the vocabulary, then judge (#4771, AutomationEngine.sealNodeTypeVocabulary)', () => {
    const source = `
      export class AutomationServicePlugin {
        name = 'com.objectstack.service-automation';
        async init() {}
        async start(ctx) {
          if (!this.nodeTypeVocabularySealed) return;
          const known = this.engine.getRegisteredNodeTypes();
          for (const flow of this.flows) {
            if (!known.includes(flow.type)) this.logger.warn('no registered executor or descriptor');
          }
        }
      }
    `;
    expect(findStartupRegistryVerdicts(source, { file: 'plugin.ts' })).toEqual([]);
  });

  it('cure 3 — the verdict is ordered after the mutation it describes (#4769)', () => {
    // The attestation is written from a `kernel:ready` handler, after the seed
    // that would contradict it. Same mechanism as cure 1; named separately
    // because it is the shape #4769's fix actually took.
    const source = `
      export class AttestationPlugin {
        name = 'com.acme.attestation';
        async init(ctx) {
          ctx.hook('kernel:ready', async () => {
            const tools = ctx.ai.getRegisteredTools();
            await ctx.api.object('sys_attestation').insert({ toolCount: tools.length });
          });
        }
        async start() {}
      }
    `;
    expect(findStartupRegistryVerdicts(source, { file: 'plugin.ts' })).toEqual([]);
  });
});

describe('legal shapes stay legal', () => {
  it('a read-only probe records nothing and is correct (getUnknownNodeTypeAudit)', () => {
    const source = `
      export class AutomationServicePlugin {
        name = 'com.objectstack.service-automation';
        async init() {}
        async start(ctx) {
          const audit = this.engine.getUnknownNodeTypeAudit();
          return audit;
        }
      }
    `;
    expect(findStartupRegistryVerdicts(source, { file: 'plugin.ts' })).toEqual([]);
  });

  it('an info/debug narration is not a verdict', () => {
    const source = `
      export class AutomationServicePlugin {
        name = 'com.objectstack.service-automation';
        async init() {}
        async start(ctx) {
          const known = this.engine.getRegisteredNodeTypes();
          ctx.logger.debug(\`node types so far: \${known.length}\`);
        }
      }
    `;
    expect(findStartupRegistryVerdicts(source, { file: 'plugin.ts' })).toEqual([]);
  });

  it('a keyed lookup that dispatches work is how the runtime resolves, not a verdict', () => {
    const source = `
      export class AutomationServicePlugin {
        name = 'com.objectstack.service-automation';
        async init() {}
        async start(ctx) {
          const executor = this.nodeExecutors.get('approval');
          if (!executor) this.logger.warn('no approval executor');
        }
      }
    `;
    expect(findStartupRegistryVerdicts(source, { file: 'plugin.ts' })).toEqual([]);
  });

  it('a post-boot method is judged against a complete vocabulary and is not this rule\'s business', () => {
    const source = `
      export class AutomationServicePlugin {
        name = 'com.objectstack.service-automation';
        async init() {}
        async start() {}
        registerFlow(flow) {
          const known = this.engine.getRegisteredNodeTypes();
          if (!known.includes(flow.type)) this.logger.warn('unknown node type — it will fail at execution time');
        }
      }
    `;
    expect(findStartupRegistryVerdicts(source, { file: 'plugin.ts' })).toEqual([]);
  });

  it('a class with no plugin lifecycle is not on the boot path this rule reasons about', () => {
    const source = `
      export class FlowInspector {
        constructor(engine) {
          const known = engine.getRegisteredNodeTypes();
          this.known = known;
          console.warn('inspector built with ' + known.length + ' types — unknown ones will fail');
        }
      }
    `;
    expect(findStartupRegistryVerdicts(source, { file: 'inspector.ts' })).toEqual([]);
  });

  it('an options bag with an `init` but no `name` is not a plugin', () => {
    const source = `
      export const options = {
        init: (ctx) => {
          const tools = ctx.ai.getRegisteredTools();
          if (!tools.length) ctx.logger.warn('you need the tools plugin');
        },
      };
    `;
    expect(findStartupRegistryVerdicts(source, { file: 'options.ts' })).toEqual([]);
  });

  it('a hedged diagnostic keeps the two worlds apart, so only the record is reported', () => {
    const source = `
      export class AutomationServicePlugin {
        name = 'com.objectstack.service-automation';
        async init() {}
        async start(ctx) {
          const known = this.engine.getRegisteredNodeTypes();
          if (!known.includes('approval')) {
            ctx.logger.warn('no executor for node type approval has been registered yet (as of plugin start) — a plugin may still contribute one.');
          }
        }
      }
    `;
    expect(ruleIds(source)).toEqual([STARTUP_OPEN_VOCABULARY_VERDICT]);
  });
});

// ── The declared boundary, asserted rather than assumed ──────────────────────

describe('what this rule delegates, and to whom', () => {
  it('the #4772 service-registry probe is left to check:startup-registry-verdict', () => {
    // Not a miss — a division of labour. That shape needs the ADR-0116
    // plugin-manifest model (`dependencies` / `requiresServices` make "absent" a
    // FACT), which the CI gate already carries. Answering one question in two
    // vocabularies is how vocabularies rot (#5841).
    const source = `
      export class AuthPlugin {
        name = 'com.objectstack.plugin-auth';
        async init(ctx) {
          const cache = await ctx.getServiceAsync('cache');
          if (!cache) ctx.logger.warn('no cache service — you need Redis for multi-node rate limiting');
          this.effectiveSecondaryStorage = cache;
        }
        async start() {}
      }
    `;
    expect(findStartupRegistryVerdicts(source, { file: 'auth-plugin.ts' })).toEqual([]);
  });

  it('#4769\'s datastore attestation is out of reach for any syntactic rule', () => {
    // "No rows → write the row" is exactly what legitimate first-boot seeding
    // looks like. A rule that flagged it would flag every seeder, and a rule
    // people switch off is worth less than no rule because it also reports
    // success. Stated here so the limit cannot quietly become a claim.
    const source = `
      export class MigrationPlugin {
        name = 'com.objectstack.migrations';
        async init(ctx) {
          const rows = await ctx.api.object('sys_migration').find({});
          if (rows.length === 0) {
            await ctx.api.object('sys_migration').insert({ attested: 'datastore-created-empty' });
          }
        }
        async start() {}
      }
    `;
    expect(findStartupRegistryVerdicts(source, { file: 'migration-plugin.ts' })).toEqual([]);
  });
});

// ── The vocabulary itself ────────────────────────────────────────────────────

describe('the vocabulary is data, and every entry earns its place', () => {
  it('every probe explains WHY its answer is not final', () => {
    for (const [probe, note] of OPEN_VOCABULARY_PROBES) {
      expect(note.length, `${probe} has no note`).toBeGreaterThan(40);
      // The note is the half the author reads; a rule id explains nothing.
      expect(note, `${probe}'s note must name what can still change`).toMatch(
        /plugin|package|boot|registered|published|contributed/i,
      );
    }
  });

  it('every pre-seal phase explains what is still open in it', () => {
    expect([...PRE_SEAL_PHASES.keys()]).toEqual(['constructor', 'init', 'start']);
    for (const [phase, note] of PRE_SEAL_PHASES) {
      expect(note.length, `${phase} has no note`).toBeGreaterThan(40);
    }
  });

  it('`start` is covered — the phase the CI gate does not enter', () => {
    // The measured complement (2026-08-08): check:startup-registry-verdict
    // reported 40 seams across 1501 files under packages/, 0 of them in a
    // start(). Its Rule A stops at init() on the sound reasoning that every
    // init() has completed by then — true of the SERVICE registry, false of an
    // ADR-0018 vocabulary a sibling plugin fills from its own start().
    expect(PRE_SEAL_PHASES.has('start')).toBe(true);
  });

  it('an empty or unparseable source is not a verdict about anyone', () => {
    expect(findStartupRegistryVerdicts('')).toEqual([]);
    expect(findStartupRegistryVerdicts('   \n  ')).toEqual([]);
    expect(findStartupRegistryVerdicts('class { { { getRegisteredNodeTypes(')).toEqual([]);
  });
});
