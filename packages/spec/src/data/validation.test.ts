import { describe, it, expect } from 'vitest';
import {
  ValidationRuleSchema,
  ScriptValidationSchema,
  StateMachineValidationSchema,
  FormatValidationSchema,
  JSONValidationSchema,
  CrossFieldValidationSchema,
  ConditionalValidationSchema,
  type ValidationRule,
} from './validation.zod';

describe('ScriptValidationSchema', () => {
  it('should accept valid script validation', () => {
    const scriptValidation = {
      type: 'script' as const,
      name: 'check_amount',
      message: 'Amount must be positive',
      condition: 'amount < 0',
    };

    expect(() => ScriptValidationSchema.parse(scriptValidation)).not.toThrow();
  });

  it('should apply default values', () => {
    const validation = {
      type: 'script' as const,
      name: 'test_validation',
      message: 'Validation failed',
      condition: 'true',
    };

    const result = ScriptValidationSchema.parse(validation);
    expect(result.active).toBe(true);
    expect(result.severity).toBe('error');
  });

  it('should accept custom severity levels', () => {
    const severityLevels = ['error', 'warning', 'info'] as const;
    
    severityLevels.forEach(severity => {
      const validation = {
        type: 'script' as const,
        name: 'test',
        message: 'Test',
        condition: 'false',
        severity,
      };

      const result = ScriptValidationSchema.parse(validation);
      expect(result.severity).toBe(severity);
    });
  });

  it('should enforce snake_case for validation name', () => {
    const validNames = ['check_amount', 'validate_email', '_internal'];
    validNames.forEach(name => {
      const validation = {
        type: 'script' as const,
        name,
        message: 'Test',
        condition: 'true',
      };
      expect(() => ScriptValidationSchema.parse(validation)).not.toThrow();
    });

    const invalidNames = ['checkAmount', 'Check-Amount', '123check'];
    invalidNames.forEach(name => {
      const validation = {
        type: 'script' as const,
        name,
        message: 'Test',
        condition: 'true',
      };
      expect(() => ScriptValidationSchema.parse(validation)).toThrow();
    });
  });
});

describe('StateMachineValidationSchema', () => {
  it('should accept valid state machine validation', () => {
    const stateMachine = {
      type: 'state_machine' as const,
      name: 'order_status_transitions',
      message: 'Invalid status transition',
      field: 'status',
      transitions: {
        draft: ['submitted', 'cancelled'],
        submitted: ['approved', 'rejected'],
        approved: ['shipped', 'cancelled'],
        shipped: ['delivered'],
        delivered: [],
        rejected: [],
        cancelled: [],
      },
    };

    expect(() => StateMachineValidationSchema.parse(stateMachine)).not.toThrow();
  });

  it('should accept simple state machine', () => {
    const simpleStateMachine = {
      type: 'state_machine' as const,
      name: 'task_status',
      message: 'Cannot change task status',
      field: 'status',
      transitions: {
        open: ['in_progress', 'closed'],
        in_progress: ['open', 'closed'],
        closed: [],
      },
    };

    expect(() => StateMachineValidationSchema.parse(simpleStateMachine)).not.toThrow();
  });
});

describe('FormatValidationSchema', () => {
  it('should accept format validation with predefined format', () => {
    const formats = ['email', 'url', 'phone', 'json'] as const;
    
    formats.forEach(format => {
      const validation = {
        type: 'format' as const,
        name: `validate_${format}`,
        message: `Invalid ${format}`,
        field: 'test_field',
        format,
      };

      expect(() => FormatValidationSchema.parse(validation)).not.toThrow();
    });
  });

  it('should accept format validation with regex', () => {
    const regexValidation = {
      type: 'format' as const,
      name: 'validate_zipcode',
      message: 'Invalid ZIP code',
      field: 'zipcode',
      regex: '^[0-9]{5}(-[0-9]{4})?$',
    };

    expect(() => FormatValidationSchema.parse(regexValidation)).not.toThrow();
  });

  it('should accept format validation with both regex and format', () => {
    const mixedValidation = {
      type: 'format' as const,
      name: 'custom_email',
      message: 'Invalid email format',
      field: 'email',
      format: 'email' as const,
      regex: '^[a-z0-9._%+-]+@company\\.com$',
    };

    expect(() => FormatValidationSchema.parse(mixedValidation)).not.toThrow();
  });
});

describe('JSONValidationSchema', () => {
  it('should accept a valid json_schema rule', () => {
    const validation = {
      type: 'json_schema' as const,
      name: 'config_shape',
      message: 'Invalid config',
      field: 'config',
      schema: {
        type: 'object',
        properties: { port: { type: 'number' } },
        required: ['port'],
      },
    };

    expect(() => JSONValidationSchema.parse(validation)).not.toThrow();
  });

  it('should accept a json_schema rule via ValidationRuleSchema', () => {
    const validation = {
      type: 'json_schema' as const,
      name: 'config_shape',
      message: 'Invalid config',
      field: 'config',
      schema: {
        type: 'object',
        properties: { port: { type: 'number' } },
        required: ['port'],
      },
    };

    expect(() => ValidationRuleSchema.parse(validation)).not.toThrow();
  });

  it('should reject json_schema rule when field is missing', () => {
    const validation = {
      type: 'json_schema' as const,
      name: 'config_shape',
      message: 'Invalid config',
      schema: {
        type: 'object',
        properties: { port: { type: 'number' } },
        required: ['port'],
      },
    };

    expect(() => JSONValidationSchema.parse(validation)).toThrow();
  });
});

describe('ValidationRuleSchema (Discriminated Union)', () => {
  it('should accept all validation rule types', () => {
    const rules: ValidationRule[] = [
      {
        type: 'script',
        name: 'check_amount',
        message: 'Amount must be positive',
        condition: 'amount > 0',
      },
      {
        type: 'state_machine',
        name: 'status_flow',
        message: 'Invalid status transition',
        field: 'status',
        transitions: { open: ['closed'], closed: [] },
      },
      {
        type: 'format',
        name: 'email_format',
        message: 'Invalid email',
        field: 'email',
        format: 'email',
      },
    ];

    rules.forEach(rule => {
      expect(() => ValidationRuleSchema.parse(rule)).not.toThrow();
    });
  });

  it('should properly discriminate between rule types', () => {
    const scriptRule = {
      type: 'script' as const,
      name: 'test',
      message: 'Test',
      condition: 'true',
    };

    const result = ValidationRuleSchema.parse(scriptRule);
    expect(result.type).toBe('script');
    if (result.type === 'script') {
      expect(result.condition).toEqual({ dialect: 'cel', source: 'true' });
    }
  });

  describe('Real-World Validation Examples', () => {
    it('should accept opportunity validation rules', () => {
      const opportunityValidations: ValidationRule[] = [
        {
          type: 'script',
          name: 'amount_positive',
          message: 'Opportunity amount must be positive',
          condition: 'amount <= 0',
          severity: 'error',
        },
        {
          type: 'script',
          name: 'close_date_future',
          message: 'Close date should be in the future',
          condition: 'close_date < TODAY()',
          severity: 'warning',
        },
        {
          type: 'state_machine',
          name: 'stage_transitions',
          message: 'Invalid stage transition',
          field: 'stage',
          transitions: {
            prospecting: ['qualification', 'closed_lost'],
            qualification: ['needs_analysis', 'closed_lost'],
            needs_analysis: ['proposal', 'closed_lost'],
            proposal: ['negotiation', 'closed_lost'],
            negotiation: ['closed_won', 'closed_lost'],
            closed_won: [],
            closed_lost: [],
          },
        },
        {
          type: 'format',
          name: 'email_format',
          message: 'Primary contact email must be valid',
          field: 'primary_contact_email',
          format: 'email',
        },
      ];

      opportunityValidations.forEach(validation => {
        expect(() => ValidationRuleSchema.parse(validation)).not.toThrow();
      });
    });
  });

  describe('CrossFieldValidationSchema', () => {
    it('should accept cross-field date validation', () => {
      const crossFieldValidation = {
        type: 'cross_field' as const,
        name: 'end_after_start',
        message: 'End date must be after start date',
        condition: 'end_date > start_date',
        fields: ['start_date', 'end_date'],
      };

      expect(() => ValidationRuleSchema.parse(crossFieldValidation)).not.toThrow();
    });

    it('should accept complex cross-field validation', () => {
      const validation = {
        type: 'cross_field' as const,
        name: 'discount_validation',
        message: 'Discount cannot exceed 50% for amounts over $1000',
        condition: 'amount > 1000 AND discount_percent > 50',
        fields: ['amount', 'discount_percent'],
      };

      expect(() => ValidationRuleSchema.parse(validation)).not.toThrow();
    });

    // Salesforce-style validation examples
    it('should validate opportunity close date is after create date (Salesforce pattern)', () => {
      const validation = {
        type: 'cross_field' as const,
        name: 'close_date_after_create',
        message: 'Close Date must be greater than or equal to Create Date',
        condition: 'close_date >= created_date',
        fields: ['close_date', 'created_date'],
      };

      expect(() => ValidationRuleSchema.parse(validation)).not.toThrow();
    });

    it('should validate amount is within min/max range (Salesforce pattern)', () => {
      const validation = {
        type: 'cross_field' as const,
        name: 'amount_in_range',
        message: 'Amount must be between Minimum and Maximum values',
        condition: 'amount >= min_amount AND amount <= max_amount',
        fields: ['amount', 'min_amount', 'max_amount'],
      };

      expect(() => ValidationRuleSchema.parse(validation)).not.toThrow();
    });

    it('should validate discount does not exceed total amount', () => {
      const validation = {
        type: 'cross_field' as const,
        name: 'discount_not_exceed_total',
        message: 'Discount cannot exceed Total Amount',
        condition: 'discount_amount <= total_amount',
        fields: ['discount_amount', 'total_amount'],
      };

      expect(() => ValidationRuleSchema.parse(validation)).not.toThrow();
    });

    it('should validate shipping date is after order date', () => {
      const validation = {
        type: 'cross_field' as const,
        name: 'shipping_after_order',
        message: 'Shipping Date must be after Order Date',
        condition: 'shipping_date > order_date',
        fields: ['shipping_date', 'order_date'],
      };

      expect(() => ValidationRuleSchema.parse(validation)).not.toThrow();
    });

    it('should validate percentage fields sum to 100', () => {
      const validation = {
        type: 'cross_field' as const,
        name: 'percentage_sum',
        message: 'Percentages must sum to 100',
        condition: 'percent_a + percent_b + percent_c = 100',
        fields: ['percent_a', 'percent_b', 'percent_c'],
      };

      expect(() => ValidationRuleSchema.parse(validation)).not.toThrow();
    });

    it('should validate quantity does not exceed available stock', () => {
      const validation = {
        type: 'cross_field' as const,
        name: 'quantity_check',
        message: 'Order quantity cannot exceed available stock',
        condition: 'order_quantity <= stock_available',
        fields: ['order_quantity', 'stock_available'],
      };

      expect(() => ValidationRuleSchema.parse(validation)).not.toThrow();
    });

    it('should validate renewal date is after contract start date', () => {
      const validation = {
        type: 'cross_field' as const,
        name: 'renewal_after_start',
        message: 'Renewal Date must be after Contract Start Date',
        condition: 'renewal_date > contract_start_date',
        fields: ['renewal_date', 'contract_start_date'],
      };

      expect(() => ValidationRuleSchema.parse(validation)).not.toThrow();
    });

    it('should validate credit limit is not exceeded by balance', () => {
      const validation = {
        type: 'cross_field' as const,
        name: 'credit_limit_check',
        message: 'Balance cannot exceed Credit Limit',
        condition: 'balance <= credit_limit',
        fields: ['balance', 'credit_limit'],
      };

      expect(() => ValidationRuleSchema.parse(validation)).not.toThrow();
    });

    it('should validate hours worked does not exceed capacity', () => {
      const validation = {
        type: 'cross_field' as const,
        name: 'hours_capacity_check',
        message: 'Hours worked cannot exceed capacity',
        condition: 'hours_worked <= capacity_hours',
        fields: ['hours_worked', 'capacity_hours'],
      };

      expect(() => ValidationRuleSchema.parse(validation)).not.toThrow();
    });

    it('should validate multi-field dependency with OR condition', () => {
      const validation = {
        type: 'cross_field' as const,
        name: 'approval_required',
        message: 'Approval required if amount exceeds threshold or is high risk',
        condition: 'amount > approval_threshold OR risk_level = "high"',
        fields: ['amount', 'approval_threshold', 'risk_level'],
      };

      expect(() => ValidationRuleSchema.parse(validation)).not.toThrow();
    });

    it('should validate contract term aligns with billing period', () => {
      const validation = {
        type: 'cross_field' as const,
        name: 'term_billing_alignment',
        message: 'Contract term must be a multiple of billing period',
        condition: 'contract_term_months % billing_period_months = 0',
        fields: ['contract_term_months', 'billing_period_months'],
      };

      expect(() => ValidationRuleSchema.parse(validation)).not.toThrow();
    });

    it('should validate payment terms with credit check', () => {
      const validation = {
        type: 'cross_field' as const,
        name: 'payment_credit_check',
        message: 'Credit terms require minimum credit score',
        condition: 'payment_terms = "credit" AND credit_score >= 650',
        fields: ['payment_terms', 'credit_score'],
      };

      expect(() => ValidationRuleSchema.parse(validation)).not.toThrow();
    });

    it('should validate minimum margin requirement', () => {
      const validation = {
        type: 'cross_field' as const,
        name: 'minimum_margin',
        message: 'Selling price must maintain minimum 20% margin',
        condition: '(selling_price - cost_price) / cost_price >= 0.20',
        fields: ['selling_price', 'cost_price'],
      };

      expect(() => ValidationRuleSchema.parse(validation)).not.toThrow();
    });

    it('should handle edge case with empty fields array', () => {
      const validation = {
        type: 'cross_field' as const,
        name: 'edge_case_validation',
        message: 'Validation failed',
        condition: 'true',
        fields: [],
      };

      expect(() => ValidationRuleSchema.parse(validation)).not.toThrow();
    });

    it('should enforce required fields property', () => {
      const invalidValidation = {
        type: 'cross_field' as const,
        name: 'invalid_validation',
        message: 'Missing fields',
        condition: 'field_a > field_b',
      };

      expect(() => ValidationRuleSchema.parse(invalidValidation)).toThrow();
    });
  });

  describe('ConditionalValidationSchema', () => {
    it('should accept conditional validation with then clause', () => {
      const conditionalValidation = {
        type: 'conditional' as const,
        name: 'enterprise_validation',
        message: 'Enterprise accounts require approval',
        when: 'account_type = "enterprise"',
        then: {
          type: 'script' as const,
          name: 'require_approval',
          message: 'Approval required for enterprise accounts',
          condition: 'approval_status = null',
        },
      };

      expect(() => ValidationRuleSchema.parse(conditionalValidation)).not.toThrow();
    });

    it('should accept conditional validation with otherwise clause', () => {
      const validation = {
        type: 'conditional' as const,
        name: 'amount_validation',
        message: 'Amount validation',
        when: 'type = "wholesale"',
        then: {
          type: 'script' as const,
          name: 'wholesale_min',
          message: 'Wholesale orders must be at least $1000',
          condition: 'amount < 1000',
        },
        otherwise: {
          type: 'script' as const,
          name: 'retail_min',
          message: 'Retail orders must be at least $10',
          condition: 'amount < 10',
        },
      };

      expect(() => ValidationRuleSchema.parse(validation)).not.toThrow();
    });

    it('should accept nested conditional validation', () => {
      const validation = {
        type: 'conditional' as const,
        name: 'nested_validation',
        message: 'Complex conditional validation',
        when: 'country = "US"',
        then: {
          type: 'conditional' as const,
          name: 'state_validation',
          message: 'State-specific validation',
          when: 'state = "CA"',
          then: {
            type: 'script' as const,
            name: 'ca_tax',
            message: 'California requires tax ID',
            condition: 'tax_id = null',
          },
        },
      };

      expect(() => ValidationRuleSchema.parse(validation)).not.toThrow();
    });

    it('should validate only if customer type is premium', () => {
      const validation = {
        type: 'conditional' as const,
        name: 'premium_discount_check',
        message: 'Premium customer validation',
        when: 'customer_type = "premium"',
        then: {
          type: 'cross_field' as const,
          name: 'premium_discount_limit',
          message: 'Premium customers can have maximum 30% discount',
          condition: 'discount_percent <= 30',
          fields: ['discount_percent'],
        },
      };

      expect(() => ValidationRuleSchema.parse(validation)).not.toThrow();
    });

    it('should validate shipping address only when shipping required', () => {
      const validation = {
        type: 'conditional' as const,
        name: 'shipping_validation',
        message: 'Shipping validation',
        when: 'requires_shipping = true',
        then: {
          type: 'script' as const,
          name: 'shipping_address_required',
          message: 'Shipping address is required',
          condition: 'shipping_address = null OR shipping_address = ""',
        },
      };

      expect(() => ValidationRuleSchema.parse(validation)).not.toThrow();
    });

    it('should apply different validation based on order value', () => {
      const validation = {
        type: 'conditional' as const,
        name: 'order_value_validation',
        message: 'Order value validation',
        when: 'order_total > 10000',
        then: {
          type: 'script' as const,
          name: 'high_value_approval',
          message: 'Orders over $10,000 require manager approval',
          condition: 'manager_approval = null',
        },
        otherwise: {
          type: 'script' as const,
          name: 'standard_validation',
          message: 'Payment method required',
          condition: 'payment_method = null',
        },
      };

      expect(() => ValidationRuleSchema.parse(validation)).not.toThrow();
    });

    it('should validate tax fields only for taxable items', () => {
      const validation = {
        type: 'conditional' as const,
        name: 'tax_validation',
        message: 'Tax validation',
        when: 'is_taxable = true',
        then: {
          type: 'script' as const,
          name: 'tax_code_required',
          message: 'Tax code is required for taxable items',
          condition: 'tax_code = null',
        },
      };

      expect(() => ValidationRuleSchema.parse(validation)).not.toThrow();
    });

    it('should conditionally require field based on another field value', () => {
      const validation = {
        type: 'conditional' as const,
        name: 'conditional_required_field',
        message: 'Conditional field requirement',
        when: 'payment_method = "bank_transfer"',
        then: {
          type: 'script' as const,
          name: 'bank_details_required',
          message: 'Bank account details required for bank transfer',
          condition: 'bank_account_number = null',
        },
      };

      expect(() => ValidationRuleSchema.parse(validation)).not.toThrow();
    });

    it('should apply complex conditional with multiple field checks', () => {
      const validation = {
        type: 'conditional' as const,
        name: 'subscription_validation',
        message: 'Subscription validation',
        when: 'subscription_type = "annual" AND customer_status = "active"',
        then: {
          type: 'cross_field' as const,
          name: 'annual_discount',
          message: 'Annual subscriptions get automatic 15% discount',
          condition: 'discount_percent >= 15',
          fields: ['discount_percent'],
        },
      };

      expect(() => ValidationRuleSchema.parse(validation)).not.toThrow();
    });

    it('should validate insurance requirement based on product category', () => {
      const validation = {
        type: 'conditional' as const,
        name: 'insurance_check',
        message: 'Insurance validation',
        when: 'product_category IN ("electronics", "jewelry", "artwork")',
        then: {
          type: 'script' as const,
          name: 'insurance_required',
          message: 'Insurance is required for high-value items',
          condition: 'insurance_selected = false',
        },
      };

      expect(() => ValidationRuleSchema.parse(validation)).not.toThrow();
    });

    it('should apply different validations for different regions', () => {
      const validation = {
        type: 'conditional' as const,
        name: 'regional_validation',
        message: 'Regional compliance validation',
        when: 'region = "EU"',
        then: {
          type: 'script' as const,
          name: 'gdpr_consent',
          message: 'GDPR consent required for EU customers',
          condition: 'gdpr_consent_given = false',
        },
        otherwise: {
          type: 'script' as const,
          name: 'tos_acceptance',
          message: 'Terms of Service acceptance required',
          condition: 'tos_accepted = false',
        },
      };

      expect(() => ValidationRuleSchema.parse(validation)).not.toThrow();
    });

    it('should apply validation based on user role', () => {
      const validation = {
        type: 'conditional' as const,
        name: 'role_based_validation',
        message: 'Role-based validation',
        when: 'user_role = "manager"',
        then: {
          type: 'script' as const,
          name: 'manager_approval_limit',
          message: 'Managers can approve up to $50,000',
          condition: 'approval_amount > 50000',
        },
      };

      expect(() => ValidationRuleSchema.parse(validation)).not.toThrow();
    });

    it('should enforce required field property in when clause', () => {
      const validation = {
        type: 'conditional' as const,
        name: 'valid_conditional',
        message: 'Valid conditional',
        when: 'status = "active"',
        then: {
          type: 'script' as const,
          name: 'test_rule',
          message: 'Test',
          condition: 'true',
        },
      };

      expect(() => ValidationRuleSchema.parse(validation)).not.toThrow();
    });

    it('should fail without when clause', () => {
      const invalidValidation = {
        type: 'conditional' as const,
        name: 'invalid_conditional',
        message: 'Missing when clause',
        then: {
          type: 'script' as const,
          name: 'test_rule',
          message: 'Test',
          condition: 'true',
        },
      };

      expect(() => ValidationRuleSchema.parse(invalidValidation)).toThrow();
    });
  });

  describe('Advanced Validation Examples', () => {
    it('should accept comprehensive validation ruleset', () => {
      const advancedRules: ValidationRule[] = [
        {
          type: 'cross_field',
          name: 'date_range',
          message: 'End date must be after start date',
          condition: 'end_date > start_date',
          fields: ['start_date', 'end_date'],
        },
        {
          type: 'conditional',
          name: 'type_based_validation',
          message: 'Type-based validation',
          when: 'type = "special"',
          then: {
            type: 'cross_field',
            name: 'special_amount',
            message: 'Special orders must have amount between min and max',
            condition: 'amount >= min_amount AND amount <= max_amount',
            fields: ['amount', 'min_amount', 'max_amount'],
          },
        },
      ];

      advancedRules.forEach(rule => {
        expect(() => ValidationRuleSchema.parse(rule)).not.toThrow();
      });
    });
  });
});

describe('ValidationRuleSchema - Edge Cases and Null Handling', () => {
  it('should handle null and undefined in optional fields', () => {
    const validation = {
      type: 'script' as const,
      name: 'test_validation',
      message: 'Test message',
      condition: 'amount > 0',
      active: undefined, // Should default to true
      severity: undefined, // Should default to 'error'
    };

    const result = ScriptValidationSchema.parse(validation);
    expect(result.active).toBe(true);
    expect(result.severity).toBe('error');
  });

  it('should handle empty state transitions', () => {
    const validation = {
      type: 'state_machine' as const,
      name: 'state_validation',
      message: 'Invalid state transition',
      field: 'status',
      transitions: {
        'draft': [],
        'published': ['draft', 'archived'],
      },
    };

    expect(() => StateMachineValidationSchema.parse(validation)).not.toThrow();
  });

  it('should handle undefined regex and format in FormatValidation', () => {
    const validation = {
      type: 'format' as const,
      name: 'format_check',
      message: 'Invalid format',
      field: 'email',
      format: 'email' as const,
      regex: undefined,
    };

    expect(() => FormatValidationSchema.parse(validation)).not.toThrow();
  });

  it('should handle various format types', () => {
    const formats = ['email', 'url', 'phone', 'json'] as const;
    
    formats.forEach(format => {
      const validation = {
        type: 'format' as const,
        name: `format_${format}`,
        message: `Invalid ${format}`,
        field: 'test_field',
        format,
      };

      expect(() => FormatValidationSchema.parse(validation)).not.toThrow();
    });
  });

  it('should handle empty fields array in CrossFieldValidation', () => {
    const validation = {
      type: 'cross_field' as const,
      name: 'test_cross_field',
      message: 'Validation failed',
      condition: 'true',
      fields: [], // Empty array
    };

    expect(() => CrossFieldValidationSchema.parse(validation)).not.toThrow();
  });

  it('should handle undefined otherwise in ConditionalValidation', () => {
    const validation = {
      type: 'conditional' as const,
      name: 'conditional_validation',
      message: 'Conditional validation',
      when: 'type = "special"',
      then: {
        type: 'script' as const,
        name: 'special_validation',
        message: 'Special type validation',
        condition: 'amount > 100',
      },
      otherwise: undefined,
    };

    expect(() => ConditionalValidationSchema.parse(validation)).not.toThrow();
  });

  it('should reject missing required fields', () => {
    expect(() => ScriptValidationSchema.parse({
      type: 'script',
      // Missing name, message, and condition
    })).toThrow();
  });

  it('should reject invalid validation type', () => {
    expect(() => ValidationRuleSchema.parse({
      type: 'invalid_type',
      name: 'test',
      message: 'Test',
    })).toThrow();
  });

  it('should reject invalid severity level', () => {
    expect(() => ScriptValidationSchema.parse({
      type: 'script',
      name: 'test',
      message: 'Test',
      condition: 'true',
      severity: 'invalid',
    })).toThrow();
  });
});

describe('ValidationRuleSchema - Type Coercion Edge Cases', () => {
  it('should handle boolean active flag', () => {
    const testCases = [
      { active: true, expected: true },
      { active: false, expected: false },
    ];

    testCases.forEach(({ active, expected }) => {
      const validation = {
        type: 'script' as const,
        name: 'test',
        message: 'Test',
        condition: 'true',
        active,
      };

      const result = ScriptValidationSchema.parse(validation);
      expect(result.active).toBe(expected);
    });
  });

  it('should handle nested conditional validations', () => {
    const validation = {
      type: 'conditional' as const,
      name: 'nested_conditional',
      message: 'Nested conditional',
      when: 'type = "A"',
      then: {
        type: 'conditional' as const,
        name: 'inner_conditional',
        message: 'Inner conditional',
        when: 'subtype = "B"',
        then: {
          type: 'script' as const,
          name: 'final_validation',
          message: 'Final validation',
          condition: 'value > 0',
        },
      },
    };

    expect(() => ValidationRuleSchema.parse(validation)).not.toThrow();
  });

  it('should handle complex state machine transitions', () => {
    const validation = {
      type: 'state_machine' as const,
      name: 'complex_state',
      message: 'Invalid state transition',
      field: 'status',
      transitions: {
        'draft': ['review', 'cancelled'],
        'review': ['approved', 'rejected', 'draft'],
        'approved': ['published', 'draft'],
        'rejected': ['draft'],
        'published': ['archived'],
        'archived': [],
        'cancelled': [],
      },
    };

    expect(() => StateMachineValidationSchema.parse(validation)).not.toThrow();
  });

  it('should handle format validation with regex', () => {
    const validation = {
      type: 'format' as const,
      name: 'regex_format',
      message: 'Invalid format',
      field: 'custom_field',
      regex: '^[A-Z]{3}-\\d{4}$', // Pattern like ABC-1234
    };

    expect(() => FormatValidationSchema.parse(validation)).not.toThrow();
  });

  it('should handle cross-field validation with complex conditions', () => {
    const validation = {
      type: 'cross_field' as const,
      name: 'complex_cross_field',
      message: 'Complex validation failed',
      condition: '(end_date > start_date) AND (amount >= min_amount) AND (amount <= max_amount)',
      fields: ['start_date', 'end_date', 'amount', 'min_amount', 'max_amount'],
    };

    expect(() => CrossFieldValidationSchema.parse(validation)).not.toThrow();
  });
});

describe('ValidationRuleSchema - Boundary Conditions', () => {
  it('should handle very long validation names', () => {
    const validation = {
      type: 'script' as const,
      name: 'very_long_validation_name_that_follows_snake_case_convention',
      message: 'Test',
      condition: 'true',
    };

    expect(() => ScriptValidationSchema.parse(validation)).not.toThrow();
  });

  it('should handle very long messages', () => {
    const longMessage = 'This is a very long validation message that provides detailed information about what went wrong and how to fix it. '.repeat(10);
    
    const validation = {
      type: 'script' as const,
      name: 'test_long_message',
      message: longMessage,
      condition: 'true',
    };

    expect(() => ScriptValidationSchema.parse(validation)).not.toThrow();
  });

  it('should handle large number of state transitions', () => {
    const transitions: Record<string, string[]> = {};
    for (let i = 0; i < 20; i++) {
      transitions[`state_${i}`] = [`state_${(i + 1) % 20}`];
    }

    const validation = {
      type: 'state_machine' as const,
      name: 'large_state_machine',
      message: 'Invalid transition',
      field: 'status',
      transitions,
    };

    expect(() => StateMachineValidationSchema.parse(validation)).not.toThrow();
  });
});

// ============================================================================
// Protocol Improvement Tests: Validation priority
// ============================================================================

describe('ValidationRule - priority property', () => {
  it('should accept a validation rule with priority', () => {
    const rule = ScriptValidationSchema.parse({
      type: 'script',
      name: 'high_priority_check',
      message: 'This runs first',
      condition: 'amount < 0',
      priority: 10,
    });
    expect(rule.priority).toBe(10);
  });

  it('should default priority to 100', () => {
    const rule = ScriptValidationSchema.parse({
      type: 'script',
      name: 'default_priority',
      message: 'Default',
      condition: 'amount < 0',
    });
    expect(rule.priority).toBe(100);
  });

  it('should accept priority of 0 (highest)', () => {
    const rule = ScriptValidationSchema.parse({
      type: 'script',
      name: 'first_check',
      message: 'First',
      condition: 'true',
      priority: 0,
    });
    expect(rule.priority).toBe(0);
  });

  it('should accept priority of 9999 (lowest)', () => {
    const rule = ScriptValidationSchema.parse({
      type: 'script',
      name: 'last_check',
      message: 'Last',
      condition: 'true',
      priority: 9999,
    });
    expect(rule.priority).toBe(9999);
  });

  it('should reject priority out of range', () => {
    expect(() => ScriptValidationSchema.parse({
      type: 'script',
      name: 'invalid_priority',
      message: 'Bad',
      condition: 'true',
      priority: -1,
    })).toThrow();

    expect(() => ScriptValidationSchema.parse({
      type: 'script',
      name: 'invalid_priority',
      message: 'Bad',
      condition: 'true',
      priority: 10000,
    })).toThrow();
  });
});
