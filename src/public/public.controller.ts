import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { CurrentUserService } from 'src/auth/current-user.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from 'src/auth/guards/permissions.guard';
import { PublicService } from './public.service';
import { CreateUserLinkDto } from './dtos/create-user-link.dto';

@Controller('public')
export class PublicController {
    constructor(
        private readonly service: PublicService,
    ) { }

    @Get('links/:token')
    // @Permissions('users.create')
    async getLinkData(
        @Param('token') token: string,
    ) {
        return this.service.getLinkData(token);
    }

    @Post('users/create')
    async createUserFromLink(
        @Body() dto: CreateUserLinkDto
    ) {
        return this.service.createUserFromLink(dto);
    }
}