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

export class AddWalletTransactionDto {
    @Type(() => Number)
    @IsInt()
    @IsIn([0, 1])
    type: number;

    @IsString()
    amount: string;
    
    @IsString()
    @Length(6, 6)
    token: string;
    
    @IsString()
    @IsOptional()
    title?: string;
}