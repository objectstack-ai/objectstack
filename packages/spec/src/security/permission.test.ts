import { describe, it, expect, vi } from 'vitest';
import {
  PermissionSetSchema,
  ObjectPermissionSchema,
  EffectiveObjectPermissionSchema,
  FieldPermissionSchema,
  AdminScopeSchema,
  type PermissionSet,
  type ObjectPermission,
  type FieldPermission,
} from './permission.zod';
import { ObjectStackDefinitionSchema } from '../stack.zod';

describe('AdminScopeSchema (ADR-0090 D12)', () => {
  it('parses a delegated-admin scope with defaults', () => {
    const scope = AdminScopeSchema.parse({ businessUnit: 'east' });
    expect(scope.businessUnit).toBe('east');
    expect(scope.includeSubtree).toBe(true); // default: whole subtree
    expect(scope.manageAssignments).toBe(false);
    expect(scope.manageBindings).toBe(false);
    expect(scope.authorEnvironmentSets).toBe(false);
    expect(scope.assignablePermissionSets).toEqual([]);
  });

  it('rides on a permission set via adminScope', () => {
    const ps = PermissionSetSchema.parse({
      name: 'east_subsidiary_admin',
      objects: {
        sys_user_position: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
      },
      adminScope: {
        businessUnit: 'east',
        manageAssignments: true,
        assignablePermissionSets: ['sales_user', 'support_user'],
      },
    });
    expect(ps.adminScope?.businessUnit).toBe('east');
    expect(ps.adminScope?.manageAssignments).toBe(true);
    expect(ps.adminScope?.assignablePermissionSets).toEqual(['sales_user', 'support_user']);
  });

  it('requires the businessUnit boundary', () => {
    expect(() => AdminScopeSchema.parse({ manageAssignments: true })).toThrow();
  });
});

describe('ObjectPermissionSchema', () => {
  it('should apply default values to false', () => {
    const result = ObjectPermissionSchema.parse({});

    expect(result.allowCreate).toBe(false);
    expect(result.allowRead).toBe(false);
    expect(result.allowEdit).toBe(false);
    expect(result.allowDelete).toBe(false);
    expect(result.viewAllRecords).toBe(false);
    expect(result.modifyAllRecords).toBe(false);
  });

  it('allowExport is optional with no default — unset stays undefined (#3544)', () => {
    // Deliberately NOT defaulted: unset = inherit read (backward-compatible
    // opt-out), so adding the key changes nothing for existing permission sets.
    const result = ObjectPermissionSchema.parse({});
    expect(result.allowExport).toBeUndefined();
    expect(ObjectPermissionSchema.parse({ allowExport: false }).allowExport).toBe(false);
    expect(ObjectPermissionSchema.parse({ allowExport: true }).allowExport).toBe(true);
  });

  it('should accept CRUD permissions', () => {
    const permission: ObjectPermission = {
      allowCreate: true,
      allowRead: true,
      allowEdit: true,
      allowDelete: true,
    };

    expect(() => ObjectPermissionSchema.parse(permission)).not.toThrow();
  });

  it('should accept view all permissions', () => {
    const permission: ObjectPermission = {
      allowRead: true,
      viewAllRecords: true,
    };

    expect(() => ObjectPermissionSchema.parse(permission)).not.toThrow();
  });

  it('should accept modify all permissions', () => {
    const permission: ObjectPermission = {
      allowEdit: true,
      allowDelete: true,
      modifyAllRecords: true,
    };

    expect(() => ObjectPermissionSchema.parse(permission)).not.toThrow();
  });

  it('should accept read-only permissions', () => {
    const permission: ObjectPermission = {
      allowRead: true,
      allowCreate: false,
      allowEdit: false,
      allowDelete: false,
    };

    const result = ObjectPermissionSchema.parse(permission);
    expect(result.allowRead).toBe(true);
    expect(result.allowCreate).toBe(false);
  });
});

describe('allowRestore / allowPurge are RETIRED (#12497, ADR-0049)', () => {
  // Removed by the 2026-08-26 maintainer ruling accepting #1883's
  // recommendation B: the `restore`/`purge` ObjectQL operations the bits
  // claimed to gate have never existed (no destructive lifecycle verb in the
  // engine's dispatch vocabulary — the #8106 pin), so granting them delivered
  // nothing. The tombstone keeps the removal audible instead of silently
  // stripping an authored value; the keys return with the M2 lifecycle
  // initiative (#1883 stays open).

  it('absent parses clean — no defaults materialize for the retired keys', () => {
    const parsed = ObjectPermissionSchema.parse({ allowRead: true });
    expect('allowRestore' in parsed, 'retired key contributes nothing to the parsed output').toBe(false);
    expect('allowPurge' in parsed, 'retired key contributes nothing to the parsed output').toBe(false);
  });

  it('non-default values reject with the prescription (not a bare strict error)', () => {
    // [#12840] Only `true` is a dead AUTHORED claim now — `false` is the
    // default the published 17.x toolchain materialized into every built
    // artifact, ruled inert residue (accepted and stripped; matrix below).
    for (const key of ['allowRestore', 'allowPurge'] as const) {
      const r = ObjectPermissionSchema.safeParse({ [key]: true } as never);
      expect(r.success).toBe(false);
      const messages = r.error!.issues.map((i) => i.message).join('\n');
      expect(messages).toContain('#12497');
      expect(messages).toContain('removed in @objectstack/spec 17');
      expect(messages).toContain('Delete the key');
      expect(messages).toContain('M2');
    }
  });

  it('[#12840] the refusal is the tombstone byte-for-byte — guidance text, expected: never, located path', () => {
    // The #12497 refusal shape was measured as
    // `{ expected: 'never', code: 'invalid_type', path: […, key], message: <guidance> }`.
    // The residue stage must not touch it: a non-default value never enters
    // the strip, so the issue is the tombstone's own. The guidance is read
    // back from the tombstone's `[REMOVED] ` describe — the single source —
    // so this pin proves refusal text === declared prescription, byte for byte.
    for (const key of ['allowRestore', 'allowPurge'] as const) {
      const declared = (ObjectPermissionSchema.shape[key].description ?? '').replace(/^\[REMOVED\] /, '');
      expect(declared).toContain('#12497');
      const r = ObjectPermissionSchema.safeParse({ allowRead: true, [key]: true } as never);
      expect(r.success).toBe(false);
      const issue = r.error!.issues.find((i) => i.path[i.path.length - 1] === key)!;
      expect(issue).toBeDefined();
      expect((issue as { expected?: string }).expected).toBe('never');
      expect(issue.code).toBe('invalid_type');
      expect(issue.message).toBe(declared);
    }
  });

  it('the bare verbs carry the prescription too, never a rename onto a tombstone', () => {
    // `restore`/`purge` were ALIASES of the retired bits; an alias may only
    // prescribe a key the shape accepts (#5013), so both verbs moved to
    // `guidance` and answer with the retirement instead of a dead-end rename.
    for (const key of ['restore', 'purge'] as const) {
      const r = ObjectPermissionSchema.safeParse({ [key]: true } as never);
      expect(r.success).toBe(false);
      const messages = r.error!.issues.map((i) => i.message).join('\n');
      expect(messages).toContain('#12497');
      expect(messages).not.toContain(`\`${key}\` → \``);
    }
  });

  it('the tombstone rides into the EffectiveObjectPermission clone', () => {
    // `.extend()` shares the authoring shape's per-property instances, so the
    // response-side def carries the same `[RETIRED]` row in the authorable
    // surface — and a DECLARED-never key is refused there even though the
    // schema `.strip()`s unknown keys (declared ≠ unknown). [#12840] narrowed
    // the refusal to NON-default values: a server still on the published 17.x
    // toolchain DOES emit the bit at its materialized default (`false`), so
    // that residue is accepted-and-stripped (matrix below) while `true` keeps
    // this refusal.
    const r = EffectiveObjectPermissionSchema.safeParse({ allowRead: true, allowRestore: true } as never);
    expect(r.success).toBe(false);
  });
});

describe('[#12840] the RETIRED DEFAULT parses as inert residue and strips (class rule)', () => {
  // Maintainer ruling 2026-08-28, recorded on objectstack-ai/cloud#1685: a
  // retired key that had a schema default is refused only when it carries a
  // NON-default value. The published `@objectstack/spec` 17.x still emitted
  // `z.boolean().default(false)` for `allowRestore`/`allowPurge`, so every
  // artifact the released toolchain built carries both keys as `false` in
  // every permission entry — 75 occurrences in the measured HotCRM artifact,
  // whose sources declare neither. Refusing the emitted default sentences
  // every existing built artifact to death on the next runtime upgrade.

  /** The published-toolchain shape, verbatim from the cloud#1685 measurement. */
  const publishedToolchainEntry = {
    allowCreate: true,
    allowRead: true,
    allowEdit: true,
    allowDelete: true,
    allowRestore: false,
    allowPurge: false,
  };

  it('accepts the emitted default and STRIPS it — the parsed output carries neither key', () => {
    const r = ObjectPermissionSchema.safeParse(publishedToolchainEntry as never);
    expect(r.success).toBe(true);
    expect('allowRestore' in r.data!, 'residue must not survive into the normalized output').toBe(false);
    expect('allowPurge' in r.data!, 'residue must not survive into the normalized output').toBe(false);
    expect(r.data!.allowCreate).toBe(true);
    expect(r.data!.allowDelete).toBe(true);
  });

  it('each key strips independently', () => {
    for (const key of ['allowRestore', 'allowPurge'] as const) {
      const r = ObjectPermissionSchema.safeParse({ allowRead: true, [key]: false } as never);
      expect(r.success).toBe(true);
      expect(key in r.data!).toBe(false);
    }
  });

  it('parse → serialize → parse is a fixpoint without the keys (no re-emission)', () => {
    const first = ObjectPermissionSchema.parse(publishedToolchainEntry as never);
    const serialized = JSON.parse(JSON.stringify(first)) as Record<string, unknown>;
    expect('allowRestore' in serialized).toBe(false);
    expect('allowPurge' in serialized).toBe(false);
    const second = ObjectPermissionSchema.parse(serialized as never);
    expect(JSON.parse(JSON.stringify(second))).toEqual(serialized);
  });

  it('tolerates ONLY the captured retired default — every other value keeps the loud refusal', () => {
    // The helper contract: the residue value is the literal captured at
    // retirement time (`false`), compared by identity. Falsy near-misses are
    // NOT the emitted default and land on the tombstone like any authored value.
    for (const wrong of [true, 0, '', null, 'false'] as const) {
      const r = ObjectPermissionSchema.safeParse({ allowRestore: wrong } as never);
      expect(r.success, `value ${JSON.stringify(wrong)} must NOT be tolerated`).toBe(false);
      expect(r.error!.issues.map((i) => i.message).join('\n')).toContain('#12497');
    }
  });

  it('the residue strips inside a full permission-set / stack-shaped parse (the artifact path)', () => {
    // The measured refusal was located at
    // `permissions[5].objects.crm_campaign_member.allowRestore` — a composed
    // artifact's permission collection. The tolerance rides the SAME nested
    // schema, so the stack-shaped parse accepts and normalizes it.
    const set = PermissionSetSchema.parse({
      name: 'system_admin',
      objects: {
        crm_campaign_member: publishedToolchainEntry,
        crm_note: { allowRead: true },
      },
    } as never);
    expect('allowRestore' in set.objects.crm_campaign_member!).toBe(false);
    expect('allowPurge' in set.objects.crm_campaign_member!).toBe(false);
    expect(set.objects.crm_campaign_member!.allowEdit).toBe(true);
  });

  it('the composed-artifact door accepts the measured refusal shape at its exact path', () => {
    // cloud#1672's red step died on the composed HotCRM artifact at
    // `permissions[5].objects.crm_campaign_member.allowRestore`
    // (`expected: 'never'`). Reproduce that exact coordinate through the
    // artifact's own door (`ObjectStackDefinitionSchema`): five sets ahead,
    // the sixth carrying the published-toolchain entry — and assert the parse
    // now accepts it and the normalized artifact carries neither key.
    const filler = Array.from({ length: 5 }, (_, i) => ({
      name: `filler_set_${i}`,
      objects: { crm_note: { allowRead: true } },
    }));
    const artifact = ObjectStackDefinitionSchema.parse({
      permissions: [
        ...filler,
        { name: 'system_admin', objects: { crm_campaign_member: publishedToolchainEntry } },
      ],
    } as never);
    const entry = artifact.permissions![5]!.objects.crm_campaign_member!;
    expect('allowRestore' in entry).toBe(false);
    expect('allowPurge' in entry).toBe(false);
    expect(entry.allowDelete).toBe(true);
  });

  it('a 75-occurrence artifact parses with NO warning storm (the strip is silent)', () => {
    // Real artifacts carry the residue once per permission entry (75 in the
    // HotCRM measurement). The ruled bound is "at most low-noise, never
    // per-occurrence storms"; the implementation chooses silence — a schema
    // parse has no notice channel, and the loud channels for authored sources
    // (tsc `never`, the D2 conversion, `os migrate meta`) are untouched.
    const spies = (['warn', 'error', 'info', 'log'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {}),
    );
    try {
      const objects: Record<string, unknown> = {};
      for (let i = 0; i < 38; i++) objects[`obj_${i}`] = { ...publishedToolchainEntry };
      const parsed = PermissionSetSchema.parse({ name: 'wide_set', objects } as never);
      expect(Object.keys(parsed.objects)).toHaveLength(38);
      for (const entry of Object.values(parsed.objects)) {
        expect('allowRestore' in entry!).toBe(false);
        expect('allowPurge' in entry!).toBe(false);
      }
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it('an entry WITHOUT residue passes through by reference (copy-on-write)', () => {
    // The strip clones only when it removes something — an artifact already on
    // the clean shape is not rewritten on its way through.
    const clean = { allowRead: true };
    const r = ObjectPermissionSchema.safeParse(clean as never);
    expect(r.success).toBe(true);
  });

  it('the wire clone tolerates the same residue (an older server emits the defaults)', () => {
    const r = EffectiveObjectPermissionSchema.safeParse({
      allowRead: true,
      allowRestore: false,
      allowPurge: false,
      apiOperations: ['get', 'list'],
    } as never);
    expect(r.success).toBe(true);
    expect('allowRestore' in r.data!).toBe(false);
    expect('allowPurge' in r.data!).toBe(false);
    expect(r.data!.apiOperations).toEqual(['get', 'list']);
  });

  it('the authoring surface stays retired: the shape still declares the tombstones', () => {
    // Nothing is un-retired — the walked shape keeps the `[REMOVED]` rows
    // (authorable-surface + JSON-schema artifacts publish the tombstone), and
    // `z.input` keeps the keys `never` so writing one in TypeScript source
    // fails `tsc` exactly as #12497 ruled. (The `as never` casts across this
    // file are that channel, exercised.)
    for (const key of ['allowRestore', 'allowPurge'] as const) {
      expect(ObjectPermissionSchema.shape[key].description).toMatch(/^\[REMOVED\] /);
    }
    // The compile channel, pinned: the residue tolerance is RUNTIME-only, so
    // the input type still refuses the key — hand-authoring even the retired
    // default in TypeScript source stays a tsc error.
    // @ts-expect-error — `allowRestore` stays unwritable on ObjectPermission (#12497, unchanged by #12840)
    const typeChannel: ObjectPermission = { allowRead: true, allowRestore: false };
    void typeChannel;
  });
});

describe('EffectiveObjectPermissionSchema (#3391 response-side)', () => {
  it('carries every ObjectPermission field plus optional apiOperations', () => {
    const parsed = EffectiveObjectPermissionSchema.parse({
      allowRead: true,
      allowCreate: true,
      apiOperations: ['get', 'list', 'create', 'update', 'delete', 'bulk'],
    });
    expect(parsed.allowRead).toBe(true);
    expect(parsed.apiOperations).toEqual(['get', 'list', 'create', 'update', 'delete', 'bulk']);
  });

  it('apiOperations is optional (absent = client default-allow)', () => {
    const parsed = EffectiveObjectPermissionSchema.parse({ allowRead: true });
    expect(parsed.apiOperations).toBeUndefined();
    expect(parsed.allowRead).toBe(true);
  });

  it('rejects an apiOperations value outside the ApiMethod enum', () => {
    expect(
      EffectiveObjectPermissionSchema.safeParse({ allowRead: true, apiOperations: ['frobnicate'] }).success,
    ).toBe(false);
  });

  it('accepts the derived legacy operations (import/export/aggregate/…)', () => {
    expect(
      EffectiveObjectPermissionSchema.safeParse({
        allowRead: true,
        apiOperations: ['get', 'list', 'aggregate', 'search', 'export', 'import', 'upsert'],
      }).success,
    ).toBe(true);
  });

  it('does not leak apiOperations onto the authoring ObjectPermissionSchema', () => {
    // The authoring schema stays unextended — since #4001 a stray apiOperations
    // key is REJECTED there (loud, with the response-side pointer), never a
    // valid authoring field and no longer a silent strip.
    const result = ObjectPermissionSchema.safeParse({ allowRead: true, apiOperations: ['get'] } as any);
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.code === 'unrecognized_keys');
    expect(issue!.message).toContain('`apiOperations`');
    expect(issue!.message).toContain('RESPONSE surface');
  });

  it('EffectiveObjectPermissionSchema stays wire-tolerant (strips, never rejects)', () => {
    // `.extend()` inherits `.strict()`, so the response shape explicitly
    // `.strip()`s back — a newer server adding a response key must not crash
    // an older parser (#4001 authorable/wire split).
    const parsed = EffectiveObjectPermissionSchema.parse({
      allowRead: true,
      apiOperations: ['get'],
      someFutureServerKey: true,
    } as any);
    expect((parsed as any).someFutureServerKey).toBeUndefined();
    expect((parsed as any).allowRead).toBe(true);
  });
});

describe('FieldPermissionSchema', () => {
  it('should default readable to true', () => {
    const result = FieldPermissionSchema.parse({});
    
    expect(result.readable).toBe(true);
    expect(result.editable).toBe(false);
  });

  it('should accept read-only field permission', () => {
    const permission: FieldPermission = {
      readable: true,
      editable: false,
    };

    expect(() => FieldPermissionSchema.parse(permission)).not.toThrow();
  });

  it('should accept editable field permission', () => {
    const permission: FieldPermission = {
      readable: true,
      editable: true,
    };

    expect(() => FieldPermissionSchema.parse(permission)).not.toThrow();
  });

  it('should accept hidden field', () => {
    const permission: FieldPermission = {
      readable: false,
      editable: false,
    };

    expect(() => FieldPermissionSchema.parse(permission)).not.toThrow();
  });
});

describe('PermissionSetSchema', () => {
  it('should accept minimal permission set', () => {
    const permSet: PermissionSet = {
      name: 'standard_user',
      objects: {},
    };

    expect(() => PermissionSetSchema.parse(permSet)).not.toThrow();
  });

  it('should default isDefault to false', () => {
    const permSet = {
      name: 'export_reports',
      objects: {},
    };

    const result = PermissionSetSchema.parse(permSet);
    expect(result.isDefault).toBe(false);
  });

  it('should accept permission set with label', () => {
    const permSet: PermissionSet = {
      name: 'sales_user',
      label: 'Sales User',
      objects: {},
    };

    expect(() => PermissionSetSchema.parse(permSet)).not.toThrow();
  });

  it('should accept profile permission set', () => {
    const profile: PermissionSet = {
      name: 'system_admin',
      label: 'System Administrator',
      objects: {},
    };

    expect(() => PermissionSetSchema.parse(profile)).not.toThrow();
  });

  it('should accept permission set with object permissions', () => {
    const permSet: PermissionSet = {
      name: 'sales_manager',
      label: 'Sales Manager',
      objects: {
        account: {
          allowCreate: true,
          allowRead: true,
          allowEdit: true,
          allowDelete: false,
          viewAllRecords: true,
          modifyAllRecords: false,
        },
        opportunity: {
          allowCreate: true,
          allowRead: true,
          allowEdit: true,
          allowDelete: true,
          viewAllRecords: true,
          modifyAllRecords: true,
        },
        contact: {
          allowCreate: true,
          allowRead: true,
          allowEdit: true,
          allowDelete: false,
        },
      },
    };

    expect(() => PermissionSetSchema.parse(permSet)).not.toThrow();
  });

  it('should accept permission set with field permissions', () => {
    const permSet: PermissionSet = {
      name: 'restricted_user',
      objects: {
        account: {
          allowRead: true,
        },
      },
      fields: {
        'account.annual_revenue': {
          readable: false,
          editable: false,
        },
        'account.account_number': {
          readable: true,
          editable: false,
        },
      },
    };

    expect(() => PermissionSetSchema.parse(permSet)).not.toThrow();
  });

  it('should accept permission set with system permissions', () => {
    const permSet: PermissionSet = {
      name: 'admin_tools',
      label: 'Admin Tools',
      objects: {},
      systemPermissions: [
        'manage_users',
        'view_setup',
        'customize_application',
        'modify_all_data',
      ],
    };

    expect(() => PermissionSetSchema.parse(permSet)).not.toThrow();
  });

  describe('Real-World Permission Set Examples', () => {
    it('should accept system administrator profile', () => {
      const sysAdmin: PermissionSet = {
        name: 'system_administrator',
        label: 'System Administrator',
        objects: {
          user: {
            allowCreate: true,
            allowRead: true,
            allowEdit: true,
            allowDelete: true,
            viewAllRecords: true,
            modifyAllRecords: true,
          },
          account: {
            allowCreate: true,
            allowRead: true,
            allowEdit: true,
            allowDelete: true,
            viewAllRecords: true,
            modifyAllRecords: true,
          },
          opportunity: {
            allowCreate: true,
            allowRead: true,
            allowEdit: true,
            allowDelete: true,
            viewAllRecords: true,
            modifyAllRecords: true,
          },
        },
        systemPermissions: [
          'manage_users',
          'view_all_data',
          'modify_all_data',
          'customize_application',
          'view_setup',
          'manage_roles',
          'manage_profiles',
        ],
      };

      expect(() => PermissionSetSchema.parse(sysAdmin)).not.toThrow();
    });

    it('should accept standard sales user profile', () => {
      const salesUser: PermissionSet = {
        name: 'standard_sales_user',
        label: 'Standard Sales User',
        objects: {
          account: {
            allowCreate: true,
            allowRead: true,
            allowEdit: true,
            allowDelete: false,
          },
          contact: {
            allowCreate: true,
            allowRead: true,
            allowEdit: true,
            allowDelete: false,
          },
          opportunity: {
            allowCreate: true,
            allowRead: true,
            allowEdit: true,
            allowDelete: false,
          },
          lead: {
            allowCreate: true,
            allowRead: true,
            allowEdit: true,
            allowDelete: false,
          },
        },
        fields: {
          'opportunity.amount': {
            readable: true,
            editable: true,
          },
          'account.annual_revenue': {
            readable: true,
            editable: false,
          },
        },
      };

      expect(() => PermissionSetSchema.parse(salesUser)).not.toThrow();
    });

    it('should accept marketing user permission set', () => {
      const marketingPermSet: PermissionSet = {
        name: 'marketing_user',
        label: 'Marketing User',
        objects: {
          campaign: {
            allowCreate: true,
            allowRead: true,
            allowEdit: true,
            allowDelete: false,
          },
          lead: {
            allowCreate: true,
            allowRead: true,
            allowEdit: true,
            allowDelete: false,
          },
        },
        systemPermissions: [
          'run_reports',
          'export_reports',
          'manage_campaigns',
        ],
      };

      expect(() => PermissionSetSchema.parse(marketingPermSet)).not.toThrow();
    });

    it('should accept read-only analyst profile', () => {
      const analyst: PermissionSet = {
        name: 'read_only_analyst',
        label: 'Read Only Analyst',
        objects: {
          account: {
            allowRead: true,
            viewAllRecords: true,
          },
          opportunity: {
            allowRead: true,
            viewAllRecords: true,
          },
          contact: {
            allowRead: true,
            viewAllRecords: true,
          },
          task: {
            allowRead: true,
            viewAllRecords: true,
          },
        },
        systemPermissions: [
          'run_reports',
          'export_reports',
        ],
      };

      expect(() => PermissionSetSchema.parse(analyst)).not.toThrow();
    });

    it('should accept service agent profile with restricted fields', () => {
      const serviceAgent: PermissionSet = {
        name: 'service_agent',
        label: 'Service Agent',
        objects: {
          case: {
            allowCreate: true,
            allowRead: true,
            allowEdit: true,
            allowDelete: false,
          },
          account: {
            allowRead: true,
            allowEdit: false,
          },
          contact: {
            allowRead: true,
            allowEdit: false,
          },
        },
        fields: {
          'account.annual_revenue': {
            readable: false,
            editable: false,
          },
          'account.account_owner': {
            readable: true,
            editable: false,
          },
          'case.priority': {
            readable: true,
            editable: true,
          },
        },
        systemPermissions: [
          'view_knowledge_base',
        ],
      };

      expect(() => PermissionSetSchema.parse(serviceAgent)).not.toThrow();
    });
  });
});

// ============================================================================
// Protocol Improvement Tests: Permission tabPermissions
// ============================================================================

describe('PermissionSetSchema - tabPermissions', () => {
  it('should accept permission set with tabPermissions', () => {
    const result = PermissionSetSchema.parse({
      name: 'sales_user',
      objects: {
        account: { allowRead: true, allowCreate: true },
      },
      tabPermissions: {
        'app_crm': 'visible',
        'app_admin': 'hidden',
        'app_marketing': 'default_on',
        'app_support': 'default_off',
      },
    });
    expect(result.tabPermissions?.['app_crm']).toBe('visible');
    expect(result.tabPermissions?.['app_admin']).toBe('hidden');
    expect(result.tabPermissions?.['app_marketing']).toBe('default_on');
    expect(result.tabPermissions?.['app_support']).toBe('default_off');
  });

  it('should reject invalid tab permission values', () => {
    expect(() => PermissionSetSchema.parse({
      name: 'bad_perm',
      objects: {},
      tabPermissions: {
        'app_test': 'invalid_value',
      },
    })).toThrow();
  });

  it('should accept permission set without tabPermissions (optional)', () => {
    const result = PermissionSetSchema.parse({
      name: 'basic_user',
      objects: {
        task: { allowRead: true },
      },
    });
    expect(result.tabPermissions).toBeUndefined();
  });
});

// #4001 — the authorable permission surface is `.strict()`: an undeclared key
// used to be dropped by zod's default `.strip`, so the author believed a grant
// or restriction was in place that the runtime never saw (the ADR-0049
// asymmetry at the capability container itself). Strictness plus the shared
// `strictUnknownKeyError` factory turns that into a loud, fixable error.
describe('unknown keys are rejected, not stripped (#4001)', () => {
  const unknownKeyIssue = (schema: { safeParse: (v: unknown) => any }, value: unknown) => {
    const result = schema.safeParse(value);
    expect(result.success).toBe(false);
    return result.error!.issues.find((i: { code: string }) => i.code === 'unrecognized_keys');
  };

  describe('PermissionSetSchema', () => {
    it('rejects an undeclared key instead of silently dropping it', () => {
      const issue = unknownKeyIssue(PermissionSetSchema, {
        name: 'p', objects: {}, notAKey: true,
      });
      expect(issue!.message).toContain('`notAKey`');
    });

    it('points neighbouring-vocabulary spellings at the canonical key', () => {
      expect(unknownKeyIssue(PermissionSetSchema, { name: 'p', objects: {}, objectPermissions: {} })!.message)
        .toContain('`objectPermissions` → `objects`');
      expect(unknownKeyIssue(PermissionSetSchema, { name: 'p', objects: {}, rls: [] })!.message)
        .toContain('`rls` → `rowLevelSecurity`');
      expect(unknownKeyIssue(PermissionSetSchema, { name: 'p', objects: {}, tabs: {} })!.message)
        .toContain('`tabs` → `tabPermissions`');
    });

    it('carries the ADR-0105 D11 tombstone for the retired contextVariables', () => {
      const message = unknownKeyIssue(PermissionSetSchema, {
        name: 'p', objects: {}, contextVariables: { teams: ['a'] },
      })!.message;
      expect(message).toContain('ADR-0105 D11');
      expect(message).toContain('rlsMembership');
    });

    it('carries the ADR-0090 D2 tombstone for the retired isProfile', () => {
      const message = unknownKeyIssue(PermissionSetSchema, {
        name: 'p', objects: {}, isProfile: true,
      })!.message;
      expect(message).toContain('ADR-0090 D2');
      expect(message).toContain('`isDefault`');
    });

    it('round-trips the ADR-0010 runtime protection envelope', () => {
      // `MetadataPlugin`'s artifact loader calls `applyProtection` on EVERY
      // metadata type, and `getMetaItemLayered` → `saveMetaItem` round-trips a
      // body carrying the stamped envelope. Until #4001 the schema could not
      // represent these keys, so they were stripped at every parse.
      const parsed = PermissionSetSchema.parse({
        name: 'showcase_contributor',
        objects: {},
        _packageId: 'com.showcase',
        _packageVersion: '1.0.0',
        _provenance: 'package',
        _lock: 'full',
      });
      expect(parsed._packageId).toBe('com.showcase');
      expect(parsed._provenance).toBe('package');
      expect(parsed._lock).toBe('full');
    });

    it('points wrong-layer keys (profiles/roles/users) at the binding mechanism', () => {
      for (const key of ['profiles', 'roles', 'users']) {
        const message = unknownKeyIssue(PermissionSetSchema, {
          name: 'p', objects: {}, [key]: [],
        })!.message;
        expect(message, `\`${key}\` should carry guidance`).toContain(`\`${key}\` is not a PermissionSet field`);
      }
    });
  });

  describe('ObjectPermissionSchema', () => {
    it('points the bare CRUD verbs at the allow* bits', () => {
      expect(unknownKeyIssue(ObjectPermissionSchema, { read: true })!.message)
        .toContain('`read` → `allowRead`');
      expect(unknownKeyIssue(ObjectPermissionSchema, { edit: true })!.message)
        .toContain('`edit` → `allowEdit`');
      expect(unknownKeyIssue(ObjectPermissionSchema, { export: true })!.message)
        .toContain('`export` → `allowExport`');
      expect(unknownKeyIssue(ObjectPermissionSchema, { viewAll: true })!.message)
        .toContain('`viewAll` → `viewAllRecords`');
    });
  });

  describe('FieldPermissionSchema', () => {
    it('points read/write vocabulary at readable/editable', () => {
      expect(unknownKeyIssue(FieldPermissionSchema, { read: true })!.message)
        .toContain('`read` → `readable`');
      expect(unknownKeyIssue(FieldPermissionSchema, { write: true })!.message)
        .toContain('`write` → `editable`');
    });

    it('explains that FLS is declared positively for a `hidden` key', () => {
      expect(unknownKeyIssue(FieldPermissionSchema, { hidden: true })!.message)
        .toContain('`readable: false`');
    });
  });

  describe('AdminScopeSchema', () => {
    it('rejects an undeclared key with a typo suggestion', () => {
      expect(unknownKeyIssue(AdminScopeSchema, { businessUnit: 'east', business_unit: 'x' })!.message)
        .toContain('`business_unit` → `businessUnit`');
    });
  });
});

/**
 * [#6698] The `modifyAllRecords` `.describe()` is a published contract, not a
 * code comment: it is the field help Studio renders inline, and it is the cell
 * the generated `content/docs/references/security/permission.mdx` table carries
 * — so an author (very often an AI maintainer, ADR-0033) deciding whether this
 * bit covers their object reads THIS text and nothing else.
 *
 * It used to read `Modify All Data (Bypass Sharing)` beside a JSDoc block
 * promising a bypass of "Sharing Rules and Ownership checks". On an object with
 * NO owner field it bypasses neither: record sharing does not enforce there at
 * all (`checkEdit` / `checkDelete` answer `abstain` before the bypass is ever
 * probed, #6428), so the platform's own row-level write floor
 * `created_by == current_user.id` (#1985) survives and the by-id write is still
 * refused — measured and pinned in plugin-security's
 * `row-write-widener-composition.test.ts`.
 *
 * The assertions read the text back OUT of the schema and match the FACTS it
 * must carry rather than its wording: re-spell the qualification however reads
 * best and this stays green; drop it — or empty the `.describe()`, which is why
 * every assertion here is POSITIVE — and it goes red. Both halves are pinned on
 * purpose: a declaration that forgot to say the bit is a genuine super-user
 * bypass would be the opposite lie, since on the common owner-bearing object it
 * does exactly what it says.
 */
describe('[#6698] modifyAllRecords declares its bypass AND the limit of that bypass', () => {
  const description = ObjectPermissionSchema.shape.modifyAllRecords.description ?? '';

  /** Idioms that SCOPE the bypass to the objects record sharing enforces on. */
  const OWNERLESS_LIMIT =
    /owner-?less|no owner field|without an owner|objects (that )?(record )?sharing enforces on|as (record )?sharing computes/i;
  /** Idioms naming the gate that SURVIVES the bypass on such an object. */
  const SURVIVING_FLOOR = /created_by|ownership floor|write floor|abstain/i;

  it('still tells the author this is a super-user bypass, not an inert bit', () => {
    expect(description, 'modifyAllRecords must carry a description — it is the form field help')
      .not.toBe('');
    expect(description, 'the capability must stay nameable in the text').toMatch(/modify all data/i);
    expect(description, 'on an owner-bearing object the bypass is real and must stay legible')
      .toMatch(/bypass/i);
  });

  it('scopes the bypass to the objects record sharing actually enforces on', () => {
    expect(description, `no owner-less qualification found in: ${description}`)
      .toMatch(OWNERLESS_LIMIT);
  });

  it('discloses the platform write floor that survives on an owner-less object', () => {
    expect(description, `no surviving-floor disclosure found in: ${description}`)
      .toMatch(SURVIVING_FLOOR);
  });
});
