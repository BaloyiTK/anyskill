import { IsString, MaxLength, MinLength } from "class-validator";
export class CompleteRegistrationDto {
  @IsString() @MinLength(32) @MaxLength(128) registrationToken!: string;
  @IsString() @MinLength(12) @MaxLength(128) password!: string;
}
