import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AppPlugin } from './app-plugin';
import { PluginContext } from '@objectstack/core';
import { PROTOCOL_MAJOR } from '@objectstack/spec/kernel';

describe('AppPlugin', () => {
    let mockContext: PluginContext;

    beforeEach(() => {
        mockContext = {
            logger: { 
                info: vi.fn(), 
                error: vi.fn(),
                warn: vi.fn(),
                debug: vi.fn()
            },
            registerService: vi.fn(),
            getService: vi.fn(),
            getServices: vi.fn(),
            // `hook` / `trigger` are REQUIRED members of PluginContext. This
            // double omitted them and got away with it only because every
            // `ctx.hook` call site happened to be conditional (jobs register
            // one only when the bundle declares jobs). ADR-0110 D5's governance
            // inventory registers one unconditionally, which surfaced the gap —
            // model the real interface rather than shrinking the code to fit
            // an incomplete double.
            hook: vi.fn(),
            trigger: vi.fn()
        } as unknown as PluginContext;
    });

    it('should initialize with manifest info', () => {
        const bundle = {
            id: 'com.test.app',
            name: 'Test App',
            version: '1.0.0'
        };
        const plugin = new AppPlugin(bundle);
        expect(plugin.name).toBe('plugin.app.com.test.app');
        expect(plugin.version).toBe('1.0.0');
    });

    it('should handle nested stack definition manifest', () => {
        const bundle = {
            manifest: {
                id: 'com.test.stack',
                version: '2.0.0'
            },
            objects: []
        };
        const plugin = new AppPlugin(bundle);
        expect(plugin.name).toBe('plugin.app.com.test.stack');
        expect(plugin.version).toBe('2.0.0');
    });

    it('registerService should register raw manifest in init phase', async () => {
        const bundle = {
            id: 'com.test.simple',
            objects: []
        };
        const plugin = new AppPlugin(bundle);

        // Mock the manifest service
        const mockManifestService = { register: vi.fn() };
        vi.mocked(mockContext.getService).mockReturnValue(mockManifestService);

        await plugin.init(mockContext);

        expect(mockContext.getService).toHaveBeenCalledWith('manifest');
        expect(mockManifestService.register).toHaveBeenCalledWith(bundle);
    });

    it('start should do nothing if no runtime hooks', async () => {
        const bundle = { id: 'com.test.static' };
        const plugin = new AppPlugin(bundle);
        
        vi.mocked(mockContext.getService).mockReturnValue({}); // Mock ObjectQL exists
        
        await plugin.start!(mockContext);
        // Only logs, no errors
        expect(mockContext.logger.debug).toHaveBeenCalled();
    });

    it('start should invoke onEnable if present', async () => {
        const onEnableSpy = vi.fn();
        const bundle = { 
            id: 'com.test.code',
            onEnable: onEnableSpy
        };
        const plugin = new AppPlugin(bundle);
        
        // Mock ObjectQL engine
        const mockQL = { registry: {} };
        vi.mocked(mockContext.getService).mockReturnValue(mockQL);
        
        await plugin.start!(mockContext);
        
        expect(onEnableSpy).toHaveBeenCalled();
        // Check context passed to onEnable
        const callArg = onEnableSpy.mock.calls[0][0];
        expect(callArg.ql).toBe(mockQL);
    });

    it('start should warn if objectql not found', async () => {
        const bundle = { id: 'com.test.warn' };
        const plugin = new AppPlugin(bundle);
        
        vi.mocked(mockContext.getService).mockReturnValue(undefined); // No ObjectQL
        
        await plugin.start!(mockContext);
        
        expect(mockContext.logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('ObjectQL engine service not found'), 
            expect.any(Object)
        );
    });

    it('start should handle getService throwing for objectql', async () => {
        const bundle = { id: 'com.test.throw' };
        const plugin = new AppPlugin(bundle);
        
        vi.mocked(mockContext.getService).mockImplementation(() => {
            throw new Error("[Kernel] Service 'objectql' not found");
        });
        
        await plugin.start!(mockContext);
        
        expect(mockContext.logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('ObjectQL engine service not found'), 
            expect.any(Object)
        );
    });

    // ═══════════════════════════════════════════════════════════════
    // i18n translation auto-loading
    // ═══════════════════════════════════════════════════════════════

    describe('i18n translation loading', () => {
        let mockI18n: any;
        let mockQL: any;

        beforeEach(() => {
            mockI18n = {
                loadTranslations: vi.fn(),
                setDefaultLocale: vi.fn(),
                setSupportedLocales: vi.fn(),
                getLocales: vi.fn().mockReturnValue([]),
                getDefaultLocale: vi.fn().mockReturnValue('en'),
            };
            mockQL = { registry: {} };

            vi.mocked(mockContext.getService).mockImplementation((name: string) => {
                if (name === 'objectql') return mockQL;
                if (name === 'i18n') return mockI18n;
                return undefined;
            });
        });

        it('should auto-load translations from bundle into i18n service', async () => {
            const bundle = {
                id: 'com.test.i18n',
                translations: [
                    {
                        en: { objects: { task: { label: 'Task' } } },
                        'zh-CN': { objects: { task: { label: '任务' } } },
                    },
                ],
            };
            const plugin = new AppPlugin(bundle);
            await plugin.start!(mockContext);

            expect(mockI18n.loadTranslations).toHaveBeenCalledWith('en', { objects: { task: { label: 'Task' } } });
            expect(mockI18n.loadTranslations).toHaveBeenCalledWith('zh-CN', { objects: { task: { label: '任务' } } });
        });

        it('should set default locale from i18n config', async () => {
            const bundle = {
                id: 'com.test.locale',
                i18n: { defaultLocale: 'zh-CN', supportedLocales: ['en', 'zh-CN'] },
                translations: [{ en: { messages: { hello: 'Hello' } } }],
            };
            const plugin = new AppPlugin(bundle);
            await plugin.start!(mockContext);

            expect(mockI18n.setDefaultLocale).toHaveBeenCalledWith('zh-CN');
        });

        // ── #7679: `supportedLocales` is threaded like `defaultLocale` ──────
        // This layer is the only one that can see the app's declaration, so
        // these assertions are about the HANDOFF; what the provider then does
        // with it is pinned in core / service-i18n, and the two ends are wired
        // together in `i18n-supported-locales.test.ts`.

        it('should thread supportedLocales from i18n config to the i18n service', async () => {
            const bundle = {
                id: 'com.test.supported',
                i18n: { defaultLocale: 'en', supportedLocales: ['en', 'zh-CN'] },
                translations: [{ en: { messages: { hello: 'Hello' } } }],
            };
            const plugin = new AppPlugin(bundle);
            await plugin.start!(mockContext);

            expect(mockI18n.setSupportedLocales).toHaveBeenCalledWith(['en', 'zh-CN']);
        });

        it('should thread supportedLocales even when the app ships no bundles of its own', async () => {
            // The showcase's shape: the app declares which locales it offers,
            // while the translations arrive from the platform plugins. An
            // early return on "no bundles" here would leave exactly the app
            // this issue was filed against unnarrowed.
            const bundle = {
                id: 'com.test.declared-only',
                i18n: { defaultLocale: 'en', supportedLocales: ['en', 'zh-CN'] },
            };
            const plugin = new AppPlugin(bundle);
            await plugin.start!(mockContext);

            expect(mockI18n.setSupportedLocales).toHaveBeenCalledWith(['en', 'zh-CN']);
            expect(mockI18n.loadTranslations).not.toHaveBeenCalled();
        });

        it('should NOT touch supportedLocales when the app declares none', async () => {
            // Not merely "does not narrow" — does not CALL. Several AppPlugins
            // share one kernel (the config apps are AppPlugins too), so an app
            // with no `i18n` block clearing the declaration would undo the
            // narrowing a sibling app had just set.
            const bundle = {
                id: 'com.test.undeclared',
                i18n: { defaultLocale: 'zh-CN' },
                translations: [{ en: { messages: { hello: 'Hello' } } }],
            };
            const plugin = new AppPlugin(bundle);
            await plugin.start!(mockContext);

            expect(mockI18n.setSupportedLocales).not.toHaveBeenCalled();
            expect(mockI18n.setDefaultLocale).toHaveBeenCalledWith('zh-CN');
        });

        it('should treat an empty supportedLocales declaration as no declaration', async () => {
            const bundle = {
                id: 'com.test.emptylocales',
                i18n: { defaultLocale: 'en', supportedLocales: [] },
                translations: [{ en: { messages: { hello: 'Hello' } } }],
            };
            const plugin = new AppPlugin(bundle);
            await plugin.start!(mockContext);

            expect(mockI18n.setSupportedLocales).not.toHaveBeenCalled();
        });

        it('should skip narrowing on a provider that does not implement setSupportedLocales', async () => {
            // `setSupportedLocales` is OPTIONAL on `II18nService` (as
            // `setDefaultLocale` is), so a third-party provider must keep
            // booting rather than crash on a method it never declared.
            delete mockI18n.setSupportedLocales;
            const bundle = {
                id: 'com.test.oldprovider',
                i18n: { defaultLocale: 'en', supportedLocales: ['en'] },
                translations: [{ en: { messages: { hello: 'Hello' } } }],
            };
            const plugin = new AppPlugin(bundle);
            await plugin.start!(mockContext);

            expect(mockI18n.loadTranslations).toHaveBeenCalledWith('en', { messages: { hello: 'Hello' } });
            expect(mockContext.logger.error).not.toHaveBeenCalled();
        });

        it('should auto-register in-memory i18n fallback when service is not registered', async () => {
            vi.mocked(mockContext.getService).mockImplementation((name: string) => {
                if (name === 'objectql') return mockQL;
                return undefined; // No i18n service
            });

            const bundle = {
                id: 'com.test.noi18n',
                translations: [{ en: { messages: { hello: 'Hello' } } }],
            };
            const plugin = new AppPlugin(bundle);
            await plugin.start!(mockContext);

            // Auto-registers in-memory fallback and loads translations; does not throw or warn.
            expect(mockContext.registerService).toHaveBeenCalledWith('i18n', expect.any(Object));
        }, 15000);

        it('should auto-register in-memory i18n fallback when getService throws for i18n', async () => {
            vi.mocked(mockContext.getService).mockImplementation((name: string) => {
                if (name === 'objectql') return mockQL;
                throw new Error("[Kernel] Service 'i18n' not found");
            });

            const bundle = {
                id: 'com.test.i18nthrow',
                translations: [{ en: { messages: { hello: 'Hello' } } }],
            };
            const plugin = new AppPlugin(bundle);
            await plugin.start!(mockContext);

            expect(mockContext.registerService).toHaveBeenCalledWith('i18n', expect.any(Object));
        }, 15000);

        it('should handle bundle with no translations gracefully', async () => {
            const bundle = { id: 'com.test.notrans' };
            const plugin = new AppPlugin(bundle);
            await plugin.start!(mockContext);

            expect(mockI18n.loadTranslations).not.toHaveBeenCalled();
        });

        it('should load translations from nested manifest.translations', async () => {
            const bundle = {
                manifest: {
                    id: 'com.test.nested',
                    translations: [
                        { en: { messages: { save: 'Save' } } },
                    ],
                },
            };
            const plugin = new AppPlugin(bundle);
            await plugin.start!(mockContext);

            expect(mockI18n.loadTranslations).toHaveBeenCalledWith('en', { messages: { save: 'Save' } });
        });

        it('should load multiple translation bundles', async () => {
            const bundle = {
                id: 'com.test.multi',
                translations: [
                    { en: { objects: { task: { label: 'Task' } } } },
                    { en: { objects: { contact: { label: 'Contact' } } }, 'ja-JP': { objects: { contact: { label: '連絡先' } } } },
                ],
            };
            const plugin = new AppPlugin(bundle);
            await plugin.start!(mockContext);

            expect(mockI18n.loadTranslations).toHaveBeenCalledTimes(3);
        });

        it('should handle errors in loadTranslations gracefully', async () => {
            mockI18n.loadTranslations.mockImplementation((locale: string) => {
                if (locale === 'zh-CN') throw new Error('Disk read failed');
            });

            const bundle = {
                id: 'com.test.error',
                translations: [
                    { en: { messages: { save: 'Save' } }, 'zh-CN': { messages: { save: '保存' } } },
                ],
            };
            const plugin = new AppPlugin(bundle);
            await plugin.start!(mockContext);

            // en should still be loaded despite zh-CN failure
            expect(mockI18n.loadTranslations).toHaveBeenCalledWith('en', { messages: { save: 'Save' } });
            expect(mockContext.logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('Failed to load translations'),
                expect.objectContaining({ locale: 'zh-CN' })
            );
        });
    });

    describe('constructor fail-fast', () => {
        it('throws when bundle has app payload but no manifest id/name', () => {
            // Mirrors the regression where the cloud artifact-kernel-factory
            // handed `artifact.metadata` (category arrays with data) without
            // surfacing the sibling `artifact.manifest`, producing opaque
            // "Plugin plugin.app.unnamed-app failed to start" errors.
            const bundle = {
                objects: [{ name: 'lead' }],
                views: [{ name: 'lead_list' }],
            };
            expect(() => new AppPlugin(bundle as any, {
                environmentId: 'env-1',
                organizationId: 'org-1',
                packageId: 'pkg.test',
                source: 'package',
            } as any)).toThrowError(/has app payload but no manifest\.id/);
        });

        it('throws when nested manifest has app payload but no id/name', () => {
            const bundle = {
                manifest: { version: '1.0.0', objects: [{ name: 'lead' }] },
            };
            expect(() => new AppPlugin(bundle as any)).toThrowError(
                /has app payload but no manifest\.id/,
            );
        });

        it('degrades to no-op for empty environments (no app payload, no id)', () => {
            // Brand-new env artifact carries only the bootstrap envelope —
            // `{ manifest: { plugins, drivers, engines }, functions: [] }`.
            // Treating this as a hard error broke kernel boot on every
            // empty env. AppPlugin must accept it as a no-op instead.
            const bundle = {
                manifest: { plugins: [], drivers: [], engines: [] },
                functions: [],
            };
            const plugin = new AppPlugin(bundle as any, {
                environmentId: 'f08a6690-7ed9-43e4-a575-816a4e0fa0a1',
            } as any);
            expect(plugin.name).toBe('plugin.app.empty-f08a6690');
        });

        it('accepts bundle with only manifest.name', () => {
            const bundle = { manifest: { name: 'name-only' } };
            const plugin = new AppPlugin(bundle as any);
            expect(plugin.name).toBe('plugin.app.name-only');
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // Default hook body runner (#2588)
    // ═══════════════════════════════════════════════════════════════

    describe('protocol handshake on the code-defined-stack load seam (ADR-0087 D1)', () => {
        let mockManifest: any;

        beforeEach(() => {
            mockManifest = { register: vi.fn() };
            vi.mocked(mockContext.getService).mockImplementation(((name: string) => {
                if (name === 'manifest') return mockManifest;
                throw new Error(`service '${name}' not found`);
            }) as any);
        });

        it('refuses an incompatible engines.protocol range BEFORE registering the manifest', async () => {
            const plugin = new AppPlugin({
                manifest: {
                    id: 'com.test.stale',
                    version: '1.0.0',
                    engines: { protocol: `^${PROTOCOL_MAJOR - 5}` },
                },
                objects: [],
            });
            await expect(plugin.init(mockContext)).rejects.toMatchObject({
                code: 'OS_PROTOCOL_INCOMPATIBLE',
                diagnostic: expect.objectContaining({
                    packageId: 'com.test.stale',
                    migrateCommand: `objectstack migrate meta --from ${PROTOCOL_MAJOR - 5}`,
                }),
            });
            expect(mockManifest.register).not.toHaveBeenCalled();
        });

        it('loads a compatible range without warnings', async () => {
            const plugin = new AppPlugin({
                manifest: {
                    id: 'com.test.current',
                    version: '1.0.0',
                    engines: { protocol: `^${PROTOCOL_MAJOR}` },
                },
                objects: [],
            });
            await plugin.init(mockContext);
            expect(mockManifest.register).toHaveBeenCalledTimes(1);
            const warnings = vi.mocked(mockContext.logger.warn).mock.calls.map((c) => String(c[0]));
            expect(warnings.filter((w) => w.includes('[protocol]'))).toHaveLength(0);
        });

        it('grandfathers a bundle with no range — loads with exactly one warning', async () => {
            const plugin = new AppPlugin({
                manifest: { id: 'com.test.unversioned', version: '1.0.0' },
                objects: [],
            });
            await plugin.init(mockContext);
            expect(mockManifest.register).toHaveBeenCalledTimes(1);
            const warnings = vi.mocked(mockContext.logger.warn).mock.calls.map((c) => String(c[0]));
            expect(warnings.filter((w) => w.includes('[protocol]'))).toHaveLength(1);
        });
    });

    describe('default hook body runner install', () => {
        let mockQL: any;
        let mockManifest: any;

        beforeEach(() => {
            delete process.env.OS_DISABLE_AUTHORED_HOOKS;
            mockQL = { setDefaultBodyRunner: vi.fn(), registry: {} };
            mockManifest = { register: vi.fn() };
            vi.mocked(mockContext.getService).mockImplementation(((name: string) => {
                if (name === 'objectql') return mockQL;
                if (name === 'manifest') return mockManifest;
                throw new Error(`service '${name}' not found`);
            }) as any);
        });

        afterEach(() => {
            delete process.env.OS_DISABLE_AUTHORED_HOOKS;
        });

        it('installs the engine default body runner during init', async () => {
            const plugin = new AppPlugin({ id: 'com.test.app' });
            await plugin.init(mockContext);
            expect(mockQL.setDefaultBodyRunner).toHaveBeenCalledTimes(1);
            const runner = mockQL.setDefaultBodyRunner.mock.calls[0][0];
            expect(typeof runner).toBe('function');
            // The factory-produced runner yields a handler for body-hooks…
            const handler = runner({
                name: 'h',
                object: 'a',
                events: ['beforeInsert'],
                body: { language: 'js', source: 'ctx.input.x = 1;' },
            });
            expect(typeof handler).toBe('function');
            // …and nothing for hooks without a body.
            expect(runner({ name: 'nobody', object: 'a', events: ['beforeInsert'] })).toBeUndefined();
        });

        it('installs the runner even for empty environments', async () => {
            // An empty env is exactly where a user authors their first hook.
            const plugin = new AppPlugin(
                { manifest: { plugins: [] }, functions: [] } as any,
                { environmentId: 'env-a', organizationId: 'org-a' } as any,
            );
            await plugin.init(mockContext);
            expect(mockQL.setDefaultBodyRunner).toHaveBeenCalledTimes(1);
            // Empty env still short-circuits the rest of init.
            expect(mockManifest.register).not.toHaveBeenCalled();
        });

        it('delegates keep-the-first to the engine — the setter is called unconditionally (#4251)', async () => {
            // The caller-side guard (probing the engine's private
            // `_defaultBodyRunner` field) is gone; the ENGINE's first-wins
            // setter owns the invariant, pinned in objectql's hook-binder
            // tests. This side only skips the "Installed" log when the engine
            // answers `false`.
            mockQL.setDefaultBodyRunner = vi.fn(() => false); // engine: already installed
            const plugin = new AppPlugin({ id: 'com.test.app' });
            await plugin.init(mockContext);
            expect(mockQL.setDefaultBodyRunner).toHaveBeenCalledTimes(1);
            expect(vi.mocked(mockContext.logger.info).mock.calls.map((c) => c[0])).not.toContain(
                '[AppPlugin] Installed default hook body runner (runtime-authored hooks can execute)',
            );
        });

        it('honours the OS_DISABLE_AUTHORED_HOOKS=1 opt-out', async () => {
            process.env.OS_DISABLE_AUTHORED_HOOKS = '1';
            const plugin = new AppPlugin({ id: 'com.test.app' });
            await plugin.init(mockContext);
            expect(mockQL.setDefaultBodyRunner).not.toHaveBeenCalled();
        });

        it('init survives a kernel without an objectql service', async () => {
            vi.mocked(mockContext.getService).mockImplementation(((name: string) => {
                if (name === 'manifest') return mockManifest;
                throw new Error(`service '${name}' not found`);
            }) as any);
            const plugin = new AppPlugin({ id: 'com.test.app' });
            await expect(plugin.init(mockContext)).resolves.toBeUndefined();
            expect(mockManifest.register).toHaveBeenCalled();
        });
    });
});
