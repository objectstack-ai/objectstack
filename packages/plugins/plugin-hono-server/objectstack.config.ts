// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { ObjectStackManifest } from '@objectstack/spec/kernel';

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
  
  // `configuration` and `capabilities` were retired (#11332, ADR-0049
  // enforce-or-remove): nothing ever read either container. The port and
  // static-root settings this adapter needs are passed by the host that
  // composes it (the options object handed to its constructor), and
  // protocol/capability discovery never consulted the declaration —
  // dependency resolution runs off top-level `dependencies`.

  // `contributes.events` was retired (#10724, ADR-0049): the declaration drove
  // nothing — this plugin already subscribes to `kernel:ready` / `kernel:listening`
  // imperatively in its own code, which is the enforced channel.
};

export default HonoServerPlugin;
