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

export class CreateUserLinkDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(120)
    token: string;

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
}