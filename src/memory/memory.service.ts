import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DRIZZLE } from '../db/db.constants';
import { memoryItem } from '../db/schema';
import { newId } from '../common/ids';

@Injectable()
export class MemoryService {
  constructor(@Inject(DRIZZLE) private readonly db: any) {}
  list(userId: string) { return this.db.select().from(memoryItem).where(eq(memoryItem.userId,userId)).orderBy(desc(memoryItem.updatedAt)).limit(100); }
  async create(userId: string, input: { title: string; content: string; pinned?: boolean }) {
    const now = new Date(); const item = { id: newId(), userId, title: input.title, content: input.content, pinned: !!input.pinned, createdAt: now, updatedAt: now };
    await this.db.insert(memoryItem).values(item); return item;
  }
  async update(userId: string, id: string, input: Partial<{title:string;content:string;pinned:boolean}>) {
    const [existing] = await this.db.select().from(memoryItem).where(and(eq(memoryItem.id,id),eq(memoryItem.userId,userId))).limit(1);
    if (!existing) throw new NotFoundException('Memory item not found');
    const [updated] = await this.db.update(memoryItem).set({ ...input, updatedAt: new Date() }).where(and(eq(memoryItem.id,id),eq(memoryItem.userId,userId))).returning();
    return updated;
  }
  async remove(userId: string, id: string) {
    const rows = await this.db.delete(memoryItem).where(and(eq(memoryItem.id,id),eq(memoryItem.userId,userId))).returning({id:memoryItem.id});
    if (!rows.length) throw new NotFoundException('Memory item not found');
    return { deleted: true };
  }
}
