import { Protect } from '../security/protect.decorator';
import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { RequireUserGuard } from '../auth/require-user.guard';
import { CurrentUserId } from '../common/user.decorator';
import { MemoryService } from './memory.service';

class CreateMemoryDto {
  @IsString() @MinLength(1) @MaxLength(120) title!: string;
  @IsString() @MinLength(1) @MaxLength(10000) content!: string;
  @IsOptional() @IsBoolean() pinned?: boolean;
}
class UpdateMemoryDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) title?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(10000) content?: string;
  @IsOptional() @IsBoolean() pinned?: boolean;
}
@ApiTags('memory') @ApiBearerAuth() @UseGuards(RequireUserGuard)
@Protect('read')
@Controller('memory')
export class MemoryController {
  constructor(private readonly service: MemoryService) {}
  @Get() list(@CurrentUserId() uid: string) { return this.service.list(uid); }
  @Post() create(@CurrentUserId() uid: string, @Body() dto: CreateMemoryDto) { return this.service.create(uid,dto); }
  @Patch(':id') update(@CurrentUserId() uid: string,@Param('id') id:string,@Body() dto:UpdateMemoryDto){return this.service.update(uid,id,dto);}
  @Delete(':id') remove(@CurrentUserId() uid:string,@Param('id') id:string){return this.service.remove(uid,id);}
}
