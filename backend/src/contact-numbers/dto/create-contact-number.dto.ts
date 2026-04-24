import { IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateContactNumberDto {
  @IsString()
  @IsNotEmpty()
  label!: string;

  @IsString()
  @IsNotEmpty()
  number!: string;

  @IsOptional()
  @IsInt()
  trunk_id?: number;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
