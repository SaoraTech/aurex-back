import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { AppException, badRequest, notFound, payloadTooLarge, unsupportedMedia } from '../common/errors';
import { newId } from '../common/ids';
import { DRIZZLE } from '../db/db.constants';
import { libraryDocument } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { PlansService } from '../plans/plans.service';
import { ALLOWED_FILE_TYPES, matchesFileSignature, sanitizeFilename } from '../storage/file-signature';
import { StorageService } from '../storage/storage.service';

const PUBLIC_COLUMNS = {
  id: libraryDocument.id, filename: libraryDocument.filename, mimeType: libraryDocument.mimeType,
  sizeBytes: libraryDocument.sizeBytes, status: libraryDocument.status, createdAt: libraryDocument.createdAt,
};

/** Private document catalogue: ownership lives in the database; object keys are server-generated and never exposed. */
@Injectable()
export class LibraryService {
  private readonly logger = new Logger(LibraryService.name);
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly storage: StorageService,
    private readonly plans: PlansService,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string) {
    return this.db.select(PUBLIC_COLUMNS).from(libraryDocument).where(eq(libraryDocument.userId, userId)).orderBy(desc(libraryDocument.createdAt)).limit(100);
  }

  private async getOwned(userId: string, id: string) {
    const [doc] = await this.db.select().from(libraryDocument).where(and(eq(libraryDocument.id, id), eq(libraryDocument.userId, userId))).limit(1);
    // Same answer for "does not exist" and "belongs to someone else" (no IDOR oracle).
    if (!doc) throw notFound('DOCUMENT_NOT_FOUND', 'Document introuvable.');
    return doc;
  }

  async get(userId: string, id: string) {
    const doc = await this.getOwned(userId, id);
    return { id: doc.id, filename: doc.filename, mimeType: doc.mimeType, sizeBytes: doc.sizeBytes, status: doc.status, createdAt: doc.createdAt };
  }

  async upload(userId: string, body: Buffer | undefined, input: { declaredMime: string; filename?: string }, requestId?: string) {
    if (!this.storage.isEnabled()) throw new AppException(503, 'STORAGE_DISABLED', "Le stockage de fichiers n'est pas activé sur ce serveur.");
    if (!Buffer.isBuffer(body) || body.length === 0) throw badRequest('FILE_REQUIRED', 'Envoyez les octets du fichier dans le corps de la requête.');
    const mime = input.declaredMime.split(';')[0].trim().toLowerCase();
    const type = ALLOWED_FILE_TYPES[mime];
    if (!type) throw unsupportedMedia('UNSUPPORTED_FILE_TYPE', "Ce type de fichier n'est pas autorisé.");

    const plan = await this.plans.getEffectivePlan(userId);
    const limits = this.plans.getLimits()[plan];
    if (body.length > limits.maxFileBytes) throw payloadTooLarge('FILE_TOO_LARGE', `Fichier trop volumineux pour le forfait ${plan} (max ${limits.maxFileBytes} octets).`);
    if (!matchesFileSignature(body, mime)) throw unsupportedMedia('INVALID_FILE_SIGNATURE', 'Le contenu du fichier ne correspond pas à son type déclaré.');

    const [{ total }] = await this.db.select({ total: sql<number>`coalesce(sum(${libraryDocument.sizeBytes}), 0)` }).from(libraryDocument).where(eq(libraryDocument.userId, userId));
    if (Number(total) + body.length > limits.maxStorageBytes) throw new AppException(413, 'STORAGE_QUOTA_EXCEEDED', 'Espace de stockage du forfait dépassé.');

    const id = newId();
    const key = this.storage.buildKey(userId, id);
    const filename = sanitizeFilename(input.filename, type.ext);
    await this.storage.put(key, body, mime, userId);
    try {
      await this.db.insert(libraryDocument).values({
        id, userId, filename, mimeType: mime, sizeBytes: body.length, objectKey: key,
        sha256: createHash('sha256').update(body).digest('hex'), status: 'stored',
      });
    } catch (error) {
      // Compensate: never leave an orphan object without a catalogue row.
      await this.storage.delete(key).catch(() => this.logger.error({ msg: 'orphan_object_cleanup_failed', documentId: id }));
      throw error;
    }
    await this.audit.record({ actorUserId: userId, action: 'library.upload', targetType: 'library_document', targetId: id, requestId, metadata: { sizeBytes: body.length, mimeType: mime } }).catch(() => undefined);
    return { id, filename, mimeType: mime, sizeBytes: body.length, status: 'stored' };
  }

  async downloadUrl(userId: string, id: string, requestId?: string) {
    const doc = await this.getOwned(userId, id);
    if (!(await this.storage.exists(doc.objectKey))) throw notFound('DOCUMENT_OBJECT_MISSING', 'Le fichier est introuvable dans le stockage.');
    const signed = await this.storage.presignDownload(doc.objectKey, doc.filename, doc.mimeType);
    await this.audit.record({ actorUserId: userId, action: 'library.download_url', targetType: 'library_document', targetId: id, requestId }).catch(() => undefined);
    return { id: doc.id, filename: doc.filename, ...signed };
  }

  async remove(userId: string, id: string, requestId?: string) {
    const doc = await this.getOwned(userId, id);
    await this.storage.delete(doc.objectKey); // S3 delete is idempotent; fail loudly if storage is unavailable
    await this.db.delete(libraryDocument).where(and(eq(libraryDocument.id, id), eq(libraryDocument.userId, userId)));
    await this.audit.record({ actorUserId: userId, action: 'library.delete', targetType: 'library_document', targetId: id, requestId }).catch(() => undefined);
    return { deleted: true };
  }

  /** For the account-deletion job: removes every stored object and catalogue row of a user. */
  async removeAllForUser(userId: string) {
    const objects = this.storage.isEnabled() ? await this.storage.deleteUserPrefix(userId) : 0;
    await this.db.delete(libraryDocument).where(eq(libraryDocument.userId, userId));
    return { objectsDeleted: objects };
  }
}
