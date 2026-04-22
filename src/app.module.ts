import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { ScheduleModule } from '@nestjs/schedule';
import { CurrencyModule } from './currency/currency.module';
import { BrandsModule } from './brands/brands.module';
import { UsersModule } from './users/users.module';
import { RegistrationsModule } from './registrations/registrations.module';
import { DealsModule } from './deals/deals.module';
import { ReportsModule } from './reports/reports.module';
import { LinksModule } from './links/links.module';
import { AffiliatesModule } from './affiliates/affiliates.module';
import { TransactionsModule } from './transactions/transactions.module';
import { EventsModule } from './events/events.module';
import { WalletsModule } from './wallets/wallets.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { PublicModule } from './public/public.module';
import { MigrationModule } from './migration/migration.module';
import { BullModule } from '@nestjs/bullmq';
import { MailModule } from './mail/mail.module';
import { DepositsModule } from './deposits/deposits.module';
import { WithdrawalsModule } from './withdrawals/withdrawals.module';

const isWs = process.env.INSTANCE_TYPE === 'ws';
@Module({
	imports: [
		BullModule.forRoot({
			connection: (() => {
				const url = new URL(process.env.REDIS_URL!);
				return {
					host: url.hostname,
					port: parseInt(url.port),
					password: url.password || undefined,
					maxRetriesPerRequest: null,
				};
			})(),
		}),
		PrismaModule,
		ConfigModule.forRoot(),
		AuthModule,
		ScheduleModule.forRoot(),
		CurrencyModule, BrandsModule, UsersModule, RegistrationsModule, DealsModule, ReportsModule, LinksModule, AffiliatesModule, TransactionsModule, EventsModule, WalletsModule, WebhooksModule, PublicModule, MigrationModule, MailModule, DepositsModule, WithdrawalsModule,
	],
	controllers: [AppController],
	providers: [AppService],
})
export class AppModule { }
