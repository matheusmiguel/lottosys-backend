import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from 'src/auth/guards/permissions.guard';
import { RegistrationsService } from './registrations.service';
import { CurrentUserService } from 'src/auth/current-user.service';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { SetAffiliateDto } from './dtos/SetAffiliateDto';

@Controller('registrations')
export class RegistrationsController {
    constructor(
        private readonly registrationsService: RegistrationsService,
        private readonly currentUser: CurrentUserService
    ) { }

    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Post('set-affiliate')
    @Permissions('adm.claff')
    async setAffiliate(
        @Body() dto: SetAffiliateDto, 
        @CurrentUser() currentUser,
    ) {
        return this.registrationsService.setAffiliate(dto, currentUser);
    }

    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Get()
    // @Permissions('registrations')
    async listRegistrations(
        @Query('search_type') search_type: string, 
        @Query('user_type') user_type: number, 
        @Query('q') q: string, 
        @Query('page') page: number, 
        @Query('limit') limit: number,
        @Query('date') date: string,
        @Query('enddate') enddate: string
    ) {
        let currentUser = this.currentUser.getUser();
        return this.registrationsService.listRegistrations(search_type, q, page, limit, currentUser, date, enddate);
    }
}
