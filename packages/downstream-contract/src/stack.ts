// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

// Assembles the consumer's metadata exactly as an objectstack.config.ts would,
// so the contract test exercises defineStack's schema parse + cross-reference
// validation (the metadata core of `objectstack validate`).
import { defineStack } from '@objectstack/spec';
import { Account } from './account.object.js';
import { AccountViews } from './account.view.js';
import { LogCallAction } from './log-call.action.js';
import { ArchiveAccountAction } from './modern.action.js';

export const ContractStack = defineStack({
  manifest: {
    id: 'com.objectstack.downstream_contract',
    namespace: 'dc',
    version: '1.0.0',
    type: 'app',
    name: 'Downstream Contract',
    description: 'Frozen third-party consumer gating spec backward compatibility (#2035).',
  },
  objects: [Account],
  views: [AccountViews],
  actions: [LogCallAction, ArchiveAccountAction],
});
