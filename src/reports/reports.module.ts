import { Module } from '@nestjs/common';
import { AffiliateReportsService } from './services/affiliate-reports.service';
import { AffiliateReportsController } from './controllers/affiliate-reports.controller';
import { BrandReportsController } from './controllers/brand-reports.controller';
import { BrandReportsService } from './services/brand-reports.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuthModule } from 'src/auth/auth.module';
import { CurrencyModule } from 'src/currency/currency.module';
import { ReportsService } from './services/reports.service';
import { ReportsController } from './controllers/reports.controller';
import { AffiliatesModule } from 'src/affiliates/affiliates.module';

@Module({
	imports: [PrismaModule, AuthModule, CurrencyModule, AffiliatesModule],
	providers: [ReportsService, AffiliateReportsService, BrandReportsService],
	controllers: [ReportsController, AffiliateReportsController, BrandReportsController]
})
export class ReportsModule { }
