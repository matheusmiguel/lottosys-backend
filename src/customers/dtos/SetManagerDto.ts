import { IsInt, IsString, Length } from 'class-validator';
import { Type } from 'class-transformer';

export class SetManagerDto {
    @Type(() => Number)
    @IsInt()
    customer_id: number;

    @Type(() => Number)
    @IsInt()
    manager_id: number;
}