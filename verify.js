let verifyUser = null;
let verifyProfile = null;

document.addEventListener('DOMContentLoaded', async () => {
    renderSamplePostFields();

    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session?.user) {
        window.location.href = 'signin.html?next=verify.html';
        return;
    }

    verifyUser = session.user;
    await loadVerificationApplication();
});

function renderSamplePostFields(existingSamples = []) {
    const container = document.getElementById('sample-posts-container');
    if (!container) return;

    let html = '';
    for (let i = 0; i < 5; i++) {
        const sample = existingSamples[i] || {};
        const idx = i + 1;
        html += `
            <div class="bg-slate-50 border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3">
                <div class="flex items-center justify-between">
                    <span class="text-xs font-extrabold uppercase tracking-wider text-accord-blue">Sample Post #${idx}</span>
                    <span class="text-[10px] font-semibold text-accord-muted">Required</span>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                        <label for="sample-type-${idx}" class="block text-[11px] font-bold uppercase tracking-wider text-accord-slate mb-1">Post Type *</label>
                        <select id="sample-type-${idx}" required class="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:border-accord-blue">
                            <option value="text" ${sample.post_type === 'text' ? 'selected' : ''}>Text Post / Devotional</option>
                            <option value="video" ${sample.post_type === 'video' ? 'selected' : ''}>Video Sermon</option>
                            <option value="audio" ${sample.post_type === 'audio' ? 'selected' : ''}>Audio Teaching</option>
                            <option value="testimony" ${sample.post_type === 'testimony' ? 'selected' : ''}>Gospel Testimony</option>
                        </select>
                    </div>
                    <div class="sm:col-span-2">
                        <label for="sample-title-${idx}" class="block text-[11px] font-bold uppercase tracking-wider text-accord-slate mb-1">Title *</label>
                        <input type="text" id="sample-title-${idx}" required minlength="4" maxlength="140" value="${escapeVerifyAttr(sample.title || '')}" placeholder="e.g., Walking in Grace — John 1:14" class="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2 text-xs focus:outline-none focus:border-accord-blue">
                    </div>
                </div>
                <div>
                    <label for="sample-body-${idx}" class="block text-[11px] font-bold uppercase tracking-wider text-accord-slate mb-1">Message / Teaching Content *</label>
                    <textarea id="sample-body-${idx}" rows="3" required minlength="20" maxlength="1000" placeholder="Write the Gospel message, scripture reflection, or sermon summary for sample #${idx}..." class="w-full bg-white border border-slate-200 rounded-xl p-3 text-xs focus:outline-none focus:border-accord-blue">${escapeVerifyHtml(sample.body || '')}</textarea>
                </div>
                <div>
                    <label for="sample-media-${idx}" class="block text-[11px] font-bold uppercase tracking-wider text-accord-slate mb-1">Media / Reference URL (Optional)</label>
                    <input type="url" id="sample-media-${idx}" value="${escapeVerifyAttr(sample.media_url || '')}" placeholder="https://youtube.com/... or audio link (optional)" class="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2 text-xs focus:outline-none focus:border-accord-blue">
                </div>
            </div>
        `;
    }
    container.innerHTML = html;
}

async function loadVerificationApplication() {
    const { data: profile, error } = await supabaseClient
        .from('profiles')
        .select('id, email, full_name, account_type, upgrade_status, upgrade_pitch, ministry_role, verification_samples, verification_socials, verification_revoked_reason')
        .eq('id', verifyUser.id)
        .maybeSingle();

    if (error) {
        console.warn('Could not load full profile verification fields:', error.message);
    }

    verifyProfile = profile || {
        id: verifyUser.id,
        email: verifyUser.email,
        account_type: 'normal_user',
        upgrade_status: 'none'
    };

    syncVerificationPageUI(verifyProfile);
}

function syncVerificationPageUI(profile) {
    const status = profile?.upgrade_status || 'none';
    const isVerified = (profile?.account_type === 'ministry_minister' || status === 'approved') && status !== 'revoked';

    const pill = document.getElementById('verify-status-pill');
    const approvedBanner = document.getElementById('verify-approved-banner');
    const pendingBanner = document.getElementById('verify-pending-banner');
    const revokedBanner = document.getElementById('verify-revoked-banner');
    const revokedReasonEl = document.getElementById('verify-revoked-reason-text');
    const form = document.getElementById('verification-application-form');

    approvedBanner?.classList.add('hidden');
    pendingBanner?.classList.add('hidden');
    revokedBanner?.classList.add('hidden');

    if (isVerified) {
        if (pill) {
            pill.className = 'px-3 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200';
            pill.textContent = 'Status: Verified Ministry / Minister';
        }
        approvedBanner?.classList.remove('hidden');
        form?.classList.add('hidden');
        return;
    }

    form?.classList.remove('hidden');

    if (status === 'pending') {
        if (pill) {
            pill.className = 'px-3 py-1 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200';
            pill.textContent = 'Status: Pending Review';
        }
        pendingBanner?.classList.remove('hidden');
    } else if (status === 'revoked') {
        if (pill) {
            pill.className = 'px-3 py-1 rounded-full text-[11px] font-bold bg-red-50 text-red-700 border border-red-200';
            pill.textContent = 'Status: Verification Revoked';
        }
        revokedBanner?.classList.remove('hidden');
        if (revokedReasonEl) {
            revokedReasonEl.textContent = profile.verification_revoked_reason
                ? `Reason: ${profile.verification_revoked_reason}`
                : 'Your verification was revoked by an administrator due to policy or activity concerns.';
        }
    } else if (status === 'rejected') {
        if (pill) {
            pill.className = 'px-3 py-1 rounded-full text-[11px] font-bold bg-red-50 text-red-600';
            pill.textContent = 'Status: Declined (Update & Resubmit)';
        }
    } else {
        if (pill) {
            pill.className = 'px-3 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-accord-muted';
            pill.textContent = 'Status: Not Requested';
        }
    }

    // Populate existing values if available
    if (profile?.ministry_role) {
        const roleEl = document.getElementById('verify-ministry-role');
        if (roleEl) roleEl.value = profile.ministry_role;
    }
    if (profile?.upgrade_pitch) {
        const pitchEl = document.getElementById('verify-gospel-statement');
        if (pitchEl) pitchEl.value = profile.upgrade_pitch;
    }
    if (Array.isArray(profile?.verification_samples) && profile.verification_samples.length > 0) {
        renderSamplePostFields(profile.verification_samples);
    }
    if (profile?.verification_socials && typeof profile.verification_socials === 'object') {
        const s = profile.verification_socials;
        if (s.youtube) document.getElementById('social-youtube').value = s.youtube;
        if (s.facebook) document.getElementById('social-facebook').value = s.facebook;
        if (s.instagram) document.getElementById('social-instagram').value = s.instagram;
        if (s.website) document.getElementById('social-website').value = s.website;
    }
}

async function submitVerificationApplication(e) {
    e.preventDefault();
    if (!verifyUser) return;

    const ministryRole = document.getElementById('verify-ministry-role').value.trim();
    const statement = document.getElementById('verify-gospel-statement').value.trim();
    const pledgeChecked = document.getElementById('verify-gospel-pledge').checked;

    if (statement.length < 40) {
        showVerifyToast('Please write at least 40 characters for your Gospel sharing statement.', true);
        return;
    }
    if (!pledgeChecked) {
        showVerifyToast('Please confirm the Gospel & Conduct pledge before submitting.', true);
        return;
    }

    const samples = [];
    for (let i = 1; i <= 5; i++) {
        const post_type = document.getElementById(`sample-type-${i}`)?.value || 'text';
        const title = document.getElementById(`sample-title-${i}`)?.value.trim() || '';
        const body = document.getElementById(`sample-body-${i}`)?.value.trim() || '';
        const media_url = document.getElementById(`sample-media-${i}`)?.value.trim() || '';

        if (title.length < 4 || body.length < 20) {
            showVerifyToast(`Please complete Sample Post #${i} (title and at least 20 characters of content).`, true);
            return;
        }
        samples.push({ post_type, title, body, media_url });
    }

    const socials = {
        youtube: document.getElementById('social-youtube')?.value.trim() || '',
        facebook: document.getElementById('social-facebook')?.value.trim() || '',
        instagram: document.getElementById('social-instagram')?.value.trim() || '',
        website: document.getElementById('social-website')?.value.trim() || ''
    };

    const btn = document.getElementById('verify-submit-btn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Submitting Application...';
    }

    const fallbackName = verifyProfile?.full_name || verifyUser.user_metadata?.full_name || verifyUser.email?.split('@')[0] || 'Member';
    const payload = {
        id: verifyUser.id,
        email: verifyUser.email,
        full_name: fallbackName,
        account_type: 'normal_user',
        upgrade_status: 'pending',
        upgrade_pitch: statement,
        ministry_role: ministryRole,
        verification_samples: samples,
        verification_socials: socials,
        upgrade_requested_at: new Date().toISOString()
    };

    const { data, error } = await supabaseClient
        .from('profiles')
        .upsert(payload, { onConflict: 'id' })
        .select()
        .single();

    if (btn) {
        btn.disabled = false;
        btn.textContent = 'Submit Verification Application (with 5 Sample Posts)';
    }

    if (error) {
        showVerifyToast(error.message || 'Could not submit verification application.', true);
        return;
    }

    verifyProfile = data;
    syncVerificationPageUI(data);
    showVerifyToast('Verification application with 5 sample posts submitted!');
}

function showVerifyToast(message, isError = false) {
    const toast = document.getElementById('toast');
    const msgEl = document.getElementById('toast-message');
    const iconEl = document.getElementById('toast-icon');
    if (!toast || !msgEl) return;

    msgEl.textContent = message;
    if (iconEl) {
        iconEl.className = isError
            ? 'fa-solid fa-circle-exclamation text-red-500 text-lg'
            : 'fa-solid fa-circle-check text-accord-gold text-lg';
    }
    toast.classList.remove('translate-y-24', 'opacity-0');
    setTimeout(() => {
        toast.classList.add('translate-y-24', 'opacity-0');
    }, 3600);
}

function escapeVerifyHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function escapeVerifyAttr(str) {
    return escapeVerifyHtml(str).replace(/"/g, '&quot;');
}
