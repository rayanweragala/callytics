import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateVpnPeerDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name!: string;
}
