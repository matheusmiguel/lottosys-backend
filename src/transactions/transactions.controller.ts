import { Controller, Get, Param, ParseIntPipe, Patch, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from 'src/auth/guards/permissions.guard';
import { TransactionsService } from './transactions.service';
import { Permissions } from 'src/auth/decorators/permissions.decorator';

@Controller('transactions')
export class TransactionsController {

    constructor(private readonly transactionsService: TransactionsService) { }

    @Get('withdrawals')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Permissions('adm.mwithdraws')
    async list(
            @Query('date') date: string,
            @Query('enddate') enddate: string,
            @Query('sort') sort: string,
            @Query('limit') limit: number = 50,
            @Query('page') page: number = 1,
            @CurrentUser() user
    ) {
        return this.transactionsService.listWithdrawals(date, enddate, sort, limit, page, user);
    }
    
    // ALTERAR STATUS
    @Patch(':id/status/:status')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Permissions('adm.mwithdraws')
    async updateStatus(
        @Param('id', ParseIntPipe) id: number,
        @Param('status', ParseIntPipe) status: number,
        @CurrentUser() user
    ) {
        return this.transactionsService.updateTransactionStatus(id, status, user);
    }
}
