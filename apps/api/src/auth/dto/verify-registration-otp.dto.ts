import { IsEmail, IsString, Matches, MaxLength } from "class-validator";
export class VerifyRegistrationOtpDto {
  @IsEmail() @MaxLength(320) email!: string;
  @IsString() @Matches(/^\\d{6}$/) otp!: string;
}
