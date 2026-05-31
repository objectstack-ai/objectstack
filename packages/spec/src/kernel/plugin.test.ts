import { describe, it, expect } from 'vitest';
import {
  PluginContextSchema,
  PluginLifecycleSchema,
  PluginSchema,
  UpgradeContextSchema,
  isConsumerInstallable,
  CONSUMER_INSTALLABLE_TYPES,
  type PluginContextData,
  type PluginLifecycleHooks,
  type PluginDefinition,
} from './plugin.zod';

describe('isConsumerInstallable (ADR-0019 — App as the consumer unit)', () => {
  it('only `app` is consumer-installable', () => {
    expect(CONSUMER_INSTALLABLE_TYPES).toEqual(['app']);
    expect(isConsumerInstallable('app')).toBe(true);
    for (const t of ['plugin', 'driver', 'server', 'ui', 'theme', 'agent', 'objectql', 'module', 'adapter']) {
      expect(isConsumerInstallable(t)).toBe(false);
    }
  });

  it('handles undefined', () => {
    expect(isConsumerInstallable(undefined)).toBe(false);
  });
});

describe('PluginContextSchema', () => {
  it('should accept valid plugin context', () => {
    const context: PluginContextData = {
      ql: {
        object: () => ({}),
        query: async () => ({})
      },
      os: {
        getCurrentUser: async () => ({ id: 'test-user' }),
        getConfig: async () => 'test-config'
      },
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {}
      },
      storage: {
        get: async () => null,
        set: async () => {},
        delete: async () => {}
      },
      i18n: {
        t: () => '',
        getLocale: () => 'en'
      },
      metadata: {},
      events: {},
      app: {
        router: {
          get: () => {},
          post: () => {},
          use: () => {}
        }
      },
      drivers: {
        register: () => {}
      }
    };

    expect(() => PluginContextSchema.parse(context)).not.toThrow();
  });

  it('should accept context with all required properties', () => {
    const completeContext = {
      ql: {
        object: () => ({}),
        query: async () => ({})
      },
      os: {
        getCurrentUser: async () => ({ id: 'test-user' }),
        getConfig: async () => 'test-config'
      },
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {}
      },
      storage: {
        get: async () => null,
        set: async () => {},
        delete: async () => {}
      },
      i18n: {
        t: () => '',
        getLocale: () => 'en'
      },
      metadata: {},
      events: {},
      app: {
        router: {
          get: () => {},
          post: () => {},
          use: () => {}
        }
      },
      drivers: {
        register: () => {}
      }
    };

    const result = PluginContextSchema.safeParse(completeContext);
    expect(result.success).toBe(true);
  });

  it('should accept context with actual implementations', () => {
    const context = {
      ql: {
        object: (name: string) => ({
          find: async () => [],
          create: async (data: any) => data,
        }),
        query: async (soql: string) => ({ records: [] })
      },
      os: {
        getCurrentUser: async () => ({ id: 'user123' }),
        getConfig: async (key: string) => 'value',
      },
      logger: {
        debug: (message: string) => console.log(message),
        info: (message: string) => console.log(message),
        warn: (message: string) => console.warn(message),
        error: (message: string, error?: any) => console.error(message, error),
      },
      storage: {
        get: async (key: string) => null,
        set: async (key: string, value: any) => {},
        delete: async (key: string) => {}
      },
      i18n: {
        t: (key: string, params?: any) => key,
        getLocale: () => 'en-US'
      },
      metadata: {
        getObject: async (name: string) => ({}),
        getFields: async (object: string) => [],
      },
      events: {
        on: (event: string, handler: Function) => {},
        emit: (event: string, data?: any) => {},
      },
      app: {
        router: {
          get: (path: string, handler: Function) => {},
          post: (path: string, handler: Function) => {},
          use: (pathOrHandler: string | Function, handler?: Function) => {}
        }
      },
      drivers: {
        register: (driver: any) => {}
      }
    };

    expect(() => PluginContextSchema.parse(context)).not.toThrow();
  });
});

describe('PluginLifecycleSchema', () => {
  it('should accept empty lifecycle (all hooks optional)', () => {
    const lifecycle: PluginLifecycleHooks = {};

    expect(() => PluginLifecycleSchema.parse(lifecycle)).not.toThrow();
  });

  it('should accept lifecycle with onInstall hook', () => {
    const lifecycle: PluginLifecycleHooks = {
      onInstall: async (context: PluginContextData) => {
        // Installation logic
      },
    };

    expect(() => PluginLifecycleSchema.parse(lifecycle)).not.toThrow();
  });

  it('should accept lifecycle with onEnable hook', () => {
    const lifecycle: PluginLifecycleHooks = {
      onEnable: async (context: PluginContextData) => {
        // Enable logic
      },
    };

    expect(() => PluginLifecycleSchema.parse(lifecycle)).not.toThrow();
  });

  it('should accept lifecycle with onDisable hook', () => {
    const lifecycle: PluginLifecycleHooks = {
      onDisable: async (context: PluginContextData) => {
        // Disable logic
      },
    };

    expect(() => PluginLifecycleSchema.parse(lifecycle)).not.toThrow();
  });

  it('should accept lifecycle with onUninstall hook', () => {
    const lifecycle: PluginLifecycleHooks = {
      onUninstall: async (context: PluginContextData) => {
        // Uninstall logic
      },
    };

    expect(() => PluginLifecycleSchema.parse(lifecycle)).not.toThrow();
  });

  it('should accept lifecycle with onUpgrade hook', () => {
    const lifecycle: PluginLifecycleHooks = {
      onUpgrade: async (context: PluginContextData, fromVersion: string, toVersion: string) => {
        // Upgrade logic
      },
    };

    expect(() => PluginLifecycleSchema.parse(lifecycle)).not.toThrow();
  });

  it('should accept lifecycle with all hooks', () => {
    const lifecycle: PluginLifecycleHooks = {
      onInstall: async (context: PluginContextData) => {
        await context.ql.object('plugin_data').syncSchema();
      },
      onEnable: async (context: PluginContextData) => {
        context.logger.info('Plugin enabled');
      },
      onDisable: async (context: PluginContextData) => {
        context.logger.info('Plugin disabled');
      },
      onUninstall: async (context: PluginContextData) => {
        await context.ql.object('plugin_data').dropTable();
      },
      onUpgrade: async (context: PluginContextData, from: string, to: string) => {
        context.logger.info(`Upgrading from ${from} to ${to}`);
      },
    };

    expect(() => PluginLifecycleSchema.parse(lifecycle)).not.toThrow();
  });
});

describe('UpgradeContextSchema', () => {
  it('should accept valid upgrade context', () => {
    const context = {
      previousVersion: '1.0.0',
      newVersion: '2.0.0',
      isMajorUpgrade: true,
    };
    const parsed = UpgradeContextSchema.parse(context);
    expect(parsed.previousVersion).toBe('1.0.0');
    expect(parsed.newVersion).toBe('2.0.0');
    expect(parsed.isMajorUpgrade).toBe(true);
  });

  it('should accept upgrade context with metadata snapshot', () => {
    const context = {
      previousVersion: '1.2.0',
      newVersion: '1.3.0',
      isMajorUpgrade: false,
      previousMetadata: {
        'objects': { count: 5 },
        'views': { count: 10 },
      },
    };
    const parsed = UpgradeContextSchema.parse(context);
    expect(parsed.previousMetadata).toBeDefined();
    expect(parsed.isMajorUpgrade).toBe(false);
  });

  it('should reject missing required fields', () => {
    expect(() => UpgradeContextSchema.parse({})).toThrow();
    expect(() => UpgradeContextSchema.parse({ previousVersion: '1.0.0' })).toThrow();
  });
});

describe('PluginSchema', () => {
  it('should accept plugin with minimal metadata', () => {
    const plugin: PluginDefinition = {};

    expect(() => PluginSchema.parse(plugin)).not.toThrow();
  });

  it('should accept plugin with id and version', () => {
    const plugin: PluginDefinition = {
      id: 'com.example.plugin',
      version: '1.0.0',
    };

    expect(() => PluginSchema.parse(plugin)).not.toThrow();
  });

  it('should accept complete plugin definition', () => {
    const plugin: PluginDefinition = {
      id: 'com.example.bi-plugin',
      version: '2.1.0',
      onInstall: async (context) => {
        await context.ql.object('bi_report').create({
          name: 'Default Report',
          type: 'chart',
        });
      },
      onEnable: async (context) => {
        context.events.on('record.created', async (data: any) => {
          context.logger.info('Record created', data);
        });
      },
      onDisable: async (context) => {
        // Cleanup event handlers
      },
      onUninstall: async (context) => {
        await context.ql.object('bi_report').delete({ plugin_id: 'com.example.bi-plugin' });
      },
      onUpgrade: async (context, from, to) => {
        if (from === '1.0.0' && to === '2.0.0') {
          // Migrate data
          await context.ql.object('bi_report').update(
            {},
            { migrated: true }
          );
        }
      },
    };

    expect(() => PluginSchema.parse(plugin)).not.toThrow();
  });
});

describe('Plugin Lifecycle Scenarios', () => {
  describe('Installation Flow', () => {
    it('should handle plugin installation', async () => {
      let installed = false;
      
      const plugin: PluginDefinition = {
        id: 'test.plugin',
        version: '1.0.0',
        onInstall: async (context) => {
          installed = true;
          await context.ql.object('test_object').syncSchema();
        },
      };

      const parsed = PluginSchema.parse(plugin);
      expect(parsed.onInstall).toBeDefined();
      
      // Simulate installation
      if (parsed.onInstall) {
        await parsed.onInstall({
          ql: { 
            object: () => ({ syncSchema: async () => {} }),
            query: async () => ({})
          },
          os: {
            getCurrentUser: async () => ({ id: 'test-user' }),
            getConfig: async () => 'test-config'
          },
          logger: { 
            debug: () => {},
            info: () => {}, 
            warn: () => {},
            error: () => {} 
          },
          storage: {
            get: async () => null,
            set: async () => {},
            delete: async () => {}
          },
          i18n: {
            t: () => '',
            getLocale: () => 'en'
          },
          metadata: {},
          events: {},
          app: {
            router: {
              get: () => {},
              post: () => {},
              use: () => {}
            }
          },
          drivers: {
            register: () => {}
          }
        } as any);
      }
      
      expect(installed).toBe(true);
    });
  });

  describe('Enable/Disable Flow', () => {
    it('should handle plugin enable and disable', async () => {
      let enabled = false;
      
      const plugin: PluginDefinition = {
        onEnable: async (context) => {
          enabled = true;
          context.logger.info('Plugin enabled');
        },
        onDisable: async (context) => {
          enabled = false;
          context.logger.info('Plugin disabled');
        },
      };

      const parsed = PluginSchema.parse(plugin);
      
      const mockContext = {
        ql: {
          object: () => ({}),
          query: async () => ({})
        },
        os: {
          getCurrentUser: async () => ({ id: 'test-user' }),
          getConfig: async () => 'test-config'
        },
        logger: { 
          debug: () => {},
          info: () => {}, 
          warn: () => {},
          error: () => {} 
        },
        storage: {
          get: async () => null,
          set: async () => {},
          delete: async () => {}
        },
        i18n: {
          t: () => '',
          getLocale: () => 'en'
        },
        metadata: {},
        events: {},
        app: {
          router: {
            get: () => {},
            post: () => {},
            use: () => {}
          }
        },
        drivers: {
          register: () => {}
        }
      } as any;

      // Enable
      if (parsed.onEnable) {
        await parsed.onEnable(mockContext);
      }
      expect(enabled).toBe(true);

      // Disable
      if (parsed.onDisable) {
        await parsed.onDisable(mockContext);
      }
      expect(enabled).toBe(false);
    });
  });

  describe('Upgrade Flow', () => {
    it('should handle version upgrade', async () => {
      let upgradeCalled = false;
      let upgradeFrom = '';
      let upgradeTo = '';
      
      const plugin: PluginDefinition = {
        onUpgrade: async (context, from, to) => {
          upgradeCalled = true;
          upgradeFrom = from;
          upgradeTo = to;
        },
      };

      const parsed = PluginSchema.parse(plugin);
      
      if (parsed.onUpgrade) {
        await parsed.onUpgrade(
          {
            ql: {
              object: () => ({}),
              query: async () => ({})
            },
            os: {
              getCurrentUser: async () => ({ id: 'test-user' }),
              getConfig: async () => 'test-config'
            },
            logger: { 
              debug: () => {},
              info: () => {}, 
              warn: () => {},
              error: () => {} 
            },
            storage: {
              get: async () => null,
              set: async () => {},
              delete: async () => {}
            },
            i18n: {
              t: () => '',
              getLocale: () => 'en'
            },
            metadata: {},
            events: {},
            app: {
              router: {
                get: () => {},
                post: () => {},
                use: () => {}
              }
            },
            drivers: {
              register: () => {}
            }
          } as any,
          '1.0.0',
          '2.0.0'
        );
      }
      
      expect(upgradeCalled).toBe(true);
      expect(upgradeFrom).toBe('1.0.0');
      expect(upgradeTo).toBe('2.0.0');
    });
  });

  describe('Uninstallation Flow', () => {
    it('should handle plugin uninstallation', async () => {
      let uninstalled = false;
      
      const plugin: PluginDefinition = {
        onUninstall: async (context) => {
          uninstalled = true;
          await context.ql.object('test_object').dropTable();
        },
      };

      const parsed = PluginSchema.parse(plugin);
      
      if (parsed.onUninstall) {
        await parsed.onUninstall({
          ql: { 
            object: () => ({ dropTable: async () => {} }),
            query: async () => ({})
          },
          os: {
            getCurrentUser: async () => ({ id: 'test-user' }),
            getConfig: async () => 'test-config'
          },
          logger: { 
            debug: () => {},
            info: () => {}, 
            warn: () => {},
            error: () => {} 
          },
          storage: {
            get: async () => null,
            set: async () => {},
            delete: async () => {}
          },
          i18n: {
            t: () => '',
            getLocale: () => 'en'
          },
          metadata: {},
          events: {},
          app: {
            router: {
              get: () => {},
              post: () => {},
              use: () => {}
            }
          },
          drivers: {
            register: () => {}
          }
        } as any);
      }
      
      expect(uninstalled).toBe(true);
    });
  });
});
