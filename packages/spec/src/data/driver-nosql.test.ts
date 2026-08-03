import { describe, it, expect } from 'vitest';
import {
  NoSQLDatabaseTypeSchema,
  NoSQLOperationTypeSchema,
  ConsistencyLevelSchema,
  NoSQLIndexTypeSchema,
  ShardingConfigSchema,
  ReplicationConfigSchema,
  NoSQLDataTypeMappingSchema,
  NoSQLDriverConfigSchema,
  NoSQLQueryOptionsSchema,
  AggregationPipelineSchema,
  NoSQLIndexSchema,
  NoSQLTransactionOptionsSchema,
} from './driver-nosql.zod';

describe('NoSQL Driver Protocol', () => {
  describe('NoSQLDatabaseTypeSchema', () => {
    it('should accept valid NoSQL database types', () => {
      expect(NoSQLDatabaseTypeSchema.parse('mongodb')).toBe('mongodb');
      expect(NoSQLDatabaseTypeSchema.parse('redis')).toBe('redis');
      expect(NoSQLDatabaseTypeSchema.parse('dynamodb')).toBe('dynamodb');
      expect(NoSQLDatabaseTypeSchema.parse('cassandra')).toBe('cassandra');
    });

    it('should reject invalid database types', () => {
      expect(() => NoSQLDatabaseTypeSchema.parse('mysql')).toThrow();
      expect(() => NoSQLDatabaseTypeSchema.parse('postgres')).toThrow();
    });
  });

  describe('ConsistencyLevelSchema', () => {
    it('should accept valid consistency levels', () => {
      expect(ConsistencyLevelSchema.parse('all')).toBe('all');
      expect(ConsistencyLevelSchema.parse('quorum')).toBe('quorum');
      expect(ConsistencyLevelSchema.parse('one')).toBe('one');
      expect(ConsistencyLevelSchema.parse('eventual')).toBe('eventual');
    });

    it('should reject invalid consistency levels', () => {
      expect(() => ConsistencyLevelSchema.parse('invalid')).toThrow();
    });
  });

  describe('ShardingConfigSchema', () => {
    it('should validate complete sharding configuration', () => {
      const config = {
        enabled: true,
        shardKey: '_id',
        shardingStrategy: 'hash' as const,
        numShards: 4,
      };
      
      const result = ShardingConfigSchema.parse(config);
      expect(result.enabled).toBe(true);
      expect(result.shardKey).toBe('_id');
      expect(result.shardingStrategy).toBe('hash');
      expect(result.numShards).toBe(4);
    });

    it('should use default values for optional fields', () => {
      const config = {};
      const result = ShardingConfigSchema.parse(config);
      expect(result.enabled).toBe(false);
    });

    it('should validate sharding strategies', () => {
      expect(ShardingConfigSchema.parse({ shardingStrategy: 'hash' })).toBeTruthy();
      expect(ShardingConfigSchema.parse({ shardingStrategy: 'range' })).toBeTruthy();
      expect(ShardingConfigSchema.parse({ shardingStrategy: 'zone' })).toBeTruthy();
    });
  });

  describe('ReplicationConfigSchema', () => {
    it('should validate complete replication configuration', () => {
      const config = {
        enabled: true,
        replicaSetName: 'rs0',
        replicas: 3,
        readPreference: 'primaryPreferred' as const,
        writeConcern: 'majority' as const,
      };
      
      const result = ReplicationConfigSchema.parse(config);
      expect(result.enabled).toBe(true);
      expect(result.replicaSetName).toBe('rs0');
      expect(result.replicas).toBe(3);
    });

    it('should validate read preferences', () => {
      expect(ReplicationConfigSchema.parse({ readPreference: 'primary' })).toBeTruthy();
      expect(ReplicationConfigSchema.parse({ readPreference: 'secondary' })).toBeTruthy();
      expect(ReplicationConfigSchema.parse({ readPreference: 'nearest' })).toBeTruthy();
    });

    it('should validate write concerns', () => {
      expect(ReplicationConfigSchema.parse({ writeConcern: 'majority' })).toBeTruthy();
      expect(ReplicationConfigSchema.parse({ writeConcern: 'acknowledged' })).toBeTruthy();
      expect(ReplicationConfigSchema.parse({ writeConcern: 'unacknowledged' })).toBeTruthy();
    });
  });

  describe('NoSQLDataTypeMappingSchema', () => {
    it('should validate MongoDB type mapping', () => {
      const mapping = {
        text: 'string',
        number: 'double',
        boolean: 'bool',
        date: 'date',
        datetime: 'date',
        json: 'object',
        uuid: 'string',
        binary: 'binData',
        array: 'array',
        objectId: 'objectId',
      };
      
      const result = NoSQLDataTypeMappingSchema.parse(mapping);
      expect(result.text).toBe('string');
      expect(result.number).toBe('double');
      expect(result.json).toBe('object');
    });

    it('should require core data types', () => {
      const invalidMapping = {
        text: 'string',
        // missing required fields
      };
      
      expect(() => NoSQLDataTypeMappingSchema.parse(invalidMapping)).toThrow();
    });
  });

  describe('NoSQLDriverConfigSchema', () => {
    it('should validate complete MongoDB driver configuration', () => {
      const config = {
        name: 'primary-mongo',
        type: 'nosql' as const,
        databaseType: 'mongodb' as const,
        connectionString: 'mongodb://localhost:27017/mydb',
        dataTypeMapping: {
          text: 'string',
          number: 'double',
          boolean: 'bool',
          date: 'date',
          datetime: 'date',
        },
        // #4634: only the live bits are authorable; MongoDB batches its DDL.
        capabilities: {
          batchSchemaSync: true,
        },
        consistency: 'quorum' as const,
        replication: {
          enabled: true,
          replicaSetName: 'rs0',
          replicas: 3,
          readPreference: 'primaryPreferred' as const,
          writeConcern: 'majority' as const,
        },
        sharding: {
          enabled: true,
          shardKey: '_id',
          shardingStrategy: 'hash' as const,
          numShards: 4,
        },
      };
      
      const result = NoSQLDriverConfigSchema.parse(config);
      expect(result.name).toBe('primary-mongo');
      expect(result.type).toBe('nosql');
      expect(result.databaseType).toBe('mongodb');
      expect(result.replication?.enabled).toBe(true);
      expect(result.sharding?.enabled).toBe(true);
    });

    it('should validate DynamoDB driver configuration', () => {
      const config = {
        name: 'dynamodb-main',
        type: 'nosql' as const,
        databaseType: 'dynamodb' as const,
        region: 'us-east-1',
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        dataTypeMapping: {
          text: 'S',
          number: 'N',
          boolean: 'BOOL',
          date: 'S',
          datetime: 'S',
        },
        // #4634: an empty advertisement is a valid one — every live bit is opt-in.
        capabilities: {},
        consistency: 'eventual' as const,
      };
      
      const result = NoSQLDriverConfigSchema.parse(config);
      expect(result.databaseType).toBe('dynamodb');
      expect(result.region).toBe('us-east-1');
      expect(result.consistency).toBe('eventual');
    });

    it('should enforce type must be "nosql"', () => {
      const invalidConfig = {
        name: 'test',
        type: 'sql',
        databaseType: 'mongodb',
        dataTypeMapping: {
          text: 'string',
          number: 'double',
          boolean: 'bool',
          date: 'date',
          datetime: 'date',
        },
        capabilities: {},
      };
      
      expect(() => NoSQLDriverConfigSchema.parse(invalidConfig)).toThrow();
    });
  });

  describe('NoSQLQueryOptionsSchema', () => {
    it('should validate query options', () => {
      const options = {
        consistency: 'quorum' as const,
        readFromSecondary: true,
        projection: { name: 1, email: 1, _id: 0 },
        timeout: 5000,
        useCursor: true,
        batchSize: 100,
        profile: true,
        hint: 'name_1_email_1',
      };
      
      const result = NoSQLQueryOptionsSchema.parse(options);
      expect(result.timeout).toBe(5000);
      expect(result.batchSize).toBe(100);
      expect(result.hint).toBe('name_1_email_1');
    });

    it('should accept minimal query options', () => {
      const options = {};
      const result = NoSQLQueryOptionsSchema.parse(options);
      expect(result).toEqual({});
    });
  });

  describe('AggregationPipelineSchema', () => {
    it('should validate aggregation pipeline', () => {
      const pipeline = {
        collection: 'orders',
        stages: [
          {
            operator: '$match',
            options: { status: 'completed' },
          },
          {
            operator: '$group',
            options: {
              _id: '$customerId',
              total: { $sum: '$amount' },
            },
          },
          {
            operator: '$sort',
            options: { total: -1 },
          },
        ],
        options: {
          timeout: 10000,
        },
      };
      
      const result = AggregationPipelineSchema.parse(pipeline);
      expect(result.collection).toBe('orders');
      expect(result.stages).toHaveLength(3);
      expect(result.stages[0].operator).toBe('$match');
    });
  });

  describe('NoSQLIndexSchema', () => {
    it('should validate single field index', () => {
      const index = {
        name: 'email_1',
        type: 'single' as const,
        fields: [{ field: 'email', order: 'asc' as const }],
        unique: true,
      };
      
      const result = NoSQLIndexSchema.parse(index);
      expect(result.name).toBe('email_1');
      expect(result.unique).toBe(true);
      expect(result.fields).toHaveLength(1);
    });

    it('should validate compound index', () => {
      const index = {
        name: 'name_1_email_1',
        type: 'compound' as const,
        fields: [
          { field: 'name', order: 'asc' as const },
          { field: 'email', order: 'asc' as const },
        ],
      };
      
      const result = NoSQLIndexSchema.parse(index);
      expect(result.type).toBe('compound');
      expect(result.fields).toHaveLength(2);
    });

    it('should validate text index', () => {
      const index = {
        name: 'content_text',
        type: 'text' as const,
        fields: [{ field: 'content', order: 'text' as const }],
      };
      
      const result = NoSQLIndexSchema.parse(index);
      expect(result.type).toBe('text');
    });

    it('should validate TTL index', () => {
      const index = {
        name: 'expiresAt_ttl',
        type: 'ttl' as const,
        fields: [{ field: 'expiresAt' }],
        expireAfterSeconds: 86400, // 24 hours
      };
      
      const result = NoSQLIndexSchema.parse(index);
      expect(result.type).toBe('ttl');
      expect(result.expireAfterSeconds).toBe(86400);
    });

    it('should validate geospatial index', () => {
      const index = {
        name: 'location_2dsphere',
        type: 'geospatial' as const,
        fields: [{ field: 'location', order: '2dsphere' as const }],
      };
      
      const result = NoSQLIndexSchema.parse(index);
      expect(result.type).toBe('geospatial');
      expect(result.fields[0].order).toBe('2dsphere');
    });
  });

  describe('NoSQLTransactionOptionsSchema', () => {
    it('should validate transaction options', () => {
      const options = {
        readConcern: 'majority' as const,
        writeConcern: 'majority' as const,
        readPreference: 'primary' as const,
        maxCommitTimeMS: 30000,
      };
      
      const result = NoSQLTransactionOptionsSchema.parse(options);
      expect(result.readConcern).toBe('majority');
      expect(result.writeConcern).toBe('majority');
      expect(result.maxCommitTimeMS).toBe(30000);
    });

    it('should validate read concern levels', () => {
      expect(NoSQLTransactionOptionsSchema.parse({ readConcern: 'local' })).toBeTruthy();
      expect(NoSQLTransactionOptionsSchema.parse({ readConcern: 'snapshot' })).toBeTruthy();
      expect(NoSQLTransactionOptionsSchema.parse({ readConcern: 'linearizable' })).toBeTruthy();
    });
  });
});
