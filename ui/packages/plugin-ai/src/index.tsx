/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The three AI components' registrations.
 *
 * Every `inputs` entry below names a key the component beneath it actually
 * reads. Seven entries used to sit here that no renderer read — `formId`,
 * `objectName`, `fields`, `autoFill` on `ai-form-assist`, `objectName` and
 * `maxResults` on `ai-recommendations`, `objectName` on `nl-query` — so the
 * designer offered them from a list, the JSON validated, and the runtime
 * dropped them silently. They are retired (objectui#8178, ADR-0049, director
 * decision batch #78, 2026-09-07) and are `?: never` tombstones on their
 * schemas; their absence from these lists is pinned by
 * `registrationInputs-8178.test.ts`.
 */

import { ComponentRegistry } from '@object-ui/core';
import { AIFormAssist } from './AIFormAssist';
import { AIRecommendations } from './AIRecommendations';
import { NLQueryInput } from './NLQueryInput';

export { AIFormAssist, AIRecommendations, NLQueryInput };

// Register AI form assist component
ComponentRegistry.register(
  'ai-form-assist',
  AIFormAssist,
  {
    label: 'AI Form Assist',
    category: 'AI',
    inputs: [
      { name: 'suggestions', type: 'code' },
      { name: 'showConfidence', type: 'boolean' },
      { name: 'showReasoning', type: 'boolean' },
    ]
  }
);

// Register AI recommendations component
ComponentRegistry.register(
  'ai-recommendations',
  AIRecommendations,
  {
    label: 'AI Recommendations',
    category: 'AI',
    inputs: [
      { name: 'recommendations', type: 'code' },
      { name: 'showScores', type: 'boolean' },
      { name: 'layout', type: 'enum', enum: [
        { label: 'List', value: 'list' },
        { label: 'Grid', value: 'grid' },
      ] },
      { name: 'emptyMessage', type: 'string' },
    ]
  }
);

// Register NL Query component
ComponentRegistry.register(
  'nl-query',
  NLQueryInput,
  {
    label: 'Natural Language Query',
    category: 'AI',
    inputs: [
      { name: 'placeholder', type: 'string' },
      { name: 'suggestions', type: 'array' },
      { name: 'showHistory', type: 'boolean' },
    ]
  }
);
