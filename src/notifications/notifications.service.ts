import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { fetchWithTimeout } from '../common/http';

export interface TriggerWorkflowInput {
  subscriberId: string;
  workflowId: string;
  email?: string;
  firstName?: string;
  payload?: Record<string, unknown>;
}

export interface TriggerWorkflowResult {
  sent: boolean;
  reason?: string;
  transactionId?: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly config: ConfigService) {}

  private get apiKey(): string | undefined {
    return this.config.get<string>('novuApiKey');
  }

  private get apiUrl(): string {
    return this.config.get<string>('novuApiUrl') ?? 'https://api.novu.co';
  }

  private get appIdentifier(): string | undefined {
    return this.config.get<string>('novuAppIdentifier');
  }

  /**
   * Generates official Novu HMAC subscriber hash for client-side Inbox SDK security.
   * Prevents unauthorized subscriber impersonation in the client widget.
   */
  getSubscriberToken(subscriberId: string): { subscriberId: string; hmacHash: string | null; appIdentifier: string | null } {
    const key = this.apiKey;
    const identifier = this.appIdentifier ?? null;
    if (!key) {
      return { subscriberId, hmacHash: null, appIdentifier: identifier };
    }
    const hmacHash = createHmac('sha256', key).update(subscriberId).digest('hex');
    return { subscriberId, hmacHash, appIdentifier: identifier };
  }

  /**
   * Triggers a Novu workflow via the official REST API v1.
   * Never throws on provider errors or timeouts: fails gracefully so business flows remain unblocked.
   */
  async triggerWorkflow(input: TriggerWorkflowInput): Promise<TriggerWorkflowResult> {
    const key = this.apiKey;
    if (!key) {
      this.logger.debug({ msg: 'novu_not_configured', detail: 'Notification skipped' });
      return { sent: false, reason: 'not_configured' };
    }

    try {
      const url = `${this.apiUrl.replace(/\/+$/, '')}/v1/events/trigger`;
      const body = {
        name: input.workflowId,
        to: {
          subscriberId: input.subscriberId,
          ...(input.email ? { email: input.email } : {}),
          ...(input.firstName ? { firstName: input.firstName } : {}),
        },
        payload: input.payload ?? {},
      };

      const res = await fetchWithTimeout(
        'novu',
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `ApiKey ${key}`,
          },
          body: JSON.stringify(body),
        },
        5000,
      );

      if (!res.ok) {
        this.logger.warn({ msg: 'novu_trigger_rejected', status: res.status, workflow: input.workflowId });
        return { sent: false, reason: `http_${res.status}` };
      }

      const json = await res.json() as { data?: { transactionId?: string; acknowledged?: boolean } };
      return {
        sent: true,
        transactionId: json?.data?.transactionId,
      };
    } catch (error) {
      this.logger.warn({ msg: 'novu_trigger_failed', workflow: input.workflowId, error: (error as Error).message });
      return { sent: false, reason: 'provider_error' };
    }
  }
}
