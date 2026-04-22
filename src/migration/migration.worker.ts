import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from 'src/prisma/prisma.service';
import { OldPrismaService } from './old-prisma.service';
import { MigrationProgressService } from './migration-progress.service';
import { BATCH_SIZES, LOCK_TTL_SECONDS, MigrationEntity } from './migration.keys';
import { LinksService } from 'src/links/links.service';
import { default_withdrawal_configs } from 'src/brands/brands.config';

// -------------------------------------------------------------------------
// Helpers de permissão
// -------------------------------------------------------------------------
const PERMISSIONS_ADMIN = [
    'adm.vfinance',
    'adm.claff',
    'subaf.register',
    'subaf.commissions',
    'ld.v_email',
    'ld.v_name',
    'ld.v_doc',
    'ld.v_phone',
    'adm.manperms',
    'adm.cusers',
    'adm.eusers',
    'adm.dusers',
    'ld.v_login',
    'adm.mwithdraws',
    'adm.brcfgs',
    'adm.mdeals',
];

const PERMISSIONS_AFFILIATE = [
    'subaf.register',
    'subaf.commissions',
    'ld.v_login',
];

function resolvePermissions(type: number, canSubaffiliate?: boolean): string[] {
    if (type === 1 || type === 2) return PERMISSIONS_ADMIN;
    if (type === 3) return PERMISSIONS_AFFILIATE;
    if (type === 4) return canSubaffiliate ? PERMISSIONS_AFFILIATE : [];
    return [];
}

@Processor('migration')
export class MigrationWorker extends WorkerHost {
    private readonly logger = new Logger(MigrationWorker.name);

    constructor(
        private readonly newPrisma: PrismaService,
        private readonly oldPrisma: OldPrismaService,
        private readonly progress: MigrationProgressService,
        private readonly linksService: LinksService,
    ) {
        super();
    }

    async process(job: Job): Promise<void> {
        const { brandId } = job.data;

        if (process.env.MODE && process.env.MODE === 'development') {
            // this.logger.warn('🚨🚨🚨 ATENÇÃO! MIGRATION WORKER HABILITADO EM MODO DEVELOPMENT.');
            this.logger.warn('Migration worker desabilitado (development mode).');
            return;
        }

        const locked = await this.progress.acquireLock(brandId);
        if (!locked) {
            this.logger.warn(`Brand ${brandId}: lock não obtido, abortando.`);
            return;
        }

        const renewInterval = setInterval(
            () => this.progress.renewLock(brandId),
            (LOCK_TTL_SECONDS / 2) * 1000,
        );

        try {
            this.logger.log(`🚀 Iniciando migração da brand ${brandId}`);

            await this.migrateBrand(brandId);
            await this.migrateUsers(brandId);
            await this.migrateWallets(brandId);
            await this.migrateDeals(brandId);
            await this.migrateLinkTypes(brandId);
            await this.migrateLinks(brandId);
            await this.migrateRegistrations(brandId);
            await this.migrateDeposits(brandId);
            await this.migrateWithdrawals(brandId);
            await this.migrateWebhooks(brandId);

            await this.progress.resetAndFinish(brandId);
            this.logger.log(`✅ Brand ${brandId} migrada com sucesso.`);
        } catch (err) {
            await this.progress.setStatus(brandId, 'error');
            await this.progress.setError(brandId, err?.message ?? String(err));
            this.logger.error(`❌ Erro na migração da brand ${brandId}`, err);
            throw err;
        } finally {
            clearInterval(renewInterval);
            await this.progress.releaseLock(brandId);
        }
    }

    // -------------------------------------------------------------------------
    // Helper: batch loop com checkpoint automático
    // -------------------------------------------------------------------------
    private async batchLoop<T extends { id: number }>(
        brandId: number,
        entity: MigrationEntity,
        fetchBatch: (lastId: number, batchSize: number) => Promise<T[]>,
        processBatch: (batch: T[]) => Promise<number>,
        countTotal: () => Promise<number>,
    ): Promise<void> {
        const batchSize = BATCH_SIZES[entity];
        const checkpoint = await this.progress.getCheckpoint(brandId, entity);

        if (checkpoint.status === 'done') {
            this.logger.log(`⏭ ${entity}: já concluída, pulando.`);
            return;
        }

        let total = checkpoint.total;
        if (!total) {
            total = await countTotal();
            await this.progress.saveCheckpoint(brandId, entity, { total, status: 'running' });
        } else {
            await this.progress.saveCheckpoint(brandId, entity, { status: 'running' });
        }

        let lastId = checkpoint.last_id;
        let done = checkpoint.done;

        this.logger.log(`▶ ${entity}: retomando de id=${lastId} (${done}/${total})`);

        while (true) {
            const batch = await fetchBatch(lastId, batchSize);
            if (!batch.length) break;

            const inserted = await processBatch(batch);
            done += inserted;
            lastId = batch[batch.length - 1].id;

            await this.progress.saveCheckpoint(brandId, entity, { last_id: lastId, done });
            this.logger.debug(`  ${entity}: ${done}/${total}`);
        }

        await this.progress.saveCheckpoint(brandId, entity, { status: 'done', done });
        this.logger.log(`✔ ${entity}: concluída (${done} registros).`);
    }

    // -------------------------------------------------------------------------
    // BRAND
    // -------------------------------------------------------------------------
    private async migrateBrand(brandId: number): Promise<void> {
        const checkpoint = await this.progress.getCheckpoint(brandId, 'brand');
        if (checkpoint.status === 'done') return;

        await this.progress.saveCheckpoint(brandId, 'brand', { status: 'running', total: 1 });

        const old = await this.oldPrisma.brand.findUnique({ where: { id: brandId } });
        if (!old) throw new Error(`Brand ${brandId} não encontrada no sistema antigo.`);

        const exists = await this.newPrisma.brand.findFirst({
            where: { old_id: old.id },
            select: { id: true },
        });

        if (!exists) {
            await this.newPrisma.brand.create({
                data: {
                    name: old.name,
                    old_id: old.id,
                    user_id: 0,
                    token: old.token ?? '',
                    public_token: old.public_token ?? '',
                    url: old.url ?? '',
                    status: old.status ?? 1,
                    document: '',
                    currency: 'brl',
                    ngr_percent: old.ngr_percent ?? 0,
                    affiliate_auto_signup: old.affiliate_auto_signup ?? false,
                    affiliate_signup_auto_approve: old.affiliate_signup_auto_approve ?? false,
                    withdrawal_configs: default_withdrawal_configs
                },
            });
        }

        await this.progress.saveCheckpoint(brandId, 'brand', { status: 'done', done: 1 });
    }

    // -------------------------------------------------------------------------
    // USERS
    // -------------------------------------------------------------------------
    private async migrateUsers(brandId: number): Promise<void> {
        const newBrand = await this.newPrisma.brand.findFirst({
            where: { old_id: brandId },
            select: { id: true },
        });
        if (!newBrand) throw new Error(`Brand ${brandId} não encontrada no sistema novo.`);

        await this.batchLoop(
            brandId,
            'users',
            (lastId, take) =>
                this.oldPrisma.user.findMany({
                    where: { brand_id: brandId, id: { gt: lastId } },
                    orderBy: { id: 'asc' },
                    take,
                }),
            async (batch) => {
                const result = await this.newPrisma.user.createMany({
                    data: batch.map(u => ({
                        old_id: u.id,
                        brand_id: newBrand.id,
                        name: u.name,
                        email: u.email,
                        login: u.login ?? u.email,
                        password: u.password ?? '',
                        status: u.status ?? 1,
                        type: u.type ?? 1,
                        validated: Boolean(u.validated),
                        confirmed: Boolean(u.confirmed),
                        validation_2fa: u.validation_2fa ?? 0,
                        manager_id: u.manager_id ?? 0,
                        parent_affiliate_id: u.parent_affiliate_id ?? 0,
                        ngr_percent: u.ngr_percent ?? 0,
                        permissions: resolvePermissions(u.type ?? 4, u.can_subaffiliate ?? false),
                        currency: 'brl',
                        phone: u.phone ?? null,
                        document: u.document ?? null,
                    })),
                    skipDuplicates: true,
                });
                return result.count;
            },
            () => this.oldPrisma.user.count({ where: { brand_id: brandId } }),
        );

        // Segunda passagem: atualiza parent_affiliate_id com o novo ID
        this.logger.log(`🧑‍🧒‍🧒 users: atualizando parent_affiliate_id...`);

        const allNewUsers = await this.newPrisma.user.findMany({
            where: { brand_id: newBrand.id, old_id: { gt: 0 } },
            select: { id: true, old_id: true, parent_affiliate_id: true },
        });

        const oldToNewMap = new Map(allNewUsers.map(u => [u.old_id, u.id]));
        const toUpdate = allNewUsers.filter(u => u.parent_affiliate_id > 0);

        if (toUpdate.length > 0) {
            await Promise.all(
                toUpdate.map(u =>
                    this.newPrisma.user.update({
                        where: { id: u.id },
                        data: {
                            parent_affiliate_id: oldToNewMap.get(u.parent_affiliate_id) ?? 0,
                        },
                    }),
                ),
            );
            this.logger.log(`✅ users: ${toUpdate.length} parent_affiliate_id atualizados.`);
        } else {
            this.logger.log(`✅ users: nenhum parent_affiliate_id para atualizar.`);
        }
    }

    // -------------------------------------------------------------------------
    // WALLETS
    // -------------------------------------------------------------------------
    private async migrateWallets(brandId: number): Promise<void> {
        const newBrand = await this.newPrisma.brand.findFirst({
            where: { old_id: brandId },
            select: { id: true },
        });
        if (!newBrand) throw new Error(`Brand ${brandId} não encontrada no sistema novo.`);

        const allUsers = await this.newPrisma.user.findMany({
            where: { brand_id: newBrand.id },
            select: { id: true, old_id: true, brand_id: true },
        });
        const userMap = new Map(allUsers.map(u => [u.old_id, u]));

        await this.batchLoop(
            brandId,
            'wallets',
            (lastId, take) =>
                this.oldPrisma.wallet.findMany({
                    where: { brand_id: brandId, id: { gt: lastId } },
                    orderBy: { id: 'asc' },
                    take,
                }),
            async (batch) => {
                const toInsert = batch
                    .filter(w => userMap.has(w.user_id))
                    .map(w => ({
                        old_id: w.id,
                        user_id: userMap.get(w.user_id)!.id,
                        brand_id: newBrand.id,
                        name: w.name ?? 'Principal',
                        description: w.description ?? '',
                        status: w.status ?? 1,
                        balance: 0,
                        currency: 'brl',
                    }));

                if (!toInsert.length) return 0;
                const result = await this.newPrisma.wallet.createMany({
                    data: toInsert,
                    skipDuplicates: true,
                });
                return result.count;
            },
            () => this.oldPrisma.wallet.count({ where: { brand_id: brandId } }),
        );
    }

    // -------------------------------------------------------------------------
    // DEALS
    // -------------------------------------------------------------------------
    private async migrateDeals(brandId: number): Promise<void> {
        const newBrand = await this.newPrisma.brand.findFirst({
            where: { old_id: brandId },
            select: { id: true },
        });
        if (!newBrand) throw new Error(`Brand ${brandId} não encontrada no sistema novo.`);

        // Carrega mapa old_id → new_id de users para mapear user_id e admin_id
        const allUsers = await this.newPrisma.user.findMany({
            where: { brand_id: newBrand.id },
            select: { id: true, old_id: true },
        });
        const userMap = new Map(allUsers.map(u => [u.old_id, u.id]));

        // Fallback: primeiro user da brand, usado quando admin_id não tem mapeamento
        const firstUserId = allUsers[0]?.id ?? 0;

        await this.batchLoop(
            brandId,
            'deals',
            (lastId, take) =>
                this.oldPrisma.deal.findMany({
                    where: { brand_id: brandId, id: { gt: lastId } },
                    orderBy: { id: 'asc' },
                    take,
                }),
            async (batch) => {
                const result = await this.newPrisma.deal.createMany({
                    data: batch.map(d => ({
                        old_id: d.id,
                        brand_id: newBrand.id,
                        // user_id = afiliado dono do deal (pode ser 0 se for deal global da brand)
                        user_id: d.user_id ? (userMap.get(d.user_id) ?? 0) : 0,
                        // admin_id = quem criou — fallback para o primeiro user se não mapeado
                        admin_id: d.admin_id ? (userMap.get(d.admin_id) ?? firstUserId) : firstUserId,
                        name: d.name,
                        status: d.status ?? 1,
                        currency: 'brl',
                        click_amount: d.click_amount ?? 0,
                        click_percent: d.click_percent ?? 0,
                        lead_amount: d.lead_amount ?? 0,
                        lead_percent: d.lead_percent ?? 0,
                        deposit_amount: d.deposit_amount ?? 0,
                        deposit_percent: d.deposit_percent ?? 0,
                        cpa_amount: d.cpa_amount ?? 0,
                        cpa_percent: d.cpa_percent ?? 0,
                        revshare_percent: d.revshare_percent ?? 0,
                        min_transaction_amount: d.min_transaction_amount ?? 0,
                    })),
                    skipDuplicates: true,
                });
                return result.count;
            },
            () => this.oldPrisma.deal.count({ where: { brand_id: brandId } }),
        );
    }

    // -------------------------------------------------------------------------
    // LINK TYPES
    // -------------------------------------------------------------------------
    private async migrateLinkTypes(brandId: number): Promise<void> {
        const newBrand = await this.newPrisma.brand.findFirst({
            where: { old_id: brandId },
            select: { id: true },
        });
        if (!newBrand) throw new Error(`Brand ${brandId} não encontrada no sistema novo.`);

        await this.batchLoop(
            brandId,
            'link_types',
            (lastId, take) =>
                this.oldPrisma.linkType.findMany({
                    where: { brand_id: brandId, id: { gt: lastId } },
                    orderBy: { id: 'asc' },
                    take,
                }),
            async (batch) => {
                const result = await this.newPrisma.linkType.createMany({
                    data: batch.map(t => ({
                        old_id: t.id,
                        brand_id: newBrand.id,
                        name: t.name,
                        status: t.status ?? 1,
                        base_url: t.base_url ?? '',
                    })),
                    skipDuplicates: true,
                });
                return result.count;
            },
            () => this.oldPrisma.linkType.count({ where: { brand_id: brandId } }),
        );
    }

    // -------------------------------------------------------------------------
    // LINKS
    // -------------------------------------------------------------------------
    private async migrateLinks(brandId: number): Promise<void> {
        const newBrand = await this.newPrisma.brand.findFirst({
            where: { old_id: brandId },
            select: { id: true },
        });
        if (!newBrand) throw new Error(`Brand ${brandId} não encontrada no sistema novo.`);

        const [users, deals, wallets, linkTypes] = await Promise.all([
            this.newPrisma.user.findMany({
                where: { brand_id: newBrand.id },
                select: { id: true, old_id: true },
            }),
            this.newPrisma.deal.findMany({
                where: { brand_id: newBrand.id },
                select: { id: true, old_id: true },
            }),
            this.newPrisma.wallet.findMany({
                where: { brand_id: newBrand.id },
                select: { id: true, old_id: true },
            }),
            this.newPrisma.linkType.findMany({
                where: { brand_id: newBrand.id },
                select: { id: true, old_id: true },
            }),
        ]);

        const userMap = new Map(users.map(u => [u.old_id, u.id]));
        const dealMap = new Map(deals.map(d => [d.old_id, d.id]));
        const walletMap = new Map(wallets.map(w => [w.old_id, w.id]));
        const typeMap = new Map(linkTypes.map(t => [t.old_id, t.id]));
        const domainBase = await this.linksService.getDomain(newBrand.id);

        // Consulta já migrados
        const alreadyMigrated = await this.newPrisma.link.findMany({
            where: {
                brand_id: newBrand.id,
                old_id: { gt: 0 }
            },
            select: { old_id: true }
        });
        const migratedOldIds = new Set(alreadyMigrated.map(l => l.old_id));

        await this.batchLoop(
            brandId,
            'links',
            (lastId, take) =>
                this.oldPrisma.link.findMany({
                    where: { brand_id: brandId, id: { gt: lastId } },
                    orderBy: { id: 'asc' },
                    take,
                }),
            async (batch) => {
                const toInsert = batch
                    .filter(l => !migratedOldIds.has(l.id))
                    .filter(l => userMap.has(l.user_id))
                    .map(l => ({
                        old_id: l.id,
                        brand_id: newBrand.id,
                        user_id: userMap.get(l.user_id)!,
                        deal_id: dealMap.get(l.deal_id) ?? 0,
                        wallet_id: walletMap.get(l.wallet_id) ?? 0,
                        link_type: typeMap.get(l.link_type) ?? 0,
                        name: l.name,
                        description: l.description ?? null,
                        url: '',
                        destination_url: l.destination_url ?? '',
                        status: l.status ?? 1,
                        public: Boolean(l.public),
                    }));

                if (!toInsert.length) return 0;

                await this.newPrisma.link.createMany({
                    data: toInsert,
                    skipDuplicates: true,
                });

                // Busca os novos IDs dos links inseridos
                const inserted = await this.newPrisma.link.findMany({
                    where: {
                        old_id: { in: batch.map(l => l.id) },
                        brand_id: newBrand.id,
                    },
                    select: { id: true, user_id: true },
                });

                // Gera e seta a URL com os novos IDs
                await Promise.all(
                    inserted.map(l =>
                        this.newPrisma.link.update({
                            where: { id: l.id },
                            data: { url: `https://${domainBase}/l/${l.id}/${l.user_id}` },
                        }),
                    ),
                );

                return inserted.length;
            },
            () => this.oldPrisma.link.count({ where: { brand_id: brandId } }),
        );
    }

    // -------------------------------------------------------------------------
    // REGISTRATIONS
    // -------------------------------------------------------------------------
    private async migrateRegistrations(brandId: number): Promise<void> {
        const newBrand = await this.newPrisma.brand.findFirst({
            where: { old_id: brandId },
            select: { id: true },
        });
        if (!newBrand) throw new Error(`Brand ${brandId} não encontrada no sistema novo.`);

        const [users, links, deals] = await Promise.all([
            this.newPrisma.user.findMany({
                where: { brand_id: newBrand.id },
                select: { id: true, old_id: true },
            }),
            this.newPrisma.link.findMany({
                where: { brand_id: newBrand.id },
                select: { id: true, old_id: true },
            }),
            this.newPrisma.deal.findMany({
                where: { brand_id: newBrand.id },
                select: { id: true, old_id: true },
            }),
        ]);

        const userMap = new Map(users.map(u => [u.old_id, u.id]));
        const linkMap = new Map(links.map(l => [l.old_id, l.id]));
        const dealMap = new Map(deals.map(d => [d.old_id, d.id]));

        await this.batchLoop(
            brandId,
            'registrations',
            (lastId, take) =>
                this.oldPrisma.$transaction([
                    this.oldPrisma.$executeRaw`SET SESSION sql_mode = 'ALLOW_INVALID_DATES'`,
                    this.oldPrisma.$queryRaw<any[]>`
                        SELECT
                            id, brand_id, affiliate_id, link_id, deal_id,
                            external_id, name, login, email, phone, document,
                            address, is_ftd, is_qftd, validated,
                            DATE_FORMAT(IF(signup_date IS NULL OR signup_date = '0000-00-00 00:00:00', NOW(), signup_date), '%Y-%m-%d %H:%i:%s') as signup_date,
                            IF(birth_date IS NULL OR birth_date = '0000-00-00', NULL, DATE_FORMAT(birth_date, '%Y-%m-%d')) as birth_date
                        FROM registrations
                        WHERE brand_id = ${brandId} AND id > ${lastId}
                        ORDER BY id ASC
                        LIMIT ${take}
                    `,
                ]).then(results => results[1] as any[]),
            async (batch) => {
                const toInsert = batch.map(r => ({
                    old_id: r.id,
                    brand_id: newBrand.id,
                    // affiliate_id = 0 no antigo → 0 no novo (não tenta mapear)
                    affiliate_id: r.affiliate_id ? (userMap.get(r.affiliate_id) ?? 0) : 0,
                    link_id: r.link_id ? (linkMap.get(r.link_id) ?? 0) : 0,
                    deal_id: r.deal_id ? (dealMap.get(r.deal_id) ?? 0) : 0,
                    external_id: r.external_id || `migrated-${r.id}`,
                    name: r.name ?? '',
                    login: r.login ?? '',
                    email: r.email ?? '',
                    phone: r.phone ?? '',
                    document: r.document ?? '',
                    address: r.address ?? '',
                    signup_date: r.signup_date ? new Date(r.signup_date) : new Date(),
                    birth_date: r.birth_date ? new Date(r.birth_date) : null,
                    is_ftd: Boolean(r.is_ftd),
                    is_qftd: Boolean(r.is_qftd),
                    validated: Boolean(r.validated),
                    currency: 'brl',
                }));

                if (!toInsert.length) return 0;
                const result = await this.newPrisma.registration.createMany({
                    data: toInsert,
                    skipDuplicates: true,
                });
                return result.count;
            },
            () => this.oldPrisma.registration.count({ where: { brand_id: brandId } }),
        );
    }

    // -------------------------------------------------------------------------
    // DEPOSITS
    // -------------------------------------------------------------------------
    private async migrateDeposits(brandId: number): Promise<void> {
        const newBrand = await this.newPrisma.brand.findFirst({
            where: { old_id: brandId },
            select: { id: true },
        });
        if (!newBrand) throw new Error(`Brand ${brandId} não encontrada no sistema novo.`);

        const [users, links, deals, registrations] = await Promise.all([
            this.newPrisma.user.findMany({
                where: { brand_id: newBrand.id },
                select: { id: true, old_id: true },
            }),
            this.newPrisma.link.findMany({
                where: { brand_id: newBrand.id },
                select: { id: true, old_id: true },
            }),
            this.newPrisma.deal.findMany({
                where: { brand_id: newBrand.id },
                select: { id: true, old_id: true },
            }),
            this.newPrisma.registration.findMany({
                where: { brand_id: newBrand.id },
                select: { id: true, old_id: true },
            }),
        ]);

        const userMap = new Map(users.map(u => [u.old_id, u.id]));
        const linkMap = new Map(links.map(l => [l.old_id, l.id]));
        const dealMap = new Map(deals.map(d => [d.old_id, d.id]));
        const registrationMap = new Map(registrations.map(r => [r.old_id, r.id]));

        await this.batchLoop(
            brandId,
            'deposits',
            (lastId, take) =>
                this.oldPrisma.$queryRaw<any[]>`
                    SELECT
                        id, brand_id, user_id, affiliate_id, link_id, deal_id,
                        external_id, status, amount, commission, bonus_amount,
                        is_first, is_qualified, paid, bonus_code, payment_url,
                        DATE_FORMAT(IF(date IS NULL OR date = '0000-00-00 00:00:00', NOW(), date), '%Y-%m-%d %H:%i:%s') as date,
                        IF(payment_date IS NULL OR payment_date = '0000-00-00 00:00:00', NULL, DATE_FORMAT(payment_date, '%Y-%m-%d %H:%i:%s')) as payment_date,
                        IF(due_date IS NULL OR due_date = '0000-00-00', NULL, DATE_FORMAT(due_date, '%Y-%m-%d %H:%i:%s')) as due_date
                    FROM deposits
                    WHERE brand_id = ${brandId} AND id > ${lastId}
                    ORDER BY id ASC
                    LIMIT ${take}
                `,
            async (batch) => {
                const toInsert = batch.map(d => ({
                    brand_id: newBrand.id,
                    user_id: d.user_id ? (registrationMap.get(d.user_id) ?? 0) : 0,
                    affiliate_id: d.affiliate_id ? (userMap.get(d.affiliate_id) ?? 0) : 0,
                    link_id: d.link_id ? (linkMap.get(d.link_id) ?? 0) : 0,
                    deal_id: d.deal_id ? (dealMap.get(d.deal_id) ?? 0) : 0,
                    external_id: d.external_id || `migrated-${d.id}`,
                    status: d.status ?? 1,
                    amount: d.amount ?? 0,
                    commission: d.commission ?? 0,
                    bonus_amount: d.bonus_amount ?? 0,
                    currency: 'brl',
                    date: d.date ? new Date(d.date) : new Date(),
                    payment_date: d.payment_date ? new Date(d.payment_date) : null,
                    due_date: d.due_date ? new Date(d.due_date) : null,
                    is_first: Boolean(d.is_first),
                    is_qualified: Boolean(d.is_qualified),
                    paid: Boolean(d.paid),
                }));

                if (!toInsert.length) return 0;
                const result = await this.newPrisma.deposit.createMany({
                    data: toInsert,
                    skipDuplicates: true,
                });
                return result.count;
            },
            () => this.oldPrisma.deposit.count({ where: { brand_id: brandId } }),
        );
    }

    // -------------------------------------------------------------------------
    // WITHDRAWALS
    // -------------------------------------------------------------------------
    private async migrateWithdrawals(brandId: number): Promise<void> {
        const newBrand = await this.newPrisma.brand.findFirst({
            where: { old_id: brandId },
            select: { id: true },
        });
        if (!newBrand) throw new Error(`Brand ${brandId} não encontrada no sistema novo.`);

        const [users, links, deals, registrations] = await Promise.all([
            this.newPrisma.user.findMany({
                where: { brand_id: newBrand.id },
                select: { id: true, old_id: true },
            }),
            this.newPrisma.link.findMany({
                where: { brand_id: newBrand.id },
                select: { id: true, old_id: true },
            }),
            this.newPrisma.deal.findMany({
                where: { brand_id: newBrand.id },
                select: { id: true, old_id: true },
            }),
            this.newPrisma.registration.findMany({
                where: { brand_id: newBrand.id },
                select: { id: true, old_id: true },
            }),
        ]);

        const userMap = new Map(users.map(u => [u.old_id, u.id]));
        const linkMap = new Map(links.map(l => [l.old_id, l.id]));
        const dealMap = new Map(deals.map(d => [d.old_id, d.id]));
        const registrationMap = new Map(registrations.map(r => [r.old_id, r.id]));

        await this.batchLoop(
            brandId,
            'withdrawals',
            (lastId, take) =>
                this.oldPrisma.$queryRaw<any[]>`
                    SELECT
                        id, brand_id, user_id, affiliate_id, link_id, deal_id,
                        external_id, status, amount, commission, is_first,
                        DATE_FORMAT(IF(date IS NULL OR date = '0000-00-00 00:00:00', NOW(), date), '%Y-%m-%d %H:%i:%s') as date,
                        IF(payment_date IS NULL OR payment_date = '0000-00-00 00:00:00', NULL, DATE_FORMAT(payment_date, '%Y-%m-%d %H:%i:%s')) as payment_date
                    FROM withdrawals
                    WHERE brand_id = ${brandId} AND id > ${lastId}
                    ORDER BY id ASC
                    LIMIT ${take}
                `,
            async (batch) => {
                const toInsert = batch.map(w => ({
                    brand_id: newBrand.id,
                    user_id: w.user_id ? (registrationMap.get(w.user_id) ?? 0) : 0,
                    affiliate_id: w.affiliate_id ? (userMap.get(w.affiliate_id) ?? 0) : 0,
                    link_id: w.link_id ? (linkMap.get(w.link_id) ?? 0) : 0,
                    deal_id: w.deal_id ? (dealMap.get(w.deal_id) ?? 0) : 0,
                    external_id: w.external_id || `migrated-${w.id}`,
                    status: w.status ?? 1,
                    amount: w.amount ?? 0,
                    commission: w.commission ?? 0,
                    currency: 'brl',
                    date: w.date ? new Date(w.date) : new Date(),
                    payment_date: w.payment_date ? new Date(w.payment_date) : null,
                    is_first: Boolean(w.is_first),
                }));

                if (!toInsert.length) return 0;
                const result = await this.newPrisma.withdrawal.createMany({
                    data: toInsert,
                    skipDuplicates: true,
                });
                return result.count;
            },
            () => this.oldPrisma.withdrawal.count({ where: { brand_id: brandId } }),
        );
    }

    // -------------------------------------------------------------------------
    // WEBHOOKS
    // -------------------------------------------------------------------------
    private async migrateWebhooks(brandId: number): Promise<void> {
        const newBrand = await this.newPrisma.brand.findFirst({
            where: { old_id: brandId },
            select: { id: true },
        });
        if (!newBrand) throw new Error(`Brand ${brandId} não encontrada no sistema novo.`);

        const allUsers = await this.newPrisma.user.findMany({
            where: { brand_id: newBrand.id },
            select: { id: true, old_id: true },
        });
        const userMap = new Map(allUsers.map(u => [u.old_id, u.id]));
        const firstUserId = allUsers[0]?.id ?? 0;

        await this.batchLoop(
            brandId,
            'webhooks',
            (lastId, take) =>
                this.oldPrisma.webhook.findMany({
                    where: { brand_id: brandId, id: { gt: lastId } },
                    orderBy: { id: 'asc' },
                    take,
                }),
            async (batch) => {
                const toInsert = batch.map(w => ({
                    brand_id: newBrand.id,
                    user_id: w.user_id ? (userMap.get(w.user_id) ?? 0) : 0,
                    created_by: w.created_by ? (userMap.get(w.created_by) ?? firstUserId) : firstUserId,
                    url: w.url,
                    method: w.method ?? 'POST',
                    send_paid_deposit: Boolean(w.send_paid_deposit),
                    send_first_paid_deposit: Boolean(w.send_first_paid_deposit),
                    send_deposit_request: Boolean(w.send_deposit_request),
                    send_paid_withdrawal: Boolean(w.send_paid_withdrawal),
                    send_first_paid_withdrawal: Boolean(w.send_first_paid_withdrawal),
                    send_canceled_withdrawal: Boolean(w.send_canceled_withdrawal),
                    send_withdrawal_request: Boolean(w.send_withdrawal_request),
                    send_signup: Boolean(w.send_signup),
                    send_account_modified: Boolean(w.send_account_modified),
                    send_effectived_user: Boolean(w.send_effectived_user),
                    headers: (() => {
                        const h = w.headers as Record<string, any>;
                        if (!h) return [];
                        const entries = Object.entries(h).filter(([key]) => key !== '');
                        return entries.map(([key, value]) => ({ key, value: value ?? '' }));
                    })(),
                }));

                if (!toInsert.length) return 0;
                const result = await this.newPrisma.webhook.createMany({
                    data: toInsert,
                    skipDuplicates: true,
                });
                return result.count;
            },
            () => this.oldPrisma.webhook.count({ where: { brand_id: brandId } }),
        );
    }
}