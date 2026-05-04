import { IsNotEmpty, IsString } from 'class-validator';

export class RelayActivateDto {
  @IsString()
  @IsNotEmpty()
  config!: string;
}
