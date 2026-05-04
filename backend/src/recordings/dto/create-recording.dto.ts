import { IsDateString, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateRecordingDto {
  @IsString()
  callId!: string;

  @IsString()
  channelId!: string;

  @IsOptional()
  @IsInt()
  flowId?: number | null;

  @IsString()
  fileName!: string;

  @IsString()
  filePath!: string;

  @IsString()
  format!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  durationSeconds?: number | null;

  @IsDateString()
  startedAt!: string;

  @IsOptional()
  @IsDateString()
  endedAt?: string | null;
}
