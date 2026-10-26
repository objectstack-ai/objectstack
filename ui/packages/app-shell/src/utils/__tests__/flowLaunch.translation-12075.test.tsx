/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * A flow LAUNCH answers the flow's own toasts in the host's language
 * (objectui#12075): `launchConsoleFlow` reads the `flows` bundle for the flow
 * the run belongs to out of the host's i18next instance, and hands it to
 * `interpretFlowResponse`. The instance here is a real `createI18n` one, loaded
 * through `transformSpecTranslations` the way the console loads an app bundle.
 *
 * ⚠️ A `.tsx` on purpose, though it renders nothing: the `.test.ts` suffix
 * puts a file in the `unit` project, which runs with `isolate: false` (one
 * module graph per worker, `vitest.config.mts`). There the `vi.mock('sonner')`
 * below holds only if no earlier file in the same worker already loaded
 * `flowLaunch` against another `sonner` — and then `launchConsoleFlow` speaks
 * through that file's toast, never this one's, so the success-toast pin reads
 * zero calls. Measured: green alone, red in CI's shard 4/12 and in a two-file
 * run where a file mocking `sonner` and importing `flowLaunch` goes first. The
 * `dom` project isolates each file, so the mock is this file's own.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createI18n, transformSpecTranslations } from '@object-ui/i18n';
import type { TranslationData } from '@objectstack/spec/system';
import { launchConsoleFlow } from '../flowLaunch';

const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));

const ZH_CN: TranslationData = {
    objects: { crm_case: { label: '工单', fields: { name: { label: '名称' } } } },
    flows: { case_escalate: { successMessage: '工单已升级', errorMessage: '升级失败' } },
};

function zhInstance() {
    const instance = createI18n({ defaultLanguage: 'zh-CN', detectBrowserLanguage: false });
    instance.addResourceBundle('zh-CN', 'translation', transformSpecTranslations(ZH_CN as Record<string, unknown>), true, true);
    return instance;
}

function answering(body: unknown) {
    return vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
}

function launch(fetch: ReturnType<typeof answering>, language = 'zh-CN') {
    return launchConsoleFlow({
        fetch,
        baseUrl: '',
        action: { name: 'case_escalate', type: 'flow', target: 'case_escalate' },
        objectName: 'crm_case',
        recordId: 'c1',
        triggerParams: {},
        objects: [],
        translation: { i18n: zhInstance(), language },
    });
}

beforeEach(() => {
    toasts.error.mockClear();
    toasts.success.mockClear();
});

describe('launchConsoleFlow — the flow\'s own toasts in the host\'s language (objectui#12075)', () => {
    it('speaks the translated successMessage of a straight-through run', async () => {
        const out = await launch(answering({ success: true, data: { success: true, status: 'completed', successMessage: 'Case escalated' } }));
        expect(out.door).toBe('trigger');
        expect(out.judged.successToast).toBe('工单已升级');
        expect(toasts.success).toHaveBeenCalledWith('工单已升级');
    });

    it('hands the ActionRunner the translated errorMessage of a failed run', async () => {
        const out = await launch(answering({ success: true, data: { success: false, error: 'boom', errorMessage: 'Escalation failed' } }));
        expect(out.judged.result).toEqual({ success: false, error: '升级失败' });
    });

    it('keeps the served strings in a language the bundle does not carry', async () => {
        const out = await launch(
            answering({ success: true, data: { success: false, error: 'boom', errorMessage: 'Escalation failed' } }),
            'en',
        );
        expect(out.judged.result).toEqual({ success: false, error: 'Escalation failed' });
    });
});
