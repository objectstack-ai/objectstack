/**
 * ObjectUI local ESLint plugin — testability + type-discipline ratchet rules.
 */
import noSyntheticEventTrigger from './no-synthetic-event-trigger.js';
import noInlineSpecConfig from './no-inline-spec-config.js';
import noTryCatchAroundHook from './no-try-catch-around-hook.js';
import noDynamicImportInTestHook from './no-dynamic-import-in-test-hook.js';
import noQueryParamsUnderOptions from './no-query-params-under-options.js';
import noUnprefixedQueryParams from './no-unprefixed-query-params.js';
import buttonHasType from './button-has-type.js';
import noUnpairedBadgeColorClasses from './no-unpaired-badge-color-classes.js';
import noUnusedImports from './no-unused-imports.js';
import noLineAddressInTestName from './no-line-address-in-test-name.js';
import noBareNodeSlotGuard from './no-bare-node-slot-guard.js';

export default {
  rules: {
    'no-synthetic-event-trigger': noSyntheticEventTrigger,
    'no-inline-spec-config': noInlineSpecConfig,
    'no-try-catch-around-hook': noTryCatchAroundHook,
    'no-dynamic-import-in-test-hook': noDynamicImportInTestHook,
    'no-query-params-under-options': noQueryParamsUnderOptions,
    'no-unprefixed-query-params': noUnprefixedQueryParams,
    'button-has-type': buttonHasType,
    'no-unpaired-badge-color-classes': noUnpairedBadgeColorClasses,
    'no-unused-imports': noUnusedImports,
    'no-line-address-in-test-name': noLineAddressInTestName,
    'no-bare-node-slot-guard': noBareNodeSlotGuard,
  },
};
