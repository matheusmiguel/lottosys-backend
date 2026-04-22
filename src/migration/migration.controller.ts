import {
    Controller,
    Post,
    Get,
    Param,
    ParseIntPipe,
    Query,
    Res,
    HttpCode,
    Delete,
    UseGuards,
    Body,
} from '@nestjs/common';
import type { Response } from 'express';
import { MigrationService } from './migration.service';
import { MigrationProgressService } from './migration-progress.service';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from 'src/auth/guards/permissions.guard';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { AuthService } from 'src/auth/auth.service';
import { MigrationUrlSyncService } from './migration-url-sync.service';

@Controller('migration')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MigrationController {
    constructor(
        private readonly migration: MigrationService,
        private readonly progress: MigrationProgressService,
        private readonly authService: AuthService,
        private readonly urlSyncService: MigrationUrlSyncService,
    ) { }

    @Post('change-provider')
    @Permissions('master.migration')
    async changeProvider(@Body('url') url: string, @Res() res: Response) {
        const result = await this.urlSyncService.changeProvider(url);
        return res.status(result.status_code).json(result);
    }

    @Post('sync-urls')
    @Permissions('master.migration')
    async syncUrls(@Body('url') url: string) {
        return this.urlSyncService.syncLinkUrls(url);
    }

    /**
     * POST /migration/:brandId/start
     * Inicia a migração. ?force=true reinicia do zero.
     */
    @Post(':brandId/start')
    @Permissions('master.migration')
    @HttpCode(202)
    async start(
        @CurrentUser() currentUser: any,
        @Body() body: { token: string },
        @Param('brandId', ParseIntPipe) brandId: number,
        @Query('force') force?: string,
    ) {
        force = 'true';
        await this.authService.validate2FA(currentUser.id, body.token);
        await this.migration.startMigration(brandId, force === 'true');
        return { status: 'success', message: 'Migração enfileirada.', brandId };
    }

    /**
     * GET /migration/:brandId/status
     * Snapshot atual do progresso (polling).
     */
    @Get(':brandId/status')
    @Permissions('master.migration')
    async status(@Param('brandId', ParseIntPipe) brandId: number) {
        return this.migration.getStatus(brandId);
    }

    /**
     * GET /migration/:brandId/stream
     * SSE: stream em tempo real do progresso (atualiza a cada 2s).
     * O cliente abre um EventSource para esse endpoint.
     */
    @Get(':brandId/stream')
    @Permissions('master.migration')
    stream(
        @Param('brandId', ParseIntPipe) brandId: number,
        @Res() res: Response,
    ) {
        return this.migration.streamStatus(brandId, res);
    }

    @Delete(':brandId/checkpoint/:entity')
    @Permissions('master.migration')
    async resetCheckpoint(
        @Param('brandId', ParseIntPipe) brandId: number,
        @Param('entity') entity: string,
    ) {
        await this.progress.saveCheckpoint(brandId, entity as any, {
            last_id: 0,
            done: 0,
            total: 0,
            status: 'pending',
        });
        return { ok: true };
    }
}