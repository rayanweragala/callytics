import { IsInt, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class CreateOperatorDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4,6}$/)
  pin?: string;

  @IsOptional()
  @IsInt()
  extension_id?: number;

  @IsOptional()
  @IsInt()
  contact_number_id?: number;
}
