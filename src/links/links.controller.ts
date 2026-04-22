import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { LinksService } from './links.service';
import { CurrentUserService } from 'src/auth/current-user.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from 'src/auth/guards/permissions.guard';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { CreateLinkDto } from './dtos/create-link.dto';
import { UpdateLinkDto } from './dtos/update-link.dto';

@Controller('links')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class LinksController {
    constructor(
        private readonly linksService: LinksService,
        private readonly currentUser: CurrentUserService
    ) { }
    
    @Get('configs')
    // @Permissions('brands.reports')
    async getLinkConfigs(
        @CurrentUser() currentUser
    ) {
        return this.linksService.getLinkConfigs(currentUser);
    }

    @Get()
    // @Permissions('brands.reports')
    async getLinks(
        @CurrentUser() currentUser
    ) {
        return this.linksService.getLinks(currentUser);
    }

    @Get(':id/report')
    // @Permissions('users.create')
    async getLinkReport(
        @Param('id') id: number,
        @Query('date') date: string,
        @Query('enddate') enddate: string,
        @Query('currency') currency: string,
        @CurrentUser() user
    ) {
        return this.linksService.getLinkReport(
            id,
            date,
            enddate,
            currency ?? 'usd',
            user
        );
    }

    @Get(':id/data')
    // @Permissions('brands.reports')
    async getLinkById(
        @Param('id') id: number,
        @CurrentUser() currentUser
    ) {
        return this.linksService.getLinkById(id, currentUser);
    }
    
    @Put(':id')
    async update(
        @Param('id') id: number,
        @Body() dto: UpdateLinkDto,
        @CurrentUser() user
    ) {
        return this.linksService.updateLink(id, dto, user);
    }
    
    @Post()
    async create(
        @Body() dto: CreateLinkDto,
        @CurrentUser() user
    ) {
        return this.linksService.createLink(dto, user);
    }

    @Get('my-link')
    @Permissions('subaf.register')
    async getReferralLink(
        @CurrentUser() currentUser
    ) {
        return this.linksService.getReferralLink(currentUser);
    }

    @Get('top-ranking')
    // @Permissions('brands.reports')
    async getLinksTopRanking(
        @Query('date') date: string,
        @Query('enddate') enddate: string,
        @Query('sort') sort: string,
        @Query('currency') currency: string,
        @Query('limit') limit: number = 5,
        @CurrentUser() currentUser
    ) {
        return this.linksService.getLinksTopRanking(date, enddate, sort, currency, limit, currentUser);
    }
}
