import {
    Body,
    Controller,
    Get,
    Post,
    Req,
    UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dtos/login.dto';
import { RefreshTokenDto } from './dtos/refresh-token.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { Permissions } from './decorators/permissions.decorator';
import * as bcrypt from 'bcrypt';
import { ChangePasswordDto } from './dtos/change-password.dto';
import { RecoveryEmailDto } from './dtos/recovery-email.dto';
import { ResetPasswordDto } from './dtos/reset-password.dto';
import { Verify2FADto } from './dtos/verify-2fa.dto';
import { CurrentUser } from './decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) { }

    @Post('recovery-email')
    async recoveryEmail(@Body() dto: RecoveryEmailDto) {
        return this.authService.getRecoveryEmail(dto.email);
    }

    @Post('reset-password')
    async resetPassword(@Body() dto: ResetPasswordDto) {
        return this.authService.resetPasswordWithToken(
            dto.email,
            dto.token,
            dto.password,
            dto.password_confirm,
        );
    }
    
    // POST /auth/login
    @Post('login')
    async login(@Body() dto: LoginDto) {

        // Gerar senha
        // const hash = await bcrypt.hash('1234', 10);
        // console.log(hash);
        // return hash;

        return this.authService.login(dto);
    }

    // POST /auth/change-password
    @Post('change-password')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    async changePassword(@Req() req: any, @Body() dto: ChangePasswordDto) {
        return this.authService.changePassword(req.user.id, dto);
    }

    // POST /auth/refresh
    @Post('refresh')
    async refresh(@Body() dto: RefreshTokenDto) {
        return this.authService.refreshTokens(dto);
    }

    // GET /auth/me
    // Exemplo de rota protegida com JWT + permissão
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Get('me')
    async me(@Req() req: any) {
        return this.authService.getUserData(req.user.id);
    }
}
