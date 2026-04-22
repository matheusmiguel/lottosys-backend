import { Deposit, Registration, Withdrawal } from '@prisma/client';

// Reexporta os tipos do Prisma para uso no service
export type WebhookDeposit = Deposit;
export type WebhookWithdrawal = Withdrawal;
export type WebhookRegistration = Registration;