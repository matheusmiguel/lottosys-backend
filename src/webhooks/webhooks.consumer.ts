import { Injectable, OnModuleInit, Logger, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import axios from 'axios';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class WebhooksConsumer implements OnModuleInit {
    private readonly logger = new Logger(WebhooksConsumer.name);

    constructor(
        private prisma: PrismaService,
        @Inject('REDIS') private redis: Redis
    ) { }

    onModuleInit() {
        this.startConsumers(3);
        this.startDelayedWorker();
    }

    startConsumers(count: number) {
        for (let i = 0; i < count; i++) {
            this.startConsumer();
        }
    }

    private async startConsumer() {
        while (true) {
            try {
                const result = await this.redis.brpop('webhooks:queue', 0);
                if (!result) continue;

                const [, raw] = result;

                let job: any;
                try {
                    job = JSON.parse(raw);
                } catch (e) {
                    this.logger.error('Erro ao parsear job', raw);
                    continue;
                }

                await this.processJob(job);
            } catch (err) {
                this.logger.error('Erro no consumer', err);
            }
        }
    }

    private async processJob(job: any) {
        const start = Date.now();

        let headers: Record<string, string> = {};
        try {
            const raw = job.headers;

            if (typeof raw === 'string') {
                // veio como string JSON
                const parsed = JSON.parse(raw);
                // suporta tanto objeto { key: value } quanto array [{ key, value }]
                headers = Array.isArray(parsed)
                    ? Object.fromEntries(parsed.map((h: any) => [h.key, h.value]))
                    : parsed;
            } else if (Array.isArray(raw)) {
                // veio como array [{ key, value }]
                headers = Object.fromEntries(raw.map((h: any) => [h.key, h.value]));
            } else if (raw && typeof raw === 'object') {
                // veio como objeto direto
                headers = raw as Record<string, string>;
            }
        } catch {
            headers = {};
        }

        try {
            const res = await axios({
                url: job.url,
                method: job.method,
                data: job.payload,
                headers,
                timeout: 5000
            });

            await this.prisma.webhookLog.create({
                data: {
                    webhook_id: job.webhook_id,
                    user_id: job.user_id,
                    brand_id: job.brand_id,
                    type: 1,
                    url: job.url,
                    category: job.event,
                    payload: JSON.stringify(job.payload),
                    response: JSON.stringify(res.data),
                    http_status: res.status,
                    data: {},
                    webhook_client: 'server',
                    attempt: job.attempt + 1
                }
            });

        } catch (error: any) {
            job.attempt++;

            await this.prisma.webhookLog.create({
                data: {
                    webhook_id: job.webhook_id,
                    user_id: job.user_id,
                    brand_id: job.brand_id,
                    type: 1,
                    url: job.url,
                    category: job.event,
                    payload: JSON.stringify(job.payload),
                    response: error?.message || 'unknown error',
                    http_status: error?.response?.status || 500,
                    data: {},
                    webhook_client: 'server',
                    attempt: job.attempt
                }
            });

            if (job.attempt < job.max_attempts) {
                const delay = this.getBackoffDelay(job.attempt);
                const runAt = Date.now() + delay;

                await this.redis.zadd(
                    'webhooks:delayed',
                    runAt,
                    JSON.stringify(job)
                );
            } else {
                this.logger.warn(`Webhook ${job.webhook_id} falhou definitivamente`);
            }
        }
    }

    private getBackoffDelay(attempt: number): number {
        const delays = [
            0,
            2 * 60 * 1000,
            5 * 60 * 1000,
            10 * 60 * 1000,
            30 * 60 * 1000
        ];

        return delays[attempt] || 30 * 60 * 1000;
    }

    private async startDelayedWorker() {
        while (true) {
            try {
                const now = Date.now();

                const jobs = await this.redis.zrangebyscore(
                    'webhooks:delayed',
                    0,
                    now,
                    'LIMIT',
                    0,
                    50
                );

                for (const jobRaw of jobs) {
                    await this.redis.lpush('webhooks:queue', jobRaw);
                    await this.redis.zrem('webhooks:delayed', jobRaw);
                }

                await this.sleep(1000);
            } catch (err) {
                this.logger.error('Erro no delayed worker', err);
            }
        }
    }

    private sleep(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}