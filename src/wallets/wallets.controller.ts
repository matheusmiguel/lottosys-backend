import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from 'src/auth/guards/permissions.guard';
import { WalletsService } from './wallets.service';
import { CurrentUserService } from 'src/auth/current-user.service';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { CreateWalletDto } from './dtos/create-wallet.dto';
import { UpdateWalletDto } from './dtos/update-wallet.dto';
import { AddWalletTransactionDto } from './dtos/add-wallet-transaction.dto';
import { MakeWithdrawalDto } from './dtos/make-withdrawal.dto';

@Controller('wallets')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class WalletsController {
    constructor(
        private readonly service: WalletsService,
    ) { }

    @Get()
    // @Permissions('brands.reports')
    async listWallets(
        @CurrentUser() currentUser
    ) {
        return this.service.listWallets(currentUser);
    }

    @Post()
    // @Permissions('brands.reports')
    async addWallet(
        @Body() dto: CreateWalletDto,
        @CurrentUser() currentUser
    ) {
        return this.service.addWallet(currentUser, dto);
    }

    @Get('global-balance')
    // @Permissions('brands.reports')
    async getUserBalances(
        @Query('currency') currency: string,
        @CurrentUser() currentUser
    ) {
        return this.service.getUserBalances(currency, currentUser);
    }

    // GET BY ID
    @Get(':id')
    async getWalletById(
        @Param('id', ParseIntPipe) id: number,
        @CurrentUser() user
    ) {
        return this.service.getWalletById(id, user);
    }

    // UPDATE
    @Put(':id')
    async updateWallet(
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: UpdateWalletDto,
        @CurrentUser() user
    ) {
        return this.service.updateWallet(id, dto, user);
    }

    // WITHDRAWAL
    @Post(':id/withdrawal')
    async makeWithdrawal(
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: MakeWithdrawalDto,
        @CurrentUser() user
    ) {
        return this.service.makeWithdrawal(id, dto, user);
    }

    // ADD TRANSACTION
    @Put(':id/transaction')
    async addWalletTransaction(
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: AddWalletTransactionDto,
        @CurrentUser() user
    ) {
        return this.service.addWalletTransaction(id, dto, user);
    }

    @Get(':user_id/list')
    // @Permissions('brands.reports')
    async listWalletsByUser(
        @CurrentUser() currentUser,
        @Param('user_id', ParseIntPipe) user_id: number
    ) {
        return this.service.listWalletsByUser(currentUser, user_id);
    }

    @Get(':user_id/settlements')
    // @Permissions('brands.reports')
    async listWalletSettlementsByUser(
        @CurrentUser() currentUser,
        @Param('user_id', ParseIntPipe) user_id: number
    ) {
        return this.service.listWalletSettlementsByUser(currentUser, user_id);
    }

}
