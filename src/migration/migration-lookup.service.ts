import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { OldPrismaService } from './old-prisma.service';
import { extractDomain } from 'src/utils/helpers.util';

@Injectable()
export class MigrationLookupService {
    constructor(private readonly oldPrisma: OldPrismaService) { }

    async lookupByUrl(url: string) {
        if(url.length < 3) {
            throw new ForbiddenException(`URL muito curta para busca`);
        }

        const brand = await this.oldPrisma.brand.findFirst({
            where: { url: { contains: url } },
        });

        if (!brand) {
            throw new NotFoundException(`Nenhum site encontrado com a URL: ${url}`);
        }

        const [users, registrations, deposits, withdrawals, links, wallets] =
            await Promise.all([
                this.oldPrisma.user.count({ where: { brand_id: brand.id } }),
                this.oldPrisma.registration.count({ where: { brand_id: brand.id } }),
                this.oldPrisma.deposit.count({ where: { brand_id: brand.id } }),
                this.oldPrisma.withdrawal.count({ where: { brand_id: brand.id } }),
                this.oldPrisma.link.count({ where: { brand_id: brand.id } }),
                this.oldPrisma.wallet.count({ where: { brand_id: brand.id } }),
            ]);

        return {
            status: 'success',
            site: {
                id: brand.id,
                url: extractDomain(brand.url),
                name: brand.name,
            },
            count: {
                users,
                registrations,
                deposits,
                withdrawals,
                links,
                wallets,
            },
        };
    }
}