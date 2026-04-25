import { IsInt, IsOptional, IsString, Matches } from 'class-validator';

export class CreateOperatorDto {
  @IsString()
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

  @IsOptional()
  @IsString()
  callback_number?: string;

  @IsOptional()
  @IsInt()
  callback_trunk_id?: number;
}
