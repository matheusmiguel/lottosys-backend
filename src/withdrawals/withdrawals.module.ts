import { Module } from '@nestjs/common';
import { WithdrawalsService } from './withdrawals.service';
import { WithdrawalsController } from './withdrawals.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuthModule } from 'src/auth/auth.module';
import { CurrencyModule } from 'src/currency/currency.module';
import { AffiliatesModule } from 'src/affiliates/affiliates.module';

@Module({
	imports: [PrismaModule, AuthModule, CurrencyModule, AffiliatesModule],
	providers: [WithdrawalsService],
	controllers: [WithdrawalsController]
})
export class WithdrawalsModule { }
