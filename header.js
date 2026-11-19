/**
 * Accord Archive - Unified Global Header Component
 * Automatically injects the navbar, handles auth state, notifications, avatar dropdown, and bookmark counts.
 */

let globalHeaderUser = null;
let globalNotifications = [];

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
            <!-- 3-Column Grid ensuring center nav remains perfectly locked regardless of auth state -->
            <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 grid grid-cols-[minmax(200px,1fr)_auto_minmax(200px,1fr)] items-center gap-4">
                
                <!-- Left: Brand Logo -->
                <a href="index.html" class="flex items-center space-x-3 group justify-self-start">
                    <div class="w-11 h-11 bg-accord-blue rounded-xl flex items-center justify-center text-white shadow-md shadow-blue-500/20 group-hover:scale-105 transition-transform">
                        <span class="font-bold text-xl tracking-tighter">Ac</span>
                    </div>
                    <div>
                        <div class="flex items-center">
                            <span class="text-2xl font-extrabold tracking-tight text-accord-slate">Acco</span>
                            <span class="text-2xl font-extrabold tracking-tight text-accord-slate" style="position:relative;">rd<span style="position:absolute; top:-4px; right:0px; width:14px; height:3px; background-color:#F5A623; border-radius:2px;"></span></span>
                        </div>
                        <p class="text-[10px] uppercase tracking-widest font-bold text-accord-blue">Official Archive & Library</p>
                    </div>
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

                <!-- Right: Notifications, Auth / Profile Dropdown & Mobile Toggle -->
                <div class="flex items-center space-x-3 justify-self-end">
                    <div id="auth-area" class="flex items-center space-x-3 min-w-[140px] justify-end">
                        <!-- Dynamically injected -->
                    </div>
                    <button type="button" onclick="toggleGlobalMobileMenu()" class="md:hidden p-2 text-accord-slate hover:text-accord-blue" aria-label="Toggle Menu">
                        <i class="fa-solid fa-bars text-xl"></i>
                    </button>
                </div>
            </div>

            <!-- Mobile Menu -->
            <div id="global-mobile-menu" class="hidden md:hidden bg-white border-b border-slate-200 px-6 py-4 space-y-3">
                <a href="index.html" class="block text-base font-medium text-accord-slate">Digital Library</a>
                <a href="feed.html" class="block text-base font-medium text-accord-slate">Feed</a>
                <a href="music.html" class="block text-base font-medium text-accord-slate">Music</a>
                <a href="saved.html" class="flex items-center justify-between text-base font-medium text-accord-slate pt-1">
                    <span class="flex items-center space-x-2">
                        <i class="fa-solid fa-bookmark text-accord-gold"></i>
                        <span>Saved</span>
                    </span>
                    <span id="mobile-bookmark-badge" class="bg-accord-gold text-white text-xs font-bold px-2 py-0.5 rounded-full">0</span>
                </a>
                <div id="mobile-auth-area" class="pt-3 border-t border-slate-100"></div>
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
    if (path.includes('index') || path.includes('book')) setActive('nav-library');
    else if (path.includes('feed') || path.includes('ministry') || path.includes('post')) setActive('nav-feed');
    else if (path.includes('music')) setActive('nav-music');
    else if (path.includes('saved')) setActive('nav-saved');
}

function setActive(id) {
    const el = document.getElementById(id);
    if (el) {
        el.className = 'text-sm font-bold text-accord-blue transition-colors';
    }
}

async function initGlobalHeaderAuth() {
    try {
        const client = window.supabaseClient;
        if (!client) return;

        const { data: { session } } = await client.auth.getSession();
        const user = session?.user || null;
        globalHeaderUser = user;

        const authArea = document.getElementById('auth-area');
        const mobileAuthArea = document.getElementById('mobile-auth-area');
        if (!authArea) return;

        const adminEmails = ['rickblebs1@gmail.com'];
        const isAdmin = user && adminEmails.includes(user.email);

        if (!user) {
            authArea.innerHTML = `
                <a href="signin.html" class="text-xs sm:text-sm font-semibold text-accord-slate hover:text-accord-blue px-2 py-2 transition-colors">
                    Log in
                </a>
                <a href="signin.html" class="inline-flex items-center space-x-1.5 bg-accord-blue hover:bg-accord-darkBlue text-white text-xs sm:text-sm font-semibold px-4 py-2.5 rounded-xl shadow-lg shadow-blue-500/20 transition-all">
                    <span>Sign up</span>
                </a>
            `;
            if (mobileAuthArea) {
                mobileAuthArea.innerHTML = `
                    <div class="flex items-center space-x-3 pt-2">
                        <a href="signin.html" class="flex-1 text-center py-2.5 rounded-xl border border-slate-200 text-xs font-semibold text-accord-slate">Log in</a>
                        <a href="signin.html" class="flex-1 text-center py-2.5 rounded-xl bg-accord-blue text-white text-xs font-semibold shadow-sm">Sign up</a>
                    </div>
                `;
            }
        } else {
            const email = user.email || 'user@accord.com';
            const avatarUrl = user.user_metadata?.avatar_url || null;
            const initial = email.charAt(0).toUpperCase();

            const avatarContent = avatarUrl
                ? `<img src="${avatarUrl}" class="w-full h-full object-cover" alt="Profile">`
                : `<span class="text-white font-bold text-sm">${initial}</span>`;

            const adminLinkHtml = isAdmin ? `
                <a href="feed-admin.html" class="flex items-center space-x-3 px-4 py-2.5 text-xs font-semibold text-accord-slate hover:bg-slate-50 transition-colors">
                    <i class="fa-solid fa-shield-halved text-emerald-600 w-4"></i>
                    <span>Admin Moderation</span>
                </a>
            ` : '';

            authArea.innerHTML = `
                <!-- Notification Bell Dropdown -->
                <div class="relative">
                    <button type="button" onclick="toggleNotificationsDropdown(event)" class="relative w-10 h-10 rounded-full bg-slate-50 hover:bg-accord-lightBlue text-accord-slate hover:text-accord-blue border border-slate-200 flex items-center justify-center transition-all focus:outline-none cursor-pointer" aria-label="Notifications" title="Notifications">
                        <i class="fa-regular fa-bell text-base"></i>
                        <span id="notif-unread-badge" class="hidden absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white">0</span>
                    </button>

                    <div id="notifications-dropdown" onclick="event.stopPropagation()" class="hidden absolute right-0 mt-3 w-80 sm:w-96 bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden z-50">
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
                    <button type="button" onclick="toggleProfileDropdown(event)" class="w-11 h-11 rounded-full bg-accord-blue overflow-hidden ring-2 ring-accord-blue/25 hover:ring-accord-blue transition-all flex items-center justify-center focus:outline-none shadow-sm cursor-pointer">
                        ${avatarContent}
                    </button>

                    <div id="profile-dropdown" class="hidden absolute right-0 mt-3 w-64 bg-white rounded-2xl shadow-2xl border border-slate-200 py-2 z-50">
                        <div class="px-4 py-3 border-b border-slate-100">
                            <p class="text-xs font-bold text-accord-slate truncate">${email}</p>
                            <p class="text-[10px] text-accord-muted">${isAdmin ? 'Administrator' : 'Authenticated Member'}</p>
                        </div>
                        <div class="py-1">
                            <a href="profile.html" class="flex items-center space-x-3 px-4 py-2.5 text-xs font-semibold text-accord-slate hover:bg-slate-50 transition-colors">
                                <i class="fa-regular fa-user text-accord-blue w-4"></i>
                                <span>Edit Profile</span>
                            </a>
                            <a href="author.html" class="flex items-center space-x-3 px-4 py-2.5 text-xs font-semibold text-accord-slate hover:bg-slate-50 transition-colors">
                                <i class="fa-solid fa-feather-pointed text-accord-gold w-4 text-center"></i>
                                <span>My Author Page</span>
                            </a>
                            <a href="saved.html" class="flex items-center space-x-3 px-4 py-2.5 text-xs font-semibold text-accord-slate hover:bg-slate-50 transition-colors">
                                <i class="fa-solid fa-bookmark text-accord-gold w-4"></i>
                                <span>Saved Collections</span>
                            </a>
                            ${adminLinkHtml}
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

            if (mobileAuthArea) {
                mobileAuthArea.innerHTML = `
                    <div class="space-y-2">
                        <a href="profile.html" class="block text-base font-medium text-accord-slate">Edit Profile</a>
                        ${isAdmin ? '<a href="feed-admin.html" class="block text-base font-medium text-accord-slate">Admin Moderation</a>' : ''}
                        <button onclick="handleGlobalSignOut()" class="text-base font-medium text-red-600 text-left">Log out</button>
                    </div>
                `;
            }

            await loadGlobalNotifications();
        }
    } catch (err) {
        console.error('Header auth check error:', err);
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
        case 'book_comment':
            return { icon: 'fa-book-open', bgClass: 'bg-emerald-50 text-emerald-600' };
        case 'post_comment':
            return { icon: 'fa-comment-dots', bgClass: 'bg-rose-50 text-rose-500' };
        default:
            return { icon: 'fa-bell', bgClass: 'bg-slate-100 text-accord-slate' };
    }
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

function toggleGlobalMobileMenu() {
    const menu = document.getElementById('global-mobile-menu');
    if (menu) menu.classList.toggle('hidden');
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