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
    IsUrl,
    IsArray,
    ValidateNested
} from 'class-validator';
import { WebhookHeaderDto } from './webhook-header.dto';

export class UpdateWebhookDto {
    @IsUrl()
    @IsNotEmpty()
    url: string;

    @IsString()
    @IsIn(['GET', 'POST', 'PUT'])
    method: string;

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => WebhookHeaderDto)
    headers?: WebhookHeaderDto[];

    @IsArray()
    @IsString({ each: true })
    events: string[];
}