import { IsEmail } from "class-validator";

export class RecoveryEmailDto {
    @IsEmail()
    email: string;
}