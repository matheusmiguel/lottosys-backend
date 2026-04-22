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

export class UpdateLinkDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(120)
    name: string;

    @Type(() => Number)
    @IsInt()
    deal_id: number;

    @Type(() => Number)
    @IsInt()
    wallet_id: number;

    @Type(() => Number)
    @IsInt()
    link_type: number;

    @IsString()
    @IsOptional()
    @MaxLength(255)
    description?: string;
}