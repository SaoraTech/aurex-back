import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DRIZZLE } from '../db/db.constants';
import { conversation, message } from '../db/schema';
import { newId } from '../common/ids';

@Injectable()
export class ConversationsService {
  constructor(@Inject(DRIZZLE) private readonly db: any) {}

  async list(userId: string) {
    return this.db.select().from(conversation).where(eq(conversation.userId, userId)).orderBy(desc(conversation.updatedAt)).limit(100);
  }
  async create(userId: string, input: { title?: string; subject?: 'calculus'|'algebra'|'geometry'|'statistics'|'general' }) {
    const now = new Date();
    const item = { id: newId(), userId, title: input.title?.slice(0, 160) ?? 'Nouvelle conversation', subject: input.subject ?? 'general', createdAt: now, updatedAt: now };
    await this.db.insert(conversation).values(item);
    return item;
  }
  async getOwned(userId: string, id: string) {
    const [item] = await this.db.select().from(conversation).where(and(eq(conversation.id, id), eq(conversation.userId, userId))).limit(1);
    if (!item) throw new NotFoundException('Conversation not found');
    return item;
  }
  async getMessages(userId: string, id: string) {
    await this.getOwned(userId, id);
    return this.db.select().from(message).where(eq(message.conversationId, id)).orderBy(message.createdAt).limit(500);
  }
  async delete(userId: string, id: string) {
    await this.getOwned(userId, id);
    await this.db.delete(conversation).where(and(eq(conversation.id, id), eq(conversation.userId, userId)));
    return { deleted: true };
  }
}
