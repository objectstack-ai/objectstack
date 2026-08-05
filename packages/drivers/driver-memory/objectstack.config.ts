// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectStackManifest } from '@objectstack/spec/system';

/**
 * In-Memory Driver Plugin Manifest
 * 
 * Reference implementation of a storage driver that stores data in memory.
 * Demonstrates the driver protocol implementation pattern.
 */
const MemoryDriverPlugin: ObjectStackManifest = {
  id: 'com.objectstack.driver.memory',
  name: 'In-Memory Driver',
  version: '1.0.0',
  type: 'driver',
  scope: 'project',
  description: 'A reference specification implementation of the IDataDriver interface using in-memory arrays. Suitable for testing and development.',
  
  configuration: {
    title: 'Memory Driver Settings',
    properties: {
      seedData: {
        type: 'boolean',
        default: false,
        description: 'Pre-populate the database with example data on startup'
      }
    }
  },

  // Plugin Capability Declaration
  capabilities: {
    // Protocols This Driver Implements
    implements: [
      {
        protocol: {
          id: 'com.objectstack.protocol.storage.v1',
          label: 'Storage Protocol v1',
          version: { major: 1, minor: 0, patch: 0 },
          description: 'Standard data storage and retrieval operations',
        },
        conformance: 'partial',
        implementedFeatures: [
          'basic_crud',
          'pagination',
        ],
        features: [
          {
            name: 'basic_crud',
            enabled: true,
            description: 'Create, read, update, delete operations',
          },
          {
            name: 'pagination',
            enabled: true,
            description: 'Basic pagination via limit/offset',
          },
          {
            name: 'query_filters',
            enabled: false,
            description: 'Advanced query filtering',
          },
          {
            name: 'aggregations',
            enabled: false,
            description: 'Count, sum, avg operations',
          },
          {
            name: 'sorting',
            enabled: false,
            description: 'Result set sorting',
          },
          {
            name: 'transactions',
            enabled: false,
            description: 'ACID transaction support',
          },
          {
            name: 'joins',
            enabled: false,
            description: 'Cross-object joins',
          },
        ],
        certified: false,
      },
    ],

    // Interfaces This Driver Provides
    provides: [
      {
        id: 'com.objectstack.driver.memory.interface.driver',
        name: 'IDataDriver',
        description: 'Standard ObjectStack driver interface for data operations',
        version: { major: 1, minor: 0, patch: 0 },
        stability: 'stable',
        methods: [
          {
            name: 'connect',
            description: 'Initialize driver connection',
            parameters: [],
            returnType: 'Promise<void>',
            async: true,
          },
          {
            name: 'disconnect',
            description: 'Close driver connection',
            parameters: [],
            returnType: 'Promise<void>',
            async: true,
          },
          {
            name: 'create',
            description: 'Create a new record',
            parameters: [
              {
                name: 'object',
                type: 'string',
                required: true,
                description: 'Object name',
              },
              {
                name: 'data',
                type: 'Record<string, any>',
                required: true,
                description: 'Record data',
              },
            ],
            returnType: 'Promise<any>',
            async: true,
          },
          {
            name: 'find',
            description: 'Query records',
            parameters: [
              {
                name: 'object',
                type: 'string',
                required: true,
                description: 'Object name',
              },
              {
                name: 'query',
                type: 'QueryInput',
                required: false,
                description: 'Query parameters',
              },
            ],
            returnType: 'Promise<any[]>',
            async: true,
          },
          {
            name: 'findOne',
            description: 'Find a single record by ID',
            parameters: [
              {
                name: 'object',
                type: 'string',
                required: true,
                description: 'Object name',
              },
              {
                name: 'id',
                type: 'string',
                required: true,
                description: 'Record ID',
              },
            ],
            returnType: 'Promise<any>',
            async: true,
          },
          {
            name: 'update',
            description: 'Update a record',
            parameters: [
              {
                name: 'object',
                type: 'string',
                required: true,
                description: 'Object name',
              },
              {
                name: 'id',
                type: 'string',
                required: true,
                description: 'Record ID',
              },
              {
                name: 'data',
                type: 'Record<string, any>',
                required: true,
                description: 'Updated record data',
              },
            ],
            returnType: 'Promise<any>',
            async: true,
          },
          {
            name: 'delete',
            description: 'Delete a record',
            parameters: [
              {
                name: 'object',
                type: 'string',
                required: true,
                description: 'Object name',
              },
              {
                name: 'id',
                type: 'string',
                required: true,
                description: 'Record ID',
              },
            ],
            returnType: 'Promise<boolean>',
            async: true,
          },
          {
            name: 'count',
            description: 'Count records',
            parameters: [
              {
                name: 'object',
                type: 'string',
                required: true,
                description: 'Object name',
              },
              {
                name: 'query',
                type: 'QueryInput',
                required: false,
                description: 'Query parameters',
              },
            ],
            returnType: 'Promise<number>',
            async: true,
          },
        ],
      },
    ],

    // No external plugin dependencies (this is a core driver)
    requires: [],

    // No extension points defined
    extensionPoints: [],

    // No extensions contributed
    extensions: [],
  },

  contributes: {
    drivers: [
      {
        id: 'memory',
        label: 'In-Memory Storage',
        description: 'Stores data in memory (volatile, for testing/development)',
      },
    ],
  }
};

export default MemoryDriverPlugin;
