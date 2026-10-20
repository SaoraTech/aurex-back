import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { envFactory } from './config/env.factory';
import { DbModule } from './db/db.module';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { SecurityModule } from './security/security.module';
import { ObservabilityModule } from './observability/observability.module';
import { ProvidersModule } from './providers/providers.module';
import { IdentityModule } from './identity/identity.module';
import { AiModule } from './ai/ai.module';
import { MathModule } from './math/math.module';
import { ConversationsModule } from './conversations/conversations.module';
import { ChatModule } from './chat/chat.module';
import { PlansModule } from './plans/plans.module';
import { BillingModule } from './billing/billing.module';
import { MemoryModule } from './memory/memory.module';
import { ArtifactsModule } from './artifacts/artifacts.module';
import { LibraryModule } from './library/library.module';
import { PrivacyModule } from './privacy/privacy.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AuditModule } from './audit/audit.module';
import { AudioModule } from './audio/audio.module';
import { ResearchModule } from './research/research.module';
import { AnnouncementsModule } from './announcements/announcements.module';
import { QuotasModule } from './quotas/quotas.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [envFactory] }),
    DbModule,
    ObservabilityModule,
    ProvidersModule,
    IdentityModule,
    AuthModule,
    SecurityModule,
    HealthModule,
    AiModule,
    MathModule,
    ConversationsModule,
    ChatModule,
    PlansModule,
    BillingModule,
    MemoryModule,
    ArtifactsModule,
    LibraryModule,
    PrivacyModule,
    NotificationsModule,
    AuditModule,
    AudioModule,
    ResearchModule,
    AnnouncementsModule,
    QuotasModule,
  ],
})
export class AppModule {}
