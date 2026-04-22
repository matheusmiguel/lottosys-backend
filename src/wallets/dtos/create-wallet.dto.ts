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

export class CreateWalletDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(120)
    name: string;

    @IsString()
    @IsIn(['usd', 'brl', 'eur', 'ars', 'clp', 'mxn'])
    currency: string;

    @IsString()
    @IsOptional()
    @MaxLength(300)
    description: string;
}