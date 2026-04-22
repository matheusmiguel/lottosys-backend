import { Injectable } from '@nestjs/common';
import Mailgun from 'mailgun.js';
import FormData from 'form-data';

@Injectable()
export class MailService {
    private mg;
    private name = process.env.NAME;
    private domain = process.env.MAILGUN_DOMAIN;

    constructor() {
        const mailgun = new Mailgun(FormData);
        this.mg = mailgun.client({
            username: 'api',
            key: process.env.MAILGUN_TOKEN!,
        });
    }

    async sendMail(to: string, template: string): Promise<string | void> {
        let subject = '';
        let html = '';
        let token = '';

        if (template === 'recovery-password') {
            subject = 'Recuperação de senha';
            token = Math.floor(100000 + Math.random() * 900000).toString();
            html = this.getTemplateRecoveryPassword(token);
        }

        await this.mg.messages.create(this.domain, {
            from: `${this.name} <noreply@${this.domain}>`,
            to,
            subject,
            html,
        });

        return token;
    }

    getTemplateRecoveryPassword(token: string) {
        return `<body style="background-color: #f6f6f6; font-family: Arial, sans-serif; -webkit-font-smoothing: antialiased; font-size: 14px; line-height: 1.4; margin: 0; padding: 0; -ms-text-size-adjust: 100%; -webkit-text-size-adjust: 100%;">
            <br />
            <table cellspacing="0" style="width: 100%; max-width: 12cm; margin: 25px auto; background: #FFF; " cellpadding="10">
                <tr>
                    <td align="center" colspan="2" style=" background: #1b1944; border: 10px solid #FFF;"><img src="${process.env.LOGO_WHITE_URL}" width="150" style=" margin: 10px 0 5px 0; " /></td>
                </tr>
                <tr>
                    <td colspan="2" align="center"><b>TOKEN DE SEGURANÇA</b></td>
                </tr>
                <tr>
                    <td style="" colspan="2">
                        <p style="margin: 0px;color: #959393;padding: 0 25px;"><br /><b>Não compartilhe com ninguém!</b> Este é o seu código de segurança:</p>
                        <b style=" display: block; text-align: center; margin: 25px; padding: 20px; background: #F6F6F6; font-size: 20px; ">${token}</b> <br />
                    </td>
                </tr>
                <tr>
                    <td style=" border-top: 1px solid #F6F6F6; " colspan="2">
                        <p style="margin: 5px 0; color: #959393;" align="center">&copy; ${new Date().getFullYear()} <b>${process.env.NAME}</b></p>
                    </td>
                </tr>
            </table>
            <br /> 
            </body>`;
    }
}