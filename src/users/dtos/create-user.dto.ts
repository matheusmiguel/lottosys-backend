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
    min
} from 'class-validator';

export class CreateUserDto {
    @Type(() => Number)
    @IsInt()
    @IsIn([2, 3, 4])
    type: number;

    @IsString()
    @IsNotEmpty()
    @MaxLength(120)
    name: string;

    @IsString()
    @IsNotEmpty()
    @MaxLength(50)
    login: string;

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
    password: string;

    @IsString()
    @IsIn(['usd', 'brl', 'eur', 'btc'])
    currency: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    ngr_percent?: number = 0;
}