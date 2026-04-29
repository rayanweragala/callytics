import { IsInt, IsOptional, IsString } from 'class-validator';

export class UpdateContactNumberDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  number?: string;

  @IsInt()
  trunk_id?: number;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
