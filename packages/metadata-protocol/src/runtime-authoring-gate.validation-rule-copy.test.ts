// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28448] The gate-local `validation-rule-copy-changed` rule, on the pure gate:
 * the registry's verdict on a tenant object's copies of packaged validation
 * rules arrives as a host fact (`packagedRuleCopyRefusal`) and is folded into
 * the gate's one 422 envelope, located on the body. The end-to-end pins (a real
 * `SchemaRegistry` behind a real save door) live in `@objectstack/objectql`'s
 * `protocol-validation-rule-copy-save-refusal.test.ts`, the one package that
 * has both.
 */

import { describe, expect, it } from 'vitest';
import { evaluateRuntimeAuthoringGate, VALIDATION_RULE_COPY_CHANGED } from './runtime-authoring-gate.js';

const PRESCRIPTION = 'To change the condition, add a rule under a new name, or change it in the package.';

const body = {
    name: 'vr_duty',
    label: 'Duty',
    sharingModel: 'private',
    fields: { status: { name: 'status', label: 'Status', type: 'text' } },
    validations: [
        { type: 'script', name: 'own_rule', message: 'Own.', condition: 'false' },
        { type: 'script', name: 'ext_rule', message: 'Ext.', condition: "record.status == 'x'" },
    ],
};

const refusal = {
    ruleName: 'ext_rule',
    changedKeys: ['condition'],
    message: `Object "vr_duty": validation rule "ext_rule" is a packaged rule. ${PRESCRIPTION}`,
};

describe('[#28448] the gate folds the registry\'s rule-copy verdict into its one refusal', () => {
    it('a refusing verdict is one located error, and the rule is disclosed as run', () => {
        const verdict = evaluateRuntimeAuthoringGate({
            type: 'object', name: 'vr_duty', state: 'active', body, packagedRuleCopyRefusal: refusal,
        });
        expect(verdict.error).toMatchObject({ code: 'INVALID_METADATA', status: 422 });
        const err = verdict.error as Error & { issues: any[]; rulesRun: string[] };
        expect(err.issues).toEqual([{
            severity: 'error',
            rule: VALIDATION_RULE_COPY_CHANGED,
            where: 'object "vr_duty" · validation rule "ext_rule"',
            path: 'validations[1].condition',
            message: refusal.message,
            hint: PRESCRIPTION,
        }]);
        expect(err.rulesRun).toContain(VALIDATION_RULE_COPY_CHANGED);
    });

    it('a clean verdict refuses nothing', () => {
        const verdict = evaluateRuntimeAuthoringGate({
            type: 'object', name: 'vr_duty', state: 'active', body, packagedRuleCopyRefusal: null,
        });
        expect(verdict.error).toBeNull();
    });

    it('no verdict (a host without the registry predicate) judges nothing', () => {
        const verdict = evaluateRuntimeAuthoringGate({ type: 'object', name: 'vr_duty', state: 'active', body });
        expect(verdict.error).toBeNull();
    });

    it('a draft is not gated (D1), whatever the verdict', () => {
        const verdict = evaluateRuntimeAuthoringGate({
            type: 'object', name: 'vr_duty', state: 'draft', body, packagedRuleCopyRefusal: refusal,
        });
        expect(verdict.error).toBeNull();
    });
});
