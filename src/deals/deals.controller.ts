import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { DealsService } from './deals.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from 'src/auth/guards/permissions.guard';
import { Permissions } from 'src/auth/decorators/permissions.decorator';

@Controller('deals')
export class DealsController {

    constructor(private readonly dealsService: DealsService) { }

    @Get()
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    // @Permissions('users.create')
    async list(@CurrentUser() user) {
        return this.dealsService.listDeals(user);
    }

    @Get(':id')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Permissions('adm.mdeals')
    async get(
        @Param('id', ParseIntPipe) id: number,
        @CurrentUser() user
    ) {
        return this.dealsService.getDeal(id, user);
    }

    @Post()
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Permissions('adm.mdeals')
    async create(
        @Body() dto,
        @CurrentUser() user
    ) {
        return this.dealsService.createDeal(dto, user);
    }

    @Put(':id')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Permissions('adm.mdeals')
    async update(
        @Param('id', ParseIntPipe) id: number,
        @Body() dto,
        @CurrentUser() user
    ) {
        return this.dealsService.updateDeal(id, dto, user);
    }

    @Delete(':id')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Permissions('adm.mdeals')
    async delete(
        @Param('id', ParseIntPipe) id: number,
        @CurrentUser() user
    ) {
        return this.dealsService.deleteDeal(id, user);
    }
}
