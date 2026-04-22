import { Module } from '@nestjs/common';
import { RegistrationsService } from './registrations.service';
import { RegistrationsController } from './registrations.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuthModule } from 'src/auth/auth.module';
import { CurrencyModule } from 'src/currency/currency.module';

@Module({
	imports: [PrismaModule, AuthModule, CurrencyModule],
	providers: [RegistrationsService],
	controllers: [RegistrationsController]
})
export class RegistrationsModule { }
