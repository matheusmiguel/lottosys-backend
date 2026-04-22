import { Module } from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { WalletsController } from './wallets.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuthModule } from 'src/auth/auth.module';
import { CurrencyModule } from 'src/currency/currency.module';
import Redis from 'ioredis';
import { WalletsSettlementService } from './wallets-settlement.service';

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
			provide: 'REDIS_HANDLER',
			useFactory: () => {
				return new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
			},
		},
		WalletsService,
		WalletsSettlementService
	],
	controllers: [WalletsController]
})
export class WalletsModule { }
