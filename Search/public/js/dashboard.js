const historyList = document.getElementById('history-list');
const historyEmpty = document.getElementById('history-empty');
const historyTemplate = document.getElementById('history-item-template');
const settingsForm = document.getElementById('settings-form');
const cooldownInput = document.getElementById('cooldown-input');
const sentenceInput = document.getElementById('sentence-input');
const refreshBtn = document.getElementById('refresh-btn');
const toastEl = document.getElementById('toast');

const uid = new URLSearchParams(window.location.search).get('uid');

if (!uid) {
  window.location.href = '/enter_uid.html';
}

function showToast(message, duration = 2500) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.remove('hidden');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => toastEl.classList.add('hidden'), duration);
}

async function apiGet(path, fallback = {}) {
  try {
    const url = `${path}${path.includes('?') ? '&' : '?'}uid=${encodeURIComponent(uid)}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Request failed');
    return await response.json();
  } catch (error) {
    console.error('[dashboard] GET failed', path, error);
    return fallback;
  }
}

async function apiPost(path, payload) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid, ...payload })
  });
  if (!response.ok) throw new Error('Request failed');
  return response.json();
}

async function apiDelete(path) {
  const response = await fetch(`${path}?uid=${encodeURIComponent(uid)}`, {
    method: 'DELETE'
  });
  if (!response.ok) throw new Error('Request failed');
  return response.json();
}

function renderHistory(searches) {
  historyList.innerHTML = '';
  if (!Array.isArray(searches) || searches.length === 0) {
    historyEmpty.classList.remove('hidden');
    return;
  }
  historyEmpty.classList.add('hidden');

  searches.forEach((search) => {
    const clone = historyTemplate.content.cloneNode(true);
    const titleEl = clone.querySelector('.result-title');
    const urlEl = clone.querySelector('.result-url');
    const timestampEl = clone.querySelector('.result-timestamp');
    const snippetEl = clone.querySelector('.result-snippet');
    const reasonEl = clone.querySelector('.result-reason');
    const excerptPre = clone.querySelector('.result-details summary + pre') || clone.querySelector('pre');
    const resultItems = clone.querySelector('.result-items');
    const deleteBtn = clone.querySelector('.delete-btn');

    const created = search.created_at ? new Date(search.created_at) : null;
    timestampEl.textContent = created ? created.toLocaleString() : 'timestamp unavailable';

    const results = Array.isArray(search.results) ? search.results : [];
    const primary = results[0] ?? null;

    if (primary && primary.url) {
      titleEl.textContent = primary.title || search.query;
      titleEl.href = primary.url;

      try {
        urlEl.textContent = new URL(primary.url).hostname;
      } catch {
        urlEl.textContent = primary.source || search.query;
      }

      snippetEl.textContent =
        primary.description ||
        search.reasoning ||
        'Search captured from your recent conversation.';
    } else {
      titleEl.textContent = search.query;
      titleEl.href = '#';
      titleEl.classList.add('result-title--no-link');
      urlEl.textContent = search.query;
      snippetEl.textContent =
        search.reasoning || 'No web results stored for this suggestion.';
    }

    reasonEl.textContent = search.reasoning || 'Suggested from your recent conversation.';
    if (excerptPre) {
      excerptPre.textContent = search.transcript_excerpt || 'No excerpt saved for this search.';
    }

    if (resultItems) {
      resultItems.innerHTML = '';
      if (results.length === 0) {
        const li = document.createElement('li');
        li.textContent = 'No web results saved.';
        resultItems.appendChild(li);
      } else {
        results.forEach((result) => {
          const li = document.createElement('li');
          if (result.url) {
            const link = document.createElement('a');
            link.href = result.url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = result.title || result.url;
            li.appendChild(link);
          } else {
            li.textContent = result.title || result.source || search.query;
          }

          if (result.description) {
            const desc = document.createElement('p');
            desc.textContent = result.description;
            li.appendChild(desc);
          }

          resultItems.appendChild(li);
        });
      }
    }

    deleteBtn.addEventListener('click', async () => {
      if (!search.id) {
        showToast('Cannot delete sample entry.');
        return;
      }
      deleteBtn.disabled = true;
      try {
        await apiDelete(`/api/history/${search.id}`);
        showToast('Search removed.');
        await loadHistory();
      } catch (error) {
        console.error('[dashboard] delete failed', error);
        showToast('Failed to delete entry.');
      } finally {
        deleteBtn.disabled = false;
      }
    });

    historyList.appendChild(clone);
  });
}

async function loadHistory() {
  const data = await apiGet('/api/history', { searches: [] });
  renderHistory(data.searches);
}

async function loadSettings() {
  const settings = await apiGet('/api/settings', {
    cooldown_seconds: 120,
    min_sentences: 3
  });
  cooldownInput.value = settings.cooldown_seconds ?? 120;
  sentenceInput.value = settings.min_sentences ?? 3;
}

async function saveSettings(event) {
  event.preventDefault();
  const cooldownSeconds = Number(cooldownInput.value);
  const minSentences = Number(sentenceInput.value);
  try {
    await apiPost('/api/settings', {
      cooldown_seconds: cooldownSeconds,
      min_sentences: minSentences
    });
    showToast('Settings saved.');
  } catch (error) {
    console.error('[dashboard] save settings failed', error);
    showToast('Failed to save settings.');
  }
}

settingsForm.addEventListener('submit', saveSettings);
refreshBtn.addEventListener('click', loadHistory);

document.addEventListener('DOMContentLoaded', async () => {
  await Promise.all([loadSettings(), loadHistory()]);
});