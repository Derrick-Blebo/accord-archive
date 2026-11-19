// =========================================================
// ACCORD PROFILE.JS
// Session Gate, Profile Updates, Upgrade Card Sync & Sign Out
// =========================================================

let currentProfileUser = null;

document.addEventListener('DOMContentLoaded', async () => {
    if (typeof supabaseClient === 'undefined') return;

    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session?.user) {
        window.location.href = 'index.html';
        return;
    }

    currentProfileUser = session.user;
    await loadUserProfileData();
});

async function loadUserProfileData() {
    if (!currentProfileUser) return;

    const emailInput = document.getElementById('profile-email');
    const nameInput = document.getElementById('profile-name');
    const authNavLabel = document.getElementById('auth-nav-label');
    const mobileAuthLabel = document.getElementById('mobile-auth-label');

    if (emailInput) emailInput.value = currentProfileUser.email || '';

    const { data: profile } = await supabaseClient
        .from('profiles')
        .select('id, email, full_name, account_type, upgrade_status, upgrade_pitch')
        .eq('id', currentProfileUser.id)
        .maybeSingle();

    const metaName = currentProfileUser.user_metadata?.full_name || currentProfileUser.user_metadata?.name || '';
    const resolvedName = profile?.full_name || metaName || currentProfileUser.email.split('@')[0];

    if (nameInput) nameInput.value = resolvedName;
    if (authNavLabel) authNavLabel.textContent = resolvedName;
    if (mobileAuthLabel) mobileAuthLabel.textContent = `Account (${resolvedName})`;

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
        if (typeof syncUpgradeCardUI === 'function') {
            syncUpgradeCardUI(defaultProfile);
        }
    } else if (typeof syncUpgradeCardUI === 'function') {
        syncUpgradeCardUI(profile);
    }
}

async function handleProfileUpdate(e) {
    e.preventDefault();
    if (!currentProfileUser) return;

    const nameInput = document.getElementById('profile-name');
    const saveBtn = document.getElementById('profile-save-btn');
    const fullName = nameInput?.value.trim() || '';

    if (!fullName) {
        showToast('Please enter your full name.');
        return;
    }

    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving Changes...';
    }

    const [authRes, profileRes] = await Promise.all([
        supabaseClient.auth.updateUser({
            data: { full_name: fullName }
        }),
        supabaseClient
            .from('profiles')
            .upsert({
                id: currentProfileUser.id,
                email: currentProfileUser.email,
                full_name: fullName
            }, { onConflict: 'id' })
    ]);

    if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Profile Changes';
    }

    if (authRes.error || profileRes.error) {
        showToast(authRes.error?.message || profileRes.error?.message || 'Could not update profile.');
        return;
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