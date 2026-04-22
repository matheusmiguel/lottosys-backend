import {
    Injectable,
    ConflictException,
    NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { MigrationProgressService } from './migration-progress.service';
import { Response } from 'express';

@Injectable()
export class MigrationService {
    constructor(
        @InjectQueue('migration') private readonly queue: Queue,
        private readonly progress: MigrationProgressService,
    ) { }

    /**
     * Inicia a migração de uma brand.
     * Se já estiver rodando, lança ConflictException.
     * Se quiser reiniciar do zero, passe force=true.
     */
    async startMigration(brandId: number, force = false): Promise<void> {
        const currentStatus = await this.progress
            .getFullStatus(brandId)
            .then(s => s.status);

        if (currentStatus === 'running' && !force) {
            throw new ConflictException(
                `Migração da brand ${brandId} já está em andamento.`,
            );
        }

        if (force) {
            await this.progress.resetCheckpoints(brandId);
            // Remove o job antigo da fila se ainda estiver lá
            const job = await this.queue.getJob(`migrate-brand-${brandId}`);
            if (job) await job.remove();
        }

        await this.progress.setStatus(brandId, 'running');

        // Enfileira o job principal. O worker vai orquestrar as etapas.
        await this.queue.add(
            'migrate-brand',
            { brandId },
            {
                jobId: `migrate-brand-${brandId}`, // idempotente: não duplica na fila
                attempts: 3,
                backoff: { type: 'exponential', delay: 5000 },
                removeOnComplete: false, // mantém histórico
                removeOnFail: false,
            },
        );
    }

    async getStatus(brandId: number) {
        return this.progress.getFullStatus(brandId);
    }

    /**
     * SSE: faz streaming do progresso para o cliente.
     * O frontend abre GET /migration/:brandId/stream e recebe eventos a cada 2s.
     */
    async streamStatus(brandId: number, res: Response): Promise<void> {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        const send = async () => {
            const status = await this.progress.getFullStatus(brandId);
            res.write(`data: ${JSON.stringify(status)}\n\n`);

            // Encerra o stream quando terminar ou der erro
            if (status.status === 'done' || status.status === 'error') {
                res.end();
                clearInterval(interval);
            }
        };

        await send();
        const interval = setInterval(send, 2000);

        res.on('close', () => clearInterval(interval));
    }
}