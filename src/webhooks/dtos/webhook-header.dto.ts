import { IsString, IsNotEmpty } from 'class-validator';

export class WebhookHeaderDto {
    @IsString()
    @IsNotEmpty()
    key: string;

    @IsString()
    @IsNotEmpty()
    value: string;
}