import { IsInt, IsString, Length } from "class-validator";

export class Verify2FADto {
    @IsInt()
    user_id: number;

    @IsString()
    @Length(6, 6)
    token: string;
}