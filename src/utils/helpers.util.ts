import { PERMISSIONS } from "src/auth/permissions";

export function normalizeDocument(doc: string): string {
    if (!doc) {
        return '';
    }

    return doc
        .normalize('NFD') // separa acentos
        .replace(/[\u0300-\u036f]/g, '') // remove acentos
        .replace(/[^a-zA-Z0-9]/g, ''); // mantém só letras e números
}

export function realToCents(value: string): number {
    if (!value) return 0;

    // remove pontos
    const clean = value.replace(/\./g, '').replace(',', '.');

    return Math.round(parseFloat(clean) * 100);
}

/**
 * Converte centavos → "9.999,99"
 */
export function realFormat(cents: number): string {
    const reais = (cents / 100).toFixed(2);

    // troca . pra , e adiciona o separador de milhar
    return reais
        .replace('.', ',')
        .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function filterPayload(data: any, allowedFields: string[]) {
    const filtered: Record<string, any> = {};
    for (const field of allowedFields) {
        if (data[field] !== undefined) {
            filtered[field] = data[field];
        }
    }

    return filtered;
}

export function cleanMarketsNames(names: string[]) {

    if (names.length <= 1) return names;

    let prefix = names[0];
    let suffix = names[0];

    for (const name of names) {

        while (!name.startsWith(prefix) && prefix.length) {
            prefix = prefix.slice(0, -1);
        }

        while (!name.endsWith(suffix) && suffix.length) {
            suffix = suffix.slice(1);
        }
    }

    return names.map(n => {
        let result = n;

        if (prefix.length) result = result.replace(prefix, '');
        if (suffix.length) result = result.replace(suffix, '');

        return result.trim();
    });
}

export function formatPolyPrice(price: number): string {

    if (price === null || price === undefined) return '';

    const cents = price * 100;

    const rounded = Math.round(cents * 10) / 10;

    if (Number.isInteger(rounded)) {
        return String(rounded);
    }

    return rounded.toFixed(1).replace('.', ',');
}

export function isStringArray(value: any): value is string[] {
    return Array.isArray(value) && value.every(v => typeof v === 'string');
}

export function sanitizePermissions(value: any): string[] {
    if (!Array.isArray(value)) return [];

    return value.filter(v => typeof v === 'string' && v.length > 0);
}

export function formatDateTime(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
        `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function applyNGRCents(
    admin: { type: number },
    ngr_percent: number,
    amount_cents: number,
): number {
    // Pula admins ou NGR zerado
    if ([1, 2].includes(admin.type) || ngr_percent === 0) {
        return amount_cents;
    }

    // Aplica NGR
    const discount = Math.floor((amount_cents * ngr_percent) / 100);

    return amount_cents - discount;
}

export function extractDomain(raw: string): string {
    try {
        const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
        return url.hostname.replace(/^www\./, '');
    } catch {
        return raw.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    }
}

export function brandTransactionStatusName(tid: string | number): string {
    switch (Number(tid)) {
        case 0: return 'Solicitado'; break;
        case 1: return 'Em aberto'; break;
        case 2: return 'Pago'; break;
        case 3: return 'Vencido'; break;
        case 4: return 'Cancelado'; break;
        default: return 'Indefinido'; break;
    }
}

export function getPermissionsByType(type: number): string[] {
    const result: string[] = [];

    Object.values(PERMISSIONS).forEach(group => {
        group.permissions.forEach(permission => {
            if (permission.default_in.includes(type)) {
                result.push(permission.key);
            }
        });
    });

    return result;
}