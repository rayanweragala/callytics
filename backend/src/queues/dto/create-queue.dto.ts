import { ArrayMinSize, IsArray, IsInt, IsNumber, IsOptional, IsString, IsNotEmpty, Min } from 'class-validator';

export class CreateQueueDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

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

  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  operator_ids!: number[];
}
