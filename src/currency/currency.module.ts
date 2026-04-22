import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { CacheModule } from '@nestjs/cache-manager';
import { CurrencyService } from './currency.service';

@Module({
	imports: [
		HttpModule,
		CacheModule.register({
			ttl: 60 * 60 * 2 * 1000, // 2h (segundos)
			max: 1000,
		}),
	],
	providers: [CurrencyService],
	exports: [CurrencyService],
})
export class CurrencyModule { }
