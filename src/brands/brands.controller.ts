import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from 'src/auth/guards/permissions.guard';
import { BrandsService } from './brands.service';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { CurrentUserService } from 'src/auth/current-user.service';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { CreateBrandDto } from './dtos/create-brand.dto';

@Controller('brands')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BrandsController {
    constructor(
        private readonly brandsService: BrandsService,
        private readonly currentUser: CurrentUserService
    ) { }

    @Get()
	@Permissions('master.mbrands')
    async listBrands(@Query('currency') currency: string) {
        return this.brandsService.listBrands(currency);
    }

    @Post()
	@Permissions('master.mbrands')
    async createBrand(@Body() dto: CreateBrandDto) {
        return this.brandsService.createBrand(dto);
    }

    @Post(':id/credentials')
	@Permissions('master.mbrands')
    async getBrandCredentials(@Param('id') id: string, @Body('token') token: string, @CurrentUser() user) {
        return this.brandsService.getBrandCredentials(id, token, user);
    }

    @Get('resume')
	// @Permissions('brands.reports')
    async getBrandResume(@Query('date') date: string, @Query('enddate') enddate: string, @Query('currency') currency: string) {
        let currentUser = this.currentUser.getUser();
        return this.brandsService.getBrandResume(date, enddate, currency, currentUser);
    }

    @Get('configs')
	@Permissions('adm.brcfgs')
    async getConfigs(@CurrentUser() user) {
        return this.brandsService.getConfigs(user);
    }

    @Put('configs')
	@Permissions('adm.brcfgs')
    async setConfigs(@Body() body, @CurrentUser() user) {
        return this.brandsService.setConfigs(body, user);
    }
}
