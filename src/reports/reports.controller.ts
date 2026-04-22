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
import { ReportsService } from './reports.service';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { CurrentUserService } from 'src/auth/current-user.service';

@Controller('reports')
export class ReportsController {

    constructor(
        private readonly service: ReportsService,
    ) { }

    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Get('resume')
    // @Permissions('brands.reports')
    async getResume(
        @Query('date') date: string,
        @Query('enddate') enddate: string,
        @Query('currency') currency: string,
        @CurrentUser() user
    ) {
        return this.service.getResume(date, enddate, currency, user);
    }
}