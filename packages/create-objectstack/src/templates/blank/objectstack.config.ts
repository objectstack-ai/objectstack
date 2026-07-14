import { defineStack } from '@objectstack/spec';
import * as objects from './src/objects/index.js';

export default defineStack({
  manifest: {
    id: 'blank',
    namespace: 'blank',
    version: '0.1.0',
    type: 'app',
    name: 'Blank Starter',
    description: 'Minimal ObjectStack environment — a clean slate for building.',
  },
  objects: Object.values(objects),
});
