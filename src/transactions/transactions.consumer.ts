import { BadRequestException, Inject, Injectable, InternalServerErrorException, Logger, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { CurrencyService } from 'src/currency/currency.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { applyNGRCents, realToCents } from 'src/utils/helpers.util';

@Injectable()
export class TransactionsConsumer implements OnModuleInit {
    private readonly QUEUE_KEY = 'commissions_queue';
    private readonly logger = new Logger(TransactionsConsumer.name);
    private running = true;

    constructor(
        @Inject('REDIS') private readonly redis: Redis,
        @Inject('REDIS_EVENT_HANDLER') private readonly redisHandler: Redis,
        private readonly prisma: PrismaService,
        private readonly currencyService: CurrencyService,
    ) { }

    async enqueueEvent(type: string, data: any): Promise<void> {
        if (!data) return;

        await this.redisHandler.lpush(
            this.QUEUE_KEY,
            JSON.stringify({
                type,
                data,
            }),
        );
    }

    async onModuleInit() {
        // this.logger.warn('Transactions consumer BLOQUEADO.');
        // return;

        // Se estiver no modo WS, NÃO roda o consumer
        if (process.env.INSTANCE_TYPE && process.env.INSTANCE_TYPE !== 'worker') {
            this.logger.warn('Transactions consumer desabilitado (' + process.env.INSTANCE_TYPE + ' mode).');
            return;
        }

        // Se estiver em development → NÃO roda o consumer
        if (process.env.MODE && process.env.MODE === 'development') {
            // this.logger.warn('🚨🚨🚨 ATENÇÃO! TRANSACTIONS CONSUMER HABILITADO EM MODO DEVELOPMENT.');
            this.logger.warn('Transactions consumer desabilitado (development mode).');
            return;
        }

        this.logger.log('Iniciando consumer de transações via Redis LIST...');
        this.startConsumerLoop();
    }

    private async startConsumerLoop(): Promise<void> {
        while (this.running) {
            try {
                // BRPOP bloqueia até ter item: [key, value]
                const result = await this.redis.brpop(this.QUEUE_KEY, 0);
                if (!result) {
                    continue;
                }

                const [, raw] = result;
                let payload: any;

                try {
                    payload = JSON.parse(raw);
                } catch (e) {
                    this.logger.error(`Erro ao parsear JSON da fila: ${raw}`, e as any);
                    continue;
                }

                // Define evento
                switch (payload.type) {
                    case 'deposit':
                        await this.handleDepositEvent(payload);
                        break;

                    case 'revshare':
                        await this.handleRevshareEvent(payload);
                        break;
                }
            } catch (error) {
                this.logger.error('Erro no loop do consumer Redis:', error as any);
                // Evita loop frenético se der erro
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
        }
    }

    async handleDepositEvent(payload: any) {
        const t = payload.data;

        try {
            // 🔎 busca depósito completo
            const transaction = await this.prisma.deposit.findUnique({
                where: { id: t.id },
                include: {
                    deal: true,
                    link: true,
                },
            });

            if (!transaction) return;

            // JÁ PAGO
            if (transaction.paid) return;

            // SEM AFILIADO
            if (!transaction?.affiliate_id || transaction.affiliate_id <= 0) {
                await this.markDepositAsPaid(transaction.id);
                return;
            }

            // SEM DEAL
            if (!transaction.deal) {
                await this.markDepositAsPaid(transaction.id);
                return;
            }

            // NÃO QUALIFICADO
            if (!transaction.is_qualified) {
                await this.markDepositAsPaid(transaction.id);
                return;
            }

            // DUPLICIDADE
            const alreadyPaid = await this.prisma.transaction.findFirst({
                where: {
                    action_id: transaction.id,
                    action_type: 2,
                    category: { in: ['deposit', 'cpa'] },
                },
            });

            if (alreadyPaid) {
                await this.markDepositAsPaid(transaction.id);
                return;
            }

            // ============================
            // 💰 CÁLCULO
            // ============================
            const amount = transaction.amount; // já em centavos
            let commission = 0;
            let fixedCommission = 0;
            let percentCommission = 0;

            if (transaction.is_first) {
                // CPA
                percentCommission = Math.floor(
                    (amount * Number(transaction.deal.cpa_percent || 0)) / 100,
                );
                fixedCommission = Number(transaction.deal.cpa_amount || 0);
                commission = percentCommission + fixedCommission;
            } else {
                // Deposit
                percentCommission = Math.floor(
                    (amount * Number(transaction.deal.deposit_percent || 0)) / 100,
                );
                fixedCommission = Number(transaction.deal.deposit_amount || 0);
                commission = percentCommission + fixedCommission;
            }

            // SEM COMISSÃO
            if (commission <= 0) {
                await this.markDepositAsPaid(transaction.id);
                return;
            }

            // SEM LINK (E WALLET)
            if (!transaction.link) {
                await this.markDepositAsPaid(transaction.id);
                return;
            }

            // ============================
            // 💸 SUB-AFFILIATE
            // ============================
            const sub = await this.defineSubaffiliateCommissions(
                transaction.brand_id,
                transaction.affiliate_id,
                transaction.id,
                transaction.is_first ? 'cpa' : 'deposit',
                false,
                commission,
                transaction.currency,
            );
            let parent_commission = commission - sub.net_commission;
            commission = sub.net_commission;

            // ============================
            // 💾 CRIA TRANSACTION
            // ============================

            await this.prisma.transaction.create({
                data: {
                    brand_id: transaction.brand_id,
                    user_id: transaction.affiliate_id,
                    link_id: transaction.link_id,
                    wallet_id: transaction.link.wallet_id,
                    status: 1,
                    category: transaction.is_first ? 'cpa' : 'deposit',
                    type: 1,
                    paid: false,
                    action_type: 2,
                    action_id: transaction.id,
                    title: transaction.is_first
                        ? `CPA - Transação #${transaction.id}`
                        : `Depósito - Transação #${transaction.id}`,
                    description: `Fixo: ${fixedCommission} | Pct.: ${percentCommission}`,
                    amount: commission,
                    currency: transaction.currency,
                    sub_id: 0,
                    parent_commission: parent_commission,
                    ngr: 0, // Depósitos não tem NGR
                },
            });

            // ============================
            // ✅ FINALIZA
            // ============================
            await this.prisma.deposit.update({
                where: { id: transaction.id },
                data: {
                    commission,
                    paid: true,
                },
            });

        } catch (e) {
            this.logger.error(`Erro no depósito ${t.id}`, e);

            await this.prisma.deposit.update({
                where: { id: t.id },
                data: { paid: true },
            });

        }
    }

    async handleRevshareEvent(payload: any) {
        const t = payload.data;

        try {
            // Busca transaction completa com relações
            const transaction = await this.prisma.siteTransaction.findUnique({
                where: { id: t.id },
                include: {
                    affiliate: {
                        select: {
                            id: true,
                            type: true,
                            ngr_percent: true,
                            parent_affiliate_id: true,
                            sub_commissions: true,
                        },
                    },
                    deal: {
                        select: {
                            revshare_percent: true,
                        },
                    },
                    link: {
                        select: {
                            wallet_id: true,
                        },
                    },
                },
            });

            if (!transaction) return;

            // SEM AFILIADO
            if (!transaction?.affiliate_id) return;

            // JÁ PAGO
            if (transaction.paid) return;

            // VALIDAÇÕES BÁSICAS
            if (!transaction.deal || !transaction.affiliate || !transaction.link) {
                await this.prisma.siteTransaction.update({
                    where: { id: transaction.id },
                    data: { paid: true },
                });
                return;
            }

            // DUPLICIDADE
            const alreadyPaid = await this.prisma.transaction.findFirst({
                where: {
                    user_id: transaction.affiliate_id,
                    action_id: transaction.id,
                    action_type: 4,
                    category: 'revshare',
                },
            });

            if (alreadyPaid) {
                await this.prisma.siteTransaction.update({
                    where: { id: transaction.id },
                    data: { paid: true },
                });
                return;
            }

            // ============================
            // CÁLCULO
            // ============================

            const returns = applyNGRCents(
                transaction.affiliate,
                Number(transaction.affiliate.ngr_percent),
                transaction.returns,
            );

            const amount = applyNGRCents(
                transaction.affiliate,
                Number(transaction.affiliate.ngr_percent),
                transaction.amount,
            );

            const percent = Number(transaction.deal?.revshare_percent || 0);
            const isNegative = returns > amount;
            let commission = 0;
            let ngrAmount = 0;

            if (isNegative) {
                commission = ((returns - amount) / 100) * percent;
                ngrAmount = (((transaction.returns - transaction.amount) / 100) * percent) - commission;
            } else {
                commission = ((amount - returns) / 100) * percent;
                ngrAmount = (((transaction.amount - transaction.returns) / 100) * percent) - commission;
            }

            // ============================
            // SUB-AFILIADOS
            // ============================
            let parent_commission = 0;
            if (transaction.affiliate.parent_affiliate_id && transaction.affiliate.sub_commissions) {
                const sub = await this.defineSubaffiliateCommissions(
                    transaction.brand_id,
                    transaction.affiliate_id,
                    transaction.id,
                    'revshare',
                    isNegative,
                    commission,
                    transaction.currency,
                );

                parent_commission = commission - sub.net_commission;
                commission = sub.net_commission;
            }

            // ============================
            // SALVA TRANSACTION
            // ============================
            await this.prisma.transaction.create({
                data: {
                    brand_id: transaction.brand_id,
                    user_id: transaction.affiliate_id,
                    link_id: transaction.link_id ?? 0,
                    wallet_id: transaction.link.wallet_id,
                    status: 1,
                    category: 'revshare',
                    type: isNegative ? 0 : 1,
                    paid: false,
                    action_type: 4,
                    action_id: transaction.id,
                    title: `RevShare - Transação #${transaction.id}`,
                    description: '',
                    amount: commission,
                    currency: transaction.currency,
                    sub_id: 0,
                    ngr: ngrAmount,
                    parent_commission: parent_commission,
                },
            });

            // MARCA COMO PAGO
            await this.prisma.siteTransaction.update({
                where: { id: transaction.id },
                data: { paid: true },
            });

        } catch (e) {
            this.logger.error(`Erro revshare ${t.id}`, e);

            await this.prisma.siteTransaction.update({
                where: { id: t.id },
                data: { paid: true },
            });
        }
    }

    /**
     * Retorna a comissão líquida do afiliado principal após descontos dos parents,
     * e persiste as sub-transações de cada parent na cadeia.
     *
     * @param affiliateId   - ID do afiliado dono da transação
     * @param actionId      - ID da siteTransaction de referência
     * @param category      - 'cpa' | 'revshare'
     * @param isNegative    - se a transação é negativa (charge-back / perda)
     * @param cpaAmount     - valor bruto CPA (use 0 quando category !== 'cpa')
     * @param revshareAmount - valor bruto revshare (use 0 quando category !== 'revshare')
     */
    async defineSubaffiliateCommissions(
        brand_id: number,
        affiliateId: number,
        actionId: number,
        category: 'cpa' | 'deposit' | 'revshare',
        isNegative: boolean,
        amount: number,
        currency: string,
    ): Promise<{ net_commission: number }> {
        let netCommission = amount;
        let currentLevelAmount = amount;
        let currentId = affiliateId;
        const MAX_DEPTH = 20;
        let depth = 0;

        // Cada entrada: { parentId, netAmount, depth }
        const levels: { parentId: number; grossAmount: number; netAmount: number; parentCommission: number; depth: number }[] = [];

        // ============================
        // 1. PERCORRE A CADEIA E CALCULA
        // ============================
        while (currentId && depth < MAX_DEPTH) {
            depth++;

            const affiliate = await this.prisma.user.findUnique({
                where: { id: currentId },
                select: { id: true, parent_affiliate_id: true, sub_commissions: true },
            });

            if (!affiliate || !affiliate.parent_affiliate_id) break;

            const parentId = affiliate.parent_affiliate_id;
            const subCommissions = affiliate.sub_commissions as {
                cpa_percent?: number;
                deposit_percent?: number;
                revshare_percent?: number;
            } | null;

            if (!subCommissions) break;

            const percentKey = `${category}_percent` as 'cpa_percent' | 'deposit_percent' | 'revshare_percent';
            const percent = Number(subCommissions[percentKey] ?? 0);

            if (percent <= 0) {
                currentId = parentId;
                continue;
            }

            const parentShare = (currentLevelAmount / 100) * percent;

            if (depth === 1) {
                netCommission = currentLevelAmount - parentShare;
            }

            levels.push({
                parentId,
                grossAmount: parentShare, // o que recebeu
                netAmount: 0, 
                parentCommission: 0,
                depth,
            });

            currentLevelAmount = parentShare;
            currentId = parentId;
        }

        // ============================
        // 2. CALCULA O LÍQUIDO DE CADA NÍVEL
        //    (bruto - o que vai pagar pro próximo)
        // ============================
        for (let i = 0; i < levels.length; i++) {
            const next = levels[i + 1]; // próximo nível acima
            levels[i].netAmount = next
                ? levels[i].grossAmount - next.grossAmount
                : levels[i].grossAmount; // último da cadeia fica com tudo
            levels[i].parentCommission = next ? next.grossAmount : 0;
        }

        // ============================
        // 3. PERSISTE AS TRANSAÇÕES COM O VALOR LÍQUIDO
        // ============================
        const categoryLabel =
            category === 'cpa' ? 'CPA' :
                category === 'deposit' ? 'Deposit' :
                    'RevShare';

        for (const level of levels) {
            const alreadyPaid = await this.prisma.transaction.findFirst({
                where: {
                    user_id: level.parentId,
                    action_id: actionId,
                    action_type: 4,
                    category,
                    sub_id: affiliateId,
                },
            });

            if (!alreadyPaid) {
                const parentLink = await this.prisma.link.findFirst({
                    where: { user_id: level.parentId },
                    select: { wallet_id: true, brand_id: true },
                });

                await this.prisma.transaction.create({
                    data: {
                        brand_id,
                        user_id: level.parentId,
                        link_id: 0,
                        wallet_id: parentLink?.wallet_id ?? 0,
                        status: 1,
                        category,
                        type: isNegative ? 0 : 1,
                        paid: false,
                        action_type: 4,
                        action_id: actionId,
                        title: `Sub-comissão ${categoryLabel} (level ${level.depth}) - Transação #${actionId}`,
                        description: '',
                        amount: level.netAmount, // ← líquido, já descontado o que vai pro próximo
                        currency,
                        sub_id: affiliateId,
                        parent_commission: level.parentCommission,
                        ngr: 0,
                    },
                });
            }
        }

        return { net_commission: netCommission };
    }

    private async markDepositAsPaid(id: number) {
        await this.prisma.deposit.update({
            where: { id },
            data: { paid: true },
        });
    }
}
