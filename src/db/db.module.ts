import { Global, Inject, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';
import { DRIZZLE } from './db.constants';

@Global()
@Module({
  providers: [{
    provide: DRIZZLE,
    inject: [ConfigService],
    useFactory: (config: ConfigService) => {
      const logger = new Logger('Database');
      const pool = new Pool({
        connectionString: config.get<string>('databaseUrl'),
        max: 10,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
        statement_timeout: 30_000,
        application_name: 'aurex-backend',
      });
      // An unhandled 'error' event on an idle client would crash the process (e.g. Neon closing idle connections).
      pool.on('error', err => logger.error({ msg: 'pg_pool_idle_client_error', error: err.message }));
      const db = drizzle(pool, { schema });
      (db as unknown as { $pool: Pool }).$pool = pool;
      return db;
    },
  }],
  exports: [DRIZZLE],
})
export class DbModule implements OnModuleDestroy {
  constructor(@Inject(DRIZZLE) private readonly db: { $pool?: Pool }) {}
  async onModuleDestroy() { await this.db.$pool?.end(); }
}
