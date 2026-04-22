export const PERMISSIONS = {
    admin: {
        code: 'admin_permissions',
        label: 'Permissões de Administradores',
        permissions: [
            {
                key: 'adm.manperms',
                label: 'Gerenciar permissões',
                default_in: [1, 2]
            },
            {
                key: 'adm.cusers',
                label: 'Cadastrar usuários',
                default_in: [1, 2]
            },
            {
                key: 'adm.eusers',
                label: 'Editar usuários',
                default_in: [1, 2]
            },
            {
                key: 'adm.dusers',
                label: 'Excluir usuários',
                default_in: [1, 2]
            },
            {
                key: 'adm.mdeals',
                label: 'Gerenciar comissões',
                default_in: [1, 2]
            },
            {
                key: 'adm.mwithdraws',
                label: 'Gerenciar saques de usuários',
                default_in: [1, 2]
            },
            {
                key: 'adm.brcfgs',
                label: 'Gerenciar configurações',
                default_in: [1, 2]
            },
            {
                key: 'adm.claff',
                label: 'Alterar gerente de um cliente',
                default_in: [1, 2]
            },
            {
                key: 'adm.vfinance',
                label: 'Visualizar movimentações financeiras',
                default_in: [1, 2]
            },
        ]
    },
    leads: {
        code: 'leads_view',
        label: 'Visualização de Clientes',
        permissions: [
            {
                key: 'ld.v_login',
                label: 'Ver login do cliente',
                default_in: [1, 2, 5, 10]
            },
            {
                key: 'ld.v_email',
                label: 'Ver e-mail do cliente',
                default_in: [1, 2, 5, 10]
            },
            {
                key: 'ld.v_name',
                label: 'Ver nome do cliente',
                default_in: [1, 2, 5, 10]
            },
            {
                key: 'ld.v_doc',
                label: 'Ver documento do cliente',
                default_in: [1, 2, 5, 10]
            },
            {
                key: 'ld.v_phone',
                label: 'Ver telefone do cliente',
                default_in: [1, 2, 5, 10]
            },
        ]
    },
    managers: {
        code: 'managers',
        label: 'Gestores',
        permissions: [
            {
                key: 'man.register',
                label: 'Cadastrar usuários',
                default_in: [1, 2, 5]
            },
            {
                key: 'man.edit',
                label: 'Editar usuários gerenciados',
                default_in: [1, 2, 5]
            },
        ]
    }
};