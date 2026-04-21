import { IsArray, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpdateQueueDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNumber()
  wait_audio_file_id?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  max_wait_seconds?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  pin_retry_attempts?: number;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  operator_ids?: number[];
}
