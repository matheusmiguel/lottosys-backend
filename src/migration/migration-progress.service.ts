import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import {
    MIGRATION_KEY,
    MIGRATION_ENTITIES,
    MigrationEntity,
    LOCK_TTL_SECONDS,
} from './migration.keys';

export interface CheckpointState {
    last_id: number;
    done: number;
    total: number;
    status: 'pending' | 'running' | 'done' | 'error';
}

export interface MigrationStatus {
    status: string;
    error?: string;
    checkpoints: Record<MigrationEntity, CheckpointState>;
}

@Injectable()
export class MigrationProgressService {
    constructor(
        @Inject('REDIS') private readonly redis: Redis
    ) { }

    async resetAndFinish(brandId: number): Promise<void> {
        await this.resetCheckpoints(brandId);
        await this.redis.set(MIGRATION_KEY.status(brandId), 'done');
    }

    // -----------------------------------------------------------------------
    // LOCK
    // -----------------------------------------------------------------------

    /** Tenta adquirir o lock. Retorna true se conseguiu. */
    async acquireLock(brandId: number): Promise<boolean> {
        const result = await this.redis.set(
            MIGRATION_KEY.lock(brandId),
            '1',
            'EX',
            LOCK_TTL_SECONDS,
            'NX',
        );
        return result === 'OK';
    }

    /** Renova o TTL do lock para evitar expiração durante processamento longo. */
    async renewLock(brandId: number): Promise<void> {
        await this.redis.expire(MIGRATION_KEY.lock(brandId), LOCK_TTL_SECONDS);
    }

    async releaseLock(brandId: number): Promise<void> {
        await this.redis.del(MIGRATION_KEY.lock(brandId));
    }

    // -----------------------------------------------------------------------
    // STATUS GERAL
    // -----------------------------------------------------------------------

    async setStatus(brandId: number, status: string): Promise<void> {
        await this.redis.set(MIGRATION_KEY.status(brandId), status);
    }

    async setError(brandId: number, message: string): Promise<void> {
        await this.redis.set(MIGRATION_KEY.error(brandId), message);
    }

    // -----------------------------------------------------------------------
    // CHECKPOINTS
    // -----------------------------------------------------------------------

    async getCheckpoint(
        brandId: number,
        entity: MigrationEntity,
    ): Promise<CheckpointState> {
        const data = await this.redis.hgetall(
            MIGRATION_KEY.checkpoint(brandId, entity),
        );

        return {
            last_id: parseInt(data.last_id ?? '0', 10),
            done: parseInt(data.done ?? '0', 10),
            total: parseInt(data.total ?? '0', 10),
            status: (data.status as CheckpointState['status']) ?? 'pending',
        };
    }

    async saveCheckpoint(
        brandId: number,
        entity: MigrationEntity,
        state: Partial<CheckpointState>,
    ): Promise<void> {
        const key = MIGRATION_KEY.checkpoint(brandId, entity);
        const payload: Record<string, string> = {};

        if (state.last_id !== undefined) payload.last_id = String(state.last_id);
        if (state.done !== undefined) payload.done = String(state.done);
        if (state.total !== undefined) payload.total = String(state.total);
        if (state.status !== undefined) payload.status = state.status;

        await this.redis.hset(key, payload);
    }

    async resetCheckpoints(brandId: number): Promise<void> {
        const pipeline = this.redis.pipeline();
        pipeline.del(MIGRATION_KEY.status(brandId));
        pipeline.del(MIGRATION_KEY.error(brandId));
        for (const entity of MIGRATION_ENTITIES) {
            pipeline.del(MIGRATION_KEY.checkpoint(brandId, entity));
        }
        await pipeline.exec();
    }

    // -----------------------------------------------------------------------
    // LEITURA AGREGADA (para o endpoint de status)
    // -----------------------------------------------------------------------

    async getFullStatus(brandId: number): Promise<MigrationStatus> {
        const pipeline = this.redis.pipeline();

        pipeline.get(MIGRATION_KEY.status(brandId));
        pipeline.get(MIGRATION_KEY.error(brandId));

        for (const entity of MIGRATION_ENTITIES) {
            pipeline.hgetall(MIGRATION_KEY.checkpoint(brandId, entity));
        }

        const results = await pipeline.exec();
        if (!results) throw new Error('Redis pipeline retornou null');

        const status = (results[0][1] as string) ?? 'idle';
        const error = (results[1][1] as string) ?? undefined;

        const checkpoints = {} as Record<MigrationEntity, CheckpointState>;
        MIGRATION_ENTITIES.forEach((entity, i) => {
            const data = (results[2 + i][1] as Record<string, string>) ?? {};
            checkpoints[entity] = {
                last_id: parseInt(data.last_id ?? '0', 10),
                done: parseInt(data.done ?? '0', 10),
                total: parseInt(data.total ?? '0', 10),
                status: (data.status as CheckpointState['status']) ?? 'pending',
            };
        });

        return { status, error, checkpoints };
    }
}