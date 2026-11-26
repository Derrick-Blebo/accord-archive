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
        .select('id, email, full_name, handle, bio, account_type, upgrade_status, upgrade_pitch')
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

    if (typeof syncUpgradeCardUI === 'function') {
        syncUpgradeCardUI(profile);
    }
    applyMinistryVerificationUI(profile);
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