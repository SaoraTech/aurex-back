export type PublicationMode = 'IN_APP_ONLY' | 'MULTI_CHANNEL' | 'SCHEDULED';
export type ScheduledDeliveryMode = 'IN_APP_ONLY' | 'MULTI_CHANNEL';
export type AnnouncementStatus = 'draft' | 'pending_review' | 'scheduled' | 'published' | 'archived';
export type TargetAudience = 'all' | 'free' | 'plus' | 'pro';
export type AnnouncementCategory = 'feature' | 'improvement' | 'ai_engine' | 'subscription' | 'maintenance';
export type NotificationChannel = 'push' | 'email';

export interface CreateAnnouncementDto {
  title: string;
  summary: string;
  content: string;
  category?: AnnouncementCategory;
  targetAudience?: TargetAudience;
  link?: string;
  publicationMode?: PublicationMode;
  scheduledAt?: string;
  scheduledDeliveryMode?: ScheduledDeliveryMode;
  notificationChannels?: NotificationChannel[];
}

export interface UpdateAnnouncementDto {
  title?: string;
  summary?: string;
  content?: string;
  category?: AnnouncementCategory;
  targetAudience?: TargetAudience;
  link?: string;
  publicationMode?: PublicationMode;
  scheduledAt?: string | null;
  scheduledDeliveryMode?: ScheduledDeliveryMode | null;
  notificationChannels?: NotificationChannel[];
}
