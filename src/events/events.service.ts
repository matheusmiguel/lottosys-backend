import { BadRequestException, Inject, Injectable, InternalServerErrorException, Logger, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { CurrencyService } from 'src/currency/currency.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { TransactionsConsumer } from 'src/transactions/transactions.consumer';
import { brandTransactionStatusName, realFormat } from 'src/utils/helpers.util';
import { WebhooksService } from 'src/webhooks/webhooks.service';
import { WebhookDeposit, WebhookRegistration, WebhookWithdrawal } from './events.types';

@Injectable()
export class EventsService implements OnModuleInit {
    private readonly QUEUE_KEY = 'events_queue';
    private readonly logger = new Logger(EventsService.name);
    private running = true;

    constructor(
        @Inject('REDIS_QUEUE') private readonly redisQueue: Redis,
        @Inject('REDIS_EVENT_HANDLER') private readonly redis: Redis,
        private readonly prisma: PrismaService,
        private readonly currencyService: CurrencyService,
        private readonly transactionsConsumer: TransactionsConsumer,
        private readonly webhooksService: WebhooksService,
    ) { }

    async onModuleInit() {
        // this.logger.warn('Notifications consumer BLOQUEADO.');
        // return;

        // Se estiver no modo WS, NÃO roda o consumer
        if (process.env.INSTANCE_TYPE && process.env.INSTANCE_TYPE !== 'worker') {
            this.logger.warn('Events consumer desabilitado (' + process.env.INSTANCE_TYPE + ' mode).');
            return;
        }

        // Se estiver em development → NÃO roda o consumer
        if (process.env.MODE && process.env.MODE === 'development') {
            // this.logger.warn('🚨🚨🚨 ATENÇÃO! EVENTS CONSUMER HABILITADO EM MODO DEVELOPMENT.');
            this.logger.warn('Events consumer desabilitado (development mode).');
            return;
        }

        this.logger.log('Iniciando consumer de eventos via Redis LIST...');
        this.startConsumerLoop();
    }

    async enqueueEvent(payload: any) {
        if (!payload) return;

        await this.redis.lpush(
            this.QUEUE_KEY,
            JSON.stringify({
                ...payload,
                created_at: new Date().toISOString(),
            }),
        );
    }

    private async startConsumerLoop(): Promise<void> {
        while (this.running) {
            let payload: any; // <-- declara aqui fora

            try {
                const result = await this.redisQueue.brpop(this.QUEUE_KEY, 0);
                if (!result) continue;

                const [, raw] = result;

                try {
                    payload = JSON.parse(raw);
                } catch (e) {
                    this.logger.error(`Erro ao parsear JSON da fila: ${raw}`, e as any);
                    continue;
                }

                let ret;
                switch (payload.event_type) {
                    case 'deposit':
                        ret = await this.handleDepositEvent(payload);
                        break;
                    case 'transaction':
                        ret = await this.handleTransactionEvent(payload);
                        break;
                    case 'update_profile':
                        ret = await this.handleUpdateProfileEvent(payload);
                        break;
                    case 'withdrawal_request':
                        ret = await this.handleWithdrawalRequestEvent(payload);
                        break;
                    case 'withdrawal_update':
                        ret = await this.handleWithdrawalUpdateEvent(payload);
                        break;
                }

                this.prisma.eventLog.create({
                    data: {
                        brand_id: payload.brand_id ?? 0,
                        status: ret?.status ?? 0,
                        payload,
                        response: ret,
                        created_at: new Date(),
                    },
                }).catch(err => this.logger.error('Erro ao salvar log de evento:', err));

            } catch (error) {
                this.logger.error('Erro no loop do consumer Redis:', error as any);
                await new Promise((resolve) => setTimeout(resolve, 1000));

                // payload pode ser undefined se o erro foi antes do JSON.parse
                if (payload) {
                    this.prisma.eventLog.create({
                        data: {
                            brand_id: payload.brand_id ?? 0,
                            status: 3,
                            payload,
                            response: { error: (error as Error).message },
                            created_at: new Date(),
                        },
                    }).catch(err => this.logger.error('Erro ao salvar log de evento:', err));
                }
            }
        }
    }

    private normalizePayload(payload: any): any[] {
        if (!payload) return [];
        return Array.isArray(payload) ? payload : [payload];
    }

    async handleUpdateProfileEvent(data: any) {
        const payload = this.normalizePayload(data.payload);
        let response = { status: 1, brand_id: data.brand_id, total: payload.length, processed: 0, errors: 0, error_description: [] as string[] };

        let created = 0;
        let updated = 0;

        for (const r of payload) {
            if (!r.user_id) continue;

            let user = await this.prisma.registration.findFirst({
                where: {
                    brand_id: data.brand_id,
                    external_id: String(r.user_id),
                },
            });

            if (!user) {
                // Obtém dados do click
                let click = { id: 0, deal_id: 0, affiliate_id: 0, link_id: 0 };
                if (r.aff_token) {
                    click = await this.handleUserClick(r.aff_token, data.brand_id);
                }

                user = await this.prisma.registration.create({
                    data: {
                        brand_id: data.brand_id,
                        external_id: String(r.user_id),
                        click_id: click?.id ?? 0,
                        deal_id: click?.deal_id ?? 0,
                        // affiliate via relação
                        ...(click?.affiliate_id ? {
                            affiliate: { connect: { id: click.affiliate_id } }
                        } : {}),
                        // link via relação
                        ...(click?.link_id ? {
                            link: { connect: { id: click.link_id } }
                        } : {}),
                        click_token: r.aff_token ?? null,
                        name: r.name ?? null,
                        login: r.login ?? null,
                        email: r.email ?? null,
                        phone: r.phone ?? '',
                        document: r.document ?? '',
                        address: r.address ?? '',
                        birth_date: (() => {
                            if (!r.birth_date) return null;
                            const d = new Date(r.birth_date);
                            return isNaN(d.getTime()) ? null : d;
                        })(),
                        signup_date: r.signup_date ? new Date(r.signup_date) : new Date(),
                        bonus_balance: r.bonus_balance ?? 0,
                        real_balance: r.real_balance ?? 0,
                        is_ftd: Boolean(r.is_ftd ?? 0),
                        is_qftd: Boolean(r.is_qftd ?? 0),
                        validated: true,
                    },
                });

                // Webhook
                await this.prepareAndSendWebhook('signup', data.brand_id, user.affiliate_id ?? 0, undefined, undefined, user);

                created++;
            } else {
                await this.prisma.registration.update({
                    where: { id: user.id },
                    data: {
                        ...(r.name !== undefined && { name: r.name }),
                        ...(r.login !== undefined && { login: r.login }),
                        ...(r.email !== undefined && { email: r.email }),
                        ...(r.phone !== undefined && { phone: r.phone }),
                        ...(r.document !== undefined && { document: r.document }),
                        ...(r.address !== undefined && { address: r.address }),
                        ...(r.birth_date && {
                            birth_date: (() => {
                                const d = new Date(r.birth_date);
                                return isNaN(d.getTime()) ? null : d;
                            })(),
                        }),
                        ...(r.signup_date && { signup_date: new Date(r.signup_date) }),
                        ...(r.bonus_balance !== undefined && { bonus_balance: r.bonus_balance }),
                        ...(r.real_balance !== undefined && { real_balance: r.real_balance }),
                        ...(r.currency !== undefined && { currency: r.currency }),
                        ...(r.is_ftd !== undefined && { is_ftd: Boolean(r.is_ftd) }),
                        ...(r.is_qftd !== undefined && { is_qftd: Boolean(r.is_qftd) }),
                    },
                });

                // Webhook
                await this.prepareAndSendWebhook('account_modified', data.brand_id, user.affiliate_id ?? 0, undefined, undefined, user);

                updated++;
            }
        }

        response.processed++;

        return response;
    }

    async handleWithdrawalRequestEvent(data: any) {
        const payload = this.normalizePayload(data.payload);
        let response = { status: 1, brand_id: data.brand_id, total: payload.length, processed: 0, errors: 0, error_description: [] as string[] };

        for (const r of payload) {
            try {
                if (!r.user_id) continue;

                let user = await this.prisma.registration.findFirst({
                    where: {
                        brand_id: data.brand_id,
                        external_id: String(r.user_id),
                    },
                });

                if (!user) {
                    user = await this.addEmptyRegistration(data.brand_id, r.user_id);
                }

                const count = await this.prisma.withdrawal.count({
                    where: { user_id: user.id },
                });
                const isFirst = count === 0;

                const withdrawal = await this.prisma.withdrawal.upsert({
                    where: {
                        external_id_brand_id: {
                            external_id: String(r.withdrawal_id),
                            brand_id: data.brand_id,
                        },
                    },
                    create: {
                        external_id: String(r.withdrawal_id),
                        brand_id: data.brand_id,
                        user_id: user.id,
                        affiliate_id: user.affiliate_id ?? 0,
                        deal_id: user.deal_id ?? 0,
                        link_id: user.link_id ?? 0,
                        date: new Date(r.withdrawal_date || Date.now()),
                        status: 1,
                        amount: r.amount,
                        commission: 0,
                        is_first: isFirst,
                    },
                    update: {},
                });

                // Webhook
                await this.prepareAndSendWebhook('withdrawal_request', data.brand_id, user.affiliate_id ?? 0, undefined, withdrawal, user);
                response.processed++;
            } catch (err) {
                this.logger.error('Event processing error. Type: withdrawal_request', {
                    payload: r,
                    error: err,
                });

                response.errors++;
                response.error_description.push(`Error processing withdrawal request with external_id ${r.withdrawal_id}: ${(err as Error).message}`);

                continue;
            }
        }

        // Define status geral
        if (response.errors > 0 && response.errors < response.total) {
            response.status = 2; // parcial
        } else if (response.errors === 0) {
            response.status = 1; // sucesso
        } else {
            response.status = 3; // falha
        }

        return response;
    }

    async handleDepositEvent(data: any) {
        const payload = this.normalizePayload(data.payload);
        let response = { status: 1, brand_id: data.brand_id, total: payload.length, processed: 0, errors: 0, error_description: [] as string[] };

        for (const r of payload) {

            try {
                if (!r.user_id) continue;

                let user = await this.prisma.registration.findFirst({
                    where: {
                        brand_id: data.brand_id,
                        external_id: String(r.user_id),
                    },
                });

                if (!user) {
                    user = await this.addEmptyRegistration(data.brand_id, r.user_id);
                }

                const count = await this.prisma.deposit.count({
                    where: { user_id: user.id },
                });
                const isFirst = count === 0;
                const deal_id = user.deal_id ?? 0;

                // Obtém dados da deal
                let isQualified = false;
                if (deal_id && deal_id > 0) {
                    const deal = await this.prisma.deal.findUnique({
                        where: { id: deal_id },
                    });

                    // Calcula valor mínimo
                    if (deal) {
                        let min_amount = deal.min_transaction_amount ?? 0;
                        const converted = await this.currencyService.convertCents(
                            min_amount,
                            deal.currency,
                            r.currency
                        );

                        // Define qualificação
                        isQualified = (r.amount ?? 0) >= converted.cents;
                    }
                }

                const deposit = await this.prisma.deposit.upsert({
                    where: {
                        external_id_brand_id: {
                            external_id: String(r.deposit_id),
                            brand_id: data.brand_id,
                        },
                    },
                    create: {
                        external_id: String(r.deposit_id),
                        brand_id: data.brand_id,
                        user_id: user.id,
                        affiliate_id: user.affiliate_id ?? 0,
                        deal_id,
                        link_id: user.link_id ?? 0,
                        date: new Date(r.deposit_date || Date.now()),
                        payment_date: new Date(r.payment_date || Date.now()),
                        status: Number(r.status ?? 2),
                        amount: r.amount,
                        bonus_amount: r.bonus_amount || 0,
                        bonus_code: r.bonus_code || '',
                        commission: 0,
                        is_first: isFirst,
                        is_qualified: isQualified,
                        currency: r.currency ?? "brl",
                    },
                    update: {
                        amount: r.amount,
                        status: Number(r.status ?? 2),
                    },
                });

                // Adiciona na fila do Redis
                await this.transactionsConsumer.enqueueEvent('deposit', { id: deposit.id });

                user = await this.prisma.registration.update({
                    where: { id: user.id },
                    data: {
                        bonus_balance: r.bonus_balance ?? user.bonus_balance,
                        real_balance: r.real_balance ?? user.real_balance,
                        is_ftd: deposit.is_first && deposit.status === 2 ? true : user.is_ftd,
                    },
                });

                // Webhook
                if (deposit.status === 2 && isFirst) {
                    await this.prepareAndSendWebhook('first_paid_deposit', data.brand_id, user.affiliate_id ?? 0, deposit, undefined, user);
                } else if (deposit.status === 2 && !isFirst) {
                    await this.prepareAndSendWebhook('paid_deposit', data.brand_id, user.affiliate_id ?? 0, deposit, undefined, user);
                } else {
                    await this.prepareAndSendWebhook('deposit_request', data.brand_id, user.affiliate_id ?? 0, deposit, undefined, user);
                }

                response.processed++;
            } catch (err) {
                this.logger.error('Event processing error. Type: deposit', {
                    payload: r,
                    error: err,
                });
                response.errors++;
                response.error_description.push(`Error processing deposit with external_id ${r.deposit_id}: ${(err as Error).message}`);
                continue;
            }
        }

        // Define status geral
        if (response.errors > 0 && response.errors < response.total) {
            response.status = 2; // parcial
        } else if (response.errors === 0) {
            response.status = 1; // sucesso
        } else {
            response.status = 3; // falha
        }

        return response;
    }

    async handleWithdrawalUpdateEvent(data: any) {
        const payload = this.normalizePayload(data.payload);
        let response = { status: 1, brand_id: data.brand_id, total: payload.length, processed: 0, errors: 0, error_description: [] as string[] };

        for (const r of payload) {
            try {
                if (!r.user_id) continue;

                let user = await this.prisma.registration.findFirst({
                    where: {
                        brand_id: data.brand_id,
                        external_id: String(r.user_id),
                    },
                });

                if (!user) {
                    user = await this.addEmptyRegistration(data.brand_id, r.user_id);
                }

                const count = await this.prisma.withdrawal.count({
                    where: { user_id: user.id },
                });
                const isFirst = count === 0;

                const withdrawal = await this.prisma.withdrawal.upsert({
                    where: {
                        external_id_brand_id: {
                            external_id: String(r.withdrawal_id),
                            brand_id: data.brand_id,
                        },
                    },
                    create: {
                        external_id: String(r.withdrawal_id),
                        brand_id: data.brand_id,
                        user_id: user.id,
                        affiliate_id: user.affiliate_id ?? 0,
                        deal_id: user.deal_id ?? 0,
                        link_id: user.link_id ?? 0,
                        date: new Date(r.withdrawal_date || Date.now()),
                        status: Number(r.status ?? 1),
                        amount: r.amount,
                        commission: r.commission ?? 0,
                        is_first: isFirst,
                        currency: r.currency ?? 'brl',
                    },
                    update: {
                        date: r.withdrawal_date ? new Date(r.withdrawal_date) : undefined,
                        amount: r.amount
                            ? r.amount
                            : undefined,
                        status: r.status !== undefined ? Number(r.status) : undefined,
                        payment_date: r.payment_date
                            ? new Date(r.payment_date)
                            : undefined,
                    },
                });

                // Atualiza saldo
                if (r.bonus_balance !== undefined || r.real_balance !== undefined) {
                    user = await this.prisma.registration.update({
                        where: { id: user.id },
                        data: {
                            bonus_balance: r.bonus_balance ?? user.bonus_balance,
                            real_balance: r.real_balance ?? user.real_balance,
                        },
                    });
                }

                // Webhook
                if (withdrawal.status === 2 && isFirst) {
                    await this.prepareAndSendWebhook('first_paid_withdrawal', data.brand_id, user.affiliate_id ?? 0, undefined, withdrawal, user);
                } else if (withdrawal.status === 2 && !isFirst) {
                    await this.prepareAndSendWebhook('paid_withdrawal', data.brand_id, user.affiliate_id ?? 0, undefined, withdrawal, user);
                } else if (withdrawal.status === 4) {
                    await this.prepareAndSendWebhook('canceled_withdrawal', data.brand_id, user.affiliate_id ?? 0, undefined, withdrawal, user);
                } else {
                    await this.prepareAndSendWebhook('withdrawal_request', data.brand_id, user.affiliate_id ?? 0, undefined, withdrawal, user);
                }

                response.processed++;
            } catch (err) {
                this.logger.error('Event processing error. Type: withdrawal_update', {
                    payload: r,
                    error: err,
                });

                response.errors++;
                response.error_description.push(`Error processing withdrawal update with external_id ${r.withdrawal_id}: ${(err as Error).message}`);

                continue;
            }
        }

        // Define status geral
        if (response.errors > 0 && response.errors < response.total) {
            response.status = 2; // parcial
        } else if (response.errors === 0) {
            response.status = 1; // sucesso
        } else {
            response.status = 3; // falha
        }

        return response;
    }

    async handleTransactionEvent(data: any) {
        const payload = this.normalizePayload(data.payload);
        let response = { status: 1, brand_id: data.brand_id, total: payload.length, processed: 0, errors: 0, error_description: [] as string[] };

        for (const r of payload) {
            try {
                if (!r.user_id) continue;

                let user = await this.prisma.registration.findFirst({
                    where: {
                        brand_id: data.brand_id,
                        external_id: String(r.user_id),
                    },
                });

                if (!user) {
                    user = await this.addEmptyRegistration(data.brand_id, r.user_id);
                }

                const amount = r.amount || 0;
                const returns = r.returns || 0;
                const transaction = await this.prisma.siteTransaction.upsert({
                    where: {
                        external_id_brand_id: {
                            external_id: String(r.transaction_id),
                            brand_id: data.brand_id,
                        },
                    },
                    create: {
                        external_id: String(r.transaction_id),
                        brand_id: data.brand_id,
                        user_id: user.id,
                        affiliate_id: user.affiliate_id ?? 0,
                        deal_id: user.deal_id ?? 0,
                        link_id: user.link_id ?? 0,
                        amount,
                        returns,
                        is_bonus: Boolean(r.is_bonus ?? 0),
                        resolved: Boolean(r.resolved ?? 0),
                        currency: r.currency ?? 'brl',
                    },
                    update: {
                        ...(r.resolved !== undefined && {
                            resolved: Boolean(r.resolved),
                        }),
                        ...(r.amount !== undefined && { amount }),
                        ...(r.returns !== undefined && { returns }),
                    },
                });

                // Adiciona na fila do Redis
                await this.transactionsConsumer.enqueueEvent('revshare', { id: transaction.id });

                // Atualiza saldo
                if (r.bonus_balance !== undefined || r.real_balance !== undefined) {
                    await this.prisma.registration.update({
                        where: { id: user.id },
                        data: {
                            bonus_balance: r.bonus_balance ?? user.bonus_balance,
                            real_balance: r.real_balance ?? user.real_balance,
                        },
                    });
                }

                response.processed++;
            } catch (err) {
                this.logger.error('Event processing error. Type: transaction', {
                    payload: r,
                    error: err,
                });

                response.errors++;
                response.error_description.push(`Error processing transaction with external_id ${r.transaction_id}: ${(err as Error).message}`);

                continue;
            }
        }

        // Define status geral
        if (response.errors > 0 && response.errors < response.total) {
            response.status = 2; // parcial
        } else if (response.errors === 0) {
            response.status = 1; // sucesso
        } else {
            response.status = 3; // falha
        }

        return response;
    }

    async addEmptyRegistration(brand_id: number, external_id: number | string) {
        if (!brand_id || Number(brand_id) <= 0 || !external_id) {
            throw new BadRequestException('Invalid brand_id or external_id');
        }

        try {
            return await this.prisma.registration.upsert({
                where: {
                    external_id_brand_id: {
                        external_id: String(external_id),
                        brand_id: Number(brand_id),
                    },
                },
                create: {
                    brand_id: Number(brand_id),
                    deal_id: 0,
                    link_id: 0,
                    affiliate_id: 0,
                    external_id: String(external_id),

                    name: '',
                    login: '',
                    email: '',
                    phone: '',
                    document: '',
                    address: '',

                    birth_date: null,
                    signup_date: new Date(),

                    bonus_balance: 0,
                    real_balance: 0,

                    is_ftd: false,
                    is_qftd: false,

                    validated: false,
                },
                update: {},
            });
        } catch (e) {
            console.log('Error creating empty registration:', e);
            throw new InternalServerErrorException('Error creating empty registration');
        }
    }

    async handleUserClick(aff_token: string, brand_id: number) {
        if (!aff_token) return { id: 0, deal_id: 0, affiliate_id: 0, link_id: 0 };

        // Pesquisa clique
        const click = await this.prisma.linkClick.findFirst({
            where: {
                token: aff_token,
                brand_id,
            },
        });

        return click ?? { id: 0, deal_id: 0, affiliate_id: 0, link_id: 0 };
    }

    async prepareAndSendWebhook(
        event: string,
        brand_id: number,
        affiliate_id: number,
        deposit?: WebhookDeposit,
        withdrawal?: WebhookWithdrawal,
        registration?: WebhookRegistration,
    ) {
        const DEPOSIT_EVENTS = ['first_paid_deposit', 'deposit_request', 'paid_deposit'];
        const WITHDRAWAL_EVENTS = ['paid_withdrawal', 'first_paid_withdrawal', 'canceled_withdrawal', 'withdrawal_request'];
        const REGISTRATION_EVENTS = ['account_modified', 'signup'];

        let data: Record<string, any>;

        if (DEPOSIT_EVENTS.includes(event)) {
            if (!deposit || !registration) {
                throw new BadRequestException(`Event "${event}" requires deposit and registration data`);
            }

            data = {
                deposit: {
                    id: deposit.id,
                    date: deposit.date.toISOString(),
                    payment_date: deposit.payment_date?.toISOString() ?? null,
                    due_date: deposit.due_date?.toISOString() ?? null,
                    status: deposit.status,
                    status_name: brandTransactionStatusName(deposit.status),
                    amount: realFormat(deposit.amount),
                    is_first: deposit.is_first ?? false,
                    is_qualified: deposit.is_qualified ?? false,
                    payment_url: deposit.payment_url ?? null,
                },
                user: this.buildUserPayload(registration),
            };

        } else if (WITHDRAWAL_EVENTS.includes(event)) {
            if (!withdrawal || !registration) {
                throw new BadRequestException(`Event "${event}" requires withdrawal and registration data`);
            }

            data = {
                withdrawal: {
                    id: withdrawal.id,
                    date: withdrawal.date.toISOString(),
                    payment_date: withdrawal.payment_date?.toISOString() ?? null,
                    status: withdrawal.status,
                    status_name: brandTransactionStatusName(withdrawal.status),
                    amount: realFormat(withdrawal.amount),
                },
                user: this.buildUserPayload(registration),
            };

        } else if (REGISTRATION_EVENTS.includes(event)) {
            if (!registration) {
                throw new BadRequestException(`Event "${event}" requires registration data`);
            }

            data = {
                user: {
                    ...this.buildUserPayload(registration),
                    birthdate: registration.birth_date?.toISOString() ?? null,
                },
            };

        } else {
            throw new BadRequestException(`Unsupported event type: "${event}"`);
        }

        try {
            await this.webhooksService.dispatchWebhook({ user_id: affiliate_id, brand_id, event, payload: data });
        } catch (err) {
            this.logger.error('Error dispatching webhook:', err);
            throw new InternalServerErrorException('Error dispatching webhook');
        }
    }

    private buildUserPayload(registration: WebhookRegistration) {
        return {
            id: registration.id,
            external_id: registration.external_id,
            login: registration.login,
            signup_date: registration.signup_date.toISOString(),
            is_ftd: registration.is_ftd ?? false,
            is_qftd: registration.is_qftd ?? false,
        };
    }
}
