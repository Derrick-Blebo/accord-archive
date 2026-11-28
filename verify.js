let verifyUser = null;
let verifyProfile = null;
let verifyProfileExists = false;

const CANONICAL_MINISTRY_ROLES = new Set([
    'Church / Ministry',
    'Preacher',
    'Musician',
    'Christian Creative'
]);

function normalizeMinistryRole(role) {
    const raw = String(role || '').trim();
    const map = {
        'Church / Local Assembly': 'Church / Ministry',
        'Christian Ministry / Fellowship': 'Church / Ministry',
        'Pastor / Ordained Minister': 'Preacher',
        'Evangelist / Missionary': 'Preacher',
        'Christian Educator / Author': 'Christian Creative'
    };
    const mapped = map[raw] || raw;
    return CANONICAL_MINISTRY_ROLES.has(mapped) ? mapped : 'Church / Ministry';
}

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

const _sampleMediaMetaCache = new Map();
const _sampleMetaTimers = {};

function getSampleFieldConfig(postType, idx) {
    const isText = postType === 'text';
    const isAudio = postType === 'audio';
    return {
        isText,
        bodyLabel: isText ? 'Message / Teaching Content *' : 'Message / Teaching Content (Optional)',
        bodyPlaceholder: isText
            ? `Write the Gospel message, scripture reflection, or sermon summary for sample #${idx}...`
            : `Add an optional message, reflection, or sermon note for sample #${idx}...`,
        mediaLabel: isText
            ? 'Media / Reference URL (Optional)'
            : (isAudio ? 'Audio Source URL * (Spotify, Audiomack, Apple, SoundCloud, YouTube)' : 'Video URL *'),
        mediaPlaceholder: isText
            ? 'https://youtube.com/... or reference link (optional)'
            : (isAudio ? 'Paste Spotify, Audiomack, Apple Music, SoundCloud, or YouTube link...' : 'https://www.youtube.com/watch?v=...')
    };
}

function renderSamplePostFields(existingSamples = []) {
    const container = document.getElementById('sample-posts-container');
    if (!container) return;

    let html = '';
    for (let i = 0; i < 5; i++) {
        const sample = existingSamples[i] || {};
        const idx = i + 1;
        const postType = (sample.post_type === 'video' || sample.post_type === 'audio') ? sample.post_type : 'text';
        const cfg = getSampleFieldConfig(postType, idx);

        if (sample.media_url && (sample.title || sample.media_thumbnail)) {
            _sampleMediaMetaCache.set(sample.media_url, {
                title: sample.title || '',
                image: sample.media_thumbnail || '',
                curator: sample.media_curator || ''
            });
        }

        html += `
            <div class="bg-slate-50 border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3">
                <div class="flex items-center justify-between">
                    <span class="text-xs font-extrabold uppercase tracking-wider text-accord-blue">Sample Post #${idx}</span>
                    <span class="text-[10px] font-semibold text-accord-muted">Required</span>
                </div>
                <div>
                    <label for="sample-type-${idx}" class="block text-[11px] font-bold uppercase tracking-wider text-accord-slate mb-1">Post Type *</label>
                    <select id="sample-type-${idx}" onchange="handleSampleTypeChange(${idx})" required class="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:border-accord-blue">
                        <option value="text" ${postType === 'text' ? 'selected' : ''}>Text Post / Devotional</option>
                        <option value="video" ${postType === 'video' ? 'selected' : ''}>Video Sermon</option>
                        <option value="audio" ${postType === 'audio' ? 'selected' : ''}>Audio Teaching</option>
                    </select>
                </div>
                <div>
                    <label id="sample-media-label-${idx}" for="sample-media-${idx}" class="block text-[11px] font-bold uppercase tracking-wider text-accord-slate mb-1">${cfg.mediaLabel}</label>
                    <input type="url" id="sample-media-${idx}" ${cfg.isText ? '' : 'required'} oninput="scheduleSampleMediaMetaPreview(${idx})" value="${escapeVerifyAttr(sample.media_url || '')}" placeholder="${escapeVerifyAttr(cfg.mediaPlaceholder)}" class="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2 text-xs focus:outline-none focus:border-accord-blue">
                    <div id="sample-meta-preview-${idx}" class="hidden mt-2 bg-white border border-slate-200 rounded-xl p-2.5 flex items-center gap-3">
                        <div id="sample-meta-thumb-${idx}" class="w-11 h-11 rounded-lg bg-accord-goldLight text-accord-gold flex items-center justify-center overflow-hidden shrink-0">
                            <i class="fa-solid fa-link"></i>
                        </div>
                        <div class="min-w-0 flex-1">
                            <p id="sample-meta-status-${idx}" class="text-[10px] font-bold uppercase tracking-wider text-accord-muted">Auto-pulled Link Info</p>
                            <p id="sample-meta-title-${idx}" class="text-xs font-bold text-accord-slate truncate">Waiting for link...</p>
                        </div>
                    </div>
                </div>
                <div>
                    <label id="sample-body-label-${idx}" for="sample-body-${idx}" class="block text-[11px] font-bold uppercase tracking-wider text-accord-slate mb-1">${cfg.bodyLabel}</label>
                    <textarea id="sample-body-${idx}" rows="3" ${cfg.isText ? 'required minlength="20"' : ''} maxlength="1000" placeholder="${escapeVerifyAttr(cfg.bodyPlaceholder)}" class="w-full bg-white border border-slate-200 rounded-xl p-3 text-xs focus:outline-none focus:border-accord-blue">${escapeVerifyHtml(sample.body || '')}</textarea>
                </div>
            </div>
        `;
    }
    container.innerHTML = html;

    for (let i = 0; i < 5; i++) {
        const sample = existingSamples[i] || {};
        if (sample.media_url && /^https?:\/\//i.test(sample.media_url)) {
            scheduleSampleMediaMetaPreview(i + 1, true);
        }
    }
}

function handleSampleTypeChange(idx) {
    const postType = document.getElementById(`sample-type-${idx}`)?.value || 'text';
    const cfg = getSampleFieldConfig(postType, idx);

    const bodyEl = document.getElementById(`sample-body-${idx}`);
    const bodyLabelEl = document.getElementById(`sample-body-label-${idx}`);
    const mediaEl = document.getElementById(`sample-media-${idx}`);
    const mediaLabelEl = document.getElementById(`sample-media-label-${idx}`);

    if (bodyLabelEl) bodyLabelEl.textContent = cfg.bodyLabel;
    if (bodyEl) {
        bodyEl.required = cfg.isText;
        if (cfg.isText) {
            bodyEl.setAttribute('minlength', '20');
        } else {
            bodyEl.removeAttribute('minlength');
        }
        bodyEl.placeholder = cfg.bodyPlaceholder;
    }

    if (mediaLabelEl) mediaLabelEl.textContent = cfg.mediaLabel;
    if (mediaEl) {
        mediaEl.required = !cfg.isText;
        mediaEl.placeholder = cfg.mediaPlaceholder;
    }
}

async function fetchSampleLinkMetadata(url) {
    const clean = String(url || '').trim();
    if (!clean || !/^https?:\/\//i.test(clean)) return null;
    if (_sampleMediaMetaCache.has(clean)) return _sampleMediaMetaCache.get(clean);
    try {
        const res = await fetch(`/api/music-metadata?url=${encodeURIComponent(clean)}`);
        if (!res.ok) return null;
        const data = await res.json();
        const meta = {
            title: String(data?.title || '').trim(),
            image: String(data?.image || '').trim(),
            curator: String(data?.curator || data?.artist || '').trim()
        };
        if (meta.title || meta.image || meta.curator) {
            _sampleMediaMetaCache.set(clean, meta);
        }
        return meta;
    } catch {
        return null;
    }
}

function scheduleSampleMediaMetaPreview(idx, immediate = false) {
    const url = document.getElementById(`sample-media-${idx}`)?.value.trim() || '';
    const box = document.getElementById(`sample-meta-preview-${idx}`);
    const statusEl = document.getElementById(`sample-meta-status-${idx}`);
    const titleEl = document.getElementById(`sample-meta-title-${idx}`);
    const thumbEl = document.getElementById(`sample-meta-thumb-${idx}`);

    clearTimeout(_sampleMetaTimers[idx]);

    if (!url || !/^https?:\/\//i.test(url)) {
        box?.classList.add('hidden');
        return;
    }

    const runLookup = async () => {
        if (!box) return;
        box.classList.remove('hidden');
        if (statusEl) statusEl.textContent = 'Pulling title & thumbnail...';
        if (titleEl) titleEl.textContent = url;
        if (thumbEl) thumbEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

        const meta = await fetchSampleLinkMetadata(url);
        const currentUrl = document.getElementById(`sample-media-${idx}`)?.value.trim() || '';
        if (currentUrl !== url) return;

        if (meta && (meta.title || meta.image)) {
            if (statusEl) {
                statusEl.textContent = meta.curator
                    ? `Auto-pulled • ${meta.curator}`
                    : 'Auto-pulled from source';
            }
            if (titleEl) titleEl.textContent = meta.title || 'Media Link';
            if (thumbEl) {
                thumbEl.innerHTML = meta.image
                    ? `<img src="${escapeVerifyAttr(meta.image)}" alt="Media thumbnail" class="w-full h-full object-cover">`
                    : '<i class="fa-solid fa-circle-play"></i>';
            }
        } else {
            if (statusEl) statusEl.textContent = 'Link attached';
            if (titleEl) titleEl.textContent = 'Preview info unavailable for this link';
            if (thumbEl) thumbEl.innerHTML = '<i class="fa-solid fa-link"></i>';
        }
    };

    if (immediate) {
        runLookup();
    } else {
        _sampleMetaTimers[idx] = setTimeout(runLookup, 350);
    }
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

    verifyProfileExists = Boolean(profile);
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

    if (status === 'revoked') {
        if (pill) {
            pill.className = 'px-3 py-1 rounded-full text-[11px] font-bold bg-red-50 text-red-700 border border-red-200';
            pill.textContent = 'Status: Verification Revoked';
        }
        revokedBanner?.classList.remove('hidden');
        if (revokedReasonEl) {
            revokedReasonEl.textContent = profile.verification_revoked_reason
                ? `Reason: ${profile.verification_revoked_reason} — Resubmission is disabled while your verification is revoked.`
                : 'Your verification was revoked by an administrator due to policy or activity concerns. Resubmission is disabled while revoked.';
        }
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
        if (roleEl) roleEl.value = normalizeMinistryRole(profile.ministry_role);
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

    const rawSamples = [];
    for (let i = 1; i <= 5; i++) {
        const post_type = document.getElementById(`sample-type-${i}`)?.value || 'text';
        const body = document.getElementById(`sample-body-${i}`)?.value.trim() || '';
        const media_url = document.getElementById(`sample-media-${i}`)?.value.trim() || '';

        if (post_type === 'text') {
            if (body.length < 20) {
                showVerifyToast(`Please complete Sample Post #${i} (at least 20 characters of message content).`, true);
                return;
            }
        } else {
            if (!media_url || !/^https?:\/\//i.test(media_url)) {
                showVerifyToast(`Please provide a valid ${post_type === 'audio' ? 'audio' : 'video'} URL for Sample Post #${i}.`, true);
                return;
            }
        }
        rawSamples.push({ post_type, body, media_url });
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

    const samples = await Promise.all(rawSamples.map(async (sample) => {
        const meta = sample.media_url && /^https?:\/\//i.test(sample.media_url)
            ? await fetchSampleLinkMetadata(sample.media_url)
            : null;
        return {
            post_type: sample.post_type,
            title: meta?.title || '',
            body: sample.body,
            media_url: sample.media_url,
            ...(meta?.image ? { media_thumbnail: meta.image } : {}),
            ...(meta?.curator ? { media_curator: meta.curator } : {})
        };
    }));

    const fallbackName = verifyProfile?.full_name || verifyUser.user_metadata?.full_name || verifyUser.email?.split('@')[0] || 'Member';
    const updateFields = {
        email: verifyUser.email,
        full_name: fallbackName,
        upgrade_status: 'pending',
        upgrade_pitch: statement,
        ministry_role: ministryRole,
        verification_samples: samples,
        verification_socials: socials,
        upgrade_requested_at: new Date().toISOString()
    };

    const { data, error } = verifyProfileExists
        ? await supabaseClient
            .from('profiles')
            .update(updateFields)
            .eq('id', verifyUser.id)
            .select()
            .single()
        : await supabaseClient
            .from('profiles')
            .upsert({
                id: verifyUser.id,
                account_type: 'normal_user',
                ...updateFields
            }, { onConflict: 'id' })
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

    verifyProfileExists = true;
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
