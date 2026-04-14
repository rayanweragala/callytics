import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateExtensionDto {
  @IsString()
  @MaxLength(64)
  username!: string;

  @IsString()
  @MaxLength(128)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  displayName?: string;
}
