import { describe, it, expect } from 'vitest';
import {
  SystemIdentifierSchema,
  SnakeCaseIdentifierSchema,
} from './identifiers.zod';

describe('SystemIdentifierSchema', () => {
  describe('valid identifiers', () => {
    it('should accept lowercase with underscores', () => {
      const validIdentifiers = [
        'account',
        'crm_account',
        'user_profile',
        'sales_manager',
        'api_v2_endpoint',
        'closed_won',
        'in_progress',
      ];

      validIdentifiers.forEach((id) => {
        expect(() => SystemIdentifierSchema.parse(id)).not.toThrow();
      });
    });

    it('should accept lowercase with dots (for events)', () => {
      const validIdentifiers = [
        'user.created',
        'order.paid',
        'user.login_success',
        'alarm.high_cpu',
        'order.created',
      ];

      validIdentifiers.forEach((id) => {
        expect(() => SystemIdentifierSchema.parse(id)).not.toThrow();
      });
    });

    it('should accept lowercase with numbers', () => {
      const validIdentifiers = [
        'api_v2',
        'user123',
        'version_1_0_0',
        'test_2024',
      ];

      validIdentifiers.forEach((id) => {
        expect(() => SystemIdentifierSchema.parse(id)).not.toThrow();
      });
    });
  });

  describe('invalid identifiers', () => {
    it('should reject uppercase letters', () => {
      const invalidIdentifiers = [
        'Account',
        'CrmAccount',
        'SalesManager',
        'UserProfile',
        'ADMIN',
        'Read_Only',
      ];

      invalidIdentifiers.forEach((id) => {
        expect(() => SystemIdentifierSchema.parse(id)).toThrow();
      });
    });

    it('should reject camelCase', () => {
      const invalidIdentifiers = [
        'crmAccount',
        'userProfile',
        'salesManager',
        'onCloseDeal',
      ];

      invalidIdentifiers.forEach((id) => {
        expect(() => SystemIdentifierSchema.parse(id)).toThrow();
      });
    });

    it('should reject kebab-case', () => {
      const invalidIdentifiers = [
        'crm-account',
        'user-profile',
        'sales-manager',
      ];

      invalidIdentifiers.forEach((id) => {
        expect(() => SystemIdentifierSchema.parse(id)).toThrow();
      });
    });

    it('should reject spaces', () => {
      const invalidIdentifiers = [
        'user profile',
        'crm account',
        'sales manager',
        'In Progress',
      ];

      invalidIdentifiers.forEach((id) => {
        expect(() => SystemIdentifierSchema.parse(id)).toThrow();
      });
    });

    it('should reject identifiers starting with numbers', () => {
      const invalidIdentifiers = ['1user', '2account', '999test'];

      invalidIdentifiers.forEach((id) => {
        expect(() => SystemIdentifierSchema.parse(id)).toThrow();
      });
    });

    it('should reject identifiers starting with underscore', () => {
      const invalidIdentifiers = ['_account', '_user', '__test'];

      invalidIdentifiers.forEach((id) => {
        expect(() => SystemIdentifierSchema.parse(id)).toThrow();
      });
    });

    it('should reject too short identifiers', () => {
      const invalidIdentifiers = ['a', 'x', ''];

      invalidIdentifiers.forEach((id) => {
        expect(() => SystemIdentifierSchema.parse(id)).toThrow();
      });
    });

    it('should reject special characters', () => {
      const invalidIdentifiers = [
        'user@profile',
        'crm#account',
        'sales$manager',
        'user!profile',
      ];

      invalidIdentifiers.forEach((id) => {
        expect(() => SystemIdentifierSchema.parse(id)).toThrow();
      });
    });
  });
});

describe('SnakeCaseIdentifierSchema', () => {
  describe('valid identifiers', () => {
    it('should accept lowercase with underscores only', () => {
      const validIdentifiers = [
        'account',
        'crm_account',
        'user_profile',
        'sales_manager',
        'api_v2_endpoint',
      ];

      validIdentifiers.forEach((id) => {
        expect(() => SnakeCaseIdentifierSchema.parse(id)).not.toThrow();
      });
    });
  });

  describe('invalid identifiers', () => {
    it('should reject dots', () => {
      const invalidIdentifiers = [
        'user.created',
        'order.paid',
        'user.login_success',
      ];

      invalidIdentifiers.forEach((id) => {
        expect(() => SnakeCaseIdentifierSchema.parse(id)).toThrow();
      });
    });

    it('should reject uppercase', () => {
      const invalidIdentifiers = ['Account', 'UserProfile', 'SalesManager'];

      invalidIdentifiers.forEach((id) => {
        expect(() => SnakeCaseIdentifierSchema.parse(id)).toThrow();
      });
    });
  });
});

