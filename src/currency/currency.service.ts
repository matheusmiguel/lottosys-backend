import { Injectable, BadRequestException, ServiceUnavailableException, Inject } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import type { Cache } from 'cache-manager';
import { CACHE_MANAGER } from '@nestjs/cache-manager';

export type CurrencyCode = string;

export interface ConvertResult {
    cents: number;
    formatted: string;
    rate: number;
    from: string;
    to: string;
    prefix: string;
}

@Injectable()
export class CurrencyService {
    private readonly baseUrl = 'https://cloud.goption.io/quotes/';

    constructor(
        private readonly http: HttpService,
        @Inject(CACHE_MANAGER) private readonly cache: Cache,
    ) { }

    private readonly currencySymbols: Record<string, string> = {
        BRL: 'R$',
        USD: 'U$',
        EUR: '€',
        GBP: '£',
        MXN: '$',
        COP: '$',
        ARS: '$',
        CLP: '$',
        PEN: 'S/',
        UYU: '$U',
        CAD: 'C$',
        AUD: 'A$',
        CHF: 'CHF',
        JPY: '¥',
        CNY: '¥',
    };

    getCurrencyPrefix(currency: string): string {
        return this.currencySymbols[currency.toUpperCase()] ?? currency.toUpperCase();
    }

    /**
     * Converte um valor em centavos de uma moeda para outra.
     * Ex: convertCents(10000, 'USD', 'BRL') => { cents: 52500, formatted: '525,00' }
     */
    async convertCents(
        amountCents: number,
        from: CurrencyCode,
        to: CurrencyCode,
        options?: { locale?: string; rounding?: 'round' | 'floor' | 'ceil' },
    ): Promise<ConvertResult> {
        if (!Number.isFinite(amountCents)) {
            throw new BadRequestException('amountCents must be a finite number.');
        }
        if (!from || !to) {
            throw new BadRequestException('from and to are required.');
        }

        const fromUp = from.toUpperCase();
        const toUp = to.toUpperCase();

        if (fromUp === toUp) {
            return {
                cents: Math.trunc(amountCents),
                formatted: this.formatCents(Math.trunc(amountCents), options?.locale ?? 'pt-BR'),
                rate: 1,
                from: fromUp,
                to: toUp,
                prefix: this.getCurrencyPrefix(toUp),
            };
        }

        const rate = await this.getRate(fromUp, toUp);

        const raw = amountCents * rate;

        const rounding = options?.rounding ?? 'round';
        const cents =
            rounding === 'floor' ? Math.floor(raw) :
                rounding === 'ceil' ? Math.ceil(raw) :
                    Math.round(raw);

        return {
            cents,
            formatted: this.formatCents(cents, options?.locale ?? 'pt-BR'),
            rate,
            from: fromUp,
            to: toUp,
            prefix: this.getCurrencyPrefix(toUp),
        };
    }

    /**
     * Retorna a taxa (bid) para converter FROM -> TO.
     * O endpoint é invertido, então chamamos:
     *   base=TO&final=FROM
     * E usamos "bid" (ex: 1 USD = 5.21 BRL).
     */
    private async getRate(from: CurrencyCode, to: CurrencyCode): Promise<number> {
        const cacheKey = `fx:${from}->${to}`;

        const cached = await this.cache.get<number>(cacheKey);
        if (typeof cached === 'number' && Number.isFinite(cached) && cached > 0) {
            return cached;
        }

        const params = new URLSearchParams({
            base: to,   // invertido
            final: from,
        });

        const url = `${this.baseUrl}?${params.toString()}`;

        try {
            const res = await firstValueFrom(this.http.get(url));
            const data = res?.data;

            if (!data || typeof data !== 'object') {
                throw new ServiceUnavailableException('Invalid FX response payload.');
            }

            // payload vem como { "USDBRL": { bid: 5.21, ... } }
            const first = Object.values(data)[0] as any;
            const bid = Number(first?.bid);

            if (!Number.isFinite(bid) || bid <= 0) {
                throw new ServiceUnavailableException('Invalid bid in FX response.');
            }

            await this.cache.set(cacheKey, bid, 60 * 60 * 2 * 1000); // 2h

            return bid;
        } catch (e: any) {
            if (e?.response?.status) {
                throw new ServiceUnavailableException(`FX endpoint error: HTTP ${e.response.status}`);
            }
            throw new ServiceUnavailableException('Failed to fetch FX rate.');
        }
    }

    private formatCents(cents: number, locale: string): string {
        const value = cents / 100;
        return new Intl.NumberFormat(locale, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(value);
    }
}
