import { IsInt, IsString, Length } from 'class-validator';
import { Type } from 'class-transformer';

export class SetAffiliateDto {
    @Type(() => Number)
    @IsInt()
    lead_id: number;

    @Type(() => Number)
    @IsInt()
    affiliate_id: number;

    @Type(() => Number)
    @IsInt()
    link_id: number;

    @IsString()
    @Length(6, 6)
    token_2fa: string;
}