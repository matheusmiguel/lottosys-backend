import { Module } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { TransactionsController } from './transactions.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuthModule } from 'src/auth/auth.module';
import { CurrencyModule } from 'src/currency/currency.module';
import Redis from 'ioredis';
import { TransactionsConsumer } from './transactions.consumer';

@Module({
	imports: [PrismaModule, AuthModule, CurrencyModule],
	providers: [
		{
			provide: 'REDIS',
			useFactory: () => {
				return new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
			},
		},
		{
			provide: 'REDIS_EVENT_HANDLER',
			useFactory: () => {
				return new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
			},
		},
		TransactionsService,
		TransactionsConsumer
	],
	controllers: [TransactionsController],
	exports: [TransactionsConsumer],
})
export class TransactionsModule { }
