import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateInboundRouteDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  did?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  flowId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  label?: string;
}
