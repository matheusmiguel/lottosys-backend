import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from 'src/auth/guards/permissions.guard';
import { CustomersService } from './customers.service';
import { CurrentUserService } from 'src/auth/current-user.service';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { SetManagerDto } from './dtos/SetManagerDto';

@Controller('customers')
export class CustomersController {
    constructor(
        private readonly customersService: CustomersService,
        private readonly currentUser: CurrentUserService
    ) { }

    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Post('set-manager')
    @Permissions('adm.claff')
    async setManager(
        @Body() dto: SetManagerDto, 
        @CurrentUser() currentUser,
    ) {
        return this.customersService.setManager(dto, currentUser);
    }

    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Get()
    // @Permissions('customers')
    async listCustomers(
        @Query('search_type') search_type: string, 
        @Query('user_type') user_type: number, 
        @Query('q') q: string, 
        @Query('page') page: number, 
        @Query('limit') limit: number,
        @Query('date') date: string,
        @Query('enddate') enddate: string
    ) {
        let currentUser = this.currentUser.getUser();
        return this.customersService.listCustomers(search_type, q, page, limit, currentUser, date, enddate);
    }
}
