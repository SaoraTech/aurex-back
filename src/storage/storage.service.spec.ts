import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { StorageService } from './storage.service';

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://mock-presigned-url.r2.cloudflarestorage.com/test'),
}));

describe('StorageService', () => {
  let service: StorageService;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    configService = {
      get: jest.fn((key: string) => {
        if (key === 'r2.accountId') return 'test-account-id';
        if (key === 'r2.accessKeyId') return 'test-access-key';
        if (key === 'r2.secretAccessKey') return 'test-secret-key';
        if (key === 'r2.bucket') return 'aurex-private-bucket';
        if (key === 'r2.endpoint') return 'https://test-account-id.r2.cloudflarestorage.com';
        return undefined;
      }),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<StorageService>(StorageService);
  });

  describe('assertOwnership (IDOR / BOLA Prevention)', () => {
    const userId = 'usr_12345';

    it('allows access when key strictly belongs to user namespace', () => {
      expect(() => {
        service.assertOwnership(userId, `${userId}/doc-5678.pdf`);
      }).not.toThrow();
    });

    it('rejects access when key belongs to another user (anti-IDOR)', () => {
      expect(() => {
        service.assertOwnership(userId, 'usr_attacker/stolen-doc.pdf');
      }).toThrow(ForbiddenException);
    });

    it('rejects path traversal attempts with .. or absolute slashes', () => {
      expect(() => {
        service.assertOwnership(userId, `${userId}/../etc/passwd`);
      }).toThrow(ForbiddenException);

      expect(() => {
        service.assertOwnership(userId, '/root/secret.env');
      }).toThrow(ForbiddenException);
    });
  });

  describe('getPresignedUploadUrl', () => {
    it('generates an upload URL with user-scoped key', async () => {
      const result = await service.getPresignedUploadUrl('usr_abc', {
        filename: 'cours_algebre.pdf',
        contentType: 'application/pdf',
      });

      expect(result.uploadUrl).toContain('mock-presigned-url');
      expect(result.key.startsWith('usr_abc/')).toBe(true);
      expect(result.key).toContain('cours_algebre.pdf');
      expect(result.bucket).toBe('aurex-private-bucket');
    });

    it('throws when R2 is not configured', async () => {
      configService.get.mockReturnValue(undefined);
      const unconfiguredService = new StorageService(configService);

      await expect(
        unconfiguredService.getPresignedUploadUrl('usr_abc', {
          filename: 'test.pdf',
          contentType: 'application/pdf',
        }),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });
});
