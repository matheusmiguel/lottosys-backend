import { Module } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { WebhooksController } from './webhooks.controller';
import { WebhooksConsumer } from './webhooks.consumer';
import { PrismaService } from 'src/prisma/prisma.service';
import Redis from 'ioredis';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuthModule } from 'src/auth/auth.module';
import { CurrencyModule } from 'src/currency/currency.module';

@Module({
	imports: [PrismaModule, AuthModule, CurrencyModule],
	controllers: [WebhooksController],
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
		WebhooksService, WebhooksConsumer, PrismaService
	],
	exports: [WebhooksService]
})
export class WebhooksModule { }