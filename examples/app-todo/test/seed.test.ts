
import { ObjectKernel, DriverPlugin, AppPlugin } from '@objectstack/runtime';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { ObjectQLPlugin } from '@objectstack/objectql';
import TodoApp from '../objectstack.config';

(async () => {
  console.log('🧪 Verifying Seeding...');

  process.env.OS_MULTI_ORG_ENABLED = 'false';

  const kernel = new ObjectKernel();

  // Core Services
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(new DriverPlugin(new SqliteWasmDriver({ filename: ':memory:' })));

  // Load App with Data
  await kernel.use(new AppPlugin(TodoApp));

  await kernel.bootstrap();

  // Verification
  // The 'objectql' service is the engine
  const ql = kernel.getService('objectql') as any;
  if (!ql) throw new Error('ObjectQL Missing');

  try {
    const tasks = await ql.find('todo_task', {});
    console.log('✅ Found Tasks:', tasks.length);
    console.log(JSON.stringify(tasks, null, 2));

    const expectedTitles = ['Learn ObjectStack', 'Build a cool app'];
    const foundTitles = tasks.map((t: any) => t.subject);

    const missing = expectedTitles.filter(t => !foundTitles.includes(t));

    if (missing.length > 0) {
        console.error('❌ Missing expected seeded data:', missing);
        process.exit(1);
    } else {
        console.log('🎉 Seeding Verification Successful!');
        process.exit(0);
    }
  } catch (e) {
      console.error('❌ Verification Failed:', e);
      process.exit(1);
  }

})();
