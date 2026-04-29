import { IsBoolean, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class PreviewTtsDto {
  @IsString()
  text!: string;

  @IsString()
  voice!: string;

  @IsNumber()
  @Min(0.5)
  @Max(2)
  @IsOptional()
  speed: number = 1;

  @IsNumber()
  @Min(-10)
  @Max(10)
  @IsOptional()
  pitch: number = 0;

  @IsBoolean()
  @IsOptional()
  normalizeVolume: boolean = true;
}
