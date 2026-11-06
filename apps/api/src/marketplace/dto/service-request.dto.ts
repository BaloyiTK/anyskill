import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from "class-validator";

export class CreateServiceRequestDto {
  @IsString()
  @MinLength(5)
  @MaxLength(120)
  title!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  skillCategory!: string;

  @IsString()
  @MinLength(20)
  @MaxLength(5000)
  description!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsUrl({ require_protocol: true }, { each: true })
  imageUrls?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  location?: string;

  @IsIn(["ONSITE", "REMOTE", "EITHER"])
  deliveryMode!: "ONSITE" | "REMOTE" | "EITHER";

  @IsOptional()
  @IsDateString()
  preferredStartAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  instructions?: string;
}

export class ProviderResponseDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;
}
