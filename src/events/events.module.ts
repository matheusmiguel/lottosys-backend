import { Module } from '@nestjs/common';
import { EventsService } from './events.service';
import Redis from 'ioredis';
import { AuthModule } from 'src/auth/auth.module';
import { CurrencyModule } from 'src/currency/currency.module';
import { PrismaModule } from 'src/prisma/prisma.module';
import { TransactionsModule } from 'src/transactions/transactions.module';
import { WebhooksModule } from 'src/webhooks/webhooks.module';

@Module({
	imports: [AuthModule, CurrencyModule, PrismaModule, TransactionsModule, WebhooksModule],
	providers: [
		{
			provide: 'REDIS_QUEUE',
			useFactory: () => {
				return new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
			},
		},
		{
			provide: 'REDIS_EVENT_HANDLER',
			useFactory: () => {
				return new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
					enableReadyCheck: true,
				});
			},
		},
		EventsService
	],
	exports: [EventsService],
})
export class EventsModule { }
