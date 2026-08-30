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
  
  // `configuration` and `capabilities` were retired (#11332, ADR-0049
  // enforce-or-remove): nothing ever read either container. The settings this
  // driver needs are passed by the host that composes it (the options object
  // handed to its constructor), and protocol/capability discovery never
  // consulted the declaration — dependency resolution runs off top-level
  // `dependencies`.

  // `contributes.drivers` was retired (#10724, ADR-0049): the declaration drove
  // nothing — this driver is wired by registering the `driver.memory` kernel
  // service (the objectql plugin calls `registerDriver` on `driver.*` services),
  // which is the enforced channel.
};

export default MemoryDriverPlugin;
