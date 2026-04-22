import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';
export const PERMISSIONS_ANY_KEY = 'permissions_any';

// Exemplo de uso: @Permissions('user.create', 'user.list')
export const Permissions = (...permissions: string[]) =>
    SetMetadata(PERMISSIONS_KEY, permissions);

export const PermissionsAny = (...permissions: string[]) =>
    SetMetadata(PERMISSIONS_ANY_KEY, permissions);