import { describe, it, expect } from 'vitest';
import { 
  FieldSchema, 
  FieldType, 
  SelectOptionSchema,
  CurrencyConfigSchema,
  CurrencyValueSchema,
  VectorConfigSchema,
  FileAttachmentConfigSchema,
  Field,
  type SelectOption,
  type CurrencyConfig,
  type CurrencyValue,
  type VectorConfig,
  type FileAttachmentConfig,
} from './field.zod';

describe('FieldType', () => {
  it('should accept valid field types', () => {
    const validTypes = [
      'text', 'textarea', 'email', 'url', 'phone', 'password',
      'markdown', 'html', 'richtext',
      'number', 'currency', 'percent',
      'date', 'datetime', 'time',
      'boolean',
      'select',
      'lookup', 'master_detail',
      'image', 'file', 'avatar',
      'formula', 'summary', 'autonumber',
      'location', 'address', 'code', 'color', 'rating', 'slider', 'signature', 'qrcode', 'vector'
    ];

    validTypes.forEach(type => {
      expect(() => FieldType.parse(type)).not.toThrow();
    });
  });

  it('should reject invalid field types', () => {
    expect(() => FieldType.parse('invalid')).toThrow();
    expect(() => FieldType.parse('text_area')).toThrow();
    expect(() => FieldType.parse('')).toThrow();
  });
});

describe('SelectOptionSchema', () => {
  it('should accept valid select option', () => {
    const validOption: SelectOption = {
      label: 'Active',
      value: 'active',
    };

    expect(() => SelectOptionSchema.parse(validOption)).not.toThrow();
  });

  it('should accept select option with all fields', () => {
    const fullOption: SelectOption = {
      label: 'High Priority',
      value: 'high',
      color: '#FF0000',
      default: true,
    };

    expect(() => SelectOptionSchema.parse(fullOption)).not.toThrow();
  });

  it('should reject option without required fields', () => {
    expect(() => SelectOptionSchema.parse({ label: 'Test' })).toThrow();
    expect(() => SelectOptionSchema.parse({ value: 'test' })).toThrow();
  });
});

describe('CurrencyConfigSchema', () => {
  it('should accept valid currency config with all fields', () => {
    const validConfig: CurrencyConfig = {
      precision: 2,
      currencyMode: 'dynamic',
      defaultCurrency: 'USD',
    };

    expect(() => CurrencyConfigSchema.parse(validConfig)).not.toThrow();
  });

  it('should apply default values', () => {
    const config = CurrencyConfigSchema.parse({});
    
    expect(config.precision).toBe(2);
    expect(config.currencyMode).toBe('dynamic');
    expect(config.defaultCurrency).toBe('CNY');
  });

  it('should accept precision from 0 to 10', () => {
    const validPrecisions = [0, 2, 4, 8, 10];
    
    validPrecisions.forEach(precision => {
      expect(() => CurrencyConfigSchema.parse({ precision })).not.toThrow();
    });
  });

  it('should reject invalid precision values', () => {
    const invalidPrecisions = [-1, 11, 15, 1.5];
    
    invalidPrecisions.forEach(precision => {
      expect(() => CurrencyConfigSchema.parse({ precision })).toThrow();
    });
  });

  it('should accept both currency modes', () => {
    expect(() => CurrencyConfigSchema.parse({ currencyMode: 'dynamic' })).not.toThrow();
    expect(() => CurrencyConfigSchema.parse({ currencyMode: 'fixed' })).not.toThrow();
  });

  it('should reject invalid currency modes', () => {
    expect(() => CurrencyConfigSchema.parse({ currencyMode: 'invalid' })).toThrow();
  });

  it('should enforce 3-character currency codes', () => {
    const validCodes = ['USD', 'CNY', 'EUR', 'GBP', 'JPY'];
    
    validCodes.forEach(code => {
      expect(() => CurrencyConfigSchema.parse({ defaultCurrency: code })).not.toThrow();
    });
  });

  it('should reject invalid currency code lengths', () => {
    const invalidCodes = ['US', 'USDD', 'C', ''];
    
    invalidCodes.forEach(code => {
      expect(() => CurrencyConfigSchema.parse({ defaultCurrency: code })).toThrow();
    });
  });
});

describe('CurrencyValueSchema', () => {
  it('should accept valid currency value', () => {
    const validValue: CurrencyValue = {
      value: 1000.50,
      currency: 'USD',
    };

    expect(() => CurrencyValueSchema.parse(validValue)).not.toThrow();
  });

  it('should accept zero value', () => {
    const zeroValue: CurrencyValue = {
      value: 0,
      currency: 'CNY',
    };

    expect(() => CurrencyValueSchema.parse(zeroValue)).not.toThrow();
  });

  it('should accept negative values', () => {
    const negativeValue: CurrencyValue = {
      value: -500.00,
      currency: 'EUR',
    };

    expect(() => CurrencyValueSchema.parse(negativeValue)).not.toThrow();
  });

  it('should reject invalid currency codes', () => {
    expect(() => CurrencyValueSchema.parse({ value: 100, currency: 'US' })).toThrow();
    expect(() => CurrencyValueSchema.parse({ value: 100, currency: 'USDD' })).toThrow();
  });

  it('should reject missing required fields', () => {
    expect(() => CurrencyValueSchema.parse({ value: 100 })).toThrow();
    expect(() => CurrencyValueSchema.parse({ currency: 'USD' })).toThrow();
    expect(() => CurrencyValueSchema.parse({})).toThrow();
  });
});

describe('FieldSchema', () => {
  describe('Basic Field Properties', () => {
    it('should accept valid field with minimal properties', () => {
      const validField: Field = {
        name: 'first_name',
        label: 'First Name',
        type: 'text',
      };

      const result = FieldSchema.safeParse(validField);
      expect(result.success).toBe(true);
    });

    it('should enforce snake_case for field name', () => {
      const validNames = ['first_name', 'user_id', 'created_at', '_private'];
      validNames.forEach(name => {
        expect(() => FieldSchema.parse({ name, label: 'Test', type: 'text' })).not.toThrow();
      });

      const invalidNames = ['firstName', 'First-Name', '123name', 'name-field'];
      invalidNames.forEach(name => {
        expect(() => FieldSchema.parse({ name, label: 'Test', type: 'text' })).toThrow();
      });
    });

    it('should apply default values correctly', () => {
      const field = {
        name: 'test_field',
        label: 'Test',
        type: 'text' as const,
      };

      const result = FieldSchema.parse(field);
      expect(result.required).toBe(false);
      expect(result.multiple).toBe(false);
      expect(result.unique).toBe(false);
      expect(result.hidden).toBe(false);
      expect(result.readonly).toBe(false);
      expect(result.index).toBe(false);
      expect(result.externalId).toBe(false);
    });
  });

  describe('Text Field Constraints', () => {
    it('should accept text field with length constraints', () => {
      const textField: Field = {
        name: 'username',
        label: 'Username',
        type: 'text',
        maxLength: 50,
        minLength: 3,
      };

      expect(() => FieldSchema.parse(textField)).not.toThrow();
    });
  });

  describe('Number Field Constraints', () => {
    it('should accept number field with precision and scale', () => {
      const numberField: Field = {
        name: 'amount',
        label: 'Amount',
        type: 'currency',
        precision: 10,
        scale: 2,
        min: 0,
        max: 999999.99,
      };

      expect(() => FieldSchema.parse(numberField)).not.toThrow();
    });
  });

  describe('Select Field', () => {
    it('should accept select field with options', () => {
      const selectField: Field = {
        name: 'status',
        label: 'Status',
        type: 'select',
        options: [
          { label: 'Active', value: 'active', color: '#00FF00', default: true },
          { label: 'Inactive', value: 'inactive', color: '#FF0000' },
        ],
      };

      expect(() => FieldSchema.parse(selectField)).not.toThrow();
    });
  });

  describe('Relationship Fields', () => {
    it('should accept lookup field with reference', () => {
      const lookupField: Field = {
        name: 'account_id',
        label: 'Account',
        type: 'lookup',
        reference: 'account',
        referenceFilters: ['status = "active"'],
      };

      expect(() => FieldSchema.parse(lookupField)).not.toThrow();
    });

    it('should accept master_detail field with delete behavior', () => {
      const masterDetailField: Field = {
        name: 'parent_id',
        label: 'Parent Record',
        type: 'master_detail',
        reference: 'parent_object',
        deleteBehavior: 'cascade',
      };

      const result = FieldSchema.parse(masterDetailField);
      expect(result.deleteBehavior).toBe('cascade');
    });

    it('should default deleteBehavior to set_null', () => {
      const lookupField: Field = {
        name: 'contact_id',
        label: 'Contact',
        type: 'lookup',
        reference: 'contact',
      };

      const result = FieldSchema.parse(lookupField);
      expect(result.deleteBehavior).toBe('set_null');
    });
  });

  describe('Calculated Fields', () => {
    it('should accept formula field with expression', () => {
      const formulaField: Field = {
        name: 'full_name',
        label: 'Full Name',
        type: 'formula',
        expression: 'first_name + " " + last_name',
      };

      expect(() => FieldSchema.parse(formulaField)).not.toThrow();
    });

    it('should accept summary field with operations', () => {
      const summaryField: Field = {
        name: 'total_opportunities',
        label: 'Total Opportunities',
        type: 'summary',
        summaryOperations: {
          object: 'opportunity',
          field: 'amount',
          function: 'sum',
        },
      };

      expect(() => FieldSchema.parse(summaryField)).not.toThrow();
    });

    it('should accept all summary functions', () => {
      const functions = ['count', 'sum', 'min', 'max', 'avg'] as const;
      
      functions.forEach(fn => {
        const field: Field = {
          name: 'test_summary',
          label: 'Test Summary',
          type: 'summary',
          summaryOperations: {
            object: 'child_object',
            field: 'value',
            function: fn,
          },
        };

        expect(() => FieldSchema.parse(field)).not.toThrow();
      });
    });
  });

  describe('Security and Visibility', () => {
    it('should accept hidden and readonly fields', () => {
      const secureField: Field = {
        name: 'secret_key',
        label: 'Secret Key',
        type: 'password',
        hidden: true,
        readonly: true,
      };

      expect(() => FieldSchema.parse(secureField)).not.toThrow();
    });
  });

  describe('Indexing', () => {
    it('should accept indexed fields', () => {
      const indexedField: Field = {
        name: 'email',
        label: 'Email',
        type: 'email',
        unique: true,
        index: true,
        externalId: true,
      };

      expect(() => FieldSchema.parse(indexedField)).not.toThrow();
    });
  });

  describe('Complex Field Examples', () => {
    it('should accept complex field with many properties', () => {
      const complexField: Field = {
        name: 'account_number',
        label: 'Account Number',
        type: 'text',
        description: 'Unique account identifier',
        required: true,
        unique: true,
        maxLength: 20,
        minLength: 10,
        defaultValue: 'ACC-0000',
        index: true,
        externalId: true,
        readonly: false,
        hidden: false,
      };

      expect(() => FieldSchema.parse(complexField)).not.toThrow();
    });
  });
});

describe('Field Factory Helpers', () => {
  describe('Basic Field Types', () => {
    it('should create phone field', () => {
      const phoneField = Field.phone({ label: 'Mobile Phone', required: true });
      
      expect(phoneField.type).toBe('phone');
      expect(phoneField.label).toBe('Mobile Phone');
      expect(phoneField.required).toBe(true);
    });

    it('should create text field', () => {
      const textField = Field.text({ label: 'Name', maxLength: 100 });
      
      expect(textField.type).toBe('text');
      expect(textField.label).toBe('Name');
      expect(textField.maxLength).toBe(100);
    });

    it('should create email field', () => {
      const emailField = Field.email({ label: 'Email Address' });
      
      expect(emailField.type).toBe('email');
      expect(emailField.label).toBe('Email Address');
    });
  });

  describe('Select Field Factory', () => {
    it('should create select field with string array (old API)', () => {
      const selectField = Field.select(['High', 'Medium', 'Low'], { label: 'Priority' });
      
      expect(selectField.type).toBe('select');
      expect(selectField.label).toBe('Priority');
      expect(selectField.options).toHaveLength(3);
      expect(selectField.options[0]).toEqual({ label: 'High', value: 'high' });
    });

    it('should create select field with SelectOption array in config (new API)', () => {
      const selectField = Field.select({
        label: 'Priority',
        options: [
          { label: 'High Priority', value: 'high', color: '#FF0000' },
          { label: 'Low Priority', value: 'low', color: '#00FF00' },
        ],
      });
      
      expect(selectField.type).toBe('select');
      expect(selectField.label).toBe('Priority');
      expect(selectField.options).toHaveLength(2);
      expect(selectField.options[0].color).toBe('#FF0000');
      expect(selectField.options[1].value).toBe('low');
    });

    it('should create select field with mixed string/object array (new API)', () => {
      const selectField = Field.select({
        label: 'Status',
        options: [
          { label: 'Active', value: 'active', color: '#00AA00' },
          'Inactive',
          'Pending',
        ],
      });
      
      expect(selectField.type).toBe('select');
      expect(selectField.options).toHaveLength(3);
      expect(selectField.options[0]).toEqual({ label: 'Active', value: 'active', color: '#00AA00' });
      expect(selectField.options[1]).toEqual({ label: 'Inactive', value: 'inactive' });
      expect(selectField.options[2]).toEqual({ label: 'Pending', value: 'pending' });
    });
  });

  describe('Lookup and Master-Detail Fields', () => {
    it('should create lookup field', () => {
      const lookupField = Field.lookup('account', { 
        label: 'Account',
        referenceFilters: ['status = "active"'],
      });
      
      expect(lookupField.type).toBe('lookup');
      expect(lookupField.reference).toBe('account');
      expect(lookupField.label).toBe('Account');
    });

    it('should create master_detail field', () => {
      const masterDetailField = Field.masterDetail('parent_object', {
        label: 'Parent',
        deleteBehavior: 'cascade',
      });
      
      expect(masterDetailField.type).toBe('master_detail');
      expect(masterDetailField.reference).toBe('parent_object');
      expect(masterDetailField.deleteBehavior).toBe('cascade');
    });
  });

  describe('Enhanced Field Types', () => {
    it('should accept location field type', () => {
      expect(() => FieldType.parse('location')).not.toThrow();
    });

    it('should accept address field type', () => {
      expect(() => FieldType.parse('address')).not.toThrow();
    });

    it('should accept richtext field type', () => {
      expect(() => FieldType.parse('richtext')).not.toThrow();
    });

    it('should accept code field type', () => {
      expect(() => FieldType.parse('code')).not.toThrow();
    });

    it('should accept color field type', () => {
      expect(() => FieldType.parse('color')).not.toThrow();
    });

    it('should accept rating field type', () => {
      expect(() => FieldType.parse('rating')).not.toThrow();
    });

    it('should accept slider field type', () => {
      expect(() => FieldType.parse('slider')).not.toThrow();
    });

    it('should accept signature field type', () => {
      expect(() => FieldType.parse('signature')).not.toThrow();
    });

    it('should accept qrcode field type', () => {
      expect(() => FieldType.parse('qrcode')).not.toThrow();
    });

    it('should create location field with config', () => {
      const locationField = Field.location({
        label: 'Office Location',
      });

      expect(locationField.type).toBe('location');
      expect(locationField.label).toBe('Office Location');
    });

    it('should create address field with format', () => {
      const addressField = Field.address({
        label: 'Mailing Address',
        required: true,
      });

      expect(addressField.type).toBe('address');
      expect(addressField.required).toBe(true);
    });

    it('should create richtext field', () => {
      const richtextField = Field.richtext({
        label: 'Description',
        maxLength: 5000,
      });
      
      expect(richtextField.type).toBe('richtext');
      expect(richtextField.label).toBe('Description');
    });

    it('should create code field with language', () => {
      const codeField = Field.code('javascript', {
        label: 'Script',
      });

      expect(codeField.type).toBe('code');
      expect(codeField.language).toBe('javascript');
    });

    it('should create color field with format', () => {
      const colorField = Field.color({
        label: 'Brand Color',
      });

      expect(colorField.type).toBe('color');
      expect(colorField.label).toBe('Brand Color');
    });

    it('should create rating field with max rating', () => {
      const ratingField = Field.rating(10, {
        label: 'Customer Satisfaction',
      });

      expect(ratingField.type).toBe('rating');
      expect(ratingField.maxRating).toBe(10);
    });

    it('should create signature field', () => {
      const signatureField = Field.signature({
        label: 'Customer Signature',
        required: true,
      });
      
      expect(signatureField.type).toBe('signature');
      expect(signatureField.required).toBe(true);
    });

    it('should create slider field with config', () => {
      const sliderField = Field.slider({
        label: 'Volume',
        min: 0,
        max: 100,
        step: 5,
        defaultValue: 50,
      });

      expect(sliderField.type).toBe('slider');
      expect(sliderField.label).toBe('Volume');
      expect(sliderField.min).toBe(0);
      expect(sliderField.max).toBe(100);
      expect(sliderField.step).toBe(5);
    });

    it('should create qrcode field with barcode format', () => {
      const qrcodeField = Field.qrcode({
        label: 'Product Barcode',
      });

      expect(qrcodeField.type).toBe('qrcode');
      expect(qrcodeField.label).toBe('Product Barcode');
    });
  });

  describe('Currency Field Type with Multi-Currency Support', () => {
    it('should create currency field with default config', () => {
      const currencyField = Field.currency({
        name: 'contract_amount',
        label: 'Contract Amount',
      });
      
      expect(currencyField.type).toBe('currency');
      expect(currencyField.name).toBe('contract_amount');
      expect(currencyField.label).toBe('Contract Amount');
    });

    it('should create currency field with dynamic currency mode (default)', () => {
      const currencyField = Field.currency({
        name: 'price',
        label: 'Price',
        currencyConfig: {
          precision: 2,
          currencyMode: 'dynamic',
          defaultCurrency: 'USD',
        },
      });
      
      expect(currencyField.type).toBe('currency');
      expect(currencyField.currencyConfig?.currencyMode).toBe('dynamic');
      expect(currencyField.currencyConfig?.defaultCurrency).toBe('USD');
      expect(currencyField.currencyConfig?.precision).toBe(2);
    });

    it('should create currency field with fixed currency mode', () => {
      const currencyField = Field.currency({
        name: 'salary',
        label: 'Salary',
        currencyConfig: {
          precision: 2,
          currencyMode: 'fixed',
          defaultCurrency: 'CNY',
        },
      });
      
      expect(currencyField.type).toBe('currency');
      expect(currencyField.currencyConfig?.currencyMode).toBe('fixed');
      expect(currencyField.currencyConfig?.defaultCurrency).toBe('CNY');
    });

    it('should validate currency field with valid config', () => {
      const validField = {
        name: 'revenue',
        label: 'Revenue',
        type: 'currency' as const,
        currencyConfig: {
          precision: 4,
          currencyMode: 'dynamic' as const,
          defaultCurrency: 'EUR',
        },
      };

      const result = FieldSchema.safeParse(validField);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.currencyConfig?.precision).toBe(4);
        expect(result.data.currencyConfig?.currencyMode).toBe('dynamic');
        expect(result.data.currencyConfig?.defaultCurrency).toBe('EUR');
      }
    });

    it('should apply default values for currency config', () => {
      const field = {
        name: 'amount',
        label: 'Amount',
        type: 'currency' as const,
        currencyConfig: {},
      };

      const result = FieldSchema.parse(field);
      expect(result.currencyConfig?.precision).toBe(2);
      expect(result.currencyConfig?.currencyMode).toBe('dynamic');
      expect(result.currencyConfig?.defaultCurrency).toBe('CNY');
    });

    it('should reject invalid precision values', () => {
      const invalidField = {
        name: 'amount',
        label: 'Amount',
        type: 'currency' as const,
        currencyConfig: {
          precision: -1,
        },
      };

      expect(() => FieldSchema.parse(invalidField)).toThrow();

      const tooHighPrecision = {
        name: 'amount',
        label: 'Amount',
        type: 'currency' as const,
        currencyConfig: {
          precision: 11,
        },
      };

      expect(() => FieldSchema.parse(tooHighPrecision)).toThrow();
    });

    it('should reject invalid currency codes', () => {
      const invalidField = {
        name: 'price',
        label: 'Price',
        type: 'currency' as const,
        currencyConfig: {
          defaultCurrency: 'US', // Must be 3 characters
        },
      };

      expect(() => FieldSchema.parse(invalidField)).toThrow();

      const tooLongCurrency = {
        name: 'price',
        label: 'Price',
        type: 'currency' as const,
        currencyConfig: {
          defaultCurrency: 'USDD',
        },
      };

      expect(() => FieldSchema.parse(tooLongCurrency)).toThrow();
    });

    it('should accept valid currency modes', () => {
      const dynamicMode = {
        name: 'price1',
        label: 'Price 1',
        type: 'currency' as const,
        currencyConfig: {
          currencyMode: 'dynamic' as const,
        },
      };

      const fixedMode = {
        name: 'price2',
        label: 'Price 2',
        type: 'currency' as const,
        currencyConfig: {
          currencyMode: 'fixed' as const,
        },
      };

      expect(() => FieldSchema.parse(dynamicMode)).not.toThrow();
      expect(() => FieldSchema.parse(fixedMode)).not.toThrow();
    });

    it('should work with other field properties', () => {
      const currencyField = Field.currency({
        name: 'budget',
        label: 'Project Budget',
        required: true,
        readonly: false,
        description: 'Total budget for the project',
        currencyConfig: {
          precision: 2,
          currencyMode: 'dynamic',
          defaultCurrency: 'USD',
        },
      });
      
      expect(currencyField.type).toBe('currency');
      expect(currencyField.required).toBe(true);
      expect(currencyField.readonly).toBe(false);
      expect(currencyField.description).toBe('Total budget for the project');
    });

    it('should support high precision for cryptocurrency', () => {
      const cryptoField = Field.currency({
        name: 'btc_balance',
        label: 'Bitcoin Balance',
        currencyConfig: {
          precision: 8,  // Bitcoin uses 8 decimal places
          currencyMode: 'fixed',
          defaultCurrency: 'BTC',
        },
      });
      
      expect(cryptoField.type).toBe('currency');
      expect(cryptoField.currencyConfig?.precision).toBe(8);
      expect(cryptoField.currencyConfig?.currencyMode).toBe('fixed');
      expect(cryptoField.currencyConfig?.defaultCurrency).toBe('BTC');
    });
  });

  describe('Vector Field Type for AI/ML Embeddings', () => {
    it('should accept vector field type', () => {
      expect(() => FieldType.parse('vector')).not.toThrow();
    });

    it('should create vector field with default config', () => {
      const vectorField = Field.vector(1536, {
        name: 'embedding',
        label: 'Text Embedding',
      });
      
      expect(vectorField.type).toBe('vector');
      expect(vectorField.name).toBe('embedding');
      expect(vectorField.label).toBe('Text Embedding');
      expect(vectorField.vectorConfig?.dimensions).toBe(1536);
      expect(vectorField.vectorConfig?.distanceMetric).toBe('cosine');
      expect(vectorField.vectorConfig?.normalized).toBe(false);
      expect(vectorField.vectorConfig?.indexed).toBe(true);
    });

    it('should create vector field with custom config', () => {
      const vectorField = Field.vector(512, {
        name: 'image_embedding',
        label: 'Image Embedding',
        vectorConfig: {
          dimensions: 512,
          distanceMetric: 'euclidean',
          normalized: true,
          indexed: true,
          indexType: 'hnsw',
        },
      });
      
      expect(vectorField.type).toBe('vector');
      expect(vectorField.vectorConfig?.dimensions).toBe(512);
      expect(vectorField.vectorConfig?.distanceMetric).toBe('euclidean');
      expect(vectorField.vectorConfig?.normalized).toBe(true);
      expect(vectorField.vectorConfig?.indexType).toBe('hnsw');
    });

    it('should validate vector field with valid config', () => {
      const validField = {
        name: 'product_embedding',
        label: 'Product Embedding',
        type: 'vector' as const,
        vectorConfig: {
          dimensions: 768,
          distanceMetric: 'dotProduct' as const,
          normalized: false,
          indexed: true,
          indexType: 'ivfflat' as const,
        },
      };

      const result = FieldSchema.safeParse(validField);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.vectorConfig?.dimensions).toBe(768);
        expect(result.data.vectorConfig?.distanceMetric).toBe('dotProduct');
        expect(result.data.vectorConfig?.indexType).toBe('ivfflat');
      }
    });

    it('should accept all distance metrics', () => {
      const metrics = ['cosine', 'euclidean', 'dotProduct', 'manhattan'] as const;
      
      metrics.forEach(metric => {
        const config = {
          dimensions: 100,
          distanceMetric: metric,
          normalized: false,
          indexed: true,
        };

        expect(() => VectorConfigSchema.parse(config)).not.toThrow();
      });
    });

    it('should accept all index types', () => {
      const indexTypes = ['hnsw', 'ivfflat', 'flat'] as const;
      
      indexTypes.forEach(indexType => {
        const config = {
          dimensions: 100,
          distanceMetric: 'cosine' as const,
          normalized: false,
          indexed: true,
          indexType,
        };

        expect(() => VectorConfigSchema.parse(config)).not.toThrow();
      });
    });

    it('should apply default values for vector config', () => {
      const config = VectorConfigSchema.parse({
        dimensions: 1536,
      });
      
      expect(config.dimensions).toBe(1536);
      expect(config.distanceMetric).toBe('cosine');
      expect(config.normalized).toBe(false);
      expect(config.indexed).toBe(true);
    });

    it('should reject invalid dimension values', () => {
      const invalidDimensions = [0, -1, 10001, 1.5];
      
      invalidDimensions.forEach(dimensions => {
        expect(() => VectorConfigSchema.parse({ dimensions })).toThrow();
      });
    });

    it('should accept valid dimension range', () => {
      const validDimensions = [1, 128, 512, 768, 1536, 3072, 10000];
      
      validDimensions.forEach(dimensions => {
        expect(() => VectorConfigSchema.parse({ dimensions })).not.toThrow();
      });
    });

    it('should work with OpenAI embeddings', () => {
      const openAIField = Field.vector(1536, {
        name: 'text_embedding',
        label: 'Text Embedding (OpenAI)',
        description: 'OpenAI text-embedding-ada-002',
        vectorConfig: {
          dimensions: 1536,
          distanceMetric: 'cosine',
          normalized: true,
          indexed: true,
          indexType: 'hnsw',
        },
      });
      
      expect(openAIField.type).toBe('vector');
      expect(openAIField.vectorConfig?.dimensions).toBe(1536);
      expect(openAIField.description).toBe('OpenAI text-embedding-ada-002');
    });

    it('should work with image embeddings', () => {
      const imageEmbeddingField = Field.vector(512, {
        name: 'image_features',
        label: 'Image Features (ResNet-50)',
        vectorConfig: {
          dimensions: 512,
          distanceMetric: 'euclidean',
          normalized: true,
          indexed: true,
        },
      });
      
      expect(imageEmbeddingField.type).toBe('vector');
      expect(imageEmbeddingField.vectorConfig?.dimensions).toBe(512);
      expect(imageEmbeddingField.vectorConfig?.distanceMetric).toBe('euclidean');
    });

    it('should support RAG use case', () => {
      const ragField = Field.vector(768, {
        name: 'document_embedding',
        label: 'Document Embedding',
        description: 'Semantic embedding for RAG retrieval',
        required: false,
        searchable: true,
        vectorConfig: {
          dimensions: 768,
          distanceMetric: 'cosine',
          normalized: true,
          indexed: true,
          indexType: 'hnsw',
        },
      });
      
      expect(ragField.type).toBe('vector');
      expect(ragField.searchable).toBe(true);
      expect(ragField.vectorConfig?.indexed).toBe(true);
      expect(ragField.vectorConfig?.indexType).toBe('hnsw');
    });
  });

  describe('FileAttachmentConfigSchema', () => {
    it('should accept minimal config', () => {
      const config = FileAttachmentConfigSchema.parse({});
      
      expect(config.virusScan).toBe(false);
      expect(config.virusScanOnUpload).toBe(true);
      expect(config.quarantineOnThreat).toBe(true);
      expect(config.allowMultiple).toBe(false);
      expect(config.allowReplace).toBe(true);
      expect(config.allowDelete).toBe(true);
      expect(config.requireUpload).toBe(false);
      expect(config.extractMetadata).toBe(true);
      expect(config.extractText).toBe(false);
      expect(config.versioningEnabled).toBe(false);
      expect(config.publicRead).toBe(false);
      expect(config.presignedUrlExpiry).toBe(3600);
    });

    it('should accept file size limits', () => {
      const config = FileAttachmentConfigSchema.parse({
        minSize: 1024,
        maxSize: 10485760, // 10MB
      });
      
      expect(config.minSize).toBe(1024);
      expect(config.maxSize).toBe(10485760);
    });

    it('should accept allowed file types', () => {
      const config = FileAttachmentConfigSchema.parse({
        allowedTypes: ['.pdf', '.docx', '.xlsx'],
        allowedMimeTypes: ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      });
      
      expect(config.allowedTypes).toHaveLength(3);
      expect(config.allowedMimeTypes).toHaveLength(2);
    });

    it('should accept blocked file types', () => {
      const config = FileAttachmentConfigSchema.parse({
        blockedTypes: ['.exe', '.bat', '.sh'],
        blockedMimeTypes: ['application/x-executable'],
      });
      
      expect(config.blockedTypes).toHaveLength(3);
      expect(config.blockedMimeTypes).toHaveLength(1);
    });

    it('should accept virus scanning configuration', () => {
      const config = FileAttachmentConfigSchema.parse({
        virusScan: true,
        virusScanProvider: 'clamav',
        virusScanOnUpload: true,
        quarantineOnThreat: true,
      });
      
      expect(config.virusScan).toBe(true);
      expect(config.virusScanProvider).toBe('clamav');
      expect(config.virusScanOnUpload).toBe(true);
      expect(config.quarantineOnThreat).toBe(true);
    });

    it('should accept all virus scan providers', () => {
      const providers = ['clamav', 'virustotal', 'metadefender', 'custom'] as const;
      
      providers.forEach(provider => {
        const config = {
          virusScan: true,
          virusScanProvider: provider,
        };
        
        expect(() => FileAttachmentConfigSchema.parse(config)).not.toThrow();
      });
    });

    it('should accept storage configuration', () => {
      const config = FileAttachmentConfigSchema.parse({
        storageProvider: 'aws_s3_storage',
        storageBucket: 'user_uploads',
        storagePrefix: 'documents/',
      });
      
      expect(config.storageProvider).toBe('aws_s3_storage');
      expect(config.storageBucket).toBe('user_uploads');
      expect(config.storagePrefix).toBe('documents/');
    });

    it('should accept image validation config', () => {
      const config = FileAttachmentConfigSchema.parse({
        imageValidation: {
          minWidth: 100,
          maxWidth: 4096,
          minHeight: 100,
          maxHeight: 4096,
          aspectRatio: '16:9',
          generateThumbnails: true,
          thumbnailSizes: [
            { name: 'small', width: 150, height: 150, crop: true },
            { name: 'medium', width: 300, height: 300, crop: true },
            { name: 'large', width: 600, height: 600, crop: false },
          ],
          preserveMetadata: false,
          autoRotate: true,
        },
      });
      
      expect(config.imageValidation?.minWidth).toBe(100);
      expect(config.imageValidation?.maxWidth).toBe(4096);
      expect(config.imageValidation?.generateThumbnails).toBe(true);
      expect(config.imageValidation?.thumbnailSizes).toHaveLength(3);
    });

    it('should accept upload behavior config', () => {
      const config = FileAttachmentConfigSchema.parse({
        allowMultiple: true,
        allowReplace: false,
        allowDelete: false,
        requireUpload: true,
      });
      
      expect(config.allowMultiple).toBe(true);
      expect(config.allowReplace).toBe(false);
      expect(config.allowDelete).toBe(false);
      expect(config.requireUpload).toBe(true);
    });

    it('should accept metadata extraction config', () => {
      const config = FileAttachmentConfigSchema.parse({
        extractMetadata: true,
        extractText: true,
      });
      
      expect(config.extractMetadata).toBe(true);
      expect(config.extractText).toBe(true);
    });

    it('should accept versioning config', () => {
      const config = FileAttachmentConfigSchema.parse({
        versioningEnabled: true,
        maxVersions: 10,
      });
      
      expect(config.versioningEnabled).toBe(true);
      expect(config.maxVersions).toBe(10);
    });

    it('should accept access control config', () => {
      const config = FileAttachmentConfigSchema.parse({
        publicRead: true,
        presignedUrlExpiry: 1800,
      });
      
      expect(config.publicRead).toBe(true);
      expect(config.presignedUrlExpiry).toBe(1800);
    });

    it('should enforce presigned URL expiry limits', () => {
      // Min 60 seconds
      expect(() => FileAttachmentConfigSchema.parse({
        presignedUrlExpiry: 59,
      })).toThrow();
      
      expect(() => FileAttachmentConfigSchema.parse({
        presignedUrlExpiry: 60,
      })).not.toThrow();
      
      // Max 7 days
      expect(() => FileAttachmentConfigSchema.parse({
        presignedUrlExpiry: 604800,
      })).not.toThrow();
      
      expect(() => FileAttachmentConfigSchema.parse({
        presignedUrlExpiry: 604801,
      })).toThrow();
    });

    it('should validate file field with attachment config', () => {
      const field = {
        name: 'resume',
        label: 'Resume',
        type: 'file' as const,
        required: true,
        multiple: false,
        fileAttachmentConfig: {
          maxSize: 5242880, // 5MB
          allowedTypes: ['.pdf', '.docx'],
          virusScan: true,
          virusScanProvider: 'clamav' as const,
          storageProvider: 'main_storage',
          storageBucket: 'user_uploads',
          storagePrefix: 'resumes/',
        },
      };

      const result = FieldSchema.safeParse(field);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.fileAttachmentConfig?.maxSize).toBe(5242880);
        expect(result.data.fileAttachmentConfig?.allowedTypes).toHaveLength(2);
        expect(result.data.fileAttachmentConfig?.virusScan).toBe(true);
      }
    });

    it('should validate image field with attachment config', () => {
      const field = {
        name: 'profile_picture',
        label: 'Profile Picture',
        type: 'image' as const,
        required: false,
        fileAttachmentConfig: {
          maxSize: 2097152, // 2MB
          allowedTypes: ['.jpg', '.jpeg', '.png', '.webp'],
          imageValidation: {
            minWidth: 200,
            maxWidth: 2048,
            minHeight: 200,
            maxHeight: 2048,
            aspectRatio: '1:1',
            generateThumbnails: true,
            thumbnailSizes: [
              { name: 'thumb', width: 100, height: 100, crop: true },
              { name: 'small', width: 200, height: 200, crop: true },
            ],
            autoRotate: true,
          },
          storageProvider: 'main_storage',
          storageBucket: 'user_uploads',
          storagePrefix: 'avatars/',
        },
      };

      const result = FieldSchema.safeParse(field);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.fileAttachmentConfig?.imageValidation?.aspectRatio).toBe('1:1');
        expect(result.data.fileAttachmentConfig?.imageValidation?.thumbnailSizes).toHaveLength(2);
      }
    });

    it('should work with comprehensive file upload configuration', () => {
      const field = {
        name: 'contract_document',
        label: 'Contract Document',
        type: 'file' as const,
        description: 'Upload signed contract (PDF only)',
        required: true,
        multiple: false,
        fileAttachmentConfig: {
          minSize: 1024, // 1KB
          maxSize: 52428800, // 50MB
          allowedTypes: ['.pdf'],
          allowedMimeTypes: ['application/pdf'],
          virusScan: true,
          virusScanProvider: 'virustotal' as const,
          virusScanOnUpload: true,
          quarantineOnThreat: true,
          storageProvider: 'secure_storage',
          storageBucket: 'legal_documents',
          storagePrefix: 'contracts/',
          allowMultiple: false,
          allowReplace: true,
          allowDelete: false,
          requireUpload: true,
          extractMetadata: true,
          extractText: true,
          versioningEnabled: true,
          maxVersions: 5,
          publicRead: false,
          presignedUrlExpiry: 3600,
        },
      };

      const result = FieldSchema.safeParse(field);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('file');
        expect(result.data.fileAttachmentConfig?.virusScan).toBe(true);
        expect(result.data.fileAttachmentConfig?.versioningEnabled).toBe(true);
        expect(result.data.fileAttachmentConfig?.extractText).toBe(true);
        expect(result.data.fileAttachmentConfig?.allowDelete).toBe(false);
      }
    });

    it('should reject negative file sizes', () => {
      expect(() => FileAttachmentConfigSchema.parse({
        minSize: -1,
      })).toThrow();
      
      expect(() => FileAttachmentConfigSchema.parse({
        maxSize: 0,
      })).toThrow();
    });

    it('should reject invalid image dimensions', () => {
      expect(() => FileAttachmentConfigSchema.parse({
        imageValidation: {
          minWidth: 0,
        },
      })).toThrow();
      
      expect(() => FileAttachmentConfigSchema.parse({
        imageValidation: {
          maxHeight: -100,
        },
      })).toThrow();
    });

    it('should reject invalid versioning config', () => {
      expect(() => FileAttachmentConfigSchema.parse({
        versioningEnabled: true,
        maxVersions: 0,
      })).toThrow();
    });

    it('should reject minSize greater than maxSize', () => {
      expect(() => FileAttachmentConfigSchema.parse({
        minSize: 1000,
        maxSize: 500,
      })).toThrow();
      
      // Verify the specific error message
      try {
        FileAttachmentConfigSchema.parse({
          minSize: 1000,
          maxSize: 500,
        });
      } catch (error: any) {
        expect(error.issues[0].message).toContain('minSize must be less than or equal to maxSize');
      }
    });

    it('should accept valid minSize and maxSize', () => {
      const config = FileAttachmentConfigSchema.parse({
        minSize: 500,
        maxSize: 1000,
      });
      
      expect(config.minSize).toBe(500);
      expect(config.maxSize).toBe(1000);
    });

    it('should reject virusScanProvider without virusScan enabled', () => {
      expect(() => FileAttachmentConfigSchema.parse({
        virusScan: false,
        virusScanProvider: 'clamav',
      })).toThrow();
      
      // Verify the specific error message
      try {
        FileAttachmentConfigSchema.parse({
          virusScan: false,
          virusScanProvider: 'clamav',
        });
      } catch (error: any) {
        expect(error.issues[0].message).toContain('virusScanProvider requires virusScan to be enabled');
      }
    });

    it('should accept virusScanProvider when virusScan is enabled', () => {
      const config = FileAttachmentConfigSchema.parse({
        virusScan: true,
        virusScanProvider: 'clamav',
      });
      
      expect(config.virusScan).toBe(true);
      expect(config.virusScanProvider).toBe('clamav');
    });
  });
});

// ============================================================================
// Protocol Improvement Tests: Field group and conditionalRequired
// ============================================================================

describe('FieldSchema - group property', () => {
  it('should accept a field with group', () => {
    const result = FieldSchema.parse({
      type: 'text',
      group: 'contact_info',
    });
    expect(result.group).toBe('contact_info');
  });

  it('should accept a field without group (optional)', () => {
    const result = FieldSchema.parse({
      type: 'text',
    });
    expect(result.group).toBeUndefined();
  });
});

describe('FieldSchema - conditionalRequired property', () => {
  it('should accept a field with conditionalRequired formula', () => {
    const result = FieldSchema.parse({
      type: 'text',
      conditionalRequired: "status = 'closed_won'",
    });
    expect(result.conditionalRequired).toEqual({ dialect: 'cel', source: "status = 'closed_won'" });
  });

  it('should accept a field without conditionalRequired (optional)', () => {
    const result = FieldSchema.parse({
      type: 'text',
    });
    expect(result.conditionalRequired).toBeUndefined();
  });

  it('should allow combining required and conditionalRequired', () => {
    const result = FieldSchema.parse({
      type: 'text',
      required: false,
      conditionalRequired: 'amount > 1000',
    });
    expect(result.required).toBe(false);
    expect(result.conditionalRequired).toEqual({ dialect: 'cel', source: 'amount > 1000' });
  });
});

describe('FieldSchema - conditional field rules (visibleWhen / readonlyWhen / requiredWhen)', () => {
  it('accepts CEL predicates and normalizes them to the { dialect, source } envelope', () => {
    const result = FieldSchema.parse({
      type: 'currency',
      visibleWhen: "record.type == 'invoice'",
      readonlyWhen: "record.status == 'paid'",
      requiredWhen: "record.status == 'sent'",
    });
    expect(result.visibleWhen).toEqual({ dialect: 'cel', source: "record.type == 'invoice'" });
    expect(result.readonlyWhen).toEqual({ dialect: 'cel', source: "record.status == 'paid'" });
    expect(result.requiredWhen).toEqual({ dialect: 'cel', source: "record.status == 'sent'" });
  });

  it('all three are optional', () => {
    const result = FieldSchema.parse({ type: 'text' });
    expect(result.visibleWhen).toBeUndefined();
    expect(result.readonlyWhen).toBeUndefined();
    expect(result.requiredWhen).toBeUndefined();
  });

  it('requiredWhen and its alias conditionalRequired can coexist', () => {
    const result = FieldSchema.parse({
      type: 'text',
      requiredWhen: "record.status == 'sent'",
      conditionalRequired: "record.status == 'closed_won'",
    });
    expect(result.requiredWhen).toEqual({ dialect: 'cel', source: "record.status == 'sent'" });
    expect(result.conditionalRequired).toEqual({ dialect: 'cel', source: "record.status == 'closed_won'" });
  });
});

// ============================================================================
// columnName — Storage Layer Mapping
// ============================================================================

describe('FieldSchema - columnName', () => {
  it('should accept columnName for storage layer mapping', () => {
    const result = FieldSchema.parse({
      type: 'text',
      columnName: 'user_email',
    });
    expect(result.columnName).toBe('user_email');
  });

  it('should accept field without columnName (optional, defaults to key)', () => {
    const result = FieldSchema.parse({
      type: 'text',
    });
    expect(result.columnName).toBeUndefined();
  });

  it('should accept camelCase columnName for legacy DB compatibility', () => {
    const result = FieldSchema.parse({
      type: 'datetime',
      columnName: 'expiresAt',
    });
    expect(result.columnName).toBe('expiresAt');
  });
});
