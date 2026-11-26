/**
 * Server-side Paystack transaction verification endpoint.
 * Used for both Paid Promotions and Book Purchases.
 * Requires PAYSTACK_SECRET_KEY in environment variables.
 * Also exposes GET ?config=1 to safely return PAYSTACK_PUBLIC_KEY to the frontend.
 */
function sanitizeEnvKey(val) {
    return String(val || '').trim().replace(/^['"]|['"]$/g, '').trim();
}

function getPaystackKeyMode(key) {
    if (key.startsWith('pk_test_') || key.startsWith('sk_test_')) return 'test';
    if (key.startsWith('pk_live_') || key.startsWith('sk_live_')) return 'live';
    return 'unknown';
}

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');

    const publicKey = sanitizeEnvKey(process.env.PAYSTACK_PUBLIC_KEY);
    const secretKey = sanitizeEnvKey(process.env.PAYSTACK_SECRET_KEY);
    const publicValid = publicKey.startsWith('pk_');
    const secretValid = secretKey.startsWith('sk_');
    const modeMismatch = publicValid && secretValid && getPaystackKeyMode(publicKey) !== getPaystackKeyMode(secretKey);

    if (req.method === 'GET') {
        const configError = modeMismatch
            ? 'Paystack public and secret keys are from different modes (test vs live).'
            : (!publicValid && !secretValid)
                ? 'Paystack is not configured yet. Please add PAYSTACK_PUBLIC_KEY and PAYSTACK_SECRET_KEY in your Vercel environment variables.'
                : !publicValid
                    ? 'Paystack public key is missing or invalid in Vercel environment variables (must start with pk_test_ or pk_live_).'
                    : !secretValid
                        ? 'Paystack secret key is missing or invalid in Vercel environment variables (must start with sk_test_ or sk_live_).'
                        : null;
        return res.status(200).json({
            configured: Boolean(publicValid && secretValid && !modeMismatch),
            publicKey: publicValid ? publicKey : null,
            currency: sanitizeEnvKey(process.env.PAYSTACK_CURRENCY) || 'GHS',
            ...(configError ? { error: configError } : {})
        });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    if (!secretValid || modeMismatch) {
        return res.status(503).json({
            verified: false,
            configured: false,
            error: modeMismatch
                ? 'Paystack key mismatch: PAYSTACK_PUBLIC_KEY and PAYSTACK_SECRET_KEY must both be test keys or both be live keys.'
                : 'Paystack secret key is missing or invalid. Ensure PAYSTACK_SECRET_KEY starts with sk_test_ or sk_live_ (with no quotes or spaces).'
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
            const rawMsg = payload?.data?.gateway_response || payload?.message || 'Transaction could not be verified.';
            const friendlyMsg = /invalid key/i.test(rawMsg)
                ? 'Paystack verification failed: Invalid key. Please verify PAYSTACK_SECRET_KEY in your Vercel environment variables matches PAYSTACK_PUBLIC_KEY (same Paystack account and test/live mode, without quotes).'
                : rawMsg;
            return res.status(400).json({
                verified: false,
                error: friendlyMsg
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
