import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuthModule } from 'src/auth/auth.module';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { UsersModule } from 'src/users/users.module';
import { CurrencyModule } from 'src/currency/currency.module';

@Module({
	imports: [PrismaModule, AuthModule, UsersModule, CurrencyModule],
	providers: [ReportsService],
	controllers: [ReportsController]
})
export class ReportsModule { }
