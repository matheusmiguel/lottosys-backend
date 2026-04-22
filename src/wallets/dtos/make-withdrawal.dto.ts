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
    Length
} from 'class-validator';

export class MakeWithdrawalDto {
    @IsString()
    amount: string;
}