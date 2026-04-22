import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { Permissions, PermissionsAny } from 'src/auth/decorators/permissions.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from 'src/auth/guards/permissions.guard';
import { UsersService } from './users.service';
import { CurrentUserService } from 'src/auth/current-user.service';
import { CreateUserDto } from './dtos/create-user.dto';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { UpdateUserDto } from './dtos/update-user.dto';

@Controller('users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class UsersController {
    constructor(
        private readonly usersService: UsersService,
        private readonly currentUser: CurrentUserService
    ) { }

    @Get()
    // @Permissions('users.list')
    async listUsers(@Query('search_type') search_type: string, @Query('user_type') user_type: number, @Query('q') q: string, @Query('page') page: number, @Query('limit') limit: number) {
        let currentUser = this.currentUser.getUser();
        return this.usersService.listUsers(user_type, search_type, q, page, limit, currentUser);
    }

    @Get('search')
    async searchUsers(
        @Query('q') q: string,
        @CurrentUser() currentUser: any
    ) {
        return this.usersService.searchUsers(q, currentUser);
    }

    @Post()
    @PermissionsAny('adm.cusers', 'man.register')
    async create(
        @Body() dto: CreateUserDto,
        @CurrentUser() user
    ) {
        return this.usersService.createUser(dto, user);
    }

    // GET BY ID
    @Get(':id')
    @PermissionsAny('adm.eusers', 'man.edit')
    async getUser(
        @Param('id', ParseIntPipe) id: number,
        @CurrentUser() user
    ) {
        return this.usersService.getUser(id, user);
    }

    // UPDATE
    @Put(':id')
    @PermissionsAny('adm.eusers', 'man.edit')
    async updateUser(
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: UpdateUserDto,
        @CurrentUser() user
    ) {
        return this.usersService.updateUser(id, dto, user);
    }

    // UPDATE PERMISSIONS
    @Put(':id/permissions')
    @Permissions('adm.manperms')
    async updateUserPermissions(
        @Param('id', ParseIntPipe) id: number,
        @Body('permission') permission: string,
        @CurrentUser() user
    ) {
        return this.usersService.updateUserPermissions(id, permission, user);
    }

    // ALTERAR STATUS
    @Patch(':id/status')
    @Permissions('adm.eusers')
    async updateStatus(
        @Param('id', ParseIntPipe) id: number,
        @CurrentUser() user
    ) {
        return this.usersService.updateUserStatus(id, user);
    }

    // DELETE
    @Delete(':id')
    @Permissions('adm.dusers')
    async deleteUser(
        @Param('id', ParseIntPipe) id: number,
        @CurrentUser() user
    ) {
        return this.usersService.deleteUser(id, user);
    }
}
