import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  constructor(private readonly config:ConfigService) {}
  async triggerWorkflow(input:{subscriberId:string;workflowId:string;payload?:Record<string,unknown>}) {
    const key=this.config.get<string>('novuApiKey');
    if (!key) { this.logger.debug('Novu not configured; notification skipped'); return {sent:false,reason:'not_configured'}; }
    // Integrate the currently supported Novu SDK/API version here, after validating region,
    // workflow IDs, retries and provider costs. Do not treat a log as a delivered notification.
    this.logger.warn(`Novu credentials are configured but no delivery adapter is enabled for workflow ${input.workflowId}`);
    return {sent:false,reason:'adapter_not_enabled'};
  }
}
