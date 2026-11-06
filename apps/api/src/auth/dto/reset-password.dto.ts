import { IsString, MinLength, MaxLength } from "class-validator";

export class ResetPasswordDto {
  @IsString()
  @MinLength(32)
  @MaxLength(128)
  token!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  newPassword!: string;
}
