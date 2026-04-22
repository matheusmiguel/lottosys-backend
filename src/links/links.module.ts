import { Module } from '@nestjs/common';
import { LinksService } from './links.service';
import { LinksController } from './links.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuthModule } from 'src/auth/auth.module';
import { CurrencyModule } from 'src/currency/currency.module';
import { AffiliatesModule } from 'src/affiliates/affiliates.module';

@Module({
	imports: [PrismaModule, AuthModule, CurrencyModule, AffiliatesModule],
	providers: [LinksService],
	exports: [LinksService],
	controllers: [LinksController]
})
export class LinksModule { }
