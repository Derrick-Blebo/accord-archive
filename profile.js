// =========================================================
// ACCORD PROFILE.JS
// Session Gate, Profile Updates, Upgrade Card Sync & Sign Out
// =========================================================

let currentProfileUser = null;
let currentUserProfile = null;

document.addEventListener('DOMContentLoaded', async () => {
    if (typeof supabaseClient === 'undefined') return;

    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session?.user) {
        window.location.href = 'signin.html?next=profile.html';
        return;
    }

    currentProfileUser = session.user;
    await loadUserProfileData();
});

function isVerifiedMinistryAccount(profile) {
    if (!profile) return false;
    if (profile.upgrade_status === 'revoked') return false;
    return profile.account_type === 'ministry_minister' || profile.upgrade_status === 'approved';
}

function applyMinistryVerificationUI(profile) {
    const verified = isVerifiedMinistryAccount(profile);
    const isPending = !verified && profile?.upgrade_status === 'pending';

    // Hide upgrade request container once approved (and optionally while pending)
    const upgradeBox = document.getElementById('ministry-upgrade-box');
    if (upgradeBox) {
        upgradeBox.classList.toggle('hidden', verified);
    }

    const upgradeForm = document.getElementById('ministry-upgrade-form') || document.getElementById('upgrade-request-form');
    if (upgradeForm) {
        upgradeForm.classList.toggle('hidden', verified);
    }

    // Show verified status banner when approved
    const verifiedBanner = document.getElementById('ministry-verified-banner');
    if (verifiedBanner) {
        verifiedBanner.classList.toggle('hidden', !verified);
    }

    const pendingNotice = document.getElementById('ministry-pending-notice');
    if (pendingNotice) {
        pendingNotice.classList.toggle('hidden', !isPending);
    }

    // Toggle verified mark attached to profile icon / avatar
    const badge = document.getElementById('profile-verified-badge');
    if (badge) {
        badge.classList.toggle('hidden', !verified);
    }

    // If an inline HTML hook is defined on the page, call it too
    if (typeof window.onMinistryProfileLoaded === 'function') {
        window.onMinistryProfileLoaded(profile, verified);
    }
}

async function loadUserProfileData() {
    if (!currentProfileUser) return;

    const emailInput = document.getElementById('profile-email');
    const nameInput = document.getElementById('profile-name');
    const authNavLabel = document.getElementById('auth-nav-label');
    const mobileAuthLabel = document.getElementById('mobile-auth-label');
    const profileIcon = document.getElementById('user-profile-icon');

    if (emailInput) emailInput.value = currentProfileUser.email || '';

    let { data: profile } = await supabaseClient
        .from('profiles')
        .select('id, email, full_name, handle, bio, avatar_url, banner_url, account_type, upgrade_status, upgrade_pitch')
        .eq('id', currentProfileUser.id)
        .maybeSingle();

    const metaName = currentProfileUser.user_metadata?.full_name || currentProfileUser.user_metadata?.name || '';
    const resolvedName = profile?.full_name || metaName || currentProfileUser.email.split('@')[0];

    if (nameInput) nameInput.value = resolvedName;
    const handleInput = document.getElementById('profile-handle');
    if (handleInput) handleInput.value = (profile?.handle || '').replace(/^@+/, '');
    const bioInput = document.getElementById('profile-bio-input');
    if (bioInput) bioInput.value = profile?.bio || '';
    const publicLink = document.getElementById('view-public-profile-btn');
    if (publicLink) publicLink.href = `user.html?id=${encodeURIComponent(currentProfileUser.id)}`;
    if (authNavLabel) authNavLabel.textContent = resolvedName;
    if (mobileAuthLabel) mobileAuthLabel.textContent = `Account (${resolvedName})`;
    if (profileIcon && !profileIcon.querySelector('i, img')) {
        profileIcon.textContent = resolvedName.charAt(0).toUpperCase() || 'U';
    }

    // Ensure a row exists in `profiles` for this user
    if (!profile) {
        const defaultProfile = {
            id: currentProfileUser.id,
            email: currentProfileUser.email,
            full_name: resolvedName,
            account_type: 'normal_user',
            upgrade_status: 'none'
        };
        await supabaseClient.from('profiles').upsert(defaultProfile, { onConflict: 'id' });
        profile = defaultProfile;
    }

    currentUserProfile = profile;
    syncProfileMediaPreview(profile, resolvedName);

    if (typeof syncUpgradeCardUI === 'function') {
        syncUpgradeCardUI(profile);
    }
    applyMinistryVerificationUI(profile);
    await loadPageAdminsManagement(profile);
}

function formatCompactBytes(bytes) {
    if (!bytes || bytes < 1024) return `${bytes || 0} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function syncProfileMediaPreview(profile, fallbackName = '') {
    const avatarImg = document.getElementById('profile-avatar-img');
    const avatarInitial = document.getElementById('profile-avatar-initial-preview');
    const avatarRemoveBtn = document.getElementById('profile-avatar-remove-btn');
    const bannerImg = document.getElementById('profile-banner-img');
    const bannerRemoveBtn = document.getElementById('profile-banner-remove-btn');

    const initial = (profile?.full_name || fallbackName || currentProfileUser?.email || 'U').charAt(0).toUpperCase();
    if (avatarInitial) avatarInitial.textContent = initial;

    if (profile?.avatar_url) {
        if (avatarImg) {
            avatarImg.src = profile.avatar_url;
            avatarImg.classList.remove('hidden');
        }
        avatarInitial?.classList.add('hidden');
        avatarRemoveBtn?.classList.remove('hidden');
    } else {
        avatarImg?.classList.add('hidden');
        avatarInitial?.classList.remove('hidden');
        avatarRemoveBtn?.classList.add('hidden');
    }

    if (profile?.banner_url) {
        if (bannerImg) {
            bannerImg.src = profile.banner_url;
            bannerImg.classList.remove('hidden');
        }
        bannerRemoveBtn?.classList.remove('hidden');
    } else {
        bannerImg?.classList.add('hidden');
        bannerRemoveBtn?.classList.add('hidden');
    }
}

async function handleProfileAvatarUpload(inputEl) {
    const file = inputEl?.files?.[0];
    if (!file || !currentProfileUser || typeof window.uploadCompressedProfileMedia !== 'function') return;
    const statusEl = document.getElementById('profile-media-status');
    if (statusEl) statusEl.textContent = 'Compressing and uploading profile picture...';

    try {
        const res = await window.uploadCompressedProfileMedia(supabaseClient, file, 'avatar', currentProfileUser.id);
        const { error } = await supabaseClient
            .from('profiles')
            .update({ avatar_url: res.url })
            .eq('id', currentProfileUser.id);
        if (error) throw error;

        await supabaseClient.auth.updateUser({ data: { avatar_url: res.url } });
        if (currentUserProfile) currentUserProfile.avatar_url = res.url;
        syncProfileMediaPreview(currentUserProfile);
        if (typeof renderGlobalHeader === 'function') renderGlobalHeader();
        if (statusEl) statusEl.textContent = `Picture saved (${formatCompactBytes(res.originalSize)} → ${formatCompactBytes(res.compressedSize)}).`;
        showToast('Profile picture updated.');
    } catch (err) {
        if (statusEl) statusEl.textContent = 'Images are automatically compressed to save space.';
        showToast(`Could not upload picture: ${err.message || 'Upload failed'}`);
    } finally {
        inputEl.value = '';
    }
}

async function removeProfileAvatar() {
    if (!currentProfileUser) return;
    const { error } = await supabaseClient
        .from('profiles')
        .update({ avatar_url: null })
        .eq('id', currentProfileUser.id);
    if (error) {
        showToast(`Could not remove picture: ${error.message}`);
        return;
    }
    await supabaseClient.auth.updateUser({ data: { avatar_url: null } });
    if (currentUserProfile) currentUserProfile.avatar_url = null;
    syncProfileMediaPreview(currentUserProfile);
    if (typeof renderGlobalHeader === 'function') renderGlobalHeader();
    showToast('Profile picture removed.');
}

async function handleProfileBannerUpload(inputEl) {
    const file = inputEl?.files?.[0];
    if (!file || !currentProfileUser || typeof window.uploadCompressedProfileMedia !== 'function') return;
    const statusEl = document.getElementById('profile-media-status');
    if (statusEl) statusEl.textContent = 'Compressing and uploading page banner...';

    try {
        const res = await window.uploadCompressedProfileMedia(supabaseClient, file, 'banner', currentProfileUser.id);
        const { error } = await supabaseClient
            .from('profiles')
            .update({ banner_url: res.url })
            .eq('id', currentProfileUser.id);
        if (error) throw error;

        if (currentUserProfile) currentUserProfile.banner_url = res.url;
        syncProfileMediaPreview(currentUserProfile);
        if (statusEl) statusEl.textContent = `Banner saved (${formatCompactBytes(res.originalSize)} → ${formatCompactBytes(res.compressedSize)}).`;
        showToast('Page banner updated.');
    } catch (err) {
        if (statusEl) statusEl.textContent = 'Images are automatically compressed to save space.';
        showToast(`Could not upload banner: ${err.message || 'Upload failed'}`);
    } finally {
        inputEl.value = '';
    }
}

async function removeProfileBanner() {
    if (!currentProfileUser) return;
    const { error } = await supabaseClient
        .from('profiles')
        .update({ banner_url: null })
        .eq('id', currentProfileUser.id);
    if (error) {
        showToast(`Could not remove banner: ${error.message}`);
        return;
    }
    if (currentUserProfile) currentUserProfile.banner_url = null;
    syncProfileMediaPreview(currentUserProfile);
    showToast('Page banner removed.');
}

let profileHandleCheckTimer = null;
function handleProfileHandleInput(inputEl) {
    const clean = inputEl.value.toLowerCase().replace(/^@+/, '').replace(/[^a-z0-9_]/g, '');
    if (inputEl.value !== clean) inputEl.value = clean;
    const statusEl = document.getElementById('profile-handle-status');
    if (!statusEl) return;
    const candidate = clean ? `@${clean}` : '';
    clearTimeout(profileHandleCheckTimer);
    if (!/^@[a-z0-9_]{3,30}$/.test(candidate)) {
        statusEl.textContent = 'Use 3–30 letters, numbers, or underscores.';
        statusEl.className = 'text-[11px] text-amber-600 mt-1';
        return;
    }
    if (currentUserProfile?.handle && currentUserProfile.handle.toLowerCase() === candidate.toLowerCase()) {
        statusEl.textContent = `${candidate} is your current handle.`;
        statusEl.className = 'text-[11px] text-accord-muted mt-1';
        return;
    }
    statusEl.textContent = `Checking ${candidate}...`;
    statusEl.className = 'text-[11px] text-accord-muted mt-1';
    profileHandleCheckTimer = setTimeout(async () => {
        const { data: available } = await supabaseClient.rpc('is_handle_available', {
            candidate,
            exclude_user_id: currentProfileUser?.id || null
        });
        if (available) {
            statusEl.textContent = `${candidate} is available!`;
            statusEl.className = 'text-[11px] text-emerald-600 font-semibold mt-1';
        } else {
            statusEl.textContent = `${candidate} is already taken. Try another.`;
            statusEl.className = 'text-[11px] text-red-600 font-semibold mt-1';
        }
    }, 250);
}

async function handleProfileUpdate(e) {
    e.preventDefault();
    if (!currentProfileUser) return;

    const nameInput = document.getElementById('profile-name');
    const handleInput = document.getElementById('profile-handle');
    const bioInput = document.getElementById('profile-bio-input');
    const saveBtn = document.getElementById('profile-save-btn');
    const fullName = nameInput?.value.trim() || '';
    const rawHandle = (handleInput?.value || '').trim().toLowerCase().replace(/^@+/, '').replace(/[^a-z0-9_]/g, '');
    const handle = rawHandle ? `@${rawHandle}` : '';
    const bio = bioInput?.value.trim() || '';

    if (!fullName) {
        showToast('Please enter your full name.');
        return;
    }

    if (!/^@[a-z0-9_]{3,30}$/.test(handle)) {
        showToast('Please enter a valid @handle (3–30 letters, numbers, or underscores).');
        return;
    }

    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving Changes...';
    }

    const { data: available, error: availErr } = await supabaseClient.rpc('is_handle_available', {
        candidate: handle,
        exclude_user_id: currentProfileUser.id
    });
    if (!availErr && available === false) {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save Profile Changes';
        }
        showToast(`Handle ${handle} is already in use by another account.`);
        return;
    }

    const [authRes, profileRes] = await Promise.all([
        supabaseClient.auth.updateUser({
            data: { full_name: fullName, handle }
        }),
        supabaseClient
            .from('profiles')
            .upsert({
                id: currentProfileUser.id,
                email: currentProfileUser.email,
                full_name: fullName,
                handle,
                bio
            }, { onConflict: 'id' })
    ]);

    if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Profile Changes';
    }

    if (authRes.error || profileRes.error) {
        const errMsg = authRes.error?.message || profileRes.error?.message || 'Could not update profile.';
        showToast(/unique|duplicate/i.test(errMsg) ? `Handle ${handle} is already taken.` : errMsg);
        return;
    }

    if (currentUserProfile) {
        currentUserProfile.full_name = fullName;
        currentUserProfile.handle = handle;
    }

    const authNavLabel = document.getElementById('auth-nav-label');
    const mobileAuthLabel = document.getElementById('mobile-auth-label');
    if (authNavLabel) authNavLabel.textContent = fullName;
    if (mobileAuthLabel) mobileAuthLabel.textContent = `Account (${fullName})`;

    showToast('Profile updated successfully.');
}

async function handleSignOut() {
    await supabaseClient.auth.signOut();
    window.location.href = 'index.html';
}

function handleAuthNavClick() {
    window.location.href = 'profile.html';
}

function toggleMobileMenu() {
    document.getElementById('mobile-menu')?.classList.toggle('hidden');
}

function showToast(message) {
    const toast = document.getElementById('toast');
    const msgEl = document.getElementById('toast-message');
    if (!toast || !msgEl) return;

    msgEl.textContent = message;
    toast.classList.remove('translate-y-24', 'opacity-0');
    toast.classList.add('translate-y-0', 'opacity-100');

    setTimeout(() => {
        toast.classList.remove('translate-y-0', 'opacity-100');
        toast.classList.add('translate-y-24', 'opacity-0');
    }, 3500);
}

function escapeProfileMgmtHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

const PAGE_ADMIN_PERMS_META = [
    { key: 'can_post', label: 'Create Feed Posts', badge: 'Post', color: 'bg-blue-50 text-accord-blue border-blue-200' },
    { key: 'can_edit_delete_posts', label: 'Edit & Delete Posts', badge: 'Edit/Delete', color: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
    { key: 'can_post_books', label: 'Post & Manage Books', badge: 'Books', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    { key: 'can_promote', label: 'Promote Books & Posts', badge: 'Promote', color: 'bg-purple-50 text-purple-700 border-purple-200' },
    { key: 'can_edit_profile', label: 'Edit Page Profile & Media', badge: 'Edit Profile', color: 'bg-sky-50 text-sky-700 border-sky-200' },
    { key: 'can_withdraw_funds', label: 'Withdraw Book Sales Funds', badge: 'Withdraw Funds', color: 'bg-amber-50 text-amber-800 border-amber-200' }
];

function normalizePageAdminPermissions(rawPerms, role = 'admin') {
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

function renderPermissionBadgesHtml(perms) {
    const active = PAGE_ADMIN_PERMS_META.filter(m => perms[m.key]);
    if (active.length === 0) {
        return `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-500 border border-slate-200">View Only</span>`;
    }
    return active.map(m => `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold border ${m.color}">${escapeProfileMgmtHtml(m.badge)}</span>`).join('');
}

function applyAdminPowerPreset(preset) {
    const presets = {
        editor: { can_post: true, can_edit_delete_posts: true, can_post_books: false, can_promote: false, can_edit_profile: false, can_withdraw_funds: false },
        manager: { can_post: true, can_edit_delete_posts: true, can_post_books: true, can_promote: true, can_edit_profile: false, can_withdraw_funds: false },
        full: { can_post: true, can_edit_delete_posts: true, can_post_books: true, can_promote: true, can_edit_profile: true, can_withdraw_funds: true }
    };
    const vals = presets[preset];
    if (!vals) return;
    PAGE_ADMIN_PERMS_META.forEach(m => {
        const cb = document.getElementById(`perm-add-${m.key}`);
        if (cb) cb.checked = Boolean(vals[m.key]);
    });
}

function syncPresetSelectFromCheckboxes() {
    const sel = document.getElementById('page-admin-preset');
    if (sel) sel.value = 'custom';
}

function readAddAdminPermissions() {
    const perms = {};
    PAGE_ADMIN_PERMS_META.forEach(m => {
        perms[m.key] = Boolean(document.getElementById(`perm-add-${m.key}`)?.checked);
    });
    return perms;
}

function toggleEditAdminPowers(rowId) {
    const panel = document.getElementById(`edit-admin-powers-${rowId}`);
    panel?.classList.toggle('hidden');
}

async function savePageAdminPermissions(rowId) {
    if (!currentProfileUser || !isVerifiedMinistryAccount(currentUserProfile)) return;
    const perms = {};
    PAGE_ADMIN_PERMS_META.forEach(m => {
        perms[m.key] = Boolean(document.getElementById(`perm-edit-${rowId}-${m.key}`)?.checked);
    });
    const role = (perms.can_edit_delete_posts || perms.can_post_books || perms.can_promote || perms.can_edit_profile || perms.can_withdraw_funds) ? 'admin' : 'editor';

    const { error } = await supabaseClient
        .from('page_admins')
        .update({ permissions: perms, role })
        .eq('id', rowId)
        .eq('page_id', currentProfileUser.id);

    if (error) {
        showToast(`Could not update powers: ${error.message}`);
        return;
    }

    showToast('Page admin powers updated.');
    await loadPageAdminsManagement(currentUserProfile);
}

async function loadPageAdminsManagement(profile) {
    const isVerified = isVerifiedMinistryAccount(profile);
    const section = document.getElementById('page-admins-section');
    const listEl = document.getElementById('page-admins-list');
    const managedSection = document.getElementById('managed-pages-section');
    const managedListEl = document.getElementById('managed-pages-list');

    if (section) {
        section.classList.toggle('hidden', !isVerified);
    }

    if (isVerified && listEl && currentProfileUser) {
        try {
            const { data: rows, error } = await supabaseClient
                .from('page_admins')
                .select('id, admin_user_id, role, permissions, created_at, profiles!page_admins_admin_user_id_fkey(id, full_name, handle, email)')
                .eq('page_id', currentProfileUser.id)
                .order('created_at', { ascending: false });

            if (error) {
                listEl.innerHTML = `<p class="text-[11px] text-accord-muted">Page admin management will be active once the latest database migration is applied.</p>`;
            } else if (!rows || rows.length === 0) {
                listEl.innerHTML = `<p class="text-[11px] text-accord-muted">No page admins added yet.</p>`;
            } else {
                listEl.innerHTML = rows.map(r => {
                    const adminProf = r.profiles || {};
                    const name = adminProf.full_name || adminProf.email || 'Member';
                    const handle = adminProf.handle ? ` ${adminProf.handle}` : '';
                    const perms = normalizePageAdminPermissions(r.permissions, r.role);
                    const checkboxesHtml = PAGE_ADMIN_PERMS_META.map(m => `
                        <label class="flex items-center gap-2 text-[11px] font-semibold text-accord-slate bg-slate-50 border border-slate-200/80 rounded-xl px-3 py-2 cursor-pointer">
                            <input type="checkbox" id="perm-edit-${escapeProfileMgmtHtml(r.id)}-${m.key}" ${perms[m.key] ? 'checked' : ''} class="rounded text-accord-blue focus:ring-accord-blue">
                            <span>${escapeProfileMgmtHtml(m.label)}</span>
                        </label>
                    `).join('');
                    return `
                        <div class="bg-white border border-slate-200 rounded-2xl p-3.5 space-y-3">
                            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <div class="min-w-0 space-y-1.5">
                                    <p class="text-xs font-bold text-accord-slate truncate">${escapeProfileMgmtHtml(name)}<span class="text-accord-blue font-semibold">${escapeProfileMgmtHtml(handle)}</span></p>
                                    <div class="flex flex-wrap gap-1.5">
                                        ${renderPermissionBadgesHtml(perms)}
                                    </div>
                                </div>
                                <div class="flex items-center gap-2 shrink-0">
                                    <button type="button" onclick="toggleEditAdminPowers('${escapeProfileMgmtHtml(r.id)}')" class="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-accord-slate text-[11px] font-bold transition-colors">
                                        Edit Powers
                                    </button>
                                    <button type="button" onclick="removePageAdmin('${escapeProfileMgmtHtml(r.id)}')" class="px-3 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 text-[11px] font-bold transition-colors">
                                        Remove
                                    </button>
                                </div>
                            </div>
                            <div id="edit-admin-powers-${escapeProfileMgmtHtml(r.id)}" class="hidden pt-2.5 border-t border-slate-100 space-y-2.5">
                                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                    ${checkboxesHtml}
                                </div>
                                <div class="flex justify-end gap-2">
                                    <button type="button" onclick="toggleEditAdminPowers('${escapeProfileMgmtHtml(r.id)}')" class="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-accord-slate text-[11px] font-bold">Cancel</button>
                                    <button type="button" onclick="savePageAdminPermissions('${escapeProfileMgmtHtml(r.id)}')" class="px-3.5 py-1.5 rounded-lg bg-accord-blue hover:bg-accord-darkBlue text-white text-[11px] font-bold shadow-sm">Save Powers</button>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('');
            }
        } catch {
            listEl.innerHTML = `<p class="text-[11px] text-accord-muted">Could not load page admins.</p>`;
        }
    }

    if (managedSection && managedListEl && currentProfileUser) {
        try {
            const { data: myManaged } = await supabaseClient
                .from('page_admins')
                .select('id, page_id, role, permissions, profiles!page_admins_page_id_fkey(id, full_name, handle, account_type, upgrade_status)')
                .eq('admin_user_id', currentProfileUser.id);
            const activePages = (myManaged || []).filter(m => m.profiles && isVerifiedMinistryAccount(m.profiles));
            if (activePages.length > 0) {
                managedSection.classList.remove('hidden');
                managedListEl.innerHTML = activePages.map(m => {
                    const p = m.profiles;
                    const perms = normalizePageAdminPermissions(m.permissions, m.role);
                    const actionLinks = [
                        perms.can_post ? `<a href="feed.html" class="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-accord-blue text-[10px] font-bold">Feed</a>` : '',
                        (perms.can_post_books || perms.can_withdraw_funds) ? `<a href="author.html?page=${encodeURIComponent(p.id)}" class="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[10px] font-bold">Books &amp; Earnings</a>` : '',
                        perms.can_promote ? `<a href="promote.html" class="px-2.5 py-1 rounded-lg bg-purple-50 hover:bg-purple-100 text-purple-700 text-[10px] font-bold">Promote</a>` : '',
                        perms.can_edit_profile ? `<a href="user.html?id=${encodeURIComponent(p.id)}&edit=1" class="px-2.5 py-1 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-700 text-[10px] font-bold">Edit Profile</a>` : ''
                    ].filter(Boolean).join('');
                    return `
                        <div class="bg-white border border-blue-200/80 rounded-2xl px-4 py-3 space-y-2">
                            <div class="flex items-center justify-between gap-3">
                                <a href="user.html?id=${encodeURIComponent(p.id)}" class="min-w-0 flex-1">
                                    <p class="text-xs font-bold text-accord-slate truncate">${escapeProfileMgmtHtml(p.full_name || 'Verified Ministry')} <span class="text-accord-blue">${escapeProfileMgmtHtml(p.handle || '')}</span></p>
                                </a>
                                <button type="button" onclick="leaveManagedPage('${escapeProfileMgmtHtml(m.id)}')" class="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-red-50 hover:text-red-600 text-accord-slate text-[11px] font-bold shrink-0 transition-colors">
                                    Leave
                                </button>
                            </div>
                            <div class="flex flex-wrap items-center justify-between gap-2">
                                <div class="flex flex-wrap gap-1.5">${renderPermissionBadgesHtml(perms)}</div>
                                <div class="flex items-center gap-1.5">${actionLinks}</div>
                            </div>
                        </div>
                    `;
                }).join('');
            } else {
                managedSection.classList.add('hidden');
            }
        } catch {
            managedSection.classList.add('hidden');
        }
    }
}

async function handleAddPageAdmin(e) {
    e.preventDefault();
    if (!currentProfileUser || !isVerifiedMinistryAccount(currentUserProfile)) return;

    const input = document.getElementById('page-admin-identifier');
    const raw = (input?.value || '').trim();
    if (!raw) return;

    const btn = document.getElementById('add-page-admin-btn');
    if (btn) btn.disabled = true;

    let targetProfile = null;
    if (raw.includes('@') && !raw.startsWith('@')) {
        const { data } = await supabaseClient
            .from('profiles')
            .select('id, full_name, handle, email')
            .ilike('email', raw)
            .maybeSingle();
        targetProfile = data;
    } else {
        const cleanHandle = '@' + raw.replace(/^@+/, '').toLowerCase();
        const { data } = await supabaseClient
            .from('profiles')
            .select('id, full_name, handle, email')
            .ilike('handle', cleanHandle)
            .maybeSingle();
        targetProfile = data;
    }

    if (!targetProfile) {
        if (btn) btn.disabled = false;
        showToast('No user found with that @handle or email.');
        return;
    }

    if (String(targetProfile.id) === String(currentProfileUser.id)) {
        if (btn) btn.disabled = false;
        showToast('You are already the owner of this verified page.');
        return;
    }

    const permissions = readAddAdminPermissions();
    const role = (permissions.can_edit_delete_posts || permissions.can_post_books || permissions.can_promote || permissions.can_edit_profile || permissions.can_withdraw_funds) ? 'admin' : 'editor';

    const { error } = await supabaseClient.from('page_admins').insert([{
        page_id: currentProfileUser.id,
        admin_user_id: targetProfile.id,
        added_by: currentProfileUser.id,
        role,
        permissions
    }]);

    if (btn) btn.disabled = false;
    if (error) {
        showToast(error.code === '23505' ? 'This user is already a page admin.' : `Could not add page admin: ${error.message}`);
        return;
    }

    // Notify the newly added admin
    await supabaseClient.from('notifications').insert([{
        user_id: targetProfile.id,
        type: 'page_admin_added',
        title: 'Added as Verified Page Admin',
        message: `${currentUserProfile.full_name || 'A verified ministry'} added you as a Page Admin. Check your Profile to view your assigned powers.`,
        link_url: 'profile.html'
    }]);

    if (input) input.value = '';
    const presetSel = document.getElementById('page-admin-preset');
    if (presetSel) presetSel.value = 'editor';
    applyAdminPowerPreset('editor');
    showToast(`${targetProfile.full_name || targetProfile.handle || 'Member'} added as Page Admin.`);
    await loadPageAdminsManagement(currentUserProfile);
}

async function removePageAdmin(rowId) {
    if (!currentProfileUser) return;
    const { error } = await supabaseClient
        .from('page_admins')
        .delete()
        .eq('id', rowId)
        .eq('page_id', currentProfileUser.id);
    if (error) {
        showToast(`Could not remove page admin: ${error.message}`);
        return;
    }
    showToast('Page admin removed.');
    await loadPageAdminsManagement(currentUserProfile);
}

async function leaveManagedPage(rowId) {
    if (!currentProfileUser) return;
    const { error } = await supabaseClient
        .from('page_admins')
        .delete()
        .eq('id', rowId)
        .eq('admin_user_id', currentProfileUser.id);
    if (error) {
        showToast(`Could not leave page: ${error.message}`);
        return;
    }
    showToast('You have left that verified page.');
    await loadPageAdminsManagement(currentUserProfile);
}