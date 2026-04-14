import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateInboundRouteDto {
  @IsString()
  @MaxLength(32)
  did!: string;

  @Type(() => Number)
  @IsInt()
  flowId!: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  label?: string;
}
