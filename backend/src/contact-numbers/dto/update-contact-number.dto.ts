import { IsInt, IsOptional, IsString } from 'class-validator';

export class UpdateContactNumberDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  number?: string;

  @IsOptional()
  @IsInt()
  trunk_id?: number | null;

  @IsOptional()
  @IsString()
  notes?: string;
}
