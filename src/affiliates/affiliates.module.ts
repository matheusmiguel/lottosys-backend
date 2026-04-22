import { Module } from '@nestjs/common';
import { AffiliatesService } from './affiliates.service';
import { AffiliatesController } from './affiliates.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuthModule } from 'src/auth/auth.module';
import { CurrencyModule } from 'src/currency/currency.module';

@Module({
	imports: [PrismaModule, AuthModule, CurrencyModule],
	providers: [AffiliatesService],
	controllers: [AffiliatesController],
	exports: [AffiliatesService],
})
export class AffiliatesModule { }
