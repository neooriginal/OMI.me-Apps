const form = document.getElementById('uid-form');
const input = document.getElementById('uid-input');
const toast = document.getElementById('toast');

function showToast(message, duration = 2200) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => toast.classList.add('hidden'), duration);
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const raw = input.value.trim();
  if (!raw || raw.length < 3) {
    return showToast('uid must be at least 3 characters');
  }
  const sanitized = raw.replace(/[^a-zA-Z0-9-_]/g, '');
  document.cookie = `search_uid=${sanitized};path=/;max-age=${7 * 24 * 60 * 60};SameSite=Lax`;
  window.location.href = `/?uid=${encodeURIComponent(sanitized)}`;
});