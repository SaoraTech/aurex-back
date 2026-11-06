import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { AnnouncementsService } from '../announcements/announcements.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const announcements = app.get(AnnouncementsService);
    const result = await announcements.publishDueScheduled();
    const notifications = await announcements.retryFailedEditorialNotifications();
    Logger.log(
      `Scheduled publications processed: ${result.processed}; editorial notification retries: ${notifications.retried}`,
      'ScheduledAnnouncementsJob',
    );
  } finally {
    await app.close();
  }
}

main().catch(error => {
  Logger.error(
    'Scheduled publication job failed',
    error instanceof Error ? error.stack : String(error),
    'ScheduledAnnouncementsJob',
  );
  process.exitCode = 1;
});
