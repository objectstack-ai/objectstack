// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectStackManifest } from '@objectstack/spec/system';

/**
 * Hono Server Plugin Manifest
 * 
 * HTTP server adapter plugin using the Hono framework.
 * Provides northbound HTTP/REST API gateway capabilities.
 */
const HonoServerPlugin: ObjectStackManifest = {
  id: 'com.objectstack.server.hono',
  name: 'Hono Server Adapter',
  version: '1.0.0',
  type: 'adapter',
  scope: 'project',
  description: 'HTTP server adapter using Hono framework. Exposes ObjectStack Runtime Protocol via REST API endpoints.',
  
  configuration: {
    title: 'Hono Server Configuration',
    properties: {
      port: {
        type: 'number',
        default: 3000,
        description: 'HTTP server port',
      },
      staticRoot: {
        type: 'string',
        description: 'Path to static files directory (optional)',
      },
    },
  },

  // Plugin Capability Declaration
  capabilities: {
    // Protocols This Plugin Implements
    implements: [
      {
        protocol: {
          id: 'com.objectstack.protocol.http.v1',
          label: 'HTTP Server Protocol v1',
          version: { major: 1, minor: 0, patch: 0 },
          description: 'Standard HTTP server capabilities',
        },
        conformance: 'full',
        certified: false,
      },
      {
        protocol: {
          id: 'com.objectstack.protocol.api.rest.v1',
          label: 'REST API Protocol v1',
          version: { major: 1, minor: 0, patch: 0 },
          description: 'RESTful API endpoint implementation',
        },
        conformance: 'full',
        features: [
          {
            name: 'meta_protocol',
            enabled: true,
            description: 'Metadata discovery endpoints',
          },
          {
            name: 'data_protocol',
            enabled: true,
            description: 'CRUD data operations',
          },
          {
            name: 'ui_protocol',
            enabled: true,
            description: 'UI view metadata endpoints',
          },
        ],
        certified: false,
      },
    ],

    // Interfaces This Plugin Provides
    provides: [
      {
        id: 'com.objectstack.server.hono.interface.http_server',
        name: 'IHttpServer',
        description: 'HTTP server service interface',
        version: { major: 1, minor: 0, patch: 0 },
        stability: 'stable',
        methods: [
          {
            name: 'get',
            description: 'Register GET route handler',
            parameters: [
              {
                name: 'path',
                type: 'string',
                required: true,
                description: 'Route path pattern',
              },
              {
                name: 'handler',
                type: 'Function',
                required: true,
                description: 'Route handler function',
              },
            ],
            returnType: 'void',
            async: false,
          },
          {
            name: 'post',
            description: 'Register POST route handler',
            parameters: [
              {
                name: 'path',
                type: 'string',
                required: true,
                description: 'Route path pattern',
              },
              {
                name: 'handler',
                type: 'Function',
                required: true,
                description: 'Route handler function',
              },
            ],
            returnType: 'void',
            async: false,
          },
          {
            name: 'patch',
            description: 'Register PATCH route handler',
            parameters: [
              {
                name: 'path',
                type: 'string',
                required: true,
                description: 'Route path pattern',
              },
              {
                name: 'handler',
                type: 'Function',
                required: true,
                description: 'Route handler function',
              },
            ],
            returnType: 'void',
            async: false,
          },
          {
            name: 'delete',
            description: 'Register DELETE route handler',
            parameters: [
              {
                name: 'path',
                type: 'string',
                required: true,
                description: 'Route path pattern',
              },
              {
                name: 'handler',
                type: 'Function',
                required: true,
                description: 'Route handler function',
              },
            ],
            returnType: 'void',
            async: false,
          },
          {
            name: 'listen',
            description: 'Start the HTTP server',
            parameters: [
              {
                name: 'port',
                type: 'number',
                required: true,
                description: 'Port number',
              },
            ],
            returnType: 'Promise<void>',
            async: true,
          },
          {
            name: 'close',
            description: 'Stop the HTTP server',
            parameters: [],
            returnType: 'void',
            async: false,
          },
        ],
      },
    ],

    // Dependencies on Other Plugins/Services
    requires: [
      {
        pluginId: 'com.objectstack.engine.objectql',
        version: '^0.6.0',
        optional: true,
        reason: 'ObjectStack Runtime Protocol implementation service',
        requiredCapabilities: [
          'com.objectstack.protocol.runtime.v1',
        ],
      },
    ],

    // Extension Points This Plugin Defines
    extensionPoints: [
      {
        id: 'com.objectstack.server.hono.extension.middleware',
        name: 'HTTP Middleware',
        description: 'Register custom HTTP middleware',
        type: 'hook',
        cardinality: 'multiple',
        contract: {
          signature: '(req: Request, res: Response, next: Function) => void | Promise<void>',
        },
      },
      {
        id: 'com.objectstack.server.hono.extension.route',
        name: 'Custom Routes',
        description: 'Register custom API routes',
        type: 'action',
        cardinality: 'multiple',
        contract: {
          input: 'RouteDefinition',
          signature: '(app: HonoApp) => void',
        },
      },
    ],

    // No extensions contributed to other plugins
    extensions: [],
  },

  // `contributes.events` was retired (#10724, ADR-0049): the declaration drove
  // nothing — this plugin already subscribes to `kernel:ready` / `kernel:listening`
  // imperatively in its own code, which is the enforced channel.
};

export default HonoServerPlugin;
