import { IsString } from 'class-validator';

export class CreateTtsDto {
  @IsString()
  text!: string;

  @IsString()
  voice!: string;

  @IsString()
  name!: string;
}
