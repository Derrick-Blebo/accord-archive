/**
 * Server-side Paystack transaction verification endpoint.
 * Used for both Paid Promotions and Book Purchases.
 * Requires PAYSTACK_SECRET_KEY in environment variables.
 * Also exposes GET ?config=1 to safely return PAYSTACK_PUBLIC_KEY to the frontend.
 */
export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');

    const publicKey = process.env.PAYSTACK_PUBLIC_KEY || '';
    const secretKey = process.env.PAYSTACK_SECRET_KEY || '';

    if (req.method === 'GET') {
        return res.status(200).json({
            configured: Boolean(publicKey && secretKey),
            publicKey: publicKey || null
        });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    if (!secretKey) {
        return res.status(503).json({
            verified: false,
            configured: false,
            error: 'Paystack is not configured yet. Add PAYSTACK_PUBLIC_KEY and PAYSTACK_SECRET_KEY to environment variables.'
        });
    }

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
        const reference = String(body.reference || '').trim();
        if (!reference) {
            return res.status(400).json({ verified: false, error: 'Transaction reference is required.' });
        }

        const verifyResp = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${secretKey}`,
                'Content-Type': 'application/json'
            }
        });

        const payload = await verifyResp.json();
        if (!verifyResp.ok || !payload?.status || payload?.data?.status !== 'success') {
            return res.status(400).json({
                verified: false,
                error: payload?.data?.gateway_response || payload?.message || 'Transaction could not be verified.'
            });
        }

        const tx = payload.data;
        return res.status(200).json({
            verified: true,
            reference: tx.reference,
            amount: Number(tx.amount || 0) / 100,
            currency: tx.currency || 'USD',
            paid_at: tx.paid_at,
            customer_email: tx.customer?.email || null,
            metadata: tx.metadata || {}
        });
    } catch (err) {
        console.error('Paystack verification error:', err);
        return res.status(500).json({ verified: false, error: 'Internal verification error.' });
    }
}
