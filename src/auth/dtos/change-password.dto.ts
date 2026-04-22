import { IsEmail, IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
    @IsString()
    @MinLength(4)
    password: string;

    @IsString()
    @MinLength(4)
    npassword: string;
    
    @IsString()
    @MinLength(4)
    npassword_confirm: string;
}
