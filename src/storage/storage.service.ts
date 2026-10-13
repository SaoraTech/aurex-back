import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { newId } from '../common/ids';

export interface PresignedUploadResult {
  uploadUrl: string;
  key: string;
  expiresInSeconds: number;
  bucket: string;
}

export interface PresignedDownloadResult {
  downloadUrl: string;
  key: string;
  expiresInSeconds: number;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private s3Client: S3Client | null = null;
  private bucket: string | null = null;

  constructor(private readonly config: ConfigService) {
    this.initClient();
  }

  private initClient() {
    const accountId = this.config.get<string>('r2.accountId');
    const accessKeyId = this.config.get<string>('r2.accessKeyId');
    const secretAccessKey = this.config.get<string>('r2.secretAccessKey');
    const endpoint = this.config.get<string>('r2.endpoint') ?? (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined);
    const bucket = this.config.get<string>('r2.bucket');

    if (accessKeyId && secretAccessKey && endpoint && bucket) {
      this.bucket = bucket;
      this.s3Client = new S3Client({
        region: 'auto',
        endpoint,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      });
      this.logger.log(`Client Cloudflare R2 initialisé sur le bucket '${bucket}'`);
    } else {
      this.logger.warn('Cloudflare R2 n’est pas configuré. Le stockage d’objets privé est inactif.');
    }
  }

  isConfigured(): boolean {
    return this.s3Client !== null && this.bucket !== null;
  }

  /**
   * Vérifie strictement que la clé appartient à l'utilisateur courant (protection anti-IDOR/BOLA)
   * et ne contient aucune tentative de traversée de chemin ('..').
   */
  assertOwnership(userId: string, key: string): void {
    if (!key || typeof key !== 'string') {
      throw new BadRequestException('Clé d’objet invalide.');
    }

    if (key.includes('..') || key.includes('\\') || key.startsWith('/')) {
      throw new ForbiddenException('Clé d’objet malformée ou tentative de traversée de chemin.');
    }

    const expectedPrefix = `${userId}/`;
    if (!key.startsWith(expectedPrefix)) {
      throw new ForbiddenException('Accès refusé : cet objet n’appartient pas à votre compte utilisateur.');
    }
  }

  /**
   * Génère une URL présignée de téléversement (PUT) à durée limitée (par défaut 15 minutes).
   * La clé est obligatoirement préfixée par l'identifiant de l'utilisateur.
   */
  async getPresignedUploadUrl(
    userId: string,
    input: { filename: string; contentType: string; expiresInSeconds?: number },
  ): Promise<PresignedUploadResult> {
    if (!this.s3Client || !this.bucket) {
      throw new ServiceUnavailableException('Le stockage Cloudflare R2 n’est pas configuré sur ce serveur.');
    }

    if (!input.filename || !input.contentType) {
      throw new BadRequestException('Le nom de fichier et le type MIME sont obligatoires.');
    }

    // Nettoyage du nom de fichier pour éviter les caractères dangereux
    const sanitizedFilename = input.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const objectId = newId();
    const key = `${userId}/${objectId}-${sanitizedFilename}`;
    const expiresIn = input.expiresInSeconds ?? 900; // 15 min

    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: input.contentType,
        Metadata: {
          'uploaded-by': userId,
          'original-filename': encodeURIComponent(input.filename),
        },
      });

      const uploadUrl = await getSignedUrl(this.s3Client, command, { expiresIn });

      return {
        uploadUrl,
        key,
        expiresInSeconds: expiresIn,
        bucket: this.bucket,
      };
    } catch (err) {
      this.logger.error('Erreur lors de la génération de l’URL présignée d’upload R2', (err as Error).stack);
      throw new ServiceUnavailableException('Impossible de générer le lien de téléversement sécurisé.');
    }
  }

  /**
   * Génère une URL présignée de téléchargement (GET) à durée limitée (par défaut 1 heure).
   */
  async getPresignedDownloadUrl(
    userId: string,
    key: string,
    expiresInSeconds = 3600,
  ): Promise<PresignedDownloadResult> {
    if (!this.s3Client || !this.bucket) {
      throw new ServiceUnavailableException('Le stockage Cloudflare R2 n’est pas configuré sur ce serveur.');
    }

    this.assertOwnership(userId, key);

    try {
      // Vérification préalable de l'existence de l'objet
      await this.s3Client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
    } catch (err: any) {
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        throw new NotFoundException('L’objet demandé est introuvable.');
      }
      this.logger.warn(`Vérification R2 HeadObject échouée: ${err.message}`);
    }

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      const downloadUrl = await getSignedUrl(this.s3Client, command, {
        expiresIn: expiresInSeconds,
      });

      return {
        downloadUrl,
        key,
        expiresInSeconds,
      };
    } catch (err) {
      this.logger.error('Erreur génération lien téléchargement R2', (err as Error).stack);
      throw new ServiceUnavailableException('Impossible de générer le lien de téléchargement sécurisé.');
    }
  }

  /**
   * Supprime un objet appartenant à l'utilisateur.
   */
  async deleteObject(userId: string, key: string): Promise<{ success: boolean; key: string }> {
    if (!this.s3Client || !this.bucket) {
      throw new ServiceUnavailableException('Le stockage Cloudflare R2 n’est pas configuré sur ce serveur.');
    }

    this.assertOwnership(userId, key);

    try {
      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );

      return { success: true, key };
    } catch (err) {
      this.logger.error(`Erreur suppression objet R2 '${key}'`, (err as Error).stack);
      throw new ServiceUnavailableException('Échec de la suppression de l’objet.');
    }
  }

  /**
   * Récupère les métadonnées d'un objet appartenant à l'utilisateur.
   */
  async getObjectMetadata(userId: string, key: string) {
    if (!this.s3Client || !this.bucket) {
      throw new ServiceUnavailableException('Le stockage Cloudflare R2 n’est pas configuré sur ce serveur.');
    }

    this.assertOwnership(userId, key);

    try {
      const res = await this.s3Client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );

      return {
        key,
        contentType: res.ContentType,
        contentLength: res.ContentLength,
        lastModified: res.LastModified,
        metadata: res.Metadata,
      };
    } catch (err: any) {
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        throw new NotFoundException('Objet introuvable.');
      }
      throw new ServiceUnavailableException('Erreur lors de la lecture des métadonnées de l’objet.');
    }
  }

  getStatus() {
    return {
      configured: this.isConfigured(),
      bucket: this.bucket,
    };
  }
}
