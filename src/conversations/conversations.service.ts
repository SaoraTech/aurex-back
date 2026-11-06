import { Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { and, desc, eq, ilike, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm';
import { DRIZZLE } from '../db/db.constants';
import { conversation, message } from '../db/schema';
import { newId } from '../common/ids';
type Cursor = { at: string; id: string };
const encodeCursor = (row: { updatedAt?: Date; createdAt?: Date; id: string }) => Buffer.from(JSON.stringify({ at: (row.updatedAt ?? row.createdAt)!.toISOString(), id: row.id })).toString('base64url');
const decodeCursor = (value?: string): Cursor | undefined => {
  if (!value) return undefined;
  try { const p = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); if (typeof p.at !== 'string' || !Number.isFinite(Date.parse(p.at)) || typeof p.id !== 'string') throw new Error(); return { at: p.at, id: p.id }; }
  catch { throw new BadRequestException('Invalid pagination cursor'); }
};
const pageSize = (v?: number) => Math.min(Math.max(Number(v) || 30, 1), 100);
@Injectable()
export class ConversationsService {
  constructor(@Inject(DRIZZLE) private readonly db: any) {}
  async list(userId: string) { return this.db.select().from(conversation).where(eq(conversation.userId, userId)).orderBy(desc(conversation.updatedAt)).limit(100); }
  async page(userId: string, input: { limit?: number; cursor?: string; q?: string; archived?: 'true'|'false'|'all' }) {
    const filters: any[] = [eq(conversation.userId, userId)];
    if (input.archived === 'true') filters.push(isNotNull(conversation.archivedAt)); else if (input.archived !== 'all') filters.push(isNull(conversation.archivedAt));
    const q = input.q?.trim().slice(0,120);
    if (q) {
      const pattern = '%' + q.replace(/[\\%_]/g, '\\$&') + '%';
      const found = await this.db.select({ conversationId: message.conversationId }).from(message).where(ilike(message.content, pattern)).limit(500);
      const ids: string[] = found.map((r: {conversationId:string}) => r.conversationId);
      filters.push(or(ilike(conversation.title, pattern), ids.length ? inArray(conversation.id, ids) : eq(conversation.id, '__no_match__'))!);
    }
    const cursor = decodeCursor(input.cursor);
    if (cursor) { const at = new Date(cursor.at); filters.push(or(lt(conversation.updatedAt, at), and(eq(conversation.updatedAt, at), lt(conversation.id, cursor.id)))!); }
    const limit = pageSize(input.limit);
    const rows = await this.db.select().from(conversation).where(and(...filters)).orderBy(desc(conversation.updatedAt), desc(conversation.id)).limit(limit + 1);
    const hasMore = rows.length > limit; const items = rows.slice(0,limit);
    return { items, nextCursor: hasMore && items.length ? encodeCursor(items[items.length-1]) : null, hasMore };
  }
  async create(userId: string, input: { title?: string; subject?: 'calculus'|'algebra'|'geometry'|'statistics'|'general' }) {
    const now = new Date(); const item = { id:newId(), userId, title:input.title?.slice(0,160) ?? 'Nouvelle conversation', subject:input.subject ?? 'general', createdAt:now, updatedAt:now };
    await this.db.insert(conversation).values(item); return item;
  }
  async getOwned(userId: string, id: string) {
    const [item] = await this.db.select().from(conversation).where(and(eq(conversation.id,id),eq(conversation.userId,userId))).limit(1);
    if (!item) throw new NotFoundException('Conversation not found'); return item;
  }
  async getMessages(userId: string, id: string) {
    await this.getOwned(userId,id); const rows = await this.db.select().from(message).where(eq(message.conversationId,id)).orderBy(desc(message.createdAt)).limit(500); return rows.reverse();
  }
  async messagesPage(userId:string,id:string,input:{limit?:number;cursor?:string}) {
    await this.getOwned(userId,id); const filters:any[]=[eq(message.conversationId,id)]; const cursor=decodeCursor(input.cursor);
    if(cursor){const at=new Date(cursor.at);filters.push(or(lt(message.createdAt,at),and(eq(message.createdAt,at),lt(message.id,cursor.id)))!);}
    const limit=pageSize(input.limit); const rows=await this.db.select().from(message).where(and(...filters)).orderBy(desc(message.createdAt),desc(message.id)).limit(limit+1);
    const hasMore=rows.length>limit; const selected=rows.slice(0,limit);
    return {items:selected.slice().reverse(),nextCursor:hasMore&&selected.length?encodeCursor({...selected[selected.length-1],createdAt:selected[selected.length-1].createdAt}):null,hasMore};
  }
  async rename(userId:string,id:string,title:string) {
    await this.getOwned(userId,id); const clean=title.trim().slice(0,160); if(!clean) throw new BadRequestException('Conversation title cannot be empty');
    const [updated]=await this.db.update(conversation).set({title:clean,updatedAt:new Date()}).where(and(eq(conversation.id,id),eq(conversation.userId,userId))).returning(); return updated;
  }
  async archive(userId:string,id:string) {
    await this.getOwned(userId,id); const [updated]=await this.db.update(conversation).set({archivedAt:new Date(),updatedAt:new Date()}).where(and(eq(conversation.id,id),eq(conversation.userId,userId))).returning(); return updated;
  }
  async unarchive(userId:string,id:string) {
    await this.getOwned(userId,id); const [updated]=await this.db.update(conversation).set({archivedAt:null,updatedAt:new Date()}).where(and(eq(conversation.id,id),eq(conversation.userId,userId))).returning(); return updated;
  }
  async delete(userId:string,id:string) { await this.getOwned(userId,id); await this.db.delete(conversation).where(and(eq(conversation.id,id),eq(conversation.userId,userId))); return {deleted:true}; }
  async deleteAll(userId:string) { const rows=await this.db.delete(conversation).where(eq(conversation.userId,userId)).returning({id:conversation.id}); return {deleted:true,count:rows.length}; }
}