/**
 * Accord Archive — PWA Service Worker Registration & iOS Home Screen Install Prompt
 */
(function () {
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', function () {
            navigator.serviceWorker.register('/sw.js').catch(function () {
                // Ignore registration failures in restricted/private contexts
            });
        });
    }

    var isStandalone = window.navigator.standalone === true ||
        (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    var path = (window.location.pathname || '').toLowerCase();
    var isAdminPath = path.indexOf('admin') !== -1;
    var previewSplash = /[?&]splash=1\b/.test(window.location.search || '');

    if ((isStandalone || previewSplash) && !isAdminPath) {
        var SPLASH_SESSION_KEY = 'accord_splash_shown';
        var alreadyShown = false;
        if (!previewSplash) {
            try {
                alreadyShown = sessionStorage.getItem(SPLASH_SESSION_KEY) === '1';
                if (!alreadyShown) {
                    sessionStorage.setItem(SPLASH_SESSION_KEY, '1');
                }
            } catch (e) {
                // Ignore storage errors
            }
        }

        if (!alreadyShown) {
            showSoftSplash();
        }
    }

    function showSoftSplash() {
        if (document.getElementById('accord-pwa-splash')) return;

        var style = document.createElement('style');
        style.id = 'accord-pwa-splash-style';
        style.textContent = [
            '@keyframes accordSplashHalo {',
            '  0% { opacity: 0; transform: scale(0.75); }',
            '  45% { opacity: 0.65; transform: scale(1.12); }',
            '  100% { opacity: 0.25; transform: scale(1.24); }',
            '}',
            '@keyframes accordSplashLogo {',
            '  0% { opacity: 0; transform: scale(0.84) translateY(6px); }',
            '  100% { opacity: 1; transform: scale(1) translateY(0); }',
            '}',
            '@keyframes accordSplashWordmark {',
            '  0% { opacity: 0; transform: translateY(8px); }',
            '  100% { opacity: 1; transform: translateY(0); }',
            '}',
            '@media (prefers-reduced-motion: reduce) {',
            '  #accord-pwa-splash-halo { animation: none !important; opacity: 0.25 !important; }',
            '  #accord-pwa-splash-logo { animation: none !important; opacity: 1 !important; transform: none !important; }',
            '  #accord-pwa-splash-wordmark { animation: none !important; opacity: 1 !important; transform: none !important; }',
            '}'
        ].join('\n');

        var splash = document.createElement('div');
        splash.id = 'accord-pwa-splash';
        splash.setAttribute('aria-hidden', 'true');
        splash.style.cssText = [
            'position:fixed',
            'inset:0',
            'z-index:2147483647',
            'display:flex',
            'flex-direction:column',
            'align-items:center',
            'justify-content:center',
            'background:radial-gradient(circle at 50% 44%, rgba(0,119,255,0.08) 0%, rgba(248,250,252,0) 58%), #F8FAFC',
            'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)',
            'transition:opacity 420ms cubic-bezier(0.22, 1, 0.36, 1), transform 420ms cubic-bezier(0.22, 1, 0.36, 1)',
            'opacity:1',
            'transform:scale(1)'
        ].join(';');

        splash.innerHTML =
            '<div style="position:relative;width:88px;height:88px;display:flex;align-items:center;justify-content:center;">' +
                '<div id="accord-pwa-splash-halo" style="position:absolute;inset:-20px;border-radius:999px;background:radial-gradient(circle, rgba(0,119,255,0.22) 0%, rgba(0,119,255,0) 70%);opacity:0;animation:accordSplashHalo 1.25s cubic-bezier(0.22, 1, 0.36, 1) forwards;"></div>' +
                '<svg id="accord-pwa-splash-logo" xmlns="http://www.w3.org/2000/svg" viewBox="-3.45 -2.4 512 512" style="position:relative;width:84px;height:84px;border-radius:20px;box-shadow:0 14px 34px rgba(0,119,255,0.24), 0 4px 12px rgba(15,23,42,0.06);opacity:0;animation:accordSplashLogo 620ms cubic-bezier(0.22, 1, 0.36, 1) forwards;">' +
                    '<rect fill="#0077FF" x="-3.45" y="-2.4" width="512" height="512" rx="109.87"/>' +
                    '<path fill="#FFFFFF" d="M231,293.71h-76.1l-15,35.22H110.79l62.78-139.49a21.52,21.52,0,0,1,19.63-12.7h0a21.53,21.53,0,0,1,19.63,12.67l63,139.52H246.24Zm-9.35-22.18L193,205,164.5,271.53Z"/>' +
                    '<path fill="#FFFFFF" d="M281.9,270.88c0-34.78,26.09-59.35,62.83-59.35,22.61,0,40.66,9.35,49.57,27l-20.87,12.17c-7-11.08-17.39-16.09-28.92-16.09-20,0-35.22,13.92-35.22,36.31,0,22.61,15.22,36.31,35.22,36.31,11.53,0,22-5,28.92-16.09l7.26,4.23c8.14,4.76,9.42,16.24,2.25,22.36-9.7,8.29-22.91,12.76-38.21,12.76C308,330.45,281.9,305.67,281.9,270.88Z"/>' +
                '</svg>' +
            '</div>' +
            '<div id="accord-pwa-splash-wordmark" style="margin-top:16px;font-family:Inter,-apple-system,BlinkMacSystemFont,sans-serif;font-size:20px;font-weight:700;letter-spacing:-0.02em;color:#0F172A;opacity:0;animation:accordSplashWordmark 520ms cubic-bezier(0.22, 1, 0.36, 1) 180ms forwards;">Accord</div>';

        var mountTarget = document.body || document.documentElement;
        (document.head || document.documentElement).appendChild(style);
        mountTarget.appendChild(splash);

        var dismissed = false;
        var minDelayDone = false;
        var domReady = document.readyState !== 'loading';

        function tryDismiss() {
            if (dismissed || !minDelayDone || !domReady) return;
            dismissed = true;
            splash.style.pointerEvents = 'none';
            splash.style.opacity = '0';
            splash.style.transform = 'scale(1.02)';
            setTimeout(function () {
                if (splash.parentNode) splash.parentNode.removeChild(splash);
                if (style.parentNode) style.parentNode.removeChild(style);
            }, 440);
        }

        if (!domReady) {
            document.addEventListener('DOMContentLoaded', function () {
                domReady = true;
                tryDismiss();
            });
        }

        setTimeout(function () {
            minDelayDone = true;
            tryDismiss();
        }, 1050);

        setTimeout(function () {
            domReady = true;
            minDelayDone = true;
            tryDismiss();
        }, 2200);
    }

    if (isStandalone) return;
    if (isAdminPath) return;

    var ua = navigator.userAgent || '';
    var isIOS = /iPhone|iPad|iPod/i.test(ua) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (!isIOS) return;

    var DISMISS_KEY = 'accord_ios_install_dismissed_at';
    try {
        var dismissedAt = Number(localStorage.getItem(DISMISS_KEY) || 0);
        if (dismissedAt && (Date.now() - dismissedAt) < 14 * 24 * 60 * 60 * 1000) {
            return;
        }
    } catch (e) {
        // Ignore storage errors
    }

    var isOtherIOSBrowser = /CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);

    function showBanner() {
        if (document.getElementById('accord-ios-install-banner')) return;

        var banner = document.createElement('div');
        banner.id = 'accord-ios-install-banner';
        banner.setAttribute('role', 'dialog');
        banner.setAttribute('aria-label', 'Install Accord on iPhone');
        banner.style.cssText = [
            'position:fixed',
            'left:12px',
            'right:12px',
            'bottom:14px',
            'z-index:9999',
            'max-width:420px',
            'margin:0 auto',
            'background:#ffffff',
            'color:#0F172A',
            'border:1px solid #E2E8F0',
            'border-radius:18px',
            'box-shadow:0 16px 40px rgba(15,23,42,0.16)',
            'padding:14px 16px',
            'font-family:Inter,-apple-system,BlinkMacSystemFont,sans-serif',
            'box-sizing:border-box',
            'transition:transform 0.25s ease, opacity 0.25s ease',
            'transform:translateY(16px)',
            'opacity:0'
        ].join(';');

        var shareIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0077FF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-3px;margin:0 2px;"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>';
        var stepText = isOtherIOSBrowser
            ? 'Open in <strong>Safari</strong>, tap ' + shareIcon + ' <strong>Share</strong>, then <strong>Add to Home Screen</strong>.'
            : 'Tap ' + shareIcon + ' <strong>Share</strong> below, then tap <strong>Add to Home Screen</strong>.';

        banner.innerHTML =
            '<div style="display:flex;align-items:flex-start;gap:12px;">' +
                '<img src="/assets/icon-180.png" alt="Accord" style="width:44px;height:44px;border-radius:11px;flex-shrink:0;box-shadow:0 2px 8px rgba(0,119,255,0.22);" />' +
                '<div style="flex:1;min-width:0;">' +
                    '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">' +
                        '<div style="font-size:14px;font-weight:700;line-height:1.25;color:#0F172A;">Install Accord App</div>' +
                        '<button type="button" id="accord-ios-install-close" aria-label="Dismiss install prompt" style="background:#F1F5F9;border:none;color:#64748B;width:26px;height:26px;border-radius:999px;font-size:16px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;">&times;</button>' +
                    '</div>' +
                    '<div style="font-size:12px;color:#475569;margin-top:3px;line-height:1.4;">' + stepText + '</div>' +
                '</div>' +
            '</div>';

        document.body.appendChild(banner);
        requestAnimationFrame(function () {
            banner.style.transform = 'translateY(0)';
            banner.style.opacity = '1';
        });

        var closeBtn = document.getElementById('accord-ios-install-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', function () {
                try {
                    localStorage.setItem(DISMISS_KEY, String(Date.now()));
                } catch (e) {}
                banner.style.transform = 'translateY(16px)';
                banner.style.opacity = '0';
                setTimeout(function () {
                    if (banner.parentNode) banner.parentNode.removeChild(banner);
                }, 250);
            });
        }
    }

    document.addEventListener('DOMContentLoaded', function () {
        setTimeout(showBanner, 2200);
    });
})();
