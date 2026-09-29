// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #20590 position 5 — MEASUREMENT FIXTURE for the `os validate` / `os lint`
// doors. Not an app; never built into anything. See ../vitest.probe.config.mts.
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { probeFlow } from '../probe-flow.js';

export default defineStack({
  manifest: {
    id: 'com.probe.p5-open-map-fixture',
    namespace: 'probe',
    version: '0.0.0',
    type: 'app',
    name: 'P5 open-map door fixture',
    description: 'One flow carrying credential-shaped literals in open maps, for the author-time doors.',
  },
  objects: [
    ObjectSchema.create({
      name: 'probe_note',
      sharingModel: 'public_read_write',
      label: 'Probe Note',
      pluralLabel: 'Probe Notes',
      fields: { name: Field.text({ label: 'Name', required: true }) },
    }),
  ],
  flows: [probeFlow('probe_open_map_p5_cli') as never],
});
