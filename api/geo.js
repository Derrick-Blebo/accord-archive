/**
 * Lightweight IP Geolocation endpoint using Vercel's built-in edge headers.
 * Returns approximate country, region, and city without exposing raw IP addresses
 * or prompting the user for browser GPS permissions.
 */
export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');

    const rawCountry = req.headers['x-vercel-ip-country'] || '';
    const rawRegion = req.headers['x-vercel-ip-country-region'] || '';
    const rawCity = req.headers['x-vercel-ip-city'] || '';

    const safeDecode = (val) => {
        if (!val) return '';
        try {
            return decodeURIComponent(String(val)).trim();
        } catch {
            return String(val).trim();
        }
    };

    const country = safeDecode(rawCountry).toUpperCase() || 'GLOBAL';
    const region = safeDecode(rawRegion);
    const city = safeDecode(rawCity);

    return res.status(200).json({
        country,
        region,
        city,
        source: rawCountry ? 'vercel_edge' : 'fallback'
    });
}
