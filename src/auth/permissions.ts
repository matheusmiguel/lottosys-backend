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
                label: 'Gerenciar saques de afiliados',
                default_in: [1, 2]
            },
            {
                key: 'adm.brcfgs',
                label: 'Gerenciar configurações',
                default_in: [1, 2]
            },
            {
                key: 'adm.claff',
                label: 'Alterar afiliado de um lead',
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
        label: 'Visualização de Leads',
        permissions: [
            {
                key: 'ld.v_login',
                label: 'Ver login do lead',
                default_in: [1, 2, 3]
            },
            {
                key: 'ld.v_email',
                label: 'Ver e-mail do lead',
                default_in: [1, 2, 3]
            },
            {
                key: 'ld.v_name',
                label: 'Ver nome do lead',
                default_in: [1, 2, 3]
            },
            {
                key: 'ld.v_doc',
                label: 'Ver documento do lead',
                default_in: [1, 2, 3]
            },
            {
                key: 'ld.v_phone',
                label: 'Ver telefone do lead',
                default_in: [1, 2, 3]
            },
        ]
    },
    subaffiliates: {
        code: 'subaffiliates',
        label: 'Subafiliados',
        permissions: [
            {
                key: 'subaf.register',
                label: 'Cadastrar subafiliados',
                default_in: [1, 2, 3, 4]
            },
            {
                key: 'subaf.edit',
                label: 'Editar subafiliados',
                default_in: [1, 2, 3, 4]
            },
            {
                key: 'subaf.commissions',
                label: 'Gerenciar comissões de subafiliados',
                default_in: [1, 2, 3, 4]
            }
        ]
    }
};