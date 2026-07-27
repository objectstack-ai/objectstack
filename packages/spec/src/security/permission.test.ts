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
    // The authoring schema stays unextended — a stray apiOperations key is
    // stripped (or rejected) there, never a valid authoring field.
    const parsed = ObjectPermissionSchema.parse({ allowRead: true, apiOperations: ['get'] } as any);
    expect((parsed as any).apiOperations).toBeUndefined();
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
