import { getDb } from '../db/index.js';
import { getService } from '../service.js';
import { seedIfEmpty } from './index.js';

getDb();
await getService().init();
const seeded = await seedIfEmpty();
if (!seeded) console.log('[seed] database already has users — nothing to do (delete data/crucible.db to reseed)');
process.exit(0);
