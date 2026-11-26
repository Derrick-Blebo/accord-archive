/**
 * Accord Archive — Shared Paystack Checkout Helper
 * Fetches PAYSTACK_PUBLIC_KEY from /api/paystack-verify, loads Paystack Inline JS,
 * launches checkout, and verifies the transaction server-side.
 */

(function () {
    let _paystackScriptPromise = null;
    let _paystackConfigCache = null;

    function loadPaystackInlineScript() {
        if (window.PaystackPop) return Promise.resolve(true);
        if (_paystackScriptPromise) return _paystackScriptPromise;

        _paystackScriptPromise = new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = 'https://js.paystack.co/v1/inline.js';
            script.async = true;
            script.onload = () => resolve(Boolean(window.PaystackPop));
            script.onerror = () => resolve(false);
            document.head.appendChild(script);
        });
        return _paystackScriptPromise;
    }

    async function getPaystackConfig() {
        if (_paystackConfigCache) return _paystackConfigCache;
        try {
            const resp = await fetch('/api/paystack-verify');
            if (resp.ok) {
                _paystackConfigCache = await resp.json();
                return _paystackConfigCache;
            }
        } catch (_) {}
        return { configured: false, publicKey: null };
    }

    window.launchAccordPaystackCheckout = async function ({
        email,
        amount,
        currency,
        metadata = {},
        onVerified,
        onError,
        onCancel
    }) {
        const cfg = await getPaystackConfig();
        if (!cfg?.configured || !cfg?.publicKey) {
            const msg = 'Paystack is not configured yet. Please add PAYSTACK_PUBLIC_KEY and PAYSTACK_SECRET_KEY in your Vercel environment variables.';
            if (typeof onError === 'function') onError(msg);
            return;
        }

        const loaded = await loadPaystackInlineScript();
        if (!loaded || !window.PaystackPop) {
            if (typeof onError === 'function') onError('Could not load Paystack checkout script. Check your connection.');
            return;
        }

        const resolvedCurrency = String(currency || cfg.currency || 'GHS').toUpperCase();
        const reference = `acc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const handler = window.PaystackPop.setup({
            key: cfg.publicKey,
            email: email || 'member@accordarchives.com',
            amount: Math.max(100, Math.round(Number(amount || 0) * 100)),
            currency: resolvedCurrency,
            ref: reference,
            metadata,
            callback: async function (response) {
                try {
                    const verifyResp = await fetch('/api/paystack-verify', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ reference: response.reference })
                    });
                    const result = await verifyResp.json();
                    if (!verifyResp.ok || !result.verified) {
                        if (typeof onError === 'function') onError(result.error || 'Payment verification failed.');
                        return;
                    }
                    if (typeof onVerified === 'function') onVerified(result);
                } catch (err) {
                    if (typeof onError === 'function') onError(err.message || 'Verification network error.');
                }
            },
            onClose: function () {
                if (typeof onCancel === 'function') onCancel();
            }
        });

        handler.openIframe();
    };
})();
