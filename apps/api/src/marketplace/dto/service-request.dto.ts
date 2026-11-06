import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsNumber,
  Min,
  Max,
  IsUrl,
  IsUUID,
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

  @IsOptional() @IsNumber({ maxDecimalPlaces: 7 }) @Min(-90) @Max(90)
  latitude?: number;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 7 }) @Min(-180) @Max(180)
  longitude?: number;

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

 
export class UpdateProviderProfileDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  publicName!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(1000000)
  hourlyRate!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000000)
  assessmentFee!: number;

  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  skillCategories!: string[];

  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  serviceAreas!: string[];

  @IsArray()
  @ArrayMaxSize(3)
  @IsIn(["ONSITE", "REMOTE", "EITHER"], { each: true })
  deliveryModes!: string[];

  @IsIn([true, false])
  isAvailable!: boolean;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 1 }) @Min(1) @Max(200)
  maxTravelDistanceKm?: number;
}

export class RegisterPushDeviceDto {
  @IsString()
  @MaxLength(255)
  expoPushToken!: string;

  @IsIn(["ios", "android", "huawei-android"])
  platform!: string;
}


export class SelectProviderDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  responseId!: string;
}

export class SubmitEstimateDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.25)
  @Max(10000)
  estimatedHours!: number;

  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  notes!: string;
}

export class DecideEstimateDto {
  @IsIn([true, false])
  approved!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class RequestAdditionalHoursDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.25)
  @Max(10000)
  additionalHours!: number;

  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  reason!: string;
}

export class DecideAdditionalHoursDto {
  @IsIn([true, false])
  approved!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class SubmitJobCompletionDto {
  @IsString()
  @MinLength(20)
  @MaxLength(3000)
  notes!: string;

  @IsArray()
  @ArrayMaxSize(8)
  @ArrayMinSize(1)
  @IsUUID("4", { each: true })
  evidenceAssetIds!: string[];
}

export class DecideJobCompletionDto {
  @IsIn([true, false])
  approved!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class UpdateHomeLocationDto {
  @IsString() @MinLength(3) @MaxLength(500) label!: string;
  @IsNumber({ maxDecimalPlaces: 7 }) @Min(-90) @Max(90) latitude!: number;
  @IsNumber({ maxDecimalPlaces: 7 }) @Min(-180) @Max(180) longitude!: number;
}

export class UpdateLiveLocationDto {
  @IsNumber({ maxDecimalPlaces: 7 }) @Min(-90) @Max(90) latitude!: number;
  @IsNumber({ maxDecimalPlaces: 7 }) @Min(-180) @Max(180) longitude!: number;
  @IsNumber({ maxDecimalPlaces: 1 }) @Min(0) @Max(1000) accuracyM!: number;
}
