/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * A flow LAUNCH speaks the flow's own toasts as the engine served them
 * (objectstack#28054). The engine renders `successMessage` / `errorMessage` as
 * `{{ }}` templates and picks their `flows.FLOW.*` translations in the run's
 * locale, so the served strings arrive translated and filled; the launch no
 * longer overlays the host's bundle (objectui#12075 did), because the bundle's
 * entry is the TEMPLATE and would put raw holes over the filled sentence. A
 * launch is handed only the host's language now, for a refused write's
 * permission line, so no bundle can reach the toast.
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
import { launchConsoleFlow } from '../flowLaunch';

const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));

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
        language,
    });
}

beforeEach(() => {
    toasts.error.mockClear();
    toasts.success.mockClear();
});

describe("launchConsoleFlow — the flow's own toasts as served (objectstack#28054)", () => {
    it('speaks the served successMessage of a straight-through run', async () => {
        const out = await launch(answering({ success: true, data: { success: true, status: 'completed', successMessage: '已升级 3 张工单' } }));
        expect(out.door).toBe('trigger');
        expect(out.judged.successToast).toBe('已升级 3 张工单');
        expect(toasts.success).toHaveBeenCalledWith('已升级 3 张工单');
    });

    it('hands the ActionRunner the served errorMessage of a failed run', async () => {
        const out = await launch(answering({ success: true, data: { success: false, error: 'boom', errorMessage: '3 张工单升级失败' } }));
        expect(out.judged.result).toEqual({ success: false, error: '3 张工单升级失败' });
    });

    it('keeps the served strings in every language', async () => {
        const out = await launch(
            answering({ success: true, data: { success: false, error: 'boom', errorMessage: 'Escalation failed for 3 cases' } }),
            'en',
        );
        expect(out.judged.result).toEqual({ success: false, error: 'Escalation failed for 3 cases' });
    });
});
