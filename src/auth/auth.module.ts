import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { CurrentUserService } from './current-user.service';
import { MailModule } from 'src/mail/mail.module';

@Module({
	imports: [
		PassportModule,
		JwtModule.register({
			secret: process.env.JWT_ACCESS_SECRET,
			signOptions: { expiresIn: '30m' },
		}),
		MailModule
	],
	controllers: [AuthController],
	providers: [
		AuthService,
		JwtStrategy,
		JwtAuthGuard,
		PermissionsGuard,
		CurrentUserService,
	],
	exports: [
		AuthService, // pra poder usar AuthService em outros módulos
		CurrentUserService,
	],
})
export class AuthModule { }
