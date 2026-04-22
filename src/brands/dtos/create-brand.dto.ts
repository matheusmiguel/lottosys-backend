import { IsEmail, IsNotEmpty, IsNumber, IsString, MinLength } from 'class-validator';

export class CreateBrandDto {
    @IsString()
    @IsNotEmpty()
    brand_name: string;

    @IsString()
    @IsNotEmpty()
    brand_url: string;

    @IsNumber()
    status: number;

    @IsString()
    @IsNotEmpty()
    name: string;

    @IsString()
    @IsNotEmpty()
    login: string;

    @IsEmail()
    email: string;

    @IsString()
    @MinLength(6)
    password: string;
}