export type WithdrawalItem = {
    id: number;
    status: number;
    amount: string;
    amount_cents: number;
    category: string;

    currency: {
        code: string;
        prefix: string;
    };

    user: {
        id: number;
        login: string;
        name: string;
        email: string;
        img: string | null;
    } | null;

    wallet: {
        id: number;
        name: string;
        balance: string;
        currency: string;
    } | null;

    created_at: string;
    updated_at: string;
};