import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import Redis from 'ioredis';
import { CurrencyService } from 'src/currency/currency.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { realFormat } from 'src/utils/helpers.util';

@Injectable()
export class WalletsSettlementService implements OnModuleInit {
    private readonly QUEUE_KEY = 'wallets_settlement_queue';
    private readonly logger = new Logger(WalletsSettlementService.name);
    private running = true;
    constructor(
        @Inject('REDIS') private readonly redis: Redis,
        @Inject('REDIS_HANDLER') private readonly redisHandler: Redis,
        private readonly prisma: PrismaService,
        private readonly currencyService: CurrencyService,
    ) { }

    async onModuleInit() {
        this.startConsumerLoop();

        // this.logger.log('Debug - Enqueueing wallet closings on startup');
        // this.enqueueWalletClosings();
    }

    async startConsumerLoop(): Promise<void> {
        while (this.running) {
            try {
                // bloqueia até ter item
                const result = await this.redisHandler.brpop(this.QUEUE_KEY, 0);
                if (!result) continue;
                const [, raw] = result;
                let payload: any;

                try {
                    payload = JSON.parse(raw);
                } catch (e) {
                    this.logger.error(`Erro ao parsear payload: ${raw}`);
                    continue;
                }

                const { wallet_id, cutoff } = payload;
                this.logger.log(`⚪ Processando wallet: ${wallet_id}`);

                await this.processSingleWallet({
                    wallet_id,
                    cutoff: new Date(cutoff)
                });

            } catch (error) {
                console.error('Erro no consumer:', error);

                // evita loop agressivo em caso de erro
                await new Promise(res => setTimeout(res, 1000));
            }
        }
    }

    async processSingleWallet(params: {
        wallet_id: number;
        cutoff: Date;
        brand_id?: number;
        user_id?: number;
    }) {

        const { wallet_id, cutoff, brand_id, user_id } = params;
        let transactionsQty = 0;

        /*
        =====================================
        AGRUPAR TRANSACTIONS
        =====================================
        */
        const rows = await this.prisma.transaction.groupBy({
            by: ['currency', 'type'],
            where: {
                wallet_id,
                paid: false,
                created_at: { lte: cutoff },
                ...(brand_id && { brand_id }),
                ...(user_id && { user_id })
            },
            _sum: {
                amount: true
            },
            _count: {
                _all: true
            }
        });

        if (!rows.length){
            this.logger.log(`⛔ Wallet ${wallet_id} - Nenhuma transação encontrada para processar. Pulando settlement.`);
            return;
        }

        /*
        =====================================
        MAPEAR MOEDAS
        =====================================
        */
        const currencyMap: Record<string, number> = {};

        for (const row of rows) {

            const amount = row._sum.amount ?? 0;
            const signed = row.type === 1 ? amount : -amount;

            if (!currencyMap[row.currency]) {
                currencyMap[row.currency] = 0;
            }

            currencyMap[row.currency] += signed;
            transactionsQty += row._count._all;
        }

        /*
        =====================================
        PEGAR WALLET
        =====================================
        */
        const wallet = await this.prisma.wallet.findUnique({
            where: { id: wallet_id },
            select: { id: true, currency: true, user_id: true, brand_id: true }
        });

        if (!wallet){
            this.logger.error(`⛔ Wallet ${wallet_id} não encontrada. Pulando settlement. (${transactionsQty} transactions)`);
            return;
        }

        /*
        =====================================
        CONVERTER
        =====================================
        */
        let total = 0;

        for (const [cur, amount] of Object.entries(currencyMap)) {

            if (amount === 0) continue;

            const result = await this.currencyService.convertCents(
                amount,
                cur,
                wallet.currency
            );

            total += result.cents;
        }

        if (total <= 0){
            this.logger.log(`⛔ Wallet ${wallet_id} - Total a ser creditado é zero ou negativo (${realFormat(total)} ${wallet.currency.toUpperCase()}). Pulando settlement. (${transactionsQty} transactions)`);
            return;
        }

        this.logger.log(`💰 Wallet ${wallet_id} - Total a ser creditado: ${realFormat(total)} ${wallet.currency.toUpperCase()} (${transactionsQty} transactions)`);

        /*
        =====================================
        TRANSACTION (ATÔMICO)
        =====================================
        */
        const settlement = await this.prisma.$transaction(async (tx) => {

            const settlement = await tx.walletSettlement.create({
                data: {
                    wallet_id,
                    user_id: wallet.user_id,
                    brand_id: wallet.brand_id,
                    amount: total,
                    currency: wallet.currency,
                    transactions_qty: transactionsQty,
                }
            });

            await tx.wallet.update({
                where: { id: wallet_id },
                data: {
                    balance: {
                        increment: total
                    }
                }
            });

            return settlement;

        });

        // Fora da transaction para evitar estouro de tempo
        while (true) {
            const affected = await this.prisma.$executeRawUnsafe(`
                UPDATE transactions
                SET paid = 1, settlement_id = ?
                WHERE wallet_id = ?
                AND paid = 0
                AND created_at <= ?
                LIMIT 10000
            `, settlement.id, wallet_id, cutoff);
            if (affected === 0) break;
        }
        
        this.logger.log(`✅ Wallet ${wallet_id} - Processamento concluído. Settlement ID: ${settlement.id}`);
    }

    @Cron('0 4 * * *') // 01:00 BRT
    async enqueueWalletClosings() {

        /*
        =====================================
        CUTOFF (ontem 23:59)
        =====================================
        */
        const end = new Date();
        end.setHours(0, 0, 0, 0);
        const cutoff = new Date(end.getTime() - 1);

        /*
        =====================================
        PEGAR WALLETS COM PENDÊNCIA
        =====================================
        */
        const wallets: any[] = await this.prisma.$queryRawUnsafe(`
            SELECT DISTINCT wallet_id
            FROM transactions
            WHERE paid = 0
            AND created_at <= ?
        `, cutoff);

        /*
        =====================================
        ENQUEUE (Redis)
        =====================================
        */
        for (const w of wallets) {
            // Pula zerado
            if(w.wallet_id <= 0) continue;

            const payload = JSON.stringify({
                wallet_id: w.wallet_id,
                cutoff
            });

            await this.redis.lpush(this.QUEUE_KEY, payload);

        }

        console.log(`Enqueued ${wallets.length} wallets for settlement processing.`);

        return {
            status: 'success',
            queued: wallets.length
        };
    }
}
