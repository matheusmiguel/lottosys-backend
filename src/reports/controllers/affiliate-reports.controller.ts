import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from 'src/auth/guards/permissions.guard';
import { AffiliateReportsService } from '../services/affiliate-reports.service';

@Controller('reports/affiliates')
export class AffiliateReportsController {

    constructor(
        private readonly service: AffiliateReportsService
    ) { }

    @Get(':affiliate_id')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    // @Permissions('users.create')
    async getAffiliateReport(
        @Param('affiliate_id') affiliate_id: number,
        @Query('date') date: string,
        @Query('enddate') enddate: string,
        @Query('currency') currency: string,
        @CurrentUser() user
    ) {
        return this.service.getAffiliateReport(
            affiliate_id,
            date,
            enddate,
            currency ?? 'usd',
            user
        );
    }
}
