const SUPABASE_URL = 'https://mzblgajftvyyosyrawcx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16YmxnYWpmdHZ5eW9zeXJhd2N4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ0NzYxNTQsImV4cCI6MjExMDA1MjE1NH0.Xs9MeioNfqb5DzxDYP-9ZqfywBeOlUreAY-yKrcBmJM';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

document.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
        window.location.href = 'index.html';
        return;
    }
    const user = session.user;
    document.getElementById('profile-email').value = user.email;
    const fullName = user.user_metadata?.full_name || user.user_metadata?.name || user.email.split('@')[0];
    document.getElementById('profile-name').value = fullName;
});

async function handleProfileUpdate(e) {
    e.preventDefault();
    const fullName = document.getElementById('profile-name').value.trim();
    const btn = document.getElementById('profile-save-btn');
    btn.disabled = true;
    btn.innerText = 'Saving...';

    const { error } = await supabaseClient.auth.updateUser({
        data: { full_name: fullName }
    });

    btn.disabled = false;
    btn.innerText = 'Save Profile Changes';

    if (error) {
        showToast(`Update failed: ${error.message}`);
    } else {
        showToast("Profile updated successfully!");
    }
}

async function handleSignOut() {
    await supabaseClient.auth.signOut();
    window.location.href = 'index.html';
}

function showToast(message) {
    const toast = document.getElementById('toast');
    document.getElementById('toast-message').innerText = message;
    toast.classList.remove('translate-y-24', 'opacity-0');
    toast.classList.add('translate-y-0', 'opacity-100');
    setTimeout(() => {
        toast.classList.remove('translate-y-0', 'opacity-100');
        toast.classList.add('translate-y-24', 'opacity-0');
    }, 3500);
}