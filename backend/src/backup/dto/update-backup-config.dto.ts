import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import type { BackupInterval } from '../backup.types';

export class UpdateBackupConfigDto {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(['daily', 'weekly', 'custom'])
  interval?: BackupInterval;

  @IsOptional()
  @Transform(({ value }) => value === '' ? null : value)
  @IsString()
  cronExpression?: string | null;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeRecordings?: boolean;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  retentionCount?: number;
}
