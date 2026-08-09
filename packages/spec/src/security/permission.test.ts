import { describe, it, expect } from 'vitest';
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
