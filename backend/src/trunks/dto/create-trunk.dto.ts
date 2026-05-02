import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateTrunkDto {
  @IsString()
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  providerPreset?: string;

  @IsString()
  @MaxLength(255)
  host!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  port?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  username?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  fromDomain?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  fromUser?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  dialFormat?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
