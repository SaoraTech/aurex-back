import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import { DRIZZLE } from '../db/db.constants';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@Inject(DRIZZLE) private readonly db: any) {}
  @Get()
  getHealth() { return { status: 'ok', service: 'aurex-api', timestamp: new Date().toISOString() }; }

  @Get('ready')
  async getReadiness() {
    await this.db.execute(sql`select 1`);
    return { status: 'ready', dependencies: { postgres: 'ok' }, timestamp: new Date().toISOString() };
  }
}
