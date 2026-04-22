/**
 * Todas as chaves Redis do módulo de migração ficam sob o prefixo "migration".
 *
 * Estrutura:
 *   migration:{brandId}:lock              → string  — lock distribuído (NX + TTL)
 *   migration:{brandId}:status            → string  — "idle"|"running"|"done"|"error"
 *   migration:{brandId}:error             → string  — mensagem de erro, se houver
 *   migration:{brandId}:checkpoint:{entity} → hash com: last_id, done, total, status
 */

export const MIGRATION_KEY = {
    lock: (brandId: number) => `migration:${brandId}:lock`,
    status: (brandId: number) => `migration:${brandId}:status`,
    error: (brandId: number) => `migration:${brandId}:error`,
    checkpoint: (brandId: number, entity: string) =>
        `migration:${brandId}:checkpoint:${entity}`,
} as const;

export const MIGRATION_ENTITIES = [
    'brand',
    'users',
    'wallets',
    'deals',
    'link_types',
    'links',
    'registrations',
    'deposits',
    'withdrawals',
    'webhooks'
] as const;

export type MigrationEntity = (typeof MIGRATION_ENTITIES)[number];

/** TTL do lock em segundos. O worker renova a cada metade desse tempo. */
export const LOCK_TTL_SECONDS = 60;

export const BATCH_SIZES: Record<MigrationEntity, number> = {
    brand: 1,
    users: 2000,
    wallets: 2000,
    deals: 2000,
    link_types: 2000,
    links: 1000,        // mais FKs por registro → batch menor
    registrations: 2000,
    deposits: 2000,
    withdrawals: 2000,
    webhooks: 2000,
};