import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import Redis from 'ioredis';
import { realFormat } from 'src/utils/helpers.util';
import { CreateWebhookDto } from './dtos/create-webhook.dto';
import { UpdateWebhookDto } from './dtos/update-webhook.dto';
import { Webhook } from '@prisma/client';

@Injectable()
export class WebhooksService {
    private readonly eventMap: Record<string, keyof Webhook> = {
        paid_deposit: 'send_paid_deposit',
        first_paid_deposit: 'send_first_paid_deposit',
        deposit_request: 'send_deposit_request',

        paid_withdrawal: 'send_paid_withdrawal',
        first_paid_withdrawal: 'send_first_paid_withdrawal',
        canceled_withdrawal: 'send_canceled_withdrawal',
        withdrawal_request: 'send_withdrawal_request',

        signup: 'send_signup',
        account_modified: 'send_account_modified',
        effectived_user: 'send_effectived_user',
    };
    constructor(
        private prisma: PrismaService,
        @Inject('REDIS_EVENT_HANDLER') private redis: Redis
    ) { }

    async resendWebhook(id: number, log_id: number, currentUser: any) {
        const log = await this.prisma.webhookLog.findFirst({
            where: {
                id: log_id,
                webhook_id: id,
                brand_id: currentUser.brand_id,
            },
            include: {
                webhook: {
                    include: {
                        user: {
                            select: {
                                permissions: true
                            }
                        }
                    }
                }
            }
        });

        if (!log) {
            throw new NotFoundException('Webhook log not found');
        }

        if (!log.webhook) {
            throw new NotFoundException('Webhook not found');
        }

        if(log.webhook.user_id !== currentUser.id && currentUser.user_type > 2) {
            throw new BadRequestException('You don\'t have permission to resend this webhook!');
        }

        /*
        console.log('Resending webhook with log ID:', {
            user_id: log.webhook.user_id,
            brand_id: log.webhook.brand_id,
            event: log.category,
            payload: log.payload
        });
        */

        await this.dispatchWebhook({
            user_id: log.webhook.user_id,
            brand_id: log.webhook.brand_id,
            event: log.category,
            payload: JSON.parse(log.payload)
        });

        return {
            status: 'success',
            message: 'Webhook resend triggered successfully'
        };
    }

    async listWebhookLogs(
        id: number,
        page: number = 1,
        limit: number = 50,
        currentUser: any,
        date_start?: string,
        date_end?: string,
    ) {
        const skip = (page - 1) * limit;

        // Valida se o webhook existe e pertence à brand
        const webhook = await this.prisma.webhook.findFirst({
            where: {
                id,
                brand_id: currentUser.brand_id,
                deleted_at: null,
            }
        });

        if (!webhook) {
            throw new NotFoundException('Webhook not found');
        }

        // Se for afiliado, só pode ver logs do próprio webhook
        if (currentUser.user_type > 2 && webhook.user_id !== currentUser.id) {
            throw new BadRequestException('You don\'t have permission to view this webhook logs!');
        }

        const where: any = {
            webhook_id: id,
        };

        // Filtro por data
        if (date_start || date_end) {
            where.created_at = {};

            if (date_start) {
                where.created_at.gte = new Date(`${date_start} 00:00:00`);
            }

            if (date_end) {
                where.created_at.lte = new Date(`${date_end} 23:59:59`);
            }
        }

        const [logs, total] = await this.prisma.$transaction([
            this.prisma.webhookLog.findMany({
                where,
                select: {
                    id: true,
                    webhook_id: true,
                    user_id: true,
                    brand_id: true,
                    type: true,
                    url: true,
                    category: true,
                    attempt: true,
                    payload: true,
                    response: true,
                    http_status: true,
                    created_at: true,
                },
                orderBy: {
                    created_at: 'desc'
                },
                skip,
                take: Number(limit)
            }),
            this.prisma.webhookLog.count({ where })
        ]);

        return {
            status: 'success',
            pagination: {
                page: Number(page),
                limit: Number(limit),
                total,
                total_pages: Math.ceil(total / Number(limit))
            },
            data: logs
        };
    }

    async dispatchWebhook({
        user_id,
        brand_id,
        event,
        payload
    }: {
        user_id: number;
        brand_id: number;
        event: string;
        payload: any;
    }) {
        const webhooks = await this.prisma.webhook.findMany({
            where: {
                user_id,
                brand_id,
                [`send_${event}`]: true,
                deleted_at: null
            },
            include: {
                user: {
                    select: {
                        permissions: true
                    }
                }
            }
        });

        if (!webhooks.length) return;

        payload.event = event;

        for (const webhook of webhooks) {
            // Sanitiza o user do payload conforme permissões do afiliado dono do webhook
            const sanitizedPayload = this.sanitizePayload(payload, webhook.user?.permissions as string[]);

            const job = {
                id: `${webhook.id}_${Date.now()}_${Math.random()}`,
                webhook_id: webhook.id,
                user_id: webhook.user_id,
                brand_id: webhook.brand_id,
                event,
                url: webhook.url,
                method: webhook.method,
                headers: webhook.headers,
                payload: sanitizedPayload,
                attempt: 0,
                max_attempts: 5
            };

            await this.redis.lpush('webhooks:queue', JSON.stringify(job));
        }
    }

    private sanitizePayload(payload: any, permissions: string[]): any {
        if (!payload?.user) return payload;

        const fieldPermissionsMap: Record<string, string> = {
            email: 'ld.v_email',
            name: 'ld.v_name',
            login: 'ld.v_login',
            document: 'ld.v_doc',
            phone: 'ld.v_phone',
        };

        const sanitizedUser = { ...payload.user };

        for (const [field, permission] of Object.entries(fieldPermissionsMap)) {
            if (!permissions?.includes(permission)) {
                sanitizedUser[field] = null;
            }
        }

        return { ...payload, user: sanitizedUser };
    }

    async getWebhookById(id: number, currentUser: any) {

        const webhook = await this.prisma.webhook.findFirst({
            where: {
                id,
                brand_id: currentUser.brand_id,
                deleted_at: null
            }
        });

        if (!webhook) {
            throw new NotFoundException('Webhook not found');
        }

        // Evita listar usuários do mesmo tipo ou superior ao do usuário atual
        if (currentUser.user_type > 2 && webhook.user_id !== currentUser.id) {
            throw new BadRequestException('You don\'t have permission to view this webhook!');
        }

        const events = this.mapFlagsToArray(webhook);

        const cleaned = Object.fromEntries(
            Object.entries(webhook).filter(([key]) => !key.startsWith('send_'))
        );

        return {
            status: 'success',
            data: {
                ...cleaned,
                events
            }
        };
    }

    // UPDATE
    async updateWebhook(id: number, dto: UpdateWebhookDto, currentUser: any) {

        const webhook = await this.prisma.webhook.findFirst({
            where: {
                id,
                brand_id: currentUser.brand_id,
                deleted_at: null
            }
        });

        if (!webhook) {
            throw new NotFoundException('Webhook not found');
        }

        // Evita alterar usuários do mesmo tipo ou superior ao do usuário atual
        if (webhook.user_id !== currentUser.id && currentUser.user_type > 2) {
            throw new BadRequestException('You don\'t have permission to update this webhook!');
        }

        const flags = this.mapEventsToFlags(dto.events);
        const updated = await this.prisma.webhook.update({
            where: {
                id
            },
            data: {
                url: dto.url,
                method: dto.method,
                headers: dto.headers,
                ...flags,
            }
        });

        return {
            status: 'success',
            data: updated
        };
    }

    async addWebhook(currentUser: any, dto: CreateWebhookDto) {
        const flags = this.mapEventsToFlags(dto.events);
        const webhook = await this.prisma.webhook.create({
            data: {
                brand_id: currentUser.brand_id,
                user_id: currentUser.id,
                url: dto.url,
                method: dto.method,
                headers: dto.headers ?? null,
                ...flags,
                created_by: currentUser.id,
            }
        });

        return {
            status: 'success',
            data: webhook
        }
    }

    async listWebhooks(currentUser: any) {
        const webhooks = await this.prisma.webhook.findMany({
            where: {
                brand_id: currentUser.brand_id,
                user_id: currentUser.id,
                deleted_at: null
            },
            include: {
                user: {
                    select: {
                        id: true,
                        login: true,
                    }
                },
                creator: {
                    select: {
                        id: true,
                        login: true,
                    }
                }
            }
        });

        const formatted = webhooks.map((webhook) => {
            const events = this.mapFlagsToEvents(webhook);

            const cleaned = Object.fromEntries(
                Object.entries(webhook).filter(([key]) => !key.startsWith('send_'))
            );

            return {
                ...cleaned,
                events
            };
        });

        return {
            status: 'success',
            data: formatted
        };
    }

    async deleteWebhook(id: number, currentUser: any) {
        const webhook = await this.prisma.webhook.findFirst({
            where: {
                id,
                brand_id: currentUser.brand_id
            }
        });

        if (!webhook) {
            throw new NotFoundException('Webhook not found');
        }

        // Evita listar usuários do mesmo tipo ou superior ao do usuário atual
        if (currentUser.user_type > 2 && webhook.user_id !== currentUser.id) {
            throw new BadRequestException('You don\'t have permission to view this webhook!');
        }

        await this.prisma.webhook.update({
            where: { id },
            data: {
                deleted_at: new Date()
            }
        });

        return {
            status: 'success',
            message: 'Webhook deleted successfully!'
        };
    }

    private mapFlagsToEvents(webhook: any) {
        const events: Record<string, boolean> = {};

        for (const key in webhook) {
            if (key.startsWith('send_') && webhook[key]) {
                const eventName = key.replace('send_', '');
                events[eventName] = true;
            }
        }

        return events;
    }

    private mapEventsToFlags(events: string[]) {
        const flags: any = {};

        // começa tudo como false (opcional, mas recomendado)
        Object.values(this.eventMap).forEach((field) => {
            flags[field] = false;
        });

        // ativa os que vieram
        for (const event of events) {
            const field = this.eventMap[event];
            if (field) {
                flags[field] = true;
            }
        }

        return flags;
    }

    private mapFlagsToArray(webhook: any): string[] {
        const events: string[] = [];

        for (const key in webhook) {
            if (key.startsWith('send_') && webhook[key]) {
                const eventName = key.replace('send_', '');
                events.push(eventName);
            }
        }

        return events;
    }
}