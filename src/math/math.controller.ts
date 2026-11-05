import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { RequireUserGuard } from '../auth/require-user.guard';
import { CurrentUserId, RequestId } from '../common/user.decorator';
import { Protect } from '../security/protect.decorator';
import { MathOperationType } from './math-engine.interface';
import { MathService } from './math.service';

class ComputeDto {
  @IsOptional()
  @IsEnum([
    'derivative',
    'integral',
    'simplify',
    'factor',
    'solve',
    'limit',
    'matrix_determinant',
    'custom',
  ])
  operation?: MathOperationType;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  expression?: string;

  /** Backward-compatibility field */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  input?: string;

  @IsOptional()
  @IsString()
  variable?: string;

  @IsOptional()
  @IsObject()
  bounds?: { lower?: string; upper?: string };
}

@ApiTags('math')
@ApiBearerAuth()
@UseGuards(RequireUserGuard)
@Controller('math')
export class MathController {
  constructor(private readonly math: MathService) {}

  @Post('compute')
  @Protect('math')
  compute(
    @CurrentUserId() uid: string,
    @RequestId() rid: string,
    @Body() dto: ComputeDto,
  ) {
    const expr = dto.expression ?? dto.input ?? '';
    const op = dto.operation ?? 'custom';

    return this.math.compute(
      uid,
      {
        operation: op,
        expression: expr,
        variable: dto.variable,
        bounds: dto.bounds,
      },
      rid,
    );
  }
}
