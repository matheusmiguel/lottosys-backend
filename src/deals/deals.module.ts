import { Module } from '@nestjs/common';
import { DealsService } from './deals.service';
import { DealsController } from './deals.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuthModule } from 'src/auth/auth.module';
import { CurrencyModule } from 'src/currency/currency.module';

@Module({
	imports: [PrismaModule, AuthModule, CurrencyModule],
	providers: [DealsService],
	controllers: [DealsController]
})
export class DealsModule { }
