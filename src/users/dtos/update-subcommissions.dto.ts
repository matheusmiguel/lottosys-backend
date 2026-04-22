import {
    IsString,
    IsEmail,
    IsOptional,
    IsNotEmpty,
    MinLength,
    MaxLength,
    IsInt,
    IsIn,
    min,
    Min,
    Max
} from 'class-validator';

export class UpdateSubcommissionsDto {
    @IsInt()
    @Min(0)
    @Max(100)
    cpa_percent: number;
    
    @IsInt()
    @Min(0)
    @Max(100)
    deposit_percent: number;
    
    @IsInt()
    @Min(0)
    @Max(100)
    revshare_percent: number;
}