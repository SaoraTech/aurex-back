import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client, DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppException } from '../common/errors';
import { MetricsService } from '../observability/metrics.service';

const status = (e: unknown): number | undefined => (e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
const name = (e: unknown): string | undefined => (e as { name?: string })?.name;
const isMissing = (e: unknown) => status(e) === 404 || name(e) === 'NotFound' || name(e) === 'NoSuchKey';

/**
 * Low-level private object storage on Cloudflare R2 (S3-compatible). The bucket is never public; there is no
 * public base URL. Keys are generated server-side from verified identifiers; access = ownership checks done by
 * LibraryService against the database + presigned, short-lived GET URLs.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private client?: S3Client;
  private readonly bucket?: string;
  private readonly enabled: boolean;

  constructor(private readonly config: ConfigService, private readonly metrics: MetricsService) {
    this.enabled = this.config.get<boolean>('r2Enabled') === true;
    this.bucket = this.config.get<string>('r2Bucket');
    if (this.enabled) {
      const accountId = this.config.get<string>('r2AccountId');
      const accessKeyId = this.config.get<string>('r2AccessKeyId');
      const secretAccessKey = this.config.get<string>('r2SecretAccessKey');
      if (!accountId || !this.bucket || !accessKeyId || !secretAccessKey) throw new Error('R2_ENABLED=true requires account ID, bucket, access key ID and secret access key');
      this.client = this.createClient(accountId, accessKeyId, secretAccessKey);
    }
  }

  protected createClient(accountId: string, accessKeyId: string, secretAccessKey: string): S3Client {
    return new S3Client({
      region: 'auto',
      endpoint: this.config.get<string>('r2Endpoint') || `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
      // AWS SDK >= 3.729 adds CRC32 checksums by default, which R2 rejects on some operations.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  isEnabled(): boolean { return this.enabled; }
  private get timeoutMs() { return this.config.get<number>('r2TimeoutMs') ?? 30000; }

  private assertEnabled(): S3Client {
    if (!this.enabled || !this.client || !this.bucket) throw new AppException(503, 'STORAGE_DISABLED', "Le stockage de fichiers n'est pas activé sur ce serveur.");
    return this.client;
  }

  private async send<T>(op: string, fn: (c: S3Client, signal: AbortSignal) => Promise<T>): Promise<T> {
    const client = this.assertEnabled();
    return this.metrics.track('r2', op, () => fn(client, AbortSignal.timeout(this.timeoutMs)));
  }

  /** Server-generated key. `ownerId` and `objectId` come from the verified session / database, never the client. */
  buildKey(ownerId: string, objectId: string): string {
    if (!ownerId || ownerId.length > 128 || !/^[0-9a-f-]{36}$/i.test(objectId)) throw new AppException(400, 'INVALID_OBJECT_ID', "Identifiant d'objet invalide.");
    return `users/${encodeURIComponent(ownerId)}/${objectId}`;
  }

  async put(key: string, body: Buffer, contentType: string, ownerId: string): Promise<void> {
    await this.send('put', (c, signal) => c.send(new PutObjectCommand({
      Bucket: this.bucket, Key: key, Body: body, ContentLength: body.length, ContentType: contentType, Metadata: { ownerid: ownerId },
    }), { abortSignal: signal })).catch(e => { throw this.map(e); });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.send('head', (c, signal) => c.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }), { abortSignal: signal }));
      return true;
    } catch (e) { if (isMissing(e)) return false; throw this.map(e); }
  }

  async delete(key: string): Promise<void> {
    await this.send('delete', (c, signal) => c.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }), { abortSignal: signal })).catch(e => { throw this.map(e); });
  }

  /** Deletes every object under a user's prefix (account deletion). Returns the number of objects removed. */
  async deleteUserPrefix(ownerId: string): Promise<number> {
    const prefix = `users/${encodeURIComponent(ownerId)}/`;
    let removed = 0; let token: string | undefined;
    do {
      const page = await this.send('list', (c, signal) => c.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }), { abortSignal: signal })).catch(e => { throw this.map(e); });
      const keys = (page.Contents ?? []).map(o => ({ Key: o.Key! }));
      if (keys.length) {
        await this.send('delete_many', (c, signal) => c.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys, Quiet: true } }), { abortSignal: signal })).catch(e => { throw this.map(e); });
        removed += keys.length;
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return removed;
  }

  /** Short-lived presigned GET URL. Forces download (attachment) so uploaded content is never rendered inline. */
  async presignDownload(key: string, filename: string, contentType: string): Promise<{ url: string; expiresIn: number }> {
    const client = this.assertEnabled();
    const expiresIn = Math.min(Math.max(this.config.get<number>('r2PresignedUrlTtlSeconds') ?? 300, 30), 3600);
    const safe = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
    const url = await getSignedUrl(client, new GetObjectCommand({
      Bucket: this.bucket, Key: key, ResponseContentType: contentType,
      ResponseContentDisposition: `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    }), { expiresIn });
    return { url, expiresIn };
  }

  private map(error: unknown): AppException {
    if (error instanceof AppException) return error;
    this.logger.error({ msg: 'r2_error', status: status(error), name: name(error) });
    if (status(error) === 403) return new AppException(503, 'STORAGE_MISCONFIGURED', 'Le stockage est mal configuré.');
    if (name(error) === 'TimeoutError' || name(error) === 'AbortError') return new AppException(504, 'STORAGE_TIMEOUT', 'Le stockage ne répond pas à temps.');
    return new AppException(503, 'STORAGE_UNAVAILABLE', 'Le stockage est momentanément indisponible.');
  }
}
