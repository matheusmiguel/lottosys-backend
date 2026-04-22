import {
    Controller,
    Get,
    Query,
    Req,
    UseGuards
} from '@nestjs/common';

import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from 'src/auth/guards/permissions.guard';
import { ReportsService } from '../services/reports.service';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { CurrentUserService } from 'src/auth/current-user.service';

@Controller('reports')
export class ReportsController {

    constructor(
        private readonly service: ReportsService,
        private readonly currentUser: CurrentUserService
    ) { }


    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Get('date-resume')
    // @Permissions('brands.reports')
    async getDateResume(
        @Query('date') date: string,
        @Query('currency') currency: string,
        @CurrentUser() user
    ) {
        return this.service.getDateResume(date, currency, user);
    }
}