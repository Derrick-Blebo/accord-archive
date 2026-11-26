/**
 * Server-side Paystack Transfer (Author Sales Withdrawal Payout) endpoint.
 * Creates a Paystack Transfer Recipient and initiates a Transfer using PAYSTACK_SECRET_KEY.
 */
export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
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
