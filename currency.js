/**
 * Accord Archive — Local Currency & Geo Pricing Helper
 * Detects visitor country via /api/geo (cached in sessionStorage) and converts
 * base USD prices into the visitor's local currency.
 */
(function () {
    const CURRENCY_BY_COUNTRY = {
        US: { code: 'USD', symbol: '$', rate: 1, decimals: 2 },
        GLOBAL: { code: 'USD', symbol: '$', rate: 1, decimals: 2 },
        GH: { code: 'GHS', symbol: 'GH₵', rate: 15.5, decimals: 2 },
        NG: { code: 'NGN', symbol: '₦', rate: 1600, decimals: 0 },
        KE: { code: 'KES', symbol: 'KSh', rate: 130, decimals: 0 },
        ZA: { code: 'ZAR', symbol: 'R', rate: 18, decimals: 2 },
        UG: { code: 'UGX', symbol: 'USh', rate: 3700, decimals: 0 },
        TZ: { code: 'TZS', symbol: 'TSh', rate: 2650, decimals: 0 },
        RW: { code: 'RWF', symbol: 'RF', rate: 1350, decimals: 0 },
        GB: { code: 'GBP', symbol: '£', rate: 0.79, decimals: 2 },
        CA: { code: 'CAD', symbol: 'CA$', rate: 1.4, decimals: 2 },
        AU: { code: 'AUD', symbol: 'A$', rate: 1.54, decimals: 2 },
        IN: { code: 'INR', symbol: '₹', rate: 84, decimals: 0 },
        DE: { code: 'EUR', symbol: '€', rate: 0.95, decimals: 2 },
        FR: { code: 'EUR', symbol: '€', rate: 0.95, decimals: 2 },
        IT: { code: 'EUR', symbol: '€', rate: 0.95, decimals: 2 },
        ES: { code: 'EUR', symbol: '€', rate: 0.95, decimals: 2 },
        NL: { code: 'EUR', symbol: '€', rate: 0.95, decimals: 2 },
        BE: { code: 'EUR', symbol: '€', rate: 0.95, decimals: 2 },
        AT: { code: 'EUR', symbol: '€', rate: 0.95, decimals: 2 },
        PT: { code: 'EUR', symbol: '€', rate: 0.95, decimals: 2 },
        IE: { code: 'EUR', symbol: '€', rate: 0.95, decimals: 2 },
        FI: { code: 'EUR', symbol: '€', rate: 0.95, decimals: 2 },
        GR: { code: 'EUR', symbol: '€', rate: 0.95, decimals: 2 }
    };

    const CURRENCY_META = {
        USD: { code: 'USD', symbol: '$', rate: 1, decimals: 2 },
        GHS: { code: 'GHS', symbol: 'GH₵', rate: 15.5, decimals: 2 },
        NGN: { code: 'NGN', symbol: '₦', rate: 1600, decimals: 0 },
        KES: { code: 'KES', symbol: 'KSh', rate: 130, decimals: 0 },
        ZAR: { code: 'ZAR', symbol: 'R', rate: 18, decimals: 2 },
        UGX: { code: 'UGX', symbol: 'USh', rate: 3700, decimals: 0 },
        TZS: { code: 'TZS', symbol: 'TSh', rate: 2650, decimals: 0 },
        RWF: { code: 'RWF', symbol: 'RF', rate: 1350, decimals: 0 },
        GBP: { code: 'GBP', symbol: '£', rate: 0.79, decimals: 2 },
        CAD: { code: 'CAD', symbol: 'CA$', rate: 1.4, decimals: 2 },
        AUD: { code: 'AUD', symbol: 'A$', rate: 1.54, decimals: 2 },
        INR: { code: 'INR', symbol: '₹', rate: 84, decimals: 0 },
        EUR: { code: 'EUR', symbol: '€', rate: 0.95, decimals: 2 }
    };

    let _initPromise = null;
    let _currentInfo = { country: 'GLOBAL', ...CURRENCY_BY_COUNTRY.GLOBAL };

    function resolveCountryFromCache() {
        try {
            if (window.accordUserGeo?.country) {
                return String(window.accordUserGeo.country).toUpperCase();
            }
            const cached = sessionStorage.getItem('accord_geo');
            if (cached) {
                const parsed = JSON.parse(cached);
                if (parsed?.country) return String(parsed.country).toUpperCase();
            }
        } catch (_) {}
        return null;
    }

    function applyCountry(country) {
        const key = String(country || 'GLOBAL').toUpperCase();
        const cfg = CURRENCY_BY_COUNTRY[key] || CURRENCY_BY_COUNTRY.GLOBAL;
        _currentInfo = { country: key, ...cfg };
        return _currentInfo;
    }

    async function init() {
        const cachedCountry = resolveCountryFromCache();
        if (cachedCountry) {
            return applyCountry(cachedCountry);
        }
        if (_initPromise) return _initPromise;

        _initPromise = (async () => {
            try {
                const resp = await fetch('/api/geo');
                if (resp.ok) {
                    const geo = await resp.json();
                    sessionStorage.setItem('accord_geo', JSON.stringify(geo));
                    window.accordUserGeo = geo;
                    return applyCountry(geo?.country);
                }
            } catch (_) {}
            return applyCountry('GLOBAL');
        })();

        return _initPromise;
    }

    function getInfo() {
        const cachedCountry = resolveCountryFromCache();
        if (cachedCountry && cachedCountry !== _currentInfo.country) {
            applyCountry(cachedCountry);
        }
        return _currentInfo;
    }

    function fromUsd(usdAmount, targetCode = null) {
        const usd = Number(usdAmount || 0);
        const meta = targetCode ? (CURRENCY_META[String(targetCode).toUpperCase()] || CURRENCY_META.USD) : getInfo();
        const raw = usd * meta.rate;
        const factor = Math.pow(10, meta.decimals);
        return Math.round(raw * factor) / factor;
    }

    function formatAmount(amount, currencyCode = null) {
        const meta = currencyCode ? (CURRENCY_META[String(currencyCode).toUpperCase()] || { code: currencyCode, symbol: currencyCode + ' ', decimals: 2 }) : getInfo();
        const num = Number(amount || 0);
        try {
            return new Intl.NumberFormat(undefined, {
                style: 'currency',
                currency: meta.code,
                minimumFractionDigits: meta.decimals,
                maximumFractionDigits: meta.decimals
            }).format(num);
        } catch (_) {
            return `${meta.symbol}${num.toFixed(meta.decimals)}`;
        }
    }

    function formatLocalFromUsd(usdAmount) {
        const info = getInfo();
        return formatAmount(fromUsd(usdAmount, info.code), info.code);
    }

    window.AccordCurrency = {
        init,
        getInfo,
        fromUsd,
        formatAmount,
        formatLocalFromUsd,
        CURRENCY_META
    };
})();
