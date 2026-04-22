import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { MigrationLookupService } from './migration-lookup.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from 'src/auth/guards/permissions.guard';
import { Permissions } from 'src/auth/decorators/permissions.decorator';

@Controller('migration')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MigrationLookupController {
    constructor(private readonly lookup: MigrationLookupService) { }

    /**
     * GET /migration/lookup?url=meusite.com
     */
    @Get('lookup')
    @Permissions('master.migration')
    async lookupByUrl(@Query('url') url: string) {
        return this.lookup.lookupByUrl(url);
    }
}