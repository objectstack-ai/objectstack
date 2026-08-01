// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.


export * from './flow.zod';
export * from './region-slots';
export * from './control-flow.zod';
export * from './io-node-config.zod';
export * from './builtin-node-config.zod';
export * from './schemaless-node-config.zod';
export * from './flow-function.zod';
export { flowForm } from './flow.form';
export * from './execution.zod';
export * from './webhook.zod';
export * from './approval.zod';
export * from './etl.zod';
// `trigger-registry.zod` was removed here (#4499). Despite the filename it
// contained no trigger registry — all 630 lines were a third declaration of
// the connector vocabulary (ConnectorSchema, Authentication*, Operation*,
// ConnectorInstance…), self-contained and read by nothing: the automation
// engine registers connectors against `integration/connector.zod.ts`
// (ADR-0097), and the stack `connectors:` collection parses
// DeclarativeConnectorEntrySchema. One capability, one contract
// (Prime Directive #12); the #4480 template cluster fell the same way.
export * from './time-relative-trigger.zod';
export * from './sync.zod';
export * from './state-machine.zod';
export * from './node-executor.zod';
export * from './flow-node-expression-paths';
export * from './bpmn-interop.zod';
export * from './bpmn-mapping';
