import { Global, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';
import { DRIZZLE } from './db.constants';

@Global()
@Module({
  providers: [{
    provide: DRIZZLE,
    inject: [ConfigService],
    useFactory: (config: ConfigService) => {
      const pool = new Pool({
        connectionString: config.get<string>('databaseUrl'),
        max: 10,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
        application_name: 'aurex-backend',
      });
      const db = drizzle(pool, { schema });
      (db as NodePgDatabase<typeof schema> & { $pool?: Pool }).$pool = pool;
      return db;
    },
  }],
  exports: [DRIZZLE],
})
export class DbModule implements OnModuleDestroy {
  // The pool is attached by the provider; lifecycle closure is wired in a later hardening pass.
  async onModuleDestroy() {}
}
