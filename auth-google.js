/**
 * Accord Archive - Shared Google Identity Services (signInWithIdToken) & Auth Helpers
 * Eliminates the raw *.supabase.co domain from the Google Account Chooser by signing in
 * directly against Accord Archive's Google OAuth Client ID and passing the ID token to Supabase.
 */

const ACCORD_GOOGLE_CLIENT_ID = '981023509389-p132l25a14r5r6vtn61u8r7seens3a8p.apps.googleusercontent.com';

async function generateGoogleNoncePair() {
    if (!window.crypto?.getRandomValues || !window.crypto?.subtle) {
        return null;
    }

    const bytes = new Uint8Array(32);
    window.crypto.getRandomValues(bytes);
    const rawNonce = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

    const encoded = new TextEncoder().encode(rawNonce);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', encoded);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashedNonce = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

    return { rawNonce, hashedNonce };
}

const ACCORD_TERMS_VERSION = '2026-11';

async function ensureUserProfileRow(client, user, overrideFullName = '', overrideHandle = '', termsAccepted = false) {
    if (!client || !user?.id) return null;

    try {
        const { data: existing, error: selectErr } = await client
            .from('profiles')
            .select('id, full_name, handle, account_type, upgrade_status, terms_accepted_at, terms_version')
            .eq('id', user.id)
            .maybeSingle();

        const rawHandle = overrideHandle || user.user_metadata?.handle || '';
        const cleanHandle = rawHandle
            ? '@' + String(rawHandle).trim().toLowerCase().replace(/^@+/, '').replace(/[^a-z0-9_]/g, '')
            : '';
        const validHandle = /^@[a-z0-9_]{3,30}$/.test(cleanHandle) ? cleanHandle : null;
        const acceptedAt = (termsAccepted || user.user_metadata?.terms_accepted_at)
            ? (user.user_metadata?.terms_accepted_at || new Date().toISOString())
            : null;

        if (selectErr || existing) {
            if (existing) {
                const updates = {};
                if (!existing.handle && validHandle) updates.handle = validHandle;
                if (!existing.terms_accepted_at && acceptedAt) {
                    updates.terms_accepted_at = acceptedAt;
                    updates.terms_version = ACCORD_TERMS_VERSION;
                }
                if (Object.keys(updates).length > 0) {
                    await client.from('profiles').update(updates).eq('id', user.id);
                    Object.assign(existing, updates);
                }
            }
            return existing || null;
        }

        const resolvedName = (
            overrideFullName ||
            user.user_metadata?.full_name ||
            user.user_metadata?.name ||
            (user.email ? user.email.split('@')[0] : '') ||
            'Accord Member'
        ).trim();

        const newProfile = {
            id: user.id,
            email: user.email || '',
            full_name: resolvedName,
            handle: validHandle,
            account_type: 'normal_user',
            upgrade_status: 'none',
            ...(acceptedAt ? { terms_accepted_at: acceptedAt, terms_version: ACCORD_TERMS_VERSION } : {})
        };

        const { data: inserted, error: insertErr } = await client
            .from('profiles')
            .insert([newProfile])
            .select('id, full_name, handle, account_type, upgrade_status, terms_accepted_at, terms_version')
            .maybeSingle();

        if (insertErr) {
            // Ignore race-condition conflict if another tab/trigger created the row first
            return null;
        }

        return inserted || newProfile;
    } catch (err) {
        console.warn('Could not verify profile row:', err);
        return null;
    }
}

function getSafeNextUrl(defaultUrl = 'index.html') {
    try {
        const params = new URLSearchParams(window.location.search);
        const raw = (params.get('next') || '').trim();
        if (!raw) return defaultUrl;
        if (raw.startsWith('//') || raw.includes('\\') || /[\x00-\x1f\x7f]/.test(raw)) {
            return defaultUrl;
        }
        if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) {
            return defaultUrl;
        }
        const baseOrigin = (window.location?.origin && window.location.origin !== 'null')
            ? window.location.origin
            : 'https://accordarchives.com';
        const resolved = new URL(raw, baseOrigin);
        if (resolved.origin !== baseOrigin) {
            return defaultUrl;
        }
        return raw;
    } catch (e) {
        return defaultUrl;
    }
}

function loadGoogleGsiScript(timeoutMs = 5000) {
    if (window.google?.accounts?.id) {
        return Promise.resolve(true);
    }
    if (window.__accordGsiLoadPromise) {
        return window.__accordGsiLoadPromise;
    }

    window.__accordGsiLoadPromise = new Promise((resolve) => {
        let settled = false;
        const finish = (ok) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (!ok) window.__accordGsiLoadPromise = null;
            resolve(ok);
        };

        const timer = setTimeout(() => finish(false), timeoutMs);

        const existing = document.querySelector('script[data-accord-gsi="true"], script[src*="accounts.google.com/gsi/client"]');
        if (existing) {
            if (window.google?.accounts?.id) {
                finish(true);
                return;
            }
            existing.addEventListener('load', () => finish(Boolean(window.google?.accounts?.id)), { once: true });
            existing.addEventListener('error', () => finish(false), { once: true });
            return;
        }

        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        script.dataset.accordGsi = 'true';
        script.onload = () => finish(Boolean(window.google?.accounts?.id));
        script.onerror = () => finish(false);
        document.head.appendChild(script);
    });

    return window.__accordGsiLoadPromise;
}

async function triggerAccordGoogleOAuthFallback(redirectTo, onError) {
    const client = window.supabaseClient;
    if (!client) {
        if (typeof onError === 'function') onError('Authentication client is not ready.');
        return;
    }

    const { error } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: redirectTo || `${window.location.origin}/index.html`,
            queryParams: { prompt: 'select_account' }
        }
    });

    if (error && typeof onError === 'function') {
        onError(error.message);
    }
}

async function mountAccordGoogleSignIn(options = {}) {
    const {
        containerId = 'google-gsi-container',
        fallbackBtnId = 'google-fallback-btn',
        fallbackLinkId = 'google-fallback-link',
        redirectTo,
        onSuccess,
        onError
    } = options;

    const container = document.getElementById(containerId);
    const fallbackBtn = document.getElementById(fallbackBtnId);
    const fallbackLink = document.getElementById(fallbackLinkId);

    const showFallbackOnly = () => {
        if (container) container.classList.add('hidden');
        if (fallbackLink) fallbackLink.classList.add('hidden');
        if (fallbackBtn) fallbackBtn.classList.remove('hidden');
    };

    if (!container) return false;

    try {
        const [gsiReady, initialPair] = await Promise.all([
            loadGoogleGsiScript(5000),
            generateGoogleNoncePair()
        ]);

        if (!gsiReady || !initialPair || !window.google?.accounts?.id) {
            showFallbackOnly();
            return false;
        }

        let currentPair = initialPair;

        const initGoogle = (pair) => {
            window.google.accounts.id.initialize({
                client_id: ACCORD_GOOGLE_CLIENT_ID,
                nonce: pair.hashedNonce,
                ux_mode: 'popup',
                auto_select: false,
                cancel_on_tap_outside: true,
                callback: async (response) => {
                    const client = window.supabaseClient;
                    if (!client) {
                        if (typeof onError === 'function') onError('Authentication client is not ready.');
                        return;
                    }

                    const usedRawNonce = currentPair.rawNonce;
                    const nextPair = await generateGoogleNoncePair();
                    if (nextPair) {
                        currentPair = nextPair;
                        initGoogle(nextPair);
                    }

                    if (!response?.credential) {
                        if (typeof onError === 'function') onError('Google sign-in was canceled or returned no credential.');
                        return;
                    }

                    const { data, error } = await client.auth.signInWithIdToken({
                        provider: 'google',
                        token: response.credential,
                        nonce: usedRawNonce
                    });

                    if (error) {
                        if (typeof onError === 'function') onError(error.message || 'Google sign-in failed.');
                        return;
                    }

                    await ensureUserProfileRow(client, data?.user);

                    if (typeof onSuccess === 'function') {
                        onSuccess(data);
                    }
                }
            });
        };

        initGoogle(currentPair);

        container.classList.remove('hidden');
        container.innerHTML = '';
        const measuredWidth = Math.floor(container.getBoundingClientRect().width || container.parentElement?.getBoundingClientRect().width || 340);
        const buttonWidth = Math.min(Math.max(measuredWidth, 240), 400);

        window.google.accounts.id.renderButton(container, {
            type: 'standard',
            theme: 'outline',
            size: 'large',
            text: 'continue_with',
            shape: 'rectangular',
            width: buttonWidth
        });

        if (fallbackBtn) fallbackBtn.classList.add('hidden');
        if (fallbackLink) {
            fallbackLink.classList.remove('hidden');
            fallbackLink.onclick = (e) => {
                e.preventDefault();
                triggerAccordGoogleOAuthFallback(redirectTo, onError);
            };
        }

        return true;
    } catch (err) {
        console.warn('Google Identity Services setup failed; using OAuth redirect fallback:', err);
        showFallbackOnly();
        return false;
    }
}

window.ACCORD_GOOGLE_CLIENT_ID = ACCORD_GOOGLE_CLIENT_ID;
window.generateGoogleNoncePair = generateGoogleNoncePair;
window.ensureUserProfileRow = ensureUserProfileRow;
window.getSafeNextUrl = getSafeNextUrl;
window.triggerAccordGoogleOAuthFallback = triggerAccordGoogleOAuthFallback;
window.mountAccordGoogleSignIn = mountAccordGoogleSignIn;
