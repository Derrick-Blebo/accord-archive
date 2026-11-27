/**
 * Accord Archive - Unified Global Header Component
 * Automatically injects the navbar, handles auth state, notifications, avatar dropdown, and bookmark counts.
 */

let globalHeaderUser = null;
let globalHeaderProfile = null;
let globalManagedPages = [];
let globalActiveContext = {
    isSwitched: false,
    userId: null,
    activeProfileId: null,
    activeProfile: null,
    personalProfile: null,
    managedPages: [],
    permissions: {
        can_post: true,
        can_edit_delete_posts: true,
        can_post_books: true,
        can_promote: true,
        can_edit_profile: true,
        can_withdraw_funds: true
    }
};
let _accordContextReadyResolve = null;
let _accordContextReadyPromise = new Promise((resolve) => {
    _accordContextReadyResolve = resolve;
});
let globalNotifications = [];
let globalHeaderAuthSubscribed = false;
let globalHeaderAuthRequestId = 0;
let globalRealtimeChannel = null;

function normalizeAccordPagePerms(rawPerms, role = 'admin') {
    const p = rawPerms && typeof rawPerms === 'object' ? rawPerms : {};
    return {
        can_post: p.can_post !== undefined ? Boolean(p.can_post) : true,
        can_edit_delete_posts: p.can_edit_delete_posts !== undefined ? Boolean(p.can_edit_delete_posts) : (role === 'admin'),
        can_post_books: Boolean(p.can_post_books),
        can_promote: Boolean(p.can_promote),
        can_edit_profile: Boolean(p.can_edit_profile),
        can_withdraw_funds: Boolean(p.can_withdraw_funds)
    };
}

function getActiveProfileStorageKey(userId) {
    return userId ? `accord_active_profile_id:${userId}` : null;
}

window.getAccordActiveContext = function () {
    return globalActiveContext;
};

window.waitForAccordActiveContext = function () {
    return _accordContextReadyPromise;
};

window.hasActivePagePermission = function (permKey) {
    if (!globalActiveContext.isSwitched) return true;
    return Boolean(globalActiveContext.permissions && globalActiveContext.permissions[permKey]);
};

window.switchAccordProfile = function (targetProfileId) {
    if (!globalHeaderUser) return;
    const key = getActiveProfileStorageKey(globalHeaderUser.id);
    const target = String(targetProfileId || '').trim();
    if (!target || target === String(globalHeaderUser.id)) {
        if (key) localStorage.removeItem(key);
    } else {
        if (key) localStorage.setItem(key, target);
    }
    const pageName = window.location.pathname.split('/').pop() || 'index.html';
    if (pageName.includes('author.html')) {
        window.location.href = (!target || target === String(globalHeaderUser.id))
            ? 'author.html'
            : `author.html?page=${encodeURIComponent(target)}`;
        return;
    }
    window.location.reload();
};

function isVerifiedMinistryProfile(profile) {
    if (!profile) return false;
    if (profile.upgrade_status === 'revoked') return false;
    return profile.account_type === 'ministry_minister' || profile.upgrade_status === 'approved';
}

function getVerifiedCheckmarkSvg(className = 'w-full h-full block') {
    return `
        <svg viewBox="0 0 24 24" class="${className}" aria-hidden="true" focusable="false">
            <path d="M12.00 2.80 Q15.13 0.31 16.60 4.03 Q20.56 3.44 19.97 7.40 Q23.69 8.87 21.20 12.00 Q23.69 15.13 19.97 16.60 Q20.56 20.56 16.60 19.97 Q15.13 23.69 12.00 21.20 Q8.87 23.69 7.40 19.97 Q3.44 20.56 4.03 16.60 Q0.31 15.13 2.80 12.00 Q0.31 8.87 4.03 7.40 Q3.44 3.44 7.40 4.03 Q8.87 0.31 12.00 2.80 Z" fill="#1D9BF0" stroke="#FFFFFF" stroke-width="1.4" stroke-linejoin="round" paint-order="stroke" />
            <path d="M8.5 12.3l2.3 2.3 4.8-5.1" fill="none" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
    `;
}

(function () {
    // Ensure Supabase client is available globally inside header.js
    const SUPABASE_URL = 'https://mzblgajftvyyosyrawcx.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16YmxnYWpmdHZ5eW9zeXJhd2N4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ0NzYxNTQsImV4cCI6MjExMDA1MjE1NH0.Xs9MeioNfqb5DzxDYP-9ZqfywBeOlUreAY-yKrcBmJM';

    if (!window.supabaseClient && window.supabase) {
        window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }

    const headerContainer = document.getElementById('accord-header');
    if (!headerContainer) return;

    headerContainer.innerHTML = `
        <header class="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-slate-200 shadow-sm">
            <!-- Responsive Header: Flex on mobile, 3-Column Grid on md+ -->
            <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-16 md:h-20 flex items-center justify-between md:grid md:grid-cols-[minmax(200px,1fr)_auto_minmax(200px,1fr)] gap-2 sm:gap-4">
                
                <!-- Left: Brand Logo -->
                <a href="index.html" class="flex items-center group justify-self-start min-w-0 shrink-0" aria-label="Accord — Official Archive & Library">
                    <img src="assets/new-accord-logo.svg" alt="Accord — Official Archive & Library" class="h-8 sm:h-10 w-auto group-hover:scale-[1.02] transition-transform" />
                </a>

                <!-- Center: Navigation Links -->
                <nav class="hidden md:flex items-center justify-center space-x-7 justify-self-center">
                    <a href="index.html" id="nav-library" class="text-sm font-semibold text-accord-slate hover:text-accord-blue transition-colors">Digital Library</a>
                    <a href="feed.html" id="nav-feed" class="text-sm font-semibold text-accord-slate hover:text-accord-blue transition-colors">Feed</a>
                    <a href="music.html" id="nav-music" class="text-sm font-semibold text-accord-slate hover:text-accord-blue transition-colors">Music</a>
                    <a href="saved.html" id="nav-saved" class="relative text-sm font-semibold text-accord-slate hover:text-accord-blue transition-colors flex items-center space-x-1.5" title="Saved">
                        <i class="fa-solid fa-bookmark text-accord-gold"></i>
                        <span>Saved</span>
                        <span id="global-bookmark-badge" class="bg-accord-gold text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">0</span>
                    </a>
                </nav>

                <!-- Right: Notifications, Auth / Profile Dropdown -->
                <div class="flex items-center space-x-1.5 sm:space-x-3 justify-self-end shrink-0">
                    <div id="auth-area" class="flex items-center space-x-1.5 sm:space-x-3 md:min-w-[140px] justify-end">
                        <!-- Dynamically injected -->
                    </div>
                </div>
            </div>

            <!-- Facebook-style Mobile Icon Navigation Bar -->
            <nav class="md:hidden grid grid-cols-4 border-t border-slate-100 bg-white/95" aria-label="Mobile Navigation">
                <a href="index.html" id="mobile-nav-library" class="h-11 flex items-center justify-center text-slate-500 hover:text-accord-blue border-b-2 border-transparent transition-colors" aria-label="Digital Library" title="Digital Library">
                    <i class="fa-solid fa-book-open text-lg"></i>
                </a>
                <a href="feed.html" id="mobile-nav-feed" class="h-11 flex items-center justify-center text-slate-500 hover:text-accord-blue border-b-2 border-transparent transition-colors" aria-label="Feed" title="Feed">
                    <i class="fa-solid fa-house text-lg"></i>
                </a>
                <a href="music.html" id="mobile-nav-music" class="h-11 flex items-center justify-center text-slate-500 hover:text-accord-blue border-b-2 border-transparent transition-colors" aria-label="Music" title="Music">
                    <i class="fa-solid fa-music text-lg"></i>
                </a>
                <a href="saved.html" id="mobile-nav-saved" class="relative h-11 flex items-center justify-center text-slate-500 hover:text-accord-blue border-b-2 border-transparent transition-colors" aria-label="Saved" title="Saved">
                    <span class="relative inline-flex items-center justify-center">
                        <i class="fa-solid fa-bookmark text-lg text-accord-gold"></i>
                        <span id="mobile-bookmark-badge" class="absolute -top-1.5 -right-2.5 min-w-[16px] h-[16px] px-1 bg-accord-gold text-white text-[9px] font-bold rounded-full flex items-center justify-center ring-2 ring-white">0</span>
                    </span>
                </a>
            </nav>

            <!-- Persistent "Acting As" Context Bar (shown when switched into a Verified Page) -->
            <div id="accord-acting-bar" class="hidden border-t border-blue-200/80 bg-gradient-to-r from-blue-50 via-indigo-50/80 to-blue-50">
                <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-2 flex items-center justify-between gap-3">
                    <div class="flex items-center gap-2.5 min-w-0">
                        <span id="accord-acting-avatar" class="w-6 h-6 rounded-full bg-accord-blue text-white text-[10px] font-bold flex items-center justify-center overflow-hidden shrink-0 ring-1 ring-blue-300"></span>
                        <p class="text-xs text-accord-slate truncate">
                            <span class="font-semibold text-accord-muted">Acting as</span>
                            <strong id="accord-acting-name" class="font-extrabold text-accord-slate"></strong>
                            <span id="accord-acting-handle" class="text-accord-blue font-semibold"></span>
                        </p>
                    </div>
                    <button type="button" id="accord-acting-switch-back" class="shrink-0 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white hover:bg-slate-100 text-accord-slate border border-slate-200 text-[11px] font-bold shadow-sm transition-colors cursor-pointer">
                        <i class="fa-solid fa-arrow-right-arrow-left text-accord-blue text-[10px]"></i>
                        <span>Switch to Personal</span>
                    </button>
                </div>
            </div>
        </header>
    `;

    highlightActiveNavLink();
    initGlobalHeaderAuth();
    updateGlobalBookmarks();
    window.addEventListener('storage', updateGlobalBookmarks);
})();

function highlightActiveNavLink() {
    const path = window.location.pathname.split('/').pop() || 'index.html';
    if (path.includes('index') || path.includes('book')) {
        setActive('nav-library');
        setMobileActive('mobile-nav-library');
    } else if (path.includes('feed') || path.includes('ministry') || path.includes('post') || path.includes('user')) {
        setActive('nav-feed');
        setMobileActive('mobile-nav-feed');
    } else if (path.includes('music') || path.includes('polls')) {
        setActive('nav-music');
        setMobileActive('mobile-nav-music');
    } else if (path.includes('saved')) {
        setActive('nav-saved');
        setMobileActive('mobile-nav-saved');
    }
}

function setActive(id) {
    const el = document.getElementById(id);
    if (el) {
        el.className = 'text-sm font-bold text-accord-blue transition-colors';
    }
}

function setMobileActive(id) {
    const el = document.getElementById(id);
    if (el) {
        el.className = 'relative h-11 flex items-center justify-center text-accord-blue border-b-[2.5px] border-accord-blue transition-colors';
    }
}

async function initGlobalHeaderAuth() {
    const requestId = ++globalHeaderAuthRequestId;
    try {
        const client = window.supabaseClient;
        if (!client) return;

        window.refreshGlobalHeaderAuth = initGlobalHeaderAuth;

        if (!globalHeaderAuthSubscribed && client.auth?.onAuthStateChange) {
            globalHeaderAuthSubscribed = true;
            client.auth.onAuthStateChange((event) => {
                if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
                    initGlobalHeaderAuth();
                }
            });
        }

        const { data: { session } } = await client.auth.getSession();
        if (requestId !== globalHeaderAuthRequestId) return;

        const user = session?.user || null;
        globalHeaderUser = user;

        const authArea = document.getElementById('auth-area');
        if (!authArea) return;

        const adminEmails = ['accordmedia1@gmail.com', 'rickblebs1@gmail.com'];
        const userEmailLower = (user?.email || '').toLowerCase();
        const isAdmin = Boolean(user && adminEmails.includes(userEmailLower));
        const isSuperadmin = userEmailLower === 'accordmedia1@gmail.com';

        const pageName = window.location.pathname.split('/').pop() || 'index.html';
        const currentPage = pageName + window.location.search;
        const isSignInPage = pageName.toLowerCase().includes('signin');
        const loginUrl = isSignInPage ? 'signin.html' : `signin.html?next=${encodeURIComponent(currentPage)}`;
        const signupUrl = isSignInPage ? 'signin.html?mode=signup' : `signin.html?mode=signup&next=${encodeURIComponent(currentPage)}`;

        if (!user) {
            globalHeaderProfile = null;
            globalManagedPages = [];
            globalActiveContext = {
                isSwitched: false,
                userId: null,
                activeProfileId: null,
                activeProfile: null,
                personalProfile: null,
                managedPages: [],
                permissions: normalizeAccordPagePerms({}, 'admin')
            };
            document.getElementById('accord-acting-bar')?.classList.add('hidden');
            if (_accordContextReadyResolve) _accordContextReadyResolve(globalActiveContext);

            authArea.innerHTML = `
                <a href="${loginUrl}" class="text-xs sm:text-sm font-semibold text-accord-slate hover:text-accord-blue px-2 py-2 transition-colors">
                    Log in
                </a>
                <a href="${signupUrl}" class="inline-flex items-center space-x-1.5 bg-accord-blue hover:bg-accord-darkBlue text-white text-xs sm:text-sm font-semibold px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl shadow-lg shadow-blue-500/20 transition-all">
                    <span>Sign up</span>
                </a>
            `;
        } else {
            let profile = null;
            let managedRows = [];
            try {
                const [profRes, adminRes] = await Promise.all([
                    client
                        .from('profiles')
                        .select('id, full_name, handle, avatar_url, account_type, upgrade_status, terms_accepted_at, warning_count, country')
                        .eq('id', user.id)
                        .maybeSingle(),
                    client
                        .from('page_admins')
                        .select('id, page_id, role, permissions, profiles!page_admins_page_id_fkey(id, full_name, handle, avatar_url, account_type, upgrade_status)')
                        .eq('admin_user_id', user.id)
                ]);
                if (!profRes.error) profile = profRes.data || null;
                if (!adminRes.error) {
                    managedRows = (adminRes.data || [])
                        .filter(r => r.profiles && isVerifiedMinistryProfile(r.profiles))
                        .map(r => ({
                            rowId: r.id,
                            pageId: String(r.page_id),
                            role: r.role || 'editor',
                            permissions: normalizeAccordPagePerms(r.permissions, r.role),
                            profile: r.profiles
                        }));
                }
            } catch (profileErr) {
                console.warn('Could not load header profile status:', profileErr);
            }
            if (requestId !== globalHeaderAuthRequestId) return;

            globalHeaderProfile = profile;
            globalManagedPages = managedRows;

            const storageKey = getActiveProfileStorageKey(user.id);
            const savedTargetId = storageKey ? localStorage.getItem(storageKey) : null;
            const activeManaged = savedTargetId
                ? managedRows.find(m => String(m.pageId) === String(savedTargetId)) || null
                : null;

            if (savedTargetId && !activeManaged && storageKey) {
                localStorage.removeItem(storageKey);
            }

            const isSwitched = Boolean(activeManaged);
            const activeProfile = isSwitched ? activeManaged.profile : profile;
            const activeProfileId = isSwitched ? activeManaged.pageId : String(user.id);
            const activePermissions = isSwitched
                ? activeManaged.permissions
                : {
                    can_post: true,
                    can_edit_delete_posts: true,
                    can_post_books: true,
                    can_promote: true,
                    can_edit_profile: true,
                    can_withdraw_funds: true
                };

            globalActiveContext = {
                isSwitched,
                userId: String(user.id),
                activeProfileId,
                activeProfile,
                personalProfile: profile,
                managedPages: managedRows,
                permissions: activePermissions
            };
            if (_accordContextReadyResolve) _accordContextReadyResolve(globalActiveContext);

            // Sync persistent "Acting As" bar
            const actingBar = document.getElementById('accord-acting-bar');
            if (actingBar) {
                if (isSwitched && activeProfile) {
                    const actingAvatar = document.getElementById('accord-acting-avatar');
                    const actingName = document.getElementById('accord-acting-name');
                    const actingHandle = document.getElementById('accord-acting-handle');
                    const switchBackBtn = document.getElementById('accord-acting-switch-back');
                    if (actingAvatar) {
                        actingAvatar.innerHTML = activeProfile.avatar_url
                            ? `<img src="${escapeHeaderHtml(activeProfile.avatar_url)}" class="w-full h-full object-cover" alt="">`
                            : escapeHeaderHtml((activeProfile.full_name || 'P').charAt(0).toUpperCase());
                    }
                    if (actingName) actingName.textContent = activeProfile.full_name || 'Verified Page';
                    if (actingHandle) actingHandle.textContent = activeProfile.handle ? ` (${activeProfile.handle})` : '';
                    if (switchBackBtn) {
                        switchBackBtn.onclick = () => window.switchAccordProfile(user.id);
                    }
                    actingBar.classList.remove('hidden');
                } else {
                    actingBar.classList.add('hidden');
                }
            }

            const isVerifiedMinistry = isVerifiedMinistryProfile(activeProfile);
            const email = user.email || 'user@accord.com';
            const personalAvatarUrl = profile?.avatar_url || user.user_metadata?.avatar_url || user.user_metadata?.picture || null;
            const personalInitial = (profile?.full_name || email).charAt(0).toUpperCase();
            const activeAvatarUrl = isSwitched
                ? (activeProfile?.avatar_url || null)
                : personalAvatarUrl;
            const activeInitial = isSwitched
                ? (activeProfile?.full_name || 'P').charAt(0).toUpperCase()
                : personalInitial;

            const avatarContent = activeAvatarUrl
                ? `<img src="${escapeHeaderHtml(activeAvatarUrl)}" class="w-full h-full object-cover" alt="Profile">`
                : `<span class="text-white font-bold text-sm">${escapeHeaderHtml(activeInitial)}</span>`;

            const switchedMiniBadgeHtml = isSwitched ? `
                <span title="Managed by ${escapeHeaderHtml(profile?.full_name || email)}" class="absolute -top-1 -left-1 w-4 h-4 rounded-full bg-slate-700 text-white text-[8px] font-bold flex items-center justify-center ring-2 ring-white overflow-hidden pointer-events-none">
                    ${personalAvatarUrl ? `<img src="${escapeHeaderHtml(personalAvatarUrl)}" class="w-full h-full object-cover" alt="">` : escapeHeaderHtml(personalInitial)}
                </span>
            ` : '';

            const roleLabel = isSwitched
                ? `Acting as Page · Managed by ${escapeHeaderHtml(profile?.handle || profile?.full_name || 'You')}`
                : (isAdmin
                    ? (isVerifiedMinistry ? 'Administrator · Verified Ministry' : 'Administrator')
                    : (isVerifiedMinistry ? 'Verified Ministry / Minister' : 'Authenticated Member'));

            const superadminLinkHtml = isSuperadmin ? `
                <a href="superadmin.html" class="flex items-center space-x-3 px-4 py-2.5 text-xs font-semibold text-accord-slate hover:bg-slate-50 transition-colors">
                    <i class="fa-solid fa-crown text-accord-gold w-4"></i>
                    <span>Superadmin Portal</span>
                </a>
            ` : '';

            const adminLinkHtml = isAdmin ? `
                <a href="feed-admin.html" class="flex items-center space-x-3 px-4 py-2.5 text-xs font-semibold text-accord-slate hover:bg-slate-50 transition-colors">
                    <i class="fa-solid fa-shield-halved text-emerald-600 w-4"></i>
                    <span>Admin Moderation</span>
                </a>
                ${superadminLinkHtml}
            ` : '';

            const switcherSectionHtml = managedRows.length > 0 ? `
                <div class="px-3 py-2 border-b border-slate-100 bg-slate-50/70">
                    <p class="px-1 pb-1.5 text-[10px] font-extrabold uppercase tracking-wider text-accord-muted flex items-center justify-between">
                        <span>Switch Profile</span>
                        <i class="fa-solid fa-arrow-right-arrow-left text-accord-blue"></i>
                    </p>
                    <div class="space-y-1 max-h-44 overflow-y-auto">
                        <button type="button" onclick="switchAccordProfile('${escapeHeaderHtml(user.id)}')" class="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-xl text-left transition-colors ${!isSwitched ? 'bg-blue-50 border border-blue-200/80' : 'hover:bg-white border border-transparent'}">
                            <span class="flex items-center gap-2 min-w-0">
                                <span class="w-6 h-6 rounded-full bg-accord-blue text-white text-[10px] font-bold flex items-center justify-center overflow-hidden shrink-0">
                                    ${personalAvatarUrl ? `<img src="${escapeHeaderHtml(personalAvatarUrl)}" class="w-full h-full object-cover" alt="">` : escapeHeaderHtml(personalInitial)}
                                </span>
                                <span class="min-w-0">
                                    <span class="block text-[11px] font-bold text-accord-slate truncate">${escapeHeaderHtml(profile?.full_name || 'Personal Account')}</span>
                                    <span class="block text-[10px] text-accord-muted truncate">${escapeHeaderHtml(profile?.handle || 'Personal Profile')}</span>
                                </span>
                            </span>
                            ${!isSwitched ? '<i class="fa-solid fa-circle-check text-accord-blue text-xs shrink-0"></i>' : ''}
                        </button>
                        ${managedRows.map(m => {
                            const mp = m.profile;
                            const isCurrent = isSwitched && String(activeProfileId) === String(m.pageId);
                            const mInitial = (mp.full_name || 'P').charAt(0).toUpperCase();
                            return `
                                <button type="button" onclick="switchAccordProfile('${escapeHeaderHtml(m.pageId)}')" class="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-xl text-left transition-colors ${isCurrent ? 'bg-blue-50 border border-blue-200/80' : 'hover:bg-white border border-transparent'}">
                                    <span class="flex items-center gap-2 min-w-0">
                                        <span class="w-6 h-6 rounded-full bg-indigo-600 text-white text-[10px] font-bold flex items-center justify-center overflow-hidden shrink-0">
                                            ${mp.avatar_url ? `<img src="${escapeHeaderHtml(mp.avatar_url)}" class="w-full h-full object-cover" alt="">` : escapeHeaderHtml(mInitial)}
                                        </span>
                                        <span class="min-w-0">
                                            <span class="block text-[11px] font-bold text-accord-slate truncate">${escapeHeaderHtml(mp.full_name || 'Verified Page')}</span>
                                            <span class="block text-[10px] text-accord-blue truncate">${escapeHeaderHtml(mp.handle || 'Verified Page')}</span>
                                        </span>
                                    </span>
                                    ${isCurrent ? '<i class="fa-solid fa-circle-check text-accord-blue text-xs shrink-0"></i>' : ''}
                                </button>
                            `;
                        }).join('')}
                    </div>
                </div>
            ` : '';

            const contextLinksHtml = isSwitched ? `
                <a href="user.html?id=${encodeURIComponent(activeProfileId)}" class="flex items-center space-x-3 px-4 py-2.5 text-xs font-semibold text-accord-slate hover:bg-slate-50 transition-colors">
                    <i class="fa-solid fa-id-badge text-accord-blue w-4"></i>
                    <span>Page Public Profile</span>
                </a>
                ${activePermissions.can_edit_profile ? `
                <a href="user.html?id=${encodeURIComponent(activeProfileId)}&edit=1" class="flex items-center space-x-3 px-4 py-2.5 text-xs font-semibold text-accord-slate hover:bg-slate-50 transition-colors">
                    <i class="fa-regular fa-pen-to-square text-accord-blue w-4"></i>
                    <span>Edit Page Profile</span>
                </a>` : ''}
                ${(activePermissions.can_post_books || activePermissions.can_withdraw_funds) ? `
                <a href="author.html?page=${encodeURIComponent(activeProfileId)}" class="flex items-center space-x-3 px-4 py-2.5 text-xs font-semibold text-accord-slate hover:bg-slate-50 transition-colors">
                    <i class="fa-solid fa-feather-pointed text-accord-gold w-4 text-center"></i>
                    <span>Page Books &amp; Earnings</span>
                </a>` : ''}
                ${activePermissions.can_promote ? `
                <a href="promote.html" class="flex items-center space-x-3 px-4 py-2.5 text-xs font-semibold text-accord-slate hover:bg-slate-50 transition-colors">
                    <i class="fa-solid fa-bullhorn text-accord-blue w-4 text-center"></i>
                    <span>Promote Page Content</span>
                </a>` : ''}
                <button type="button" onclick="switchAccordProfile('${escapeHeaderHtml(user.id)}')" class="w-full flex items-center space-x-3 px-4 py-2.5 text-xs font-bold text-accord-blue hover:bg-blue-50 transition-colors text-left">
                    <i class="fa-solid fa-arrow-right-arrow-left w-4"></i>
                    <span>Switch Back to Personal</span>
                </button>
                ${adminLinkHtml}
            ` : `
                <a href="user.html?id=${encodeURIComponent(user.id)}" class="flex items-center space-x-3 px-4 py-2.5 text-xs font-semibold text-accord-slate hover:bg-slate-50 transition-colors">
                    <i class="fa-solid fa-id-badge text-accord-blue w-4"></i>
                    <span>My Public Profile</span>
                </a>
                <a href="messages.html" class="flex items-center space-x-3 px-4 py-2.5 text-xs font-semibold text-accord-slate hover:bg-slate-50 transition-colors">
                    <i class="fa-regular fa-paper-plane text-accord-blue w-4"></i>
                    <span>Messages</span>
                </a>
                <a href="profile.html" class="flex items-center space-x-3 px-4 py-2.5 text-xs font-semibold text-accord-slate hover:bg-slate-50 transition-colors">
                    <i class="fa-regular fa-user text-accord-blue w-4"></i>
                    <span>Edit Profile</span>
                </a>
                <a href="author.html" class="flex items-center space-x-3 px-4 py-2.5 text-xs font-semibold text-accord-slate hover:bg-slate-50 transition-colors">
                    <i class="fa-solid fa-feather-pointed text-accord-gold w-4 text-center"></i>
                    <span>My Author Page</span>
                </a>
                <a href="promote.html" class="flex items-center space-x-3 px-4 py-2.5 text-xs font-semibold text-accord-slate hover:bg-slate-50 transition-colors">
                    <i class="fa-solid fa-bullhorn text-accord-blue w-4 text-center"></i>
                    <span>Promote / Advertise</span>
                </a>
                <a href="saved.html" class="flex items-center space-x-3 px-4 py-2.5 text-xs font-semibold text-accord-slate hover:bg-slate-50 transition-colors">
                    <i class="fa-solid fa-bookmark text-accord-gold w-4"></i>
                    <span>Saved Collections</span>
                </a>
                ${adminLinkHtml}
            `;

            authArea.innerHTML = `
                <!-- Messages Link -->
                <a href="messages.html" class="relative w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-slate-50 hover:bg-accord-lightBlue text-accord-slate hover:text-accord-blue border border-slate-200 flex items-center justify-center transition-all" aria-label="Messages" title="Messages">
                    <i class="fa-regular fa-paper-plane text-xs sm:text-sm"></i>
                    <span id="chat-unread-badge" class="hidden absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-accord-blue text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white">0</span>
                </a>

                <!-- Notification Bell Dropdown -->
                <div class="relative">
                    <button type="button" onclick="toggleNotificationsDropdown(event)" class="relative w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-slate-50 hover:bg-accord-lightBlue text-accord-slate hover:text-accord-blue border border-slate-200 flex items-center justify-center transition-all focus:outline-none cursor-pointer" aria-label="Notifications" title="Notifications">
                        <i class="fa-regular fa-bell text-sm sm:text-base"></i>
                        <span id="notif-unread-badge" class="hidden absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white">0</span>
                    </button>

                    <div id="notifications-dropdown" onclick="event.stopPropagation()" class="hidden fixed left-3 right-3 top-16 sm:top-auto sm:left-auto sm:right-0 sm:absolute sm:mt-3 sm:w-96 bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden z-50">
                        <div class="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
                            <span class="text-xs font-bold text-accord-slate">Notifications</span>
                            <button type="button" id="mark-all-read-btn" onclick="markAllNotificationsRead()" class="text-[11px] font-bold text-accord-blue hover:underline">
                                Mark all as read
                            </button>
                        </div>
                        <div id="notifications-list" class="max-h-96 overflow-y-auto divide-y divide-slate-100">
                            <div class="px-4 py-8 text-center text-xs text-accord-muted">Loading notifications...</div>
                        </div>
                    </div>
                </div>

                <!-- Profile Avatar Dropdown -->
                <div class="relative">
                    <button type="button" onclick="toggleProfileDropdown(event)" class="relative w-9 h-9 sm:w-11 sm:h-11 rounded-full bg-accord-blue ring-2 ring-accord-blue/25 hover:ring-accord-blue transition-all flex items-center justify-center focus:outline-none shadow-sm cursor-pointer" aria-label="Account menu">
                        <span class="w-full h-full rounded-full overflow-hidden flex items-center justify-center">
                            ${avatarContent}
                        </span>
                        ${switchedMiniBadgeHtml}
                        <span id="profile-verified-badge" title="Verified Ministry / Minister" aria-label="Verified Ministry / Minister" class="${isVerifiedMinistry ? '' : 'hidden'} absolute -bottom-0.5 -right-0.5 w-5 h-5 z-10 pointer-events-none select-none drop-shadow-sm">
                            ${getVerifiedCheckmarkSvg()}
                        </span>
                    </button>

                    <div id="profile-dropdown" class="hidden absolute right-0 mt-3 w-72 bg-white rounded-2xl shadow-2xl border border-slate-200 py-2 z-50">
                        <div class="px-4 py-3 border-b border-slate-100">
                            <p class="text-xs font-bold text-accord-slate truncate">${escapeHeaderHtml(activeProfile?.full_name || email)}</p>
                            ${activeProfile?.handle ? `<p class="text-[11px] font-semibold text-accord-blue truncate">${escapeHeaderHtml(activeProfile.handle)}</p>` : ''}
                            <p class="text-[10px] text-accord-muted truncate">${roleLabel}</p>
                        </div>
                        ${switcherSectionHtml}
                        <div class="py-1">
                            ${contextLinksHtml}
                        </div>
                        <div class="border-t border-slate-100 pt-1">
                            <button type="button" onclick="handleGlobalSignOut()" class="w-full flex items-center space-x-3 px-4 py-2.5 text-xs font-semibold text-red-600 hover:bg-red-50 transition-colors text-left">
                                <i class="fa-solid fa-arrow-right-from-bracket w-4"></i>
                                <span>Log out</span>
                            </button>
                        </div>
                    </div>
                </div>
            `;

            if (profile && !profile.handle && !isSignInPage) {
                promptMissingHandleOnboarding(user, profile);
            } else if (profile && !profile.terms_accepted_at && !isSignInPage) {
                promptTermsAcceptanceOnboarding(user);
            }

            await Promise.all([
                loadGlobalNotifications(),
                loadGlobalUnreadChatCount()
            ]);
            checkUnreadPolicyWarnings();
            initGlobalRealtimeSubscriptions();
        }
        collectAudienceGeoSignal(user);
    } catch (err) {
        console.error('Header auth check error:', err);
        if (_accordContextReadyResolve) _accordContextReadyResolve(globalActiveContext);
    }
}

// ==========================================
// GLOBAL NOTIFICATIONS
// ==========================================

async function loadGlobalNotifications() {
    const client = window.supabaseClient;
    if (!client || !globalHeaderUser) return;

    const { data, error } = await client
        .from('notifications')
        .select('*')
        .eq('user_id', globalHeaderUser.id)
        .order('created_at', { ascending: false })
        .limit(20);

    if (error) {
        console.warn('Could not load notifications:', error.message);
        return;
    }

    globalNotifications = data || [];
    renderGlobalNotifications();
}

function renderGlobalNotifications() {
    const badge = document.getElementById('notif-unread-badge');
    const listEl = document.getElementById('notifications-list');
    const markAllBtn = document.getElementById('mark-all-read-btn');
    if (!listEl) return;

    const unreadCount = globalNotifications.filter(n => !n.is_read).length;

    if (badge) {
        if (unreadCount > 0) {
            badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }

    if (markAllBtn) {
        markAllBtn.classList.toggle('hidden', unreadCount === 0);
    }

    if (globalNotifications.length === 0) {
        listEl.innerHTML = `
            <div class="px-4 py-8 text-center space-y-1.5">
                <i class="fa-regular fa-bell-slash text-2xl text-slate-300"></i>
                <p class="text-xs font-semibold text-accord-slate">You're all caught up</p>
                <p class="text-[11px] text-accord-muted">Follow ministries or join discussions to see updates here.</p>
            </div>
        `;
        return;
    }

    listEl.innerHTML = globalNotifications.map(n => {
        const iconMeta = getNotificationIconMeta(n.type);
        const timeAgo = formatNotifTimeAgo(n.created_at);
        const unreadBg = n.is_read ? 'bg-white hover:bg-slate-50' : 'bg-accord-lightBlue/40 hover:bg-accord-lightBlue/70';

        return `
            <button type="button" onclick="handleNotificationClick('${n.id}')" class="w-full text-left px-4 py-3.5 flex items-start space-x-3 transition-colors ${unreadBg}">
                <div class="w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${iconMeta.bgClass}">
                    <i class="fa-solid ${iconMeta.icon} text-xs"></i>
                </div>
                <div class="flex-1 min-w-0 space-y-0.5">
                    <div class="flex items-start justify-between gap-2">
                        <p class="text-xs font-bold text-accord-slate leading-snug">${escapeHeaderHtml(n.title)}</p>
                        ${!n.is_read ? '<span class="w-2 h-2 rounded-full bg-accord-blue shrink-0 mt-1"></span>' : ''}
                    </div>
                    <p class="text-[11px] text-accord-muted leading-relaxed line-clamp-2">${escapeHeaderHtml(n.message)}</p>
                    <p class="text-[10px] font-semibold text-slate-400 pt-0.5">${timeAgo}</p>
                </div>
            </button>
        `;
    }).join('');
}

function getNotificationIconMeta(type) {
    switch (type) {
        case 'new_follow':
            return { icon: 'fa-user-plus', bgClass: 'bg-accord-lightBlue text-accord-blue' };
        case 'new_post':
            return { icon: 'fa-bullhorn', bgClass: 'bg-accord-goldLight text-accord-gold' };
        case 'post_repost':
            return { icon: 'fa-retweet', bgClass: 'bg-emerald-50 text-emerald-600' };
        case 'post_like':
            return { icon: 'fa-heart', bgClass: 'bg-rose-50 text-rose-500' };
        case 'book_comment':
            return { icon: 'fa-book-open', bgClass: 'bg-emerald-50 text-emerald-600' };
        case 'post_comment':
            return { icon: 'fa-comment-dots', bgClass: 'bg-rose-50 text-rose-500' };
        case 'new_message':
            return { icon: 'fa-paper-plane', bgClass: 'bg-indigo-50 text-indigo-600' };
        case 'content_warning':
        case 'verification_revoked':
            return { icon: 'fa-triangle-exclamation', bgClass: 'bg-red-100 text-red-600' };
        default:
            return { icon: 'fa-bell', bgClass: 'bg-slate-100 text-accord-slate' };
    }
}

async function loadGlobalUnreadChatCount() {
    const client = window.supabaseClient;
    const badge = document.getElementById('chat-unread-badge');
    if (!client || !globalHeaderUser || !badge) return;

    try {
        const { data: memberships, error } = await client
            .from('conversation_members')
            .select('conversation_id, last_read_at, conversations(last_message_at)')
            .eq('user_id', globalHeaderUser.id);

        if (error || !Array.isArray(memberships)) return;

        const unreadConvs = memberships.filter(m => {
            const lastMsg = m.conversations?.last_message_at;
            if (!lastMsg) return false;
            if (!m.last_read_at) return true;
            return new Date(lastMsg).getTime() > new Date(m.last_read_at).getTime();
        }).length;

        if (unreadConvs > 0) {
            badge.textContent = unreadConvs > 99 ? '99+' : String(unreadConvs);
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    } catch (_) {}
}
window.refreshGlobalChatBadge = loadGlobalUnreadChatCount;
window.refreshGlobalNotifications = loadGlobalNotifications;

window.markMessageNotificationsRead = async function (convId) {
    const client = window.supabaseClient;
    if (!client || !globalHeaderUser || !convId) return;

    const targetUrl = `messages.html?c=${convId}`;
    let changed = false;
    globalNotifications = globalNotifications.map(n => {
        if (!n.is_read && n.type === 'new_message' && n.link_url === targetUrl) {
            changed = true;
            return { ...n, is_read: true };
        }
        return n;
    });
    if (changed) {
        renderGlobalNotifications();
    }

    await client
        .from('notifications')
        .update({ is_read: true })
        .eq('user_id', globalHeaderUser.id)
        .eq('type', 'new_message')
        .eq('is_read', false)
        .eq('link_url', targetUrl);

    if (!changed) {
        await loadGlobalNotifications();
    }
};

function initGlobalRealtimeSubscriptions() {
    const client = window.supabaseClient;
    if (!client || !globalHeaderUser || typeof client.channel !== 'function') return;

    if (globalRealtimeChannel) {
        try { client.removeChannel(globalRealtimeChannel); } catch (_) {}
        globalRealtimeChannel = null;
    }

    globalRealtimeChannel = client
        .channel(`accord_user_${globalHeaderUser.id}`)
        .on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'notifications',
                filter: `user_id=eq.${globalHeaderUser.id}`
            },
            (payload) => {
                if (payload?.new) {
                    const notif = payload.new;
                    const activeConv = window.activeAccordConvId;
                    if (activeConv && notif.type === 'new_message' && notif.link_url === `messages.html?c=${activeConv}`) {
                        notif.is_read = true;
                        client.from('notifications').update({ is_read: true }).eq('id', notif.id).eq('user_id', globalHeaderUser.id);
                    }
                    globalNotifications = [notif, ...globalNotifications.filter(n => n.id !== notif.id)].slice(0, 30);
                    renderGlobalNotifications();
                }
            }
        )
        .on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'chat_messages'
            },
            (payload) => {
                if (payload?.new && payload.new.sender_id !== globalHeaderUser.id) {
                    loadGlobalUnreadChatCount();
                }
            }
        )
        .subscribe();
}

async function handleNotificationClick(notifId) {
    const client = window.supabaseClient;
    const notif = globalNotifications.find(n => String(n.id) === String(notifId));
    if (!notif) return;

    if (!notif.is_read && client && globalHeaderUser) {
        notif.is_read = true;
        renderGlobalNotifications();
        await client
            .from('notifications')
            .update({ is_read: true })
            .eq('id', notifId)
            .eq('user_id', globalHeaderUser.id);
    }

    if (notif.link_url) {
        window.location.href = notif.link_url;
    }
}

async function markAllNotificationsRead() {
    const client = window.supabaseClient;
    if (!client || !globalHeaderUser) return;

    globalNotifications = globalNotifications.map(n => ({ ...n, is_read: true }));
    renderGlobalNotifications();

    await client
        .from('notifications')
        .update({ is_read: true })
        .eq('user_id', globalHeaderUser.id)
        .eq('is_read', false);
}

function formatNotifTimeAgo(dateStr) {
    if (!dateStr) return '';
    const diffSec = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (diffSec < 60) return 'Just now';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function escapeHeaderHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ==========================================
// DROPDOWNS, MOBILE MENU & BOOKMARKS
// ==========================================

function toggleNotificationsDropdown(e) {
    e.stopPropagation();
    document.getElementById('profile-dropdown')?.classList.add('hidden');
    const dropdown = document.getElementById('notifications-dropdown');
    if (dropdown) {
        const willOpen = dropdown.classList.contains('hidden');
        dropdown.classList.toggle('hidden');
        if (willOpen) loadGlobalNotifications();
    }
}

function toggleProfileDropdown(e) {
    e.stopPropagation();
    document.getElementById('notifications-dropdown')?.classList.add('hidden');
    const dropdown = document.getElementById('profile-dropdown');
    if (dropdown) dropdown.classList.toggle('hidden');
}

window.addEventListener('click', () => {
    document.getElementById('profile-dropdown')?.classList.add('hidden');
    document.getElementById('notifications-dropdown')?.classList.add('hidden');
});

window.normalizeAccordHandle = function (raw) {
    const cleaned = String(raw || '').trim().toLowerCase().replace(/^@+/, '').replace(/[^a-z0-9_]/g, '');
    return cleaned ? `@${cleaned}` : '';
};

window.isValidAccordHandle = function (handle) {
    return /^@[a-z0-9_]{3,30}$/.test(String(handle || ''));
};

function promptMissingHandleOnboarding(user, profile) {
    if (!user || document.getElementById('accord-handle-onboarding-modal')) return;
    const suggested = window.normalizeAccordHandle(profile?.full_name || user.email?.split('@')[0] || '');
    const modal = document.createElement('div');
    modal.id = 'accord-handle-onboarding-modal';
    modal.className = 'fixed inset-0 z-[70] bg-accord-slate/75 backdrop-blur-sm flex items-center justify-center p-4';
    modal.innerHTML = `
        <div class="bg-white rounded-3xl max-w-md w-full p-6 sm:p-8 shadow-2xl space-y-4">
            <div class="space-y-1">
                <span class="inline-block px-2.5 py-0.5 rounded-full bg-accord-lightBlue text-accord-blue text-[10px] font-bold uppercase tracking-wider">Account Setup</span>
                <h2 class="text-xl font-bold text-accord-slate">Choose Your Unique @Handle</h2>
                <p class="text-xs text-accord-muted leading-relaxed">Every Accord account has a unique handle starting with <strong>@</strong> so others can find and mention you.</p>
            </div>
            <form id="handle-onboarding-form" class="space-y-3">
                <div>
                    <label for="onboarding-handle-input" class="block text-[11px] font-bold uppercase tracking-wider text-accord-slate mb-1.5">Your Handle</label>
                    <div class="relative">
                        <span class="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-accord-blue">@</span>
                        <input type="text" id="onboarding-handle-input" required minlength="3" maxlength="30" value="${escapeHeaderHtml(suggested.replace(/^@/, ''))}" placeholder="your_handle" class="w-full bg-slate-50 border border-slate-200 rounded-xl pl-8 pr-4 py-3 text-sm focus:outline-none focus:border-accord-blue focus:bg-white">
                    </div>
                    <p id="onboarding-handle-status" class="text-[11px] text-accord-muted mt-1.5">Letters, numbers, and underscores only (3–30 characters).</p>
                </div>
                <button type="submit" id="onboarding-handle-submit" class="w-full py-3 rounded-xl bg-accord-blue hover:bg-accord-darkBlue text-white text-xs font-bold shadow-md transition-all">
                    Save Handle &amp; Continue
                </button>
            </form>
        </div>
    `;
    document.body.appendChild(modal);

    const inputEl = document.getElementById('onboarding-handle-input');
    const statusEl = document.getElementById('onboarding-handle-status');
    const formEl = document.getElementById('handle-onboarding-form');
    const submitBtn = document.getElementById('onboarding-handle-submit');
    let checkTimer = null;

    inputEl?.addEventListener('input', () => {
        const clean = inputEl.value.toLowerCase().replace(/^@+/, '').replace(/[^a-z0-9_]/g, '');
        if (inputEl.value !== clean) inputEl.value = clean;
        const fullHandle = `@${clean}`;
        clearTimeout(checkTimer);
        if (!window.isValidAccordHandle(fullHandle)) {
            statusEl.textContent = 'Use 3–30 letters, numbers, or underscores.';
            statusEl.className = 'text-[11px] text-amber-600 mt-1.5';
            return;
        }
        statusEl.textContent = `Checking ${fullHandle}...`;
        statusEl.className = 'text-[11px] text-accord-muted mt-1.5';
        checkTimer = setTimeout(async () => {
            const { data: available } = await window.supabaseClient.rpc('is_handle_available', {
                candidate: fullHandle,
                exclude_user_id: user.id
            });
            if (available) {
                statusEl.textContent = `${fullHandle} is available!`;
                statusEl.className = 'text-[11px] text-emerald-600 font-semibold mt-1.5';
            } else {
                statusEl.textContent = `${fullHandle} is already taken. Try another.`;
                statusEl.className = 'text-[11px] text-red-600 font-semibold mt-1.5';
            }
        }, 250);
    });

    formEl?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fullHandle = window.normalizeAccordHandle(inputEl?.value || '');
        if (!window.isValidAccordHandle(fullHandle)) {
            statusEl.textContent = 'Please enter a valid handle (3–30 letters, numbers, or underscores).';
            statusEl.className = 'text-[11px] text-red-600 font-semibold mt-1.5';
            return;
        }
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving...';
        const { data: available } = await window.supabaseClient.rpc('is_handle_available', {
            candidate: fullHandle,
            exclude_user_id: user.id
        });
        if (!available) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Save Handle & Continue';
            statusEl.textContent = `${fullHandle} is already taken. Please choose another.`;
            statusEl.className = 'text-[11px] text-red-600 font-semibold mt-1.5';
            return;
        }
        const { error } = await window.supabaseClient
            .from('profiles')
            .update({ handle: fullHandle })
            .eq('id', user.id);
        if (error) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Save Handle & Continue';
            statusEl.textContent = error.message || 'Could not save handle.';
            statusEl.className = 'text-[11px] text-red-600 font-semibold mt-1.5';
            return;
        }
        modal.remove();
        if (typeof window.refreshGlobalHeaderAuth === 'function') {
            window.refreshGlobalHeaderAuth();
        }
    });
}

async function handleGlobalSignOut() {
    const client = window.supabaseClient || window.supabase;
    if (client) await client.auth.signOut();
    localStorage.removeItem('accord_user_session');
    window.location.href = 'index.html';
}

function updateGlobalBookmarks() {
    try {
        const saved = JSON.parse(localStorage.getItem('accord_saved_items')) || [];
        const badge = document.getElementById('global-bookmark-badge');
        const mobileBadge = document.getElementById('mobile-bookmark-badge');
        if (badge) badge.textContent = saved.length;
        if (mobileBadge) mobileBadge.textContent = saved.length;
    } catch (e) {}
}

function promptTermsAcceptanceOnboarding(user) {
    if (!user || document.getElementById('accord-terms-onboarding-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'accord-terms-onboarding-modal';
    modal.className = 'fixed inset-0 z-[70] bg-accord-slate/75 backdrop-blur-sm flex items-center justify-center p-4';
    modal.innerHTML = `
        <div class="bg-white rounded-3xl max-w-md w-full p-6 sm:p-8 shadow-2xl space-y-4">
            <div class="space-y-1">
                <span class="inline-block px-2.5 py-0.5 rounded-full bg-accord-lightBlue text-accord-blue text-[10px] font-bold uppercase tracking-wider">Compliance Update</span>
                <h2 class="text-xl font-bold text-accord-slate">Accept Terms &amp; Community Guidelines</h2>
                <p class="text-xs text-accord-muted leading-relaxed">To continue using your Accord Archive account, please review and accept our updated Terms of Service and Privacy Policy.</p>
            </div>
            <label class="flex items-start gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer text-xs text-accord-slate leading-relaxed">
                <input type="checkbox" id="onboarding-terms-check" class="mt-0.5 rounded border-slate-300 text-accord-blue">
                <span>I agree to the <a href="terms.html" target="_blank" class="text-accord-blue font-bold hover:underline">Terms of Service</a> (including rules on language, inappropriate content, violence, and copyright) and <a href="privacy.html" target="_blank" class="text-accord-blue font-bold hover:underline">Privacy Policy</a>.</span>
            </label>
            <p id="onboarding-terms-err" class="hidden text-[11px] font-semibold text-red-600"></p>
            <button type="button" id="onboarding-terms-submit" class="w-full py-3 rounded-xl bg-accord-blue hover:bg-accord-darkBlue text-white text-xs font-bold shadow-md transition-all">
                Accept &amp; Continue
            </button>
        </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('onboarding-terms-submit')?.addEventListener('click', async () => {
        const checked = document.getElementById('onboarding-terms-check')?.checked;
        const errEl = document.getElementById('onboarding-terms-err');
        const btn = document.getElementById('onboarding-terms-submit');
        if (!checked) {
            if (errEl) {
                errEl.textContent = 'Please check the box to accept the Terms of Service and Privacy Policy.';
                errEl.classList.remove('hidden');
            }
            return;
        }
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Saving...';
        }
        const { error } = await window.supabaseClient
            .from('profiles')
            .update({ terms_accepted_at: new Date().toISOString(), terms_version: '2026-11' })
            .eq('id', user.id);
        if (error) {
            if (btn) { btn.disabled = false; btn.textContent = 'Accept & Continue'; }
            if (errEl) { errEl.textContent = error.message; errEl.classList.remove('hidden'); }
            return;
        }
        modal.remove();
    });
}

function checkUnreadPolicyWarnings() {
    if (!globalHeaderUser || !Array.isArray(globalNotifications)) return;
    const warningNotif = globalNotifications.find(n => !n.is_read && n.type === 'content_warning');
    if (!warningNotif || document.getElementById('accord-policy-warning-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'accord-policy-warning-modal';
    modal.className = 'fixed inset-0 z-[75] bg-accord-slate/75 backdrop-blur-sm flex items-center justify-center p-4';
    modal.innerHTML = `
        <div class="bg-white rounded-3xl max-w-md w-full p-6 sm:p-7 shadow-2xl space-y-4 border-2 border-red-200">
            <div class="flex items-start gap-3">
                <div class="w-10 h-10 rounded-full bg-red-100 text-red-600 flex items-center justify-center shrink-0">
                    <i class="fa-solid fa-triangle-exclamation text-lg"></i>
                </div>
                <div class="space-y-1">
                    <span class="inline-block px-2 py-0.5 rounded-full bg-red-50 text-red-700 text-[10px] font-extrabold uppercase tracking-wider">Policy Warning</span>
                    <h3 class="text-base font-bold text-accord-slate">${escapeHeaderHtml(warningNotif.title)}</h3>
                </div>
            </div>
            <p class="text-xs text-slate-700 leading-relaxed bg-red-50/60 border border-red-100 rounded-xl p-3.5">${escapeHeaderHtml(warningNotif.message)}</p>
            <p class="text-[11px] text-accord-muted">Repeated violations of our <a href="terms.html" class="text-accord-blue font-bold hover:underline">Terms of Service</a> may result in account suspension.</p>
            <button type="button" id="ack-policy-warning-btn" class="w-full py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold shadow-sm transition-all">
                I Understand
            </button>
        </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('ack-policy-warning-btn')?.addEventListener('click', async () => {
        warningNotif.is_read = true;
        renderGlobalNotifications();
        modal.remove();
        await window.supabaseClient
            .from('notifications')
            .update({ is_read: true })
            .eq('id', warningNotif.id)
            .eq('user_id', globalHeaderUser.id);
    });
}

const ACCORD_CONSENT_STORAGE_KEY = 'accord_consent_v1';

function getAccordConsentChoice() {
    try {
        const val = localStorage.getItem(ACCORD_CONSENT_STORAGE_KEY);
        return (val === 'accepted' || val === 'essential') ? val : null;
    } catch (_) {
        return null;
    }
}

function saveAccordConsentChoice(choice) {
    try {
        localStorage.setItem(ACCORD_CONSENT_STORAGE_KEY, choice);
        if (choice !== 'accepted') {
            localStorage.removeItem('accord_session_key');
        }
    } catch (_) {}
    document.getElementById('accord-consent-banner')?.remove();
    if (choice === 'accepted') {
        collectAudienceGeoSignal(globalHeaderUser);
    }
}

window.openAccordConsentBanner = function (forceShow = true) {
    if (!forceShow && getAccordConsentChoice()) return;
    if (document.getElementById('accord-consent-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'accord-consent-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Cookie and privacy preferences');
    banner.className = 'fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:max-w-md z-[90] bg-white border border-slate-200 rounded-2xl shadow-2xl p-4 sm:p-5 text-xs text-slate-700';
    banner.innerHTML = `
        <div class="space-y-3">
            <div class="flex items-start justify-between gap-3">
                <p class="font-bold text-sm text-[#0F172A]">Privacy &amp; Cookie Preferences</p>
            </div>
            <p class="leading-relaxed text-slate-600">
                Accord Archive uses strictly necessary storage for sign-in, saved items, and regional currency display. With your consent, we also use approximate location and a session key to measure aggregated reach and deliver relevant regional promotions. See our <a href="privacy.html" class="text-[#0077FF] font-semibold hover:underline">Privacy Policy</a>.
            </p>
            <div class="flex flex-wrap items-center justify-end gap-2 pt-1">
                <button type="button" id="accord-consent-essential" class="px-3.5 py-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 font-semibold transition-colors">
                    Essential Only
                </button>
                <button type="button" id="accord-consent-accept" class="px-4 py-2 rounded-xl bg-[#0077FF] hover:bg-[#005BC4] text-white font-semibold shadow-sm transition-colors">
                    Accept All
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(banner);
    document.getElementById('accord-consent-essential')?.addEventListener('click', () => saveAccordConsentChoice('essential'));
    document.getElementById('accord-consent-accept')?.addEventListener('click', () => saveAccordConsentChoice('accepted'));
};

document.addEventListener('DOMContentLoaded', () => {
    window.openAccordConsentBanner(false);
});

async function collectAudienceGeoSignal(user) {
    try {
        let geo = null;
        const cached = sessionStorage.getItem('accord_geo');
        if (cached) {
            geo = JSON.parse(cached);
        } else {
            const resp = await fetch('/api/geo');
            if (resp.ok) {
                geo = await resp.json();
                sessionStorage.setItem('accord_geo', JSON.stringify(geo));
            }
        }
        if (!geo) return;
        window.accordUserGeo = geo;

        // Only persist or log audience tracking signals when the visitor has explicitly consented.
        if (getAccordConsentChoice() !== 'accepted') return;

        const client = window.supabaseClient;
        if (!client) return;

        if (user?.id && !sessionStorage.getItem('accord_geo_profile_synced')) {
            sessionStorage.setItem('accord_geo_profile_synced', '1');
            client.from('profiles').update({
                country: geo.country || 'GLOBAL',
                region: geo.region || null,
                city: geo.city || null,
                location_updated_at: new Date().toISOString()
            }).eq('id', user.id).then(() => {});
        }

        const pageName = window.location.pathname.split('/').pop() || 'index.html';
        const signalKey = `accord_sig_${pageName}`;
        if (!sessionStorage.getItem(signalKey)) {
            sessionStorage.setItem(signalKey, '1');
            let sessKey = localStorage.getItem('accord_session_key');
            if (!sessKey) {
                sessKey = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`);
                localStorage.setItem('accord_session_key', sessKey);
            }
            const deviceType = window.innerWidth < 768 ? 'mobile' : 'desktop';
            client.from('user_audience_signals').insert([{
                user_id: user?.id || null,
                session_key: sessKey,
                country: geo.country || 'GLOBAL',
                region: geo.region || null,
                city: geo.city || null,
                page: pageName,
                device_type: deviceType
            }]).then(() => {});
        }
    } catch (_) {}
}

window.compressImageFile = function (file, options = {}) {
    const maxWidth = options.maxWidth || 1200;
    const maxHeight = options.maxHeight || 1200;
    const quality = options.quality ?? 0.8;

    return new Promise((resolve, reject) => {
        if (!file || !file.type || !file.type.startsWith('image/')) {
            reject(new Error('Please select a valid image file.'));
            return;
        }
        const objectUrl = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            try {
                let width = img.naturalWidth || img.width;
                let height = img.naturalHeight || img.height;
                const scale = Math.min(1, maxWidth / width, maxHeight / height);
                width = Math.max(1, Math.round(width * scale));
                height = Math.max(1, Math.round(height * scale));

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                canvas.toBlob((blob) => {
                    if (blob) {
                        resolve({ blob, ext: 'webp', originalSize: file.size, compressedSize: blob.size });
                        return;
                    }
                    canvas.toBlob((jpegBlob) => {
                        if (jpegBlob) {
                            resolve({ blob: jpegBlob, ext: 'jpg', originalSize: file.size, compressedSize: jpegBlob.size });
                        } else {
                            reject(new Error('Could not compress image.'));
                        }
                    }, 'image/jpeg', quality);
                }, 'image/webp', quality);
            } catch (err) {
                reject(err);
            } finally {
                URL.revokeObjectURL(objectUrl);
            }
        };
        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('Could not read the selected image.'));
        };
        img.src = objectUrl;
    });
};

window.uploadCompressedProfileMedia = async function (client, file, kind, targetId) {
    if (!client) throw new Error('Supabase client not ready.');
    const isBanner = kind === 'banner';
    const compressed = await window.compressImageFile(file, isBanner
        ? { maxWidth: 1400, maxHeight: 500, quality: 0.78 }
        : { maxWidth: 400, maxHeight: 400, quality: 0.82 }
    );
    const folder = isBanner ? 'banners' : 'avatars';
    const filePath = `${folder}/${targetId}_${Date.now()}.${compressed.ext}`;
    const contentType = compressed.ext === 'webp' ? 'image/webp' : 'image/jpeg';

    const { data, error } = await client.storage
        .from('archive-files')
        .upload(filePath, compressed.blob, {
            cacheControl: '3600',
            contentType,
            upsert: false
        });
    if (error) throw new Error(error.message || 'Upload failed.');

    const { data: pub } = client.storage.from('archive-files').getPublicUrl(data.path);
    return {
        url: pub.publicUrl,
        originalSize: compressed.originalSize,
        compressedSize: compressed.compressedSize
    };
};