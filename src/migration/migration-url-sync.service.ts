import { Injectable, NotFoundException, Logger, BadRequestException } from '@nestjs/common';
import { OldPrismaService } from './old-prisma.service';
import { PrismaService } from 'src/prisma/prisma.service';
import axios from 'axios';

function extractDomain(raw: string): string {
    try {
        const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
        return url.hostname.replace(/^www\./, '');
    } catch {
        return raw.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    }
}

@Injectable()
export class MigrationUrlSyncService {
    private readonly logger = new Logger(MigrationUrlSyncService.name);

    constructor(
        private readonly oldPrisma: OldPrismaService,
        private readonly newPrisma: PrismaService,
    ) { }

    async changeProvider(rawUrl: string) {
        const domain = extractDomain(rawUrl);

        const brand = await this.newPrisma.brand.findFirst({
            where: { url: { contains: domain } },
        });

        if (!brand) {
            throw new NotFoundException(`O site com a URL ${rawUrl} não foi encontrado no novo banco de dados.`);
        }

        this.logger.log(`🔍 Site encontrado: ${brand.name} (id=${brand.id})`);

        const payload = {
            configs: {
                brand_id: brand.id,
                token: brand.token,
            },
        };

        let url = `${brand.url}/api/crm/change-provider/ryvon`;
        url = url.replace('www.', '');
        this.logger.log(`📤 Enviando ChangeProvider para ${url}...`);

        try {
            const response = await axios.post(url, payload, {
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive',
                    'Referer': brand.url,
                    'Origin': brand.url,
                },
                timeout: 15000,
                validateStatus: () => true, // não lança erro em 4xx/5xx
            });

            this.logger.log(`✅ ChangeProviderResponse: ${response.status} | Body: ${JSON.stringify(response.data)}`);

            return {
                status: response.status >= 200 && response.status < 300 ? 'success' : 'error',
                status_code: response.status,
                body: response.data,
            };
        } catch (err) {
            this.logger.error(`❌ Falha ao contatar ${url}: ${err.message}`);
            throw new BadRequestException(`Falha ao contatar o site: ${err.message}`);
        }
    }

    async syncLinkUrls(rawUrl: string): Promise<{
        status: string;
        site: { id: number; name: string; url: string };
        updated: number;
        skipped: number;
    }> {
        // 1. Pesquisa o site no OLD pelo domínio
        const domain = extractDomain(rawUrl);

        const oldBrand = await this.oldPrisma.brand.findFirst({
            where: { url: { contains: domain } },
        });

        if (!oldBrand) {
            throw new NotFoundException(`Nenhum site encontrado com a URL: ${rawUrl}`);
        }

        this.logger.log(`🔍 Site encontrado: ${oldBrand.name} (id=${oldBrand.id})`);

        // 2. Lista todos os links migrados no novo (old_id > 0)
        const newLinks = await this.newPrisma.link.findMany({
            where: {
                brand: { old_id: oldBrand.id },
                old_id: { gt: 0 },
            },
            select: {
                old_id: true,
                url: true,
            },
        });

        if (!newLinks.length) {
            this.logger.warn(`Nenhum link migrado encontrado para brand ${oldBrand.id}`);
            return {
                status: 'success',
                site: { id: oldBrand.id, name: oldBrand.name, url: oldBrand.url },
                updated: 0,
                skipped: 0,
            };
        }

        this.logger.log(`📋 ${newLinks.length} links migrados encontrados, sincronizando...`);

        // 3. Atualiza destination_url no OLD em batches
        const BATCH_SIZE = 500;
        let updated = 0;
        let skipped = 0;

        for (let i = 0; i < newLinks.length; i += BATCH_SIZE) {
            const batch = newLinks.slice(i, i + BATCH_SIZE);

            const updates = await Promise.allSettled(
                batch.map(link =>
                    this.oldPrisma.link.update({
                        where: { id: link.old_id },
                        data: { destination_url: link.url },
                    }),
                ),
            );

            for (const result of updates) {
                if (result.status === 'fulfilled') updated++;
                else {
                    skipped++;
                    this.logger.warn(`Falha ao atualizar link: ${result.reason}`);
                }
            }

            this.logger.debug(`  sync: ${Math.min(i + BATCH_SIZE, newLinks.length)}/${newLinks.length}`);
        }

        this.logger.log(`✅ Sync concluído: ${updated} atualizados, ${skipped} ignorados.`);

        return {
            status: 'success',
            site: { id: oldBrand.id, name: oldBrand.name, url: oldBrand.url },
            updated,
            skipped,
        };
    }
}