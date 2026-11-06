import { IsEmail, IsIn, IsOptional, MaxLength } from "class-validator";
export class RegisterDto {
  @IsEmail() @MaxLength(320) email!: string;
  @IsOptional() @IsIn(["SEEKER", "PROVIDER"]) mode?: "SEEKER" | "PROVIDER";
}
