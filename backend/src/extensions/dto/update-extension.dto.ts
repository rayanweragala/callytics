import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateExtensionDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  username?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  displayName?: string;

  @IsOptional()
  @IsString()
  @IsIn(['sip', 'webrtc'])
  transportType?: 'sip' | 'webrtc';

  @IsOptional()
  @IsBoolean()
  vpnOnly?: boolean;
}
