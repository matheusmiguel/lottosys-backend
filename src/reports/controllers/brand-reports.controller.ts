import {
    Controller,
    Get,
    Query,
    Req,
    UseGuards
} from '@nestjs/common';

import { BrandReportsService } from '../services/brand-reports.service';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from 'src/auth/guards/permissions.guard';

@Controller('reports/brands')
export class BrandReportsController {

    constructor(
        private readonly service: BrandReportsService
    ) { }

    @Get('daily')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    // @Permissions('users.create')
    async getDailyReport(
        @Query('date') date: string,
        @Query('enddate') enddate: string,
        @Query('currency') currency: string,
        @CurrentUser() user

    ) {
        return this.service.getDailyReport(
            date,
            enddate,
            currency ?? 'usd',
            user
        );
    }

    @Get('links')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    // @Permissions('users.create')
    async getLinksReport(
        @Query('date') date: string,
        @Query('enddate') enddate: string,
        @Query('currency') currency: string,
        @CurrentUser() user

    ) {
        return this.service.getLinksReport(
            date,
            enddate,
            currency ?? 'usd',
            user
        );
    }

    @Get('affiliates')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    // @Permissions('users.create')
    async getAffiliatesReport(
        @Query('date') date: string,
        @Query('enddate') enddate: string,
        @Query('currency') currency: string,
        @CurrentUser() user

    ) {
        return this.service.getAffiliatesReport(
            date,
            enddate,
            currency ?? 'usd',
            user
        );
    }

}