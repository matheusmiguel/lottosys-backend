import { Controller, Get, Post, Body, Put, Param, Delete, Req, UseGuards, ParseIntPipe, Query } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from 'src/auth/guards/permissions.guard';
import { CreateWebhookDto } from './dtos/create-webhook.dto';
import { UpdateWebhookDto } from './dtos/update-webhook.dto';

@Controller('webhooks')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class WebhooksController {
    constructor(private readonly service: WebhooksService) { }

    @Get()
    // @Permissions('brands.reports')
    async listWebhooks(
        @CurrentUser() currentUser
    ) {
        return this.service.listWebhooks(currentUser);
    }

    @Post()
    // @Permissions('brands.reports')
    async addWebhook(
        @Body() dto: CreateWebhookDto,
        @CurrentUser() currentUser
    ) {
        return this.service.addWebhook(currentUser, dto);
    }

    // GET BY ID
    @Get(':id')
    async getWebhookById(
        @Param('id', ParseIntPipe) id: number,
        @CurrentUser() user
    ) {
        return this.service.getWebhookById(id, user);
    }

    // UPDATE
    @Put(':id')
    async updateWebhook(
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: UpdateWebhookDto,
        @CurrentUser() user
    ) {
        return this.service.updateWebhook(id, dto, user);
    }

    @Delete(':id')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    // @Permissions('adm.mdeals')
    async delete(
        @Param('id', ParseIntPipe) id: number,
        @CurrentUser() user
    ) {
        return this.service.deleteWebhook(id, user);
    }
    
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Get(':id/history')
    // @Permissions('registrations')
    async listWebhookLogs(
        @Param('id', ParseIntPipe) id: number,
        @Query('page') page: number = 1, 
        @Query('limit') limit: number = 50,
        @Query('date') date: string,
        @Query('enddate') enddate: string,
        @CurrentUser() currentUser,
    ) {
        return this.service.listWebhookLogs(id, page, limit, currentUser, date, enddate);
    }
    
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Post(':id/resend/:log_id')
    // @Permissions('registrations')
    async resendWebhook(
        @Param('id', ParseIntPipe) id: number,
        @Param('log_id', ParseIntPipe) log_id: number,
        @CurrentUser() currentUser,
    ) {
        return this.service.resendWebhook(id, log_id, currentUser);
    }
}