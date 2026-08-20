import { describe, it, expect } from 'vitest';
import {
  HookEvent,
  HookSchema,
  HookContextSchema,
  defineHook,
  type Hook,
  type HookContext,
} from './hook.zod';

describe('HookEvent', () => {
  describe('Read Operations', () => {
    it('should accept read events (fire for both find and findOne)', () => {
      const readEvents = ['beforeFind', 'afterFind'];

      readEvents.forEach(event => {
        expect(() => HookEvent.parse(event)).not.toThrow();
      });
    });
  });

  describe('Write Operations', () => {
    it('should accept write events (fire for both single and bulk writes)', () => {
      const writeEvents = [
        'beforeInsert', 'afterInsert',
        'beforeUpdate', 'afterUpdate',
        'beforeDelete', 'afterDelete',
      ];

      writeEvents.forEach(event => {
        expect(() => HookEvent.parse(event)).not.toThrow();
      });
    });
  });

  describe('Removed non-dispatched events (#3195)', () => {
    it('should reject per-method read and *Many events that the engine never dispatched', () => {
      // These were declared but never fired; the engine only ever triggers the
      // 8 events above. Removed rather than left as silent no-ops — read
      // filtering is RLS/middleware, masking is field metadata, and bulk writes
      // fire the singular before/after events.
      const removed = [
        'beforeFindOne', 'afterFindOne',
        'beforeCount', 'afterCount',
        'beforeAggregate', 'afterAggregate',
        'beforeUpdateMany', 'afterUpdateMany',
        'beforeDeleteMany', 'afterDeleteMany',
      ];

      removed.forEach(event => {
        expect(() => HookEvent.parse(event)).toThrow();
      });
    });
  });

  it('should reject invalid event', () => {
    expect(() => HookEvent.parse('invalidEvent')).toThrow();
  });
});

describe('HookSchema', () => {
  describe('Basic Hook Properties', () => {
    it('should accept minimal valid hook', () => {
      const hook = HookSchema.parse({
        name: 'validate_email',
        object: 'contact',
        events: ['beforeInsert'],
      });

      expect(hook.name).toBe('validate_email');
      expect(hook.object).toBe('contact');
      expect(hook.events).toContain('beforeInsert');
    });

    it('should enforce snake_case for hook name', () => {
      expect(() => HookSchema.parse({
        name: 'ValidateEmail',
        object: 'contact',
        events: ['beforeInsert'],
      })).toThrow();

      expect(() => HookSchema.parse({
        name: 'validate-email',
        object: 'contact',
        events: ['beforeInsert'],
      })).toThrow();
    });

    it('should accept valid snake_case names', () => {
      const validNames = ['validate_email', 'set_default_values', 'before_save_hook', '_system_hook'];

      validNames.forEach(name => {
        expect(() => HookSchema.parse({
          name,
          object: 'contact',
          events: ['beforeInsert'],
        })).not.toThrow();
      });
    });

    it('should accept hook with label', () => {
      const hook = HookSchema.parse({
        name: 'validate_email',
        label: 'Email Validation Hook',
        object: 'contact',
        events: ['beforeInsert', 'beforeUpdate'],
      });

      expect(hook.label).toBe('Email Validation Hook');
    });
  });

  describe('Object Targeting', () => {
    it('should accept single object', () => {
      const hook = HookSchema.parse({
        name: 'account_hook',
        object: 'account',
        events: ['beforeInsert'],
      });

      expect(hook.object).toBe('account');
    });

    it('should accept multiple objects', () => {
      const hook = HookSchema.parse({
        name: 'multi_object_hook',
        object: ['account', 'contact', 'opportunity'],
        events: ['beforeInsert'],
      });

      expect(hook.object).toEqual(['account', 'contact', 'opportunity']);
    });

    it('should accept wildcard for all objects', () => {
      const hook = HookSchema.parse({
        name: 'global_audit',
        object: '*',
        events: ['afterInsert', 'afterUpdate', 'afterDelete'],
      });

      expect(hook.object).toBe('*');
    });

    // #4001: an empty target used to parse, and the binder widened `''` / `[]`
    // to the wildcard `'*'` — so a blank target registered the hook on EVERY
    // object. `['']` failed the other way: an object name nothing matches, a
    // hook that could never fire. Both are refused; a wildcard must be spelled.
    describe('an empty target is refused, not widened to the wildcard', () => {
      it.each([
        ['empty string', ''],
        ['whitespace-only string', '   '],
        ['empty array', [] as string[]],
        ['array of one blank', [''] as string[]],
        ['array with a blank member', ['account', ''] as string[]],
      ])('rejects %s', (_label, object) => {
        const result = HookSchema.safeParse({
          name: 'blank_target',
          object,
          events: ['beforeInsert'],
        });

        expect(result.success).toBe(false);
        const message = result.error!.issues.map((i) => i.message).join('\n');
        // The error has to be fixable, not merely loud (#4001): it names both
        // spellings that work and the wildcard that the blank silently became.
        expect(message).toMatch(/must name at least one object/);
        expect(message).toMatch(/object: '\*'/);
      });

      it('still accepts a wildcard inside an array', () => {
        expect(HookSchema.parse({
          name: 'array_wildcard',
          object: ['*'],
          events: ['afterUpdate'],
        }).object).toEqual(['*']);
      });
    });
  });

  describe('Event Subscription', () => {
    it('should accept single event', () => {
      const hook = HookSchema.parse({
        name: 'before_save',
        object: 'account',
        events: ['beforeInsert'],
      });

      expect(hook.events).toHaveLength(1);
      expect(hook.events).toContain('beforeInsert');
    });

    it('should accept multiple events', () => {
      const hook = HookSchema.parse({
        name: 'audit_changes',
        object: 'account',
        events: ['afterInsert', 'afterUpdate', 'afterDelete'],
      });

      expect(hook.events).toHaveLength(3);
    });

    it('should accept before and after events', () => {
      const hook = HookSchema.parse({
        name: 'sync_to_external',
        object: 'contact',
        events: ['beforeInsert', 'afterInsert', 'beforeUpdate', 'afterUpdate'],
      });

      expect(hook.events).toHaveLength(4);
    });
  });

  describe('Handler Configuration', () => {
    it('should accept string handler', () => {
      const hook = HookSchema.parse({
        name: 'validate_data',
        object: 'account',
        events: ['beforeInsert'],
        handler: 'validators.validateAccount',
      });

      expect(hook.handler).toBe('validators.validateAccount');
    });

    it('should accept optional handler', () => {
      const hook = HookSchema.parse({
        name: 'log_changes',
        object: 'account',
        events: ['afterUpdate'],
      });

      expect(hook.handler).toBeUndefined();
    });
  });

  describe('Priority and Execution Order', () => {
    it('should apply default priority', () => {
      const hook = HookSchema.parse({
        name: 'app_hook',
        object: 'account',
        events: ['beforeInsert'],
      });

      expect(hook.priority).toBe(100);
    });

    it('should accept system hook priority', () => {
      const hook = HookSchema.parse({
        name: 'system_validation',
        object: '*',
        events: ['beforeInsert'],
        priority: 50,
      });

      expect(hook.priority).toBe(50);
    });

    it('should accept user hook priority', () => {
      const hook = HookSchema.parse({
        name: 'custom_logic',
        object: 'account',
        events: ['beforeInsert'],
        priority: 1000,
      });

      expect(hook.priority).toBe(1000);
    });
  });

  describe('Async Execution', () => {
    it('should default async to false', () => {
      const hook = HookSchema.parse({
        name: 'sync_hook',
        object: 'account',
        events: ['afterInsert'],
      });

      expect(hook.async).toBe(false);
    });

    it('should accept async execution', () => {
      const hook = HookSchema.parse({
        name: 'send_notification',
        object: 'account',
        events: ['afterInsert'],
        async: true,
      });

      expect(hook.async).toBe(true);
    });

    it('should accept blocking execution', () => {
      const hook = HookSchema.parse({
        name: 'validate_critical',
        object: 'account',
        events: ['beforeInsert'],
        async: false,
      });

      expect(hook.async).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should default onError to abort', () => {
      const hook = HookSchema.parse({
        name: 'validation_hook',
        object: 'account',
        events: ['beforeInsert'],
      });

      expect(hook.onError).toBe('abort');
    });

    it('should accept abort error policy', () => {
      const hook = HookSchema.parse({
        name: 'critical_validation',
        object: 'account',
        events: ['beforeInsert'],
        onError: 'abort',
      });

      expect(hook.onError).toBe('abort');
    });

    it('should accept log error policy', () => {
      const hook = HookSchema.parse({
        name: 'non_critical_hook',
        object: 'account',
        events: ['afterInsert'],
        onError: 'log',
      });

      expect(hook.onError).toBe('log');
    });
  });

  describe('Complete Hook Examples', () => {
    it('should accept validation hook', () => {
      const hook: Hook = {
        name: 'validate_account_data',
        label: 'Account Data Validation',
        object: 'account',
        events: ['beforeInsert', 'beforeUpdate'],
        handler: 'validators.validateAccountData',
        priority: 100,
        async: false,
        onError: 'abort',
      };

      expect(() => HookSchema.parse(hook)).not.toThrow();
    });

    it('should accept audit trail hook', () => {
      const hook: Hook = {
        name: 'audit_trail',
        label: 'Audit Trail Logging',
        object: '*',
        events: ['afterInsert', 'afterUpdate', 'afterDelete'],
        handler: 'audit.logChange',
        priority: 200,
        async: true,
        onError: 'log',
      };

      expect(() => HookSchema.parse(hook)).not.toThrow();
    });

    it('should accept default value hook', () => {
      const hook: Hook = {
        name: 'set_defaults',
        label: 'Set Default Values',
        object: 'opportunity',
        events: ['beforeInsert'],
        handler: 'defaults.setOpportunityDefaults',
        priority: 50,
        async: false,
        onError: 'abort',
      };

      expect(() => HookSchema.parse(hook)).not.toThrow();
    });

    it('should accept external sync hook', () => {
      const hook: Hook = {
        name: 'sync_to_salesforce',
        label: 'Sync to Salesforce',
        object: ['account', 'contact'],
        events: ['afterInsert', 'afterUpdate'],
        handler: 'integrations.syncToSalesforce',
        priority: 500,
        async: true,
        onError: 'log',
      };

      expect(() => HookSchema.parse(hook)).not.toThrow();
    });

    it('should accept notification hook', () => {
      const hook: Hook = {
        name: 'send_email_notification',
        label: 'Send Email Notification',
        object: 'case',
        events: ['afterInsert'],
        handler: 'notifications.sendEmail',
        priority: 800,
        async: true,
        onError: 'log',
      };

      expect(() => HookSchema.parse(hook)).not.toThrow();
    });
  });
});

describe('HookContextSchema', () => {
  describe('Basic Context Properties', () => {
    it('should accept minimal context', () => {
      const context = HookContextSchema.parse({
        object: 'account',
        event: 'beforeInsert',
        input: { data: { name: 'Test Account' } },
        ql: {},
      });

      expect(context.object).toBe('account');
      expect(context.event).toBe('beforeInsert');
    });

    it('should accept context with id', () => {
      const context = HookContextSchema.parse({
        id: 'trace_123',
        object: 'account',
        event: 'beforeInsert',
        input: {},
        ql: {},
      });

      expect(context.id).toBe('trace_123');
    });
  });

  describe('Input Parameters', () => {
    it('should accept find input', () => {
      const context = HookContextSchema.parse({
        object: 'account',
        event: 'beforeFind',
        input: {
          query: { where: { status: 'active' } },
          options: {},
        },
        ql: {},
      });

      expect(context.input.query).toBeDefined();
    });

    it('should accept insert input', () => {
      const context = HookContextSchema.parse({
        object: 'account',
        event: 'beforeInsert',
        input: {
          data: {
            name: 'New Account',
            industry: 'Technology',
          },
          options: {},
        },
        ql: {},
      });

      // `input` is `z.record(z.string(), z.unknown())` by contract — the payload
      // shape varies per event — so a parsed read is narrowed at the read site.
      expect((context.input.data as { name: string }).name).toBe('New Account');
    });

    it('should accept update input', () => {
      const context = HookContextSchema.parse({
        object: 'account',
        event: 'beforeUpdate',
        input: {
          id: '123',
          data: { status: 'active' },
          options: {},
        },
        ql: {},
      });

      expect(context.input.id).toBe('123');
      expect((context.input.data as { status: string }).status).toBe('active');
    });

    it('should accept delete input', () => {
      const context = HookContextSchema.parse({
        object: 'account',
        event: 'beforeDelete',
        input: {
          id: '123',
          options: {},
        },
        ql: {},
      });

      expect(context.input.id).toBe('123');
    });
  });

  describe('Operation Result', () => {
    it('should accept result for after hooks', () => {
      const context = HookContextSchema.parse({
        object: 'account',
        event: 'afterInsert',
        input: {},
        result: {
          id: '123',
          name: 'New Account',
          createdAt: '2026-01-31T00:00:00Z',
        },
        ql: {},
      });

      expect((context.result as { id: string }).id).toBe('123');
    });

    it('should accept array result', () => {
      const context = HookContextSchema.parse({
        object: 'account',
        event: 'afterFind',
        input: {},
        result: [
          { id: '1', name: 'Account 1' },
          { id: '2', name: 'Account 2' },
        ],
        ql: {},
      });

      expect(context.result).toHaveLength(2);
    });
  });

  describe('Previous Data Snapshot', () => {
    it('should accept previous data for update', () => {
      const context = HookContextSchema.parse({
        object: 'account',
        event: 'beforeUpdate',
        input: {},
        previous: {
          id: '123',
          name: 'Old Name',
          status: 'inactive',
        },
        ql: {},
      });

      expect(context.previous?.name).toBe('Old Name');
    });

    it('should accept previous data for delete', () => {
      const context = HookContextSchema.parse({
        object: 'account',
        event: 'beforeDelete',
        input: {},
        previous: {
          id: '123',
          name: 'Account to Delete',
        },
        ql: {},
      });

      expect(context.previous?.name).toBe('Account to Delete');
    });
  });

  describe('Session Context', () => {
    it('should accept session with user info', () => {
      // `roles` used to ride along in this fixture; it was retired in #5050
      // (declared, never produced) and now has its own pin block below. The
      // keys asserted here are the ones `buildSession()` really writes.
      const context = HookContextSchema.parse({
        object: 'account',
        event: 'beforeInsert',
        input: {},
        session: {
          userId: 'user_123',
          organizationId: 'org_456',
          isSystem: false,
        },
        ql: {},
      });

      expect(context.session?.userId).toBe('user_123');
      expect(context.session?.organizationId).toBe('org_456');
      expect(context.session?.isSystem).toBe(false);
    });

    it('should accept session with access token', () => {
      const context = HookContextSchema.parse({
        object: 'account',
        event: 'beforeInsert',
        input: {},
        session: {
          userId: 'user_123',
          accessToken: 'token_abc123',
        },
        ql: {},
      });

      expect(context.session?.accessToken).toBe('token_abc123');
    });

    // #3280 made `organizationId` the blessed developer-facing name; the
    // `tenantId` alias was removed from this surface in v16 (#3290). A stray
    // `tenantId` key is now stripped by the schema rather than surfaced.
    it('exposes session.organizationId and no longer carries the removed tenantId alias (#3290)', () => {
      const context = HookContextSchema.parse({
        object: 'account',
        event: 'beforeInsert',
        input: {},
        session: {
          userId: 'user_123',
          organizationId: 'org_456',
          // No longer part of the schema — Zod strips this unknown key.
          tenantId: 'org_456',
        } as any,
        ql: {},
      });

      expect(context.session?.organizationId).toBe('org_456');
      expect((context.session as any)?.tenantId).toBeUndefined();
    });

    it('should accept user.organizationId shortcut', () => {
      const context = HookContextSchema.parse({
        object: 'account',
        event: 'beforeInsert',
        input: {},
        user: {
          id: 'user_123',
          email: 'dev@example.com',
          organizationId: 'org_456',
        },
        ql: {},
      });

      expect(context.user?.organizationId).toBe('org_456');
    });
  });

  describe('Transaction Support', () => {
    it('should accept transaction handle', () => {
      const context = HookContextSchema.parse({
        object: 'account',
        event: 'beforeInsert',
        input: {},
        transaction: { id: 'tx_123' },
        ql: {},
      });

      expect(context.transaction).toBeDefined();
    });
  });

  describe('Complete Context Examples', () => {
    it('should accept complete before insert context', () => {
      const context: HookContext = {
        id: 'trace_abc123',
        object: 'account',
        event: 'beforeInsert',
        input: {
          data: {
            name: 'New Account',
            industry: 'Technology',
            status: 'active',
          },
          options: {},
        },
        session: {
          userId: 'user_123',
          // `session.tenantId` was removed in v16 (#3280/#3290); the blessed
          // developer-facing name is `organizationId`. This fixture kept
          // spelling the retired alias for two majors because nothing
          // type-checked it — vitest only sees `HookContextSchema.parse`,
          // which strips unknown keys silently (#5286).
          organizationId: 'org_456',
          // `roles` stood here for the same reason until #5050 retired it. It
          // is now a `retiredKey()` tombstone, so this literal — which IS typed
          // as `HookContext` — would no longer compile: the tsc channel the
          // #5286 comment above says this fixture never had.
        },
        transaction: { id: 'tx_789' },
        ql: {},
      };

      expect(() => HookContextSchema.parse(context)).not.toThrow();
    });

    it('should accept complete after update context', () => {
      const context: HookContext = {
        id: 'trace_def456',
        object: 'account',
        event: 'afterUpdate',
        input: {
          id: '123',
          data: { status: 'active' },
          options: {},
        },
        result: {
          id: '123',
          name: 'Account Name',
          status: 'active',
          updatedAt: '2026-01-31T00:00:00Z',
        },
        previous: {
          id: '123',
          name: 'Account Name',
          status: 'inactive',
        },
        session: {
          userId: 'user_123',
        },
        ql: {},
      };

      expect(() => HookContextSchema.parse(context)).not.toThrow();
    });
  });
});

describe('Integration Tests', () => {
  it('should support hook lifecycle', () => {
    // Define hook
    const hook = HookSchema.parse({
      name: 'validate_and_enrich',
      label: 'Validate and Enrich Data',
      object: 'account',
      events: ['beforeInsert', 'beforeUpdate'],
      handler: 'handlers.validateAndEnrich',
      priority: 100,
      async: false,
      onError: 'abort',
    });

    // Before insert context
    const beforeContext = HookContextSchema.parse({
      object: 'account',
      event: 'beforeInsert',
      input: {
        data: { name: 'Test Account' },
      },
      session: {
        userId: 'user_123',
      },
      ql: {},
    });

    // After insert context
    const afterContext = HookContextSchema.parse({
      object: 'account',
      event: 'afterInsert',
      input: {
        data: { name: 'Test Account' },
      },
      result: {
        id: '123',
        name: 'Test Account',
        createdAt: '2026-01-31T00:00:00Z',
      },
      session: {
        userId: 'user_123',
      },
      ql: {},
    });

    expect(hook.events).toContain('beforeInsert');
    expect(beforeContext.event).toBe('beforeInsert');
    expect((afterContext.result as { id: string }).id).toBe('123');
  });
});

// ============================================================================
// Protocol Improvement Tests: Hook condition
// ============================================================================

describe('HookSchema - condition property', () => {
  it('should accept a hook with declarative condition', () => {
    const hook = HookSchema.parse({
      name: 'notify_high_value',
      object: 'order',
      events: ['afterInsert'],
      handler: 'sendNotification',
      condition: "amount > 1000 AND status = 'confirmed'",
    });
    expect(hook.condition).toEqual({ dialect: 'cel', source: "amount > 1000 AND status = 'confirmed'" });
  });

  it('should accept a hook without condition (optional)', () => {
    const hook = HookSchema.parse({
      name: 'log_changes',
      object: 'account',
      events: ['afterUpdate'],
      handler: 'logChanges',
    });
    expect(hook.condition).toBeUndefined();
  });
});

// ============================================================================
// defineHook factory (#4269)
// ============================================================================

describe('defineHook (#4269)', () => {
  const config: Hook = {
    name: 'order_guard',
    object: 'order',
    events: ['beforeUpdate'],
    handler: 'guardStatus',
    condition: 'record.amount > 1000',
  };

  it('drift guard: factory output IS the schema parse output', () => {
    // The factory must stay a pure `HookSchema.parse` — if it ever grows its
    // own normalization, the two authoring paths (convention scan vs
    // `defineStack({ hooks })` binding) fork into different artifact shapes.
    expect(defineHook(config)).toEqual(HookSchema.parse(config));
  });

  it('materializes defaults and CEL shorthand (input shape → resolved shape)', () => {
    const resolved = defineHook({ ...config, retryPolicy: {} });
    expect(resolved.priority).toBe(100);
    expect(resolved.async).toBe(false);
    expect(resolved.onError).toBe('abort');
    expect(resolved.retryPolicy).toEqual({ maxRetries: 3, backoffMs: 1000 });
    expect(resolved.condition).toEqual({ dialect: 'cel', source: 'record.amount > 1000' });
  });

  it('passes an inline function handler through by reference', () => {
    const fn = async () => {};
    const resolved = defineHook({ ...config, handler: fn });
    expect(resolved.handler).toBe(fn);
  });

  it('re-parsing factory output is idempotent (bind-time double validation is safe)', () => {
    const resolved = defineHook(config);
    expect(HookSchema.parse(resolved)).toEqual(resolved);
  });

  it("hard-fails at authoring time with the schema's own guidance, not a second dialect", () => {
    expect(() => defineHook({
      ...config,
      // @ts-expect-error — `enabled` is not a hook key (#4207 guidance)
      enabled: true,
    })).toThrow(/no on\/off switch/);
    expect(() => defineHook({ ...config, name: 'NotSnakeCase' })).toThrow();
  });
});

/**
 * `HookContext.session.roles` retirement (#5050, ADR-0049 enforce-or-remove).
 *
 * The key was DECLARED here, READ by two exemption branches in plugin-approvals
 * (the approval record lock and the delegation write guard, both deleted in
 * #4839 / PR #5049), and NEVER PRODUCED on the hook path — ObjectQL's
 * `buildSession()` writes the session field by field and has no `roles` write,
 * here or in `cloud` (whose hook consumers read `hookContext?.session?.userId`
 * and nothing else). With the readers gone the key had neither end, which is
 * the state ADR-0049 says must not persist.
 *
 * The one neighbour worth naming, so nobody "disproves" the above with it: an
 * ACTION body's `ctx.session` is a different, untyped object built by
 * `runtime`'s `buildActionSession()`, and it does populate a `roles` key from
 * `ec.positions`. It never becomes a HookContext and no schema types it, so it
 * is neither evidence against this retirement nor fixed by it — tracked apart.
 *
 * Both channels are pinned below, because they answer different questions:
 *
 *   - the PARSE channel (`toThrow`) — what a runtime value meets. It matters
 *     here even though nobody authors a HookContext: `HookContextSchema` is
 *     exported and the generated reference documents `HookContextSchema.parse`,
 *     so a consumer parsing a context it was handed is a real, designed-for
 *     caller;
 *   - the TSC channel (`@ts-expect-error`) — what a producer meets, and the one
 *     that would have caught this key being written back. It is only live
 *     because #5286/#5478 put the test layer in front of `tsc`
 *     (`tsconfig.test.json`); before that every directive in this package was
 *     inert.
 *
 * Reverse-verified by restoring `roles: z.array(z.string()).optional()` in
 * `hook.zod.ts`: `pnpm --filter @objectstack/spec test` turns the two parse
 * assertions red, and `pnpm --filter @objectstack/spec typecheck` reports
 * TS2578 "Unused '@ts-expect-error' directive" on the two directives below.
 * Direction predicted before running it, and that is what it did.
 */
describe('session.roles retirement (#5050, ADR-0049)', () => {
  it('REJECTS an authored `roles`, with the prescription in the message', () => {
    expect(() =>
      HookContextSchema.parse({
        object: 'account',
        event: 'beforeInsert',
        input: {},
        session: { userId: 'user_123', roles: ['admin'] },
        ql: {},
      }),
    ).toThrow(/session\.roles.*removed.*never produced/s);
  });

  it('names the live vocabulary rather than only refusing', () => {
    // A tombstone whose message stops at "removed" leaves the reader to guess,
    // and the guess this key invites is a second admin dialect.
    expect(() =>
      HookContextSchema.parse({
        object: 'account',
        event: 'beforeInsert',
        input: {},
        session: { roles: [] },
        ql: {},
      }),
    ).toThrow(/ctx\.session\.userId.*permissions.*positions/s);
  });

  it('parses cleanly once the key is gone, and carries no `roles` on the way out', () => {
    const context = HookContextSchema.parse({
      object: 'account',
      event: 'beforeInsert',
      input: {},
      session: { userId: 'user_123', organizationId: 'org_456', isSystem: true },
      ql: {},
    });

    expect(context.session?.userId).toBe('user_123');
    expect(context.session).not.toHaveProperty('roles');
  });

  it('is a TOMBSTONE, not new strictness — an unrecognized key still strips silently', () => {
    // The distinction is the whole reason `retiredKey()` exists here. This
    // schema must stay tolerant (the header says so: an engine-internal
    // enrichment must not break a consumer parsing a context it was handed),
    // so a plain deletion would have stripped `roles` in silence — the
    // #3733 / ADR-0104 failure. Only the retired key is loud.
    const context = HookContextSchema.parse({
      object: 'account',
      event: 'beforeInsert',
      input: {},
      session: { userId: 'user_123', somethingTheEngineMayAddLater: true } as never,
      ql: {},
    });

    expect(context.session?.userId).toBe('user_123');
    expect(context.session).not.toHaveProperty('somethingTheEngineMayAddLater');
  });

  it('fails tsc at the producer — the channel that outranks the parse here', () => {
    const context: HookContext = {
      object: 'account',
      event: 'beforeInsert',
      input: {},
      session: {
        userId: 'user_123',
        // @ts-expect-error — `session.roles` was retired in #5050; the input type is `never`.
        roles: ['admin'],
      },
      ql: {},
    };

    // ...and the same directive holds for the shape ObjectQL builds, which is
    // the site that would have had to start producing the key for any reader
    // to ever see it.
    const built: NonNullable<HookContext['session']> = {
      userId: 'user_123',
      organizationId: 'org_456',
      // @ts-expect-error — `buildSession()` never wrote this, and now it cannot.
      roles: [],
    };

    expect(() => HookContextSchema.parse(context)).toThrow(/session\.roles/s);
    expect(built.userId).toBe('user_123');
  });
});

/**
 * `HookContext.session.positions` / `.preserveAudit` declaration (#5605,
 * maintainer ruling A of 2026-08-06).
 *
 * The MIRROR of the retirement above, and the reason both blocks live in this
 * file: `roles` was declared-never-produced (delete it), these two are
 * produced-never-declared (declare them). Same `session` object, opposite
 * drift, opposite fix — which is why #5605 was filed apart from #5050 rather
 * than folded into it.
 *
 * What was actually broken before the declaration, on `origin/main`:
 *
 *   - PARSE — `HookContextSchema` is deliberately non-strict (see the
 *     `hook.zod.ts` header), so both keys were silently STRIPPED. Measured
 *     before the change: parsing a session of
 *     `{ userId, positions, preserveAudit }` returned `{"userId":"u1"}`. That
 *     is not hypothetical: the generated reference page documents
 *     `HookContextSchema.parse(data)` as the way to consume a context, so a
 *     consumer following the docs dropped the caller's positions on the floor.
 *   - TSC — a handler typed the way `content/docs/automation/index.mdx` teaches,
 *     `(ctx: HookContext)`, could not read either key: two TS2339s, on
 *     `ctx.session?.positions` and `ctx.session?.preserveAudit`. The two
 *     `runtime-services` pages that teach `positions: ctx.session?.positions`
 *     only look fine because they annotate `ctx` as `any` — copy the code AND
 *     the documented annotation and it did not compile.
 *
 * REVERSE VERIFICATION, direction predicted first: delete either declaration
 * from `hook.zod.ts` and this block fails BOTH ways — the parse assertions go
 * red (the key is stripped, so `toHaveProperty` fails), and
 * `pnpm --filter @objectstack/spec typecheck` reports TS2339 on the typed
 * reads below. No `@ts-expect-error` is involved here and none should be
 * added: the fact under test is that documented code COMPILES, so the pin is
 * a positive typed read, and its failure mode on revert is a hard type error
 * rather than an unused-directive TS2578.
 *
 * Boundary, restated because it is the whole reason the ruling needed a
 * maintainer: `positions` is readable context, NOT an authorization input.
 * The `.describe()` says so and the assertion below pins that it keeps saying
 * so — the next author (or the next AI) reaching for
 * `session.positions.includes(...)` as an access check is exactly what the
 * `roles` tombstone above was written to stop.
 */
describe('session.positions / session.preserveAudit declaration (#5605)', () => {
  it('PRESERVES `positions` through a parse instead of stripping it', () => {
    const context = HookContextSchema.parse({
      object: 'account',
      event: 'beforeUpdate',
      input: {},
      session: { userId: 'user_123', positions: ['sales_manager', 'org_admin'] },
      ql: {},
    });

    expect(context.session).toHaveProperty('positions');
    expect(context.session?.positions).toEqual(['sales_manager', 'org_admin']);
  });

  it('PRESERVES `preserveAudit` through a parse (#3493 has a live consumer)', () => {
    const context = HookContextSchema.parse({
      object: 'account',
      event: 'beforeInsert',
      input: {},
      session: { userId: 'user_123', preserveAudit: true },
      ql: {},
    });

    expect(context.session).toHaveProperty('preserveAudit');
    expect(context.session?.preserveAudit).toBe(true);
  });

  it('keeps both OPTIONAL — a normal write produces neither', () => {
    // `buildSession()` writes `preserveAudit` only under the historical-import
    // opt-in, and `positions` is absent whenever the execution context carried
    // none. Declaring them must not start requiring them.
    //
    // ⚠️ HONEST NOTE — this one is a COMPANION, not a pin. It asserts absence,
    // and absence is also what a stripped (undeclared) key produces, so it
    // stayed green under the reverse verification while its four siblings went
    // red. It is kept because "declaring them did not make them required" is a
    // real regression it would catch (a missing `.optional()` turns it red),
    // but it is not evidence that the declaration exists — do not read it as
    // such. The pins are the two preserve tests, the `buildSession()` shape,
    // and the tsc read below.
    const context = HookContextSchema.parse({
      object: 'account',
      event: 'beforeInsert',
      input: {},
      session: { userId: 'user_123' },
      ql: {},
    });

    expect(context.session?.positions).toBeUndefined();
    expect(context.session?.preserveAudit).toBeUndefined();
  });

  it('accepts the exact session shape `buildSession()` builds', () => {
    // Field-for-field the object ObjectQL assembles (engine.ts `buildSession`)
    // for a historical import by an authenticated caller. Before #5605 this
    // parse quietly returned a session two keys shorter than the one the
    // engine handed the handler.
    const built = {
      userId: 'user_123',
      organizationId: 'org_456',
      positions: ['sales_manager'],
      accessToken: 'token_abc123',
      isSystem: true,
      actor: 'svc:flow:import_history',
      skipTriggers: true,
      skipAutomations: true,
      preserveAudit: true,
    };

    const context = HookContextSchema.parse({
      object: 'account',
      event: 'beforeInsert',
      input: {},
      session: built,
      ql: {},
    });

    expect(context.session).toEqual(built);
  });

  it('type-checks the code the docs teach — `(ctx: HookContext)` reading both keys', () => {
    // The TSC channel. Both reads were TS2339 before the declaration; this is
    // `content/docs/kernel/runtime-services/sharing-service.mdx`'s snippet with
    // the `any` annotation removed, which is what made the omission invisible
    // there. Explicit annotations, so a widened or renamed declaration fails
    // here too rather than being absorbed by inference.
    const readCallerContext = (ctx: HookContext) => {
      const positions: string[] | undefined = ctx.session?.positions;
      const preserveAudit: boolean | undefined = ctx.session?.preserveAudit;
      return { positions, preserveAudit };
    };

    // ...and the PRODUCER side: the literal `buildSession()` returns must be
    // assignable to the declared session type.
    const session: NonNullable<HookContext['session']> = {
      userId: 'user_123',
      positions: ['sales_manager'],
      preserveAudit: true,
    };

    expect(readCallerContext({
      object: 'account',
      event: 'beforeUpdate',
      input: {},
      session,
      ql: {},
    })).toEqual({ positions: ['sales_manager'], preserveAudit: true });
  });

  it('carries the "not an authorization input" boundary in the `.describe()`', () => {
    // The ruling's wording is load-bearing, not decoration: it is the only
    // thing standing between this key and the next author using it as an
    // access check. A `.describe()` reaches the generated reference page and
    // every schema-driven surface, so pin that the boundary survives edits.
    const sessionShape = HookContextSchema.shape.session.unwrap().shape;

    const positionsDoc = sessionShape.positions.description ?? '';
    expect(positionsDoc).toMatch(/security service/i);
    expect(positionsDoc).toMatch(/not an authorization input/i);

    const preserveAuditDoc = sessionShape.preserveAudit.description ?? '';
    expect(preserveAuditDoc).toMatch(/not an authorization input/i);
  });
});

/**
 * `HookContext.api` is typed as {@link IScopedContext} (#5945, maintainer
 * ruling C of 2026-08-07).
 *
 * The THIRD entry in this file's drift family, and the one whose two ends both
 * pointed the same way: `session.roles` was declared-never-produced (removed),
 * `session.positions` / `.preserveAudit` were produced-never-declared
 * (declared), and `api` was produced, DOCUMENTED, and typed `unknown` — so the
 * documentation's primary data channel could not be called from the annotation
 * the documentation itself teaches:
 *
 *     error TS18046: 'ctx.api' is of type 'unknown'.    // ctx.api.object('x')
 *
 * measured on `origin/main` and reproduced by reverting this change (the exact
 * diagnostics, chained and unchained, are tabulated in
 * `contracts/scoped-context.test.ts`, which owns the COMPILE half of the pin).
 * What lives here is the half that belongs to the schema: the change is
 * type-only, and the runtime must be able to prove it.
 *
 * REVERSE VERIFICATION, direction predicted then measured: restoring
 * `z.unknown()` leaves every assertion in THIS block green — `z.custom()` with
 * no validator and `z.unknown()` accept exactly the same values, which is the
 * point of choosing it. The block is a REGRESSION guard, not evidence that the
 * type landed; the pins for that are in `scoped-context.test.ts`. Said out loud
 * because a green companion test read as a pin is how #5605's third assertion
 * nearly got over-credited.
 */
describe('HookContext.api typing (#5945)', () => {
  /** Shaped like ObjectQL's `ScopedContext` — a live object, not authored data. */
  const liveApi = {
    object: (_name: string) => ({
      find: async () => [],
      findOne: async () => null,
      count: async () => 0,
      insert: async (data: unknown) => data,
      update: async (data: unknown) => data,
      updateById: async (id: string | number, data: object) => ({ id, ...data }),
    }),
    transaction: async (cb: (tx: unknown, info: { owned: boolean }) => unknown) => cb(liveApi, { owned: true }),
    sudo: () => liveApi,
  };

  it('still accepts a live engine object, and hands back the SAME instance', () => {
    // `z.custom()` with no validator neither rejects nor clones. Identity is
    // the load-bearing assertion: a copied `api` would be a repository whose
    // closures point at the wrong execution context, which no shape check
    // could see.
    const context = HookContextSchema.parse({
      object: 'account',
      event: 'beforeInsert',
      input: {},
      api: liveApi,
      ql: {},
    });

    expect(context.api).toBe(liveApi);
  });

  it('stays OPTIONAL — a context built without an engine still parses', () => {
    // Every `buildHookApi` dispatch site sets it, but making it required would
    // start rejecting the partial contexts this schema accepts today (and that
    // this file's own older tests build). Declaring the type must not change
    // what parses.
    const context = HookContextSchema.parse({
      object: 'account',
      event: 'beforeInsert',
      input: {},
      ql: {},
    });

    expect(context.api).toBeUndefined();
  });

  it('accepts the values `z.unknown()` accepted — the change is type-only', () => {
    for (const api of [undefined, null, 42, 'nope', {}, liveApi]) {
      expect(() => HookContextSchema.parse({
        object: 'account', event: 'beforeInsert', input: {}, api, ql: {},
      })).not.toThrow();
    }
  });

  it('type-checks the code the docs teach — `(ctx: HookContext)` calling ctx.api', () => {
    // The TSC channel, and the reason this block is in a file `tsconfig.test.json`
    // compiles (#5286). Every line below was TS18046 or TS2339-on-`{}` before
    // the declaration. Explicit annotations, so a widened or renamed
    // declaration fails here rather than being absorbed by inference.
    const crossObjectRead = async (ctx: HookContext) => {
      const owner: unknown = await ctx.api?.object('user').findOne({
        where: { id: ctx.input.owner_id },
      });
      const open: number | undefined = await ctx.api?.object('task').count({
        where: { done: false },
      });
      await ctx.api?.object('audit_log').insert({ object_type: ctx.object });
      return { owner, open };
    };

    // ...and the transaction shape the docs teach: objects are reached through
    // the CALLBACK's context, which must itself be an IScopedContext.
    const transactional = async (ctx: HookContext) => ctx.api?.transaction(async (tx) => {
      await tx.object('task').insert({ title: 'kickoff' });
      return tx.object('project').update({ id: 'p1', task_count: 1 });
    });

    expect(typeof crossObjectRead).toBe('function');
    expect(typeof transactional).toBe('function');
  });

  it('names the contract in the `.describe()`, so the generated reference does too', () => {
    // `api`'s JSON Schema is `{}` either way, so the generated reference row
    // renders its TYPE as `any` in both states — the description is the only
    // channel that page has for saying what the value actually is.
    const doc = HookContextSchema.shape.api.description ?? '';
    expect(doc).toContain('IScopedContext');
    expect(doc).toContain('object(name)');
    expect(doc).toContain('transaction(cb)');
  });
});
