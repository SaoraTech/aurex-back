export type PublicationMode = 'manual' | 'automatic' | 'hybrid';
export type AnnouncementStatus = 'draft' | 'pending_review' | 'published' | 'archived';
export type TargetAudience = 'all' | 'free' | 'plus' | 'pro';
export type AnnouncementCategory = 'feature' | 'improvement' | 'ai_engine' | 'subscription' | 'maintenance';

export interface CreateAnnouncementDto {
  title: string;
  summary: string;
  content: string;
  category?: AnnouncementCategory;
  targetAudience?: TargetAudience;
  link?: string;
  publicationMode?: PublicationMode;
  autoPublish?: boolean;
}

export interface UpdateAnnouncementDto {
  title?: string;
  summary?: string;
  content?: string;
  category?: AnnouncementCategory;
  targetAudience?: TargetAudience;
  link?: string;
}

export interface PublishAnnouncementOptions {
  sendNotification?: boolean;
}
