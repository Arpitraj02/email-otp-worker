import PostalMime from 'postal-mime';

function extractOTP(text) {
    if (!text) return null;
    const patterns = [
        /\b(\d{4,8})\b/,
        /verification code[:\s]*(\d{4,8})/i,
        /OTP[:\s]*(\d{4,8})/i,
        /code[:\s]*(\d{4,8})/i,
        /验证码[:\s]*(\d{4,8})/i
    ];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
            const code = match[1];
            if (!/^(19|20)\d{2}$/.test(code) && !/^\d{1,2}:\d{2}$/.test(code)) {
                return code;
            }
        }
    }
    return null;
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;

        // ----- GET / – welcome -----
        if (path === '/') {
            return new Response(JSON.stringify({
                message: 'nigga hunter mail API active 🎯',
                version: '1.0.0',
                endpoints: {
                    setup: '/setup (call once to create DB)',
                    all: '/all (list all emails)',
                    inbox: '/inbox/<email>',
                    health: '/health'
                }
            }), {
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // ----- GET /health – status -----
        if (path === '/health') {
            return new Response(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }), {
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // ----- /setup – create schema using prepare().run() -----
        if (path === '/setup') {
            try {
                await env.DB.prepare(
                    `CREATE TABLE IF NOT EXISTS emails (
                        id TEXT PRIMARY KEY,
                        recipient TEXT NOT NULL,
                        sender TEXT,
                        subject TEXT,
                        text_body TEXT,
                        html_body TEXT,
                        received_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )`
                ).run();
                await env.DB.prepare(
                    `CREATE INDEX IF NOT EXISTS idx_recipient ON emails(recipient)`
                ).run();
                return new Response(JSON.stringify({ success: true, message: 'Schema created' }), {
                    headers: { 'Content-Type': 'application/json' }
                });
            } catch (err) {
                return new Response(JSON.stringify({ success: false, error: err.message }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
        }

        // ----- /all – get all emails (latest 200) -----
        if (path === '/all') {
            const { results } = await env.DB.prepare(
                `SELECT * FROM emails ORDER BY received_at DESC LIMIT 200`
            ).all();
            const withOtp = results.map(row => ({
                ...row,
                otp: extractOTP(row.html_body || row.text_body)
            }));
            return new Response(JSON.stringify({
                success: true,
                count: withOtp.length,
                emails: withOtp
            }), {
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // ----- /inbox/<email> -----
        const match = path.match(/^\/inbox\/(.+)$/);
        if (match) {
            const emailAddress = match[1];
            const { results } = await env.DB.prepare(
                `SELECT * FROM emails WHERE recipient = ? ORDER BY received_at DESC`
            ).bind(emailAddress).all();
            const withOtp = results.map(row => ({
                ...row,
                otp: extractOTP(row.html_body || row.text_body)
            }));
            return new Response(JSON.stringify({
                success: true,
                email: emailAddress,
                count: withOtp.length,
                emails: withOtp
            }), {
                headers: { 'Content-Type': 'application/json' }
            });
        }

        return new Response('Not found', { status: 404 });
    },

    async email(message, env, ctx) {
        const parser = new PostalMime();
        const email = await parser.parse(message.raw);

        const to = message.to;
        const id = crypto.randomUUID();

        await env.DB.prepare(
            `INSERT INTO emails (id, recipient, sender, subject, text_body, html_body, received_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(
            id,
            to,
            message.from,
            email.subject || '',
            email.text || '',
            email.html || '',
            new Date().toISOString()
        ).run();
    }
};
