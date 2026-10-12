import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { RequireUserGuard } from '../auth/require-user.guard';
import { CurrentUserId } from '../common/user.decorator';
import { ArtifactsService } from './artifacts.service';

class CreateArtifactDto {
  @IsString() @MinLength(1) @MaxLength(180) title!: string;
  @IsIn(['equation','graph','proof','solution','document','other']) type!: any;
  @IsObject() content!: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
class NewVersionDto {
  @IsObject() content!: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
@ApiTags('artifacts') @ApiBearerAuth() @UseGuards(RequireUserGuard)
@Controller('artifacts')
export class ArtifactsController {
  constructor(private readonly service: ArtifactsService) {}
  @Get() list(@CurrentUserId() uid:string){return this.service.list(uid);}
  @Post() create(@CurrentUserId() uid:string,@Body() dto:CreateArtifactDto){return this.service.create(uid,dto);}
  @Get(':id/versions') versions(@CurrentUserId() uid:string,@Param('id') id:string){return this.service.versions(uid,id);}
  @Post(':id/versions') append(@CurrentUserId() uid:string,@Param('id') id:string,@Body() dto:NewVersionDto){return this.service.appendVersion(uid,id,dto);}
}
