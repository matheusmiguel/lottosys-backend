import { Type } from 'class-transformer';
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

export class UpdateUserDto {
    @IsInt()
    @IsIn([0, 1])
    status: number;

    @IsInt()
    @IsIn([2, 3, 4, 5, 6])
    type: number;

    @IsEmail()
    email: string;

    @IsOptional()
    @IsString()
    @MaxLength(30)
    phone?: string;

    @IsOptional()
    @IsString()
    @MaxLength(30)
    document?: string;

    @IsString()
    @MinLength(6)
    @IsOptional()
    password?: string;

    @IsString()
    @IsIn(['usd', 'brl', 'eur', 'btc'])
    currency: string;

    @IsOptional()
    @Type(() => Number)
    @Min(0)
    @Max(100)
    ngr_percent?: number;

    withdrawal_configs?: any;
}