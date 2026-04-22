import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { CurrentUserService } from 'src/auth/current-user.service';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from 'src/auth/guards/permissions.guard';
import { AffiliatesService } from './affiliates.service';

@Controller('affiliates')
export class AffiliatesController {
    constructor(
        private readonly affiliatesService: AffiliatesService,
        private readonly currentUser: CurrentUserService
    ) { }

    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Get('financial-statement')
    // @Permissions('brands.reports')
    async getFinancialStatement(
        @Query('date') date: string,
        @Query('enddate') enddate: string,
        @Query('currency') currency: string,
        @Query('limit') limit: number = 50,
        @Query('page') page: number = 1,
        @Query('affiliate_id') affiliate_id: number = 0,
        @CurrentUser() currentUser
    ) {
        return this.affiliatesService.getAffiliateStatement(date, enddate, currency, limit, page, affiliate_id, currentUser);
    }

    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Get('top-ranking')
    // @Permissions('brands.reports')
    async getAffiliatesTopRanking(
        @Query('date') date: string,
        @Query('enddate') enddate: string,
        @Query('sort') sort: string,
        @Query('currency') currency: string,
        @Query('limit') limit: number = 5,
        @CurrentUser() currentUser
    ) {
        return this.affiliatesService.getAffiliatesTopRanking(date, enddate, sort, currency, limit, currentUser);
    }

    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Get(':id/links')
    // @Permissions('brands.reports')
    async getAffiliateLinks(
        @Param('id') id: number,
        @CurrentUser() currentUser
    ) {
        return this.affiliatesService.getAffiliateLinks(id, currentUser);
    }
}
