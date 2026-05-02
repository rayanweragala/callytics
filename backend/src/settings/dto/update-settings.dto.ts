import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  default_outbound_trunk_id?: number | null;

  @IsOptional()
  @IsBoolean()
  record_outbound_calls?: boolean;
}
