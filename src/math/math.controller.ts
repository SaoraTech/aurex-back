import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { RequireUserGuard } from '../auth/require-user.guard';
import { CurrentUserId, RequestId } from '../common/user.decorator';
import { Protect } from '../security/protect.decorator';
import { MathService } from './math.service';

class ComputeDto { @IsString() @MinLength(1) @MaxLength(2000) input!: string; }
@ApiTags('math') @ApiBearerAuth() @UseGuards(RequireUserGuard)
@Controller('math')
export class MathController {
  constructor(private readonly math: MathService) {}
  @Post('compute') @Protect('math')
  compute(@CurrentUserId() uid: string, @RequestId() rid: string, @Body() dto: ComputeDto) { return this.math.compute(dto.input, uid, rid); }
}
