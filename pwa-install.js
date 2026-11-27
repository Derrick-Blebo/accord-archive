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
    if (isStandalone) return;

    var path = (window.location.pathname || '').toLowerCase();
    if (path.indexOf('admin') !== -1) return;

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
