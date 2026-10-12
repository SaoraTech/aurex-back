import { Inject, Injectable, Logger } from '@nestjs/common';
import { DRIZZLE } from '../db/db.constants';
import { auditEvent } from '../db/schema';
import { newId } from '../common/ids';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  constructor(@Inject(DRIZZLE) private readonly db: any) {}

  async record(input: { actorUserId?: string; action: string; targetType?: string; targetId?: string; metadata?: Record<string, unknown>; requestId?: string }) {
    // Never pass secrets, credentials, tokens, or message contents in metadata.
    await this.db.insert(auditEvent).values({
      id: newId(), actorUserId: input.actorUserId ?? null, action: input.action,
      targetType: input.targetType ?? null, targetId: input.targetId ?? null,
      metadata: input.metadata ?? null, requestId: input.requestId ?? null,
    });
    this.logger.debug(`audit action=${input.action} target=${input.targetType ?? '-'} request=${input.requestId ?? '-'}`);
  }
}
