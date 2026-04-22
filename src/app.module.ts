import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { ScheduleModule } from '@nestjs/schedule';
import { UsersModule } from './users/users.module';
import { CustomersModule } from './customers/customers.module';
import { ReportsModule } from './reports/reports.module';
import { TransactionsModule } from './transactions/transactions.module';
import { PublicModule } from './public/public.module';
import { MailModule } from './mail/mail.module';
import { CurrencyModule } from './currency/currency.module';

const isWs = process.env.INSTANCE_TYPE === 'ws';
@Module({
	imports: [
		PrismaModule,
		ConfigModule.forRoot(),
		AuthModule,
		ScheduleModule.forRoot(),
		UsersModule, CustomersModule, ReportsModule, TransactionsModule, PublicModule, MailModule, CurrencyModule
	],
	controllers: [AppController],
	providers: [AppService],
})
export class AppModule { }
