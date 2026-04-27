import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateRelayConfigDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  vpsPublicKey!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  vpsPublicIp!: string;
}
