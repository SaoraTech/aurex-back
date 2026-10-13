import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { RequireUserGuard } from '../auth/require-user.guard';
import { CurrentUserId } from '../common/user.decorator';
import { StorageService } from './storage.service';

export class CreatePresignedUploadDto {
  @IsString()
  @IsNotEmpty()
  filename!: string;

  @IsString()
  @IsNotEmpty()
  contentType!: string;

  @IsNumber()
  @IsOptional()
  @Min(60)
  @Max(3600)
  expiresInSeconds?: number;
}

export class CreatePresignedDownloadDto {
  @IsString()
  @IsNotEmpty()
  key!: string;

  @IsNumber()
  @IsOptional()
  @Min(60)
  @Max(86400)
  expiresInSeconds?: number;
}

export class DeleteObjectDto {
  @IsString()
  @IsNotEmpty()
  key!: string;
}

@ApiTags('storage')
@ApiBearerAuth()
@UseGuards(RequireUserGuard)
@Controller('storage')
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @Get('status')
  @ApiOperation({ summary: 'Vérifier la configuration du stockage d’objets privé Cloudflare R2' })
  getStatus() {
    return this.storageService.getStatus();
  }

  @Post('presigned-upload')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Obtenir une URL présignée pour téléverser un fichier privé vers Cloudflare R2' })
  async getPresignedUpload(
    @CurrentUserId() userId: string,
    @Body() body: CreatePresignedUploadDto,
  ) {
    return this.storageService.getPresignedUploadUrl(userId, body);
  }

  @Post('presigned-download')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Obtenir une URL présignée pour télécharger un fichier privé appartenant à l’utilisateur' })
  async getPresignedDownload(
    @CurrentUserId() userId: string,
    @Body() body: CreatePresignedDownloadDto,
  ) {
    return this.storageService.getPresignedDownloadUrl(userId, body.key, body.expiresInSeconds);
  }

  @Delete('objects')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Supprimer définitivement un objet du stockage Cloudflare R2' })
  async deleteObject(
    @CurrentUserId() userId: string,
    @Body() body: DeleteObjectDto,
  ) {
    return this.storageService.deleteObject(userId, body.key);
  }

  @Get('objects/metadata')
  @ApiOperation({ summary: 'Consulter les métadonnées d’un objet appartenant à l’utilisateur' })
  async getMetadata(
    @CurrentUserId() userId: string,
    @Query('key') key: string,
  ) {
    return this.storageService.getObjectMetadata(userId, key);
  }
}
