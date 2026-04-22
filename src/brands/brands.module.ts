import { Module } from '@nestjs/common';
import { BrandsService } from './brands.service';
import { BrandsController } from './brands.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuthModule } from 'src/auth/auth.module';
import { CurrencyModule } from 'src/currency/currency.module';
import { AffiliatesModule } from 'src/affiliates/affiliates.module';

@Module({
	imports: [PrismaModule, AuthModule, CurrencyModule, AffiliatesModule],
	providers: [BrandsService],
	controllers: [BrandsController]
})
export class BrandsModule { }
