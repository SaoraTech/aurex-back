import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { fetchWithTimeout } from '../common/http';

export interface TriggerWorkflowInput {
  subscriberId?: string;
  topicKey?: string;
  workflowId: string;
  transactionId?: string;
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
      if (!input.subscriberId && !input.topicKey) {
        return { sent: false, reason: 'recipient_missing' };
      }

      const recipient = input.topicKey
        ? { type: 'Topic', topicKey: input.topicKey }
        : {
            subscriberId: input.subscriberId!,
            ...(input.email ? { email: input.email } : {}),
            ...(input.firstName ? { firstName: input.firstName } : {}),
          };
      const body = {
        workflowId: input.workflowId,
        to: recipient,
        payload: input.payload ?? {},
        ...(input.transactionId ? { transactionId: input.transactionId } : {}),
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

  /**
   * Ensures the Novu subscriber exists and is subscribed to the editorial topic.
   * Audience targeting is evaluated by Novu against the server-synced commercial plan.
   */
  async syncSubscriber(input: {
    subscriberId: string;
    email: string;
    firstName?: string;
    plan: 'free' | 'plus' | 'pro';
    preferences: {
      editorialEmailEnabled: boolean;
      editorialPushEnabled: boolean;
      transactionalEmailEnabled: boolean;
      transactionalPushEnabled: boolean;
    };
  }): Promise<TriggerWorkflowResult> {
    const key = this.apiKey;
    if (!key) return { sent: false, reason: 'not_configured' };

    let baseUrl = this.apiUrl;
    while (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `ApiKey ${key}`,
    };
    const subscriber = {
      subscriberId: input.subscriberId,
      email: input.email,
      ...(input.firstName ? { firstName: input.firstName } : {}),
      data: {
        plan: input.plan,
        editorialEmailEnabled: input.preferences.editorialEmailEnabled,
        editorialPushEnabled: input.preferences.editorialPushEnabled,
        transactionalEmailEnabled: input.preferences.transactionalEmailEnabled,
        transactionalPushEnabled: input.preferences.transactionalPushEnabled,
      },
    };

    try {
      let response = await fetchWithTimeout(
        'novu',
        `${baseUrl}/v1/subscribers/${encodeURIComponent(input.subscriberId)}`,
        { method: 'PUT', headers, body: JSON.stringify(subscriber) },
        5000,
      );

      if (response.status === 404) {
        response = await fetchWithTimeout(
          'novu',
          `${baseUrl}/v1/subscribers`,
          { method: 'POST', headers, body: JSON.stringify(subscriber) },
          5000,
        );
      }

      if (!response.ok) {
        this.logger.warn({ msg: 'novu_subscriber_sync_rejected', status: response.status });
        return { sent: false, reason: `subscriber_http_${response.status}` };
      }

      const identifier = `${input.subscriberId}-announcements`;
      const channelTopics = ['email', 'push'] as const;
      const allTopics = channelTopics.flatMap(channel => [
        { topicKey: `announcements:all:${channel}`, name: `Aurex announcements — all — ${channel}` },
        { topicKey: `announcements:${input.plan}:${channel}`, name: `Aurex announcements — ${input.plan} — ${channel}` },
        ...(['free', 'plus', 'pro'] as const)
          .filter(plan => plan !== input.plan)
          .map(plan => ({
            topicKey: `announcements:${plan}:${channel}`,
            name: `Aurex announcements — ${plan} — ${channel}`,
          })),
      ]);
      const activeTopics = new Set<string>();
      for (const channel of channelTopics) {
        const enabled = channel === 'email'
          ? input.preferences.editorialEmailEnabled
          : input.preferences.editorialPushEnabled;
        if (enabled) {
          activeTopics.add(`announcements:all:${channel}`);
          activeTopics.add(`announcements:${input.plan}:${channel}`);
        }
      }

      const syncTopic = async (topicKey: string, name: string) => {
        const topicUrl = `${baseUrl}/v2/topics/${encodeURIComponent(topicKey)}/subscriptions`;
        return fetchWithTimeout(
          'novu',
          topicUrl,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              subscriptions: [{ identifier, subscriberId: input.subscriberId }],
              name,
            }),
          },
          5000,
        );
      };

      // Topic membership enforces audience and channel preferences server-side.
      const activeResponses = await Promise.all(
        allTopics.filter(item => activeTopics.has(item.topicKey))
          .map(async topic => ({ topic, response: await syncTopic(topic.topicKey, topic.name) })),
      );
      const failedActive = activeResponses.find(({ response }) => !response.ok && response.status !== 409);
      if (failedActive) {
        this.logger.warn({ msg: 'novu_topic_subscription_rejected', status: failedActive.response.status, topicKey: failedActive.topic.topicKey });
        return { sent: false, reason: `topic_http_${failedActive.response.status}` };
      }

      const staleResponses = await Promise.all(
        allTopics.filter(item => !activeTopics.has(item.topicKey)).map(async topic => {
          const staleUrl = `${baseUrl}/v2/topics/${encodeURIComponent(topic.topicKey)}/subscriptions`;
          const response = await fetchWithTimeout(
            'novu',
            staleUrl,
            {
              method: 'DELETE',
              headers,
              body: JSON.stringify({ subscriptions: [{ identifier, subscriberId: input.subscriberId }] }),
            },
            5000,
          );
          return { topic, response };
        }),
      );
      const failedStale = staleResponses.find(({ response }) => !response.ok && response.status !== 404);
      if (failedStale) {
        this.logger.warn({ msg: 'novu_stale_topic_unsubscribe_rejected', status: failedStale.response.status, topicKey: failedStale.topic.topicKey });
        return { sent: false, reason: `topic_unsubscribe_http_${failedStale.response.status}` };
      }

      return { sent: true };
    } catch (error) {
      this.logger.warn({ msg: 'novu_subscriber_sync_failed', error: (error as Error).message });
      return { sent: false, reason: 'provider_error' };
    }
  }

}
