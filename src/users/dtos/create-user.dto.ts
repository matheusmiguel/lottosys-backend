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
    @IsIn([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
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

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    region?: number = 0;
}