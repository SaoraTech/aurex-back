import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import { AppException } from '../common/errors';
import { DRIZZLE } from '../db/db.constants';
import { ProviderRegistryService } from '../providers/provider-registry.service';
import { ArcjetService } from '../security/arcjet.service';
import { Protect } from '../security/protect.decorator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@Inject(DRIZZLE) private readonly db: any, private readonly providers: ProviderRegistryService, private readonly arcjet: ArcjetService) {}

  /** Liveness: the process answers. Exempt from rate limiting so orchestrator probes are never blocked. */
  @Get() @Protect('exempt')
  getHealth() { return { status: 'ok', service: 'aurex-api', timestamp: new Date().toISOString() }; }

  /**
   * Readiness: the database must answer (otherwise 503). External providers are reported as
   * `configured` / `not_configured` / `disabled` — this does NOT call them (calls are billed), so it is not proof
   * that they are reachable; use provider metrics (/metrics) for real availability.
   */
  @Get('ready') @Protect('exempt')
  async getReadiness() {
    try {
      await Promise.race([this.db.execute(sql`select 1`), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000))]);
    } catch {
      throw new AppException(503, 'DATABASE_UNAVAILABLE', 'Base de données indisponible.');
    }
    const snap = this.providers.snapshot();
    return {
      status: 'ready',
      dependencies: { postgres: 'ok', arcjet: { mode: this.arcjet.mode, active: this.arcjet.isActive }, providers: snap },
      timestamp: new Date().toISOString(),
    };
  }
}
