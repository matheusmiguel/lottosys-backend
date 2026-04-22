import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from 'src/auth/guards/permissions.guard';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { WithdrawalsService } from './withdrawals.service';

@Controller('withdrawals')
export class WithdrawalsController {

    constructor(
        private readonly service: WithdrawalsService
    ) { }

    @Get()
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Permissions('adm.vfinance')
    async listWithdrawals(
        @Query('user_id') user_id: number,
        @Query('date') date: string,
        @Query('enddate') enddate: string,
        @Query('currency') currency: string,
        @Query('context') context: string,
        @Query('page') page: number,
        @CurrentUser() user
    ) {
        return this.service.listWithdrawals(
            user_id,
            date,
            enddate,
            currency ?? 'usd',
            context,
            page,
            user
        );
    }
}
