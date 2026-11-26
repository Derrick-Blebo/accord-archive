/**
 * Server-side Paystack Transfer (Author Sales Withdrawal Payout) endpoint.
 * Creates a Paystack Transfer Recipient and initiates a Transfer using PAYSTACK_SECRET_KEY.
 * Requires a valid Supabase JWT belonging to an active Superadmin.
 */
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mzblgajftvyyosyrawcx.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16YmxnYWpmdHZ5eW9zeXJhd2N4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ0NzYxNTQsImV4cCI6MjExMDA1MjE1NH0.Xs9MeioNfqb5DzxDYP-9ZqfywBeOlUreAY-yKrcBmJM';
const MASTER_ADMIN_EMAIL = 'accordmedia1@gmail.com';

async function verifySuperadminCaller(authHeader) {
    const token = String(authHeader || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return { ok: false, status: 401, error: 'Authentication required.' };

    const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${token}`
        }
    });
    if (!userResp.ok) return { ok: false, status: 401, error: 'Invalid or expired session.' };

    const user = await userResp.json();
    const email = String(user?.email || '').trim().toLowerCase();
    if (!email) return { ok: false, status: 401, error: 'Invalid user session.' };

    if (email === MASTER_ADMIN_EMAIL) return { ok: true, user };

    const superResp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_superadmin`, {
        method: 'POST',
        headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: '{}'
    });
    const isSuper = superResp.ok ? await superResp.json() : false;
    if (!isSuper) return { ok: false, status: 403, error: 'Forbidden: Superadmin privileges required.' };

    return { ok: true, user };
}

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const auth = await verifySuperadminCaller(req.headers.authorization);
    if (!auth.ok) {
        return res.status(auth.status).json({ success: false, error: auth.error });
    }

    const secretKey = process.env.PAYSTACK_SECRET_KEY || '';
    if (!secretKey) {
        return res.status(503).json({
            success: false,
            configured: false,
            error: 'Paystack is not configured yet. Add PAYSTACK_SECRET_KEY to environment variables to enable automated payouts.'
        });
    }

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
        const {
            withdrawalId,
            amount,
            currency = 'GHS',
            recipientType = 'nuban',
            accountName,
            accountNumber,
            bankCode,
            reason = 'Accord Archive Author Royalties Payout'
        } = body;

        const numericAmount = Number(amount);
        if (!withdrawalId || !Number.isFinite(numericAmount) || numericAmount <= 0) {
            return res.status(400).json({ success: false, error: 'Valid withdrawalId and positive amount are required.' });
        }
        if (!accountName || !accountNumber || !bankCode) {
            return res.status(400).json({ success: false, error: 'Recipient accountName, accountNumber, and bankCode are required.' });
        }

        // 1. Create Transfer Recipient
        const recipientResp = await fetch('https://api.paystack.co/transferrecipient', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${secretKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                type: recipientType,
                name: String(accountName).trim(),
                account_number: String(accountNumber).trim(),
                bank_code: String(bankCode).trim(),
                currency: String(currency).toUpperCase()
            })
        });

        const recipientData = await recipientResp.json();
        if (!recipientResp.ok || !recipientData?.status || !recipientData?.data?.recipient_code) {
            return res.status(400).json({
                success: false,
                error: recipientData?.message || 'Could not create Paystack transfer recipient.'
            });
        }

        const recipientCode = recipientData.data.recipient_code;
        const reference = `accord_wd_${String(withdrawalId).replace(/[^a-zA-Z0-9_-]/g, '')}_${Date.now()}`;

        // 2. Initiate Transfer
        const transferResp = await fetch('https://api.paystack.co/transfer', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${secretKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                source: 'balance',
                amount: Math.round(numericAmount * 100),
                recipient: recipientCode,
                reference,
                reason
            })
        });

        const transferData = await transferResp.json();
        if (!transferResp.ok || !transferData?.status) {
            return res.status(400).json({
                success: false,
                error: transferData?.message || 'Paystack transfer initiation failed.'
            });
        }

        return res.status(200).json({
            success: true,
            recipient_code: recipientCode,
            transfer_code: transferData.data?.transfer_code || null,
            reference: transferData.data?.reference || reference,
            status: transferData.data?.status || 'pending'
        });
    } catch (err) {
        console.error('Paystack payout error:', err);
        return res.status(500).json({ success: false, error: 'Internal payout error.' });
    }
}
