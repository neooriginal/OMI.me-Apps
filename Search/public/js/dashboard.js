const historyList = document.getElementById('history-list');
const historyEmpty = document.getElementById('history-empty');
const historyTemplate = document.getElementById('history-item-template');
const settingsForm = document.getElementById('settings-form');
const cooldownInput = document.getElementById('cooldown-input');
const sentenceInput = document.getElementById('sentence-input');
const refreshBtn = document.getElementById('refresh-btn');
const toastEl = document.getElementById('toast');
const summaryContainer = document.getElementById('summary-container');
const summaryBanner = document.getElementById('summary-banner');
const summaryTextEl = document.getElementById('summary-text');
const summaryLinkEl = document.getElementById('summary-link');
const summarySourceEl = document.getElementById('summary-source');
const summaryConfidenceEl = document.getElementById('summary-confidence');
const wipeHistoryBtn = document.getElementById('wipe-history-btn');

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

function extractResultsPayload(search) {
  if (!search) {
    return {
      items: [],
      aiSummary: null,
      aiBestIndex: null,
      aiConfidence: null
    };
  }

  const rawResults = search.results;
  let items = [];

  if (Array.isArray(rawResults)) {
    items = rawResults;
  } else if (rawResults && typeof rawResults === 'object') {
    if (Array.isArray(rawResults.items)) {
      items = rawResults.items;
    } else if (Array.isArray(rawResults.results)) {
      items = rawResults.results;
    }
  }

  if (!Array.isArray(items)) {
    items = [];
  }

  let aiBestIndex = Number.isInteger(search.ai_best_index) ? search.ai_best_index : null;
  if (aiBestIndex === null && rawResults && typeof rawResults === 'object') {
    if (Number.isInteger(rawResults.ai_best_index)) {
      aiBestIndex = rawResults.ai_best_index;
    }
  }
  if (aiBestIndex === null) {
    const flaggedIndex = items.findIndex(item => item?.ai_is_pick);
    if (flaggedIndex >= 0) {
      aiBestIndex = flaggedIndex;
    }
  }
  if (aiBestIndex !== null) {
    if (aiBestIndex < 0 || aiBestIndex >= items.length) {
      aiBestIndex = items.length ? 0 : null;
    }
  } else if (items.length > 0) {
    aiBestIndex = 0;
  }

  let aiSummary =
    typeof search.ai_summary === 'string' && search.ai_summary.trim().length
      ? search.ai_summary.trim()
      : null;

  if (!aiSummary && rawResults && typeof rawResults === 'object') {
    if (typeof rawResults.ai_summary === 'string' && rawResults.ai_summary.trim().length) {
      aiSummary = rawResults.ai_summary.trim();
    } else if (typeof rawResults.summary === 'string' && rawResults.summary.trim().length) {
      aiSummary = rawResults.summary.trim();
    }
  }

  let aiConfidence =
    typeof search.ai_confidence === 'number' && !Number.isNaN(search.ai_confidence)
      ? Math.max(0, Math.min(1, search.ai_confidence))
      : null;

  if (
    aiConfidence === null &&
    rawResults &&
    typeof rawResults === 'object' &&
    typeof rawResults.ai_confidence === 'number' &&
    !Number.isNaN(rawResults.ai_confidence)
  ) {
    aiConfidence = Math.max(0, Math.min(1, rawResults.ai_confidence));
  }

  return {
    items,
    aiSummary,
    aiBestIndex,
    aiConfidence
  };
}

function formatConfidence(confidence) {
  if (typeof confidence !== 'number' || Number.isNaN(confidence)) {
    return null;
  }
  return `${Math.round(confidence * 100)}% confidence`;
}

function formatHostname(url) {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function updateSummaryBanner(latestSearch) {
  if (!summaryBanner || !summaryContainer) {
    return;
  }

  if (!latestSearch) {
    summaryContainer.classList.add('hidden');
    summaryBanner.classList.add('hidden');
    return;
  }

  const { items, aiSummary, aiBestIndex, aiConfidence } = extractResultsPayload(latestSearch);
  const highlightedIndex =
    aiBestIndex !== null && aiBestIndex >= 0 && aiBestIndex < items.length ? aiBestIndex : 0;
  const highlighted = items[highlightedIndex] || null;

  const fallbackSummary =
    aiSummary ||
    highlighted?.description ||
    latestSearch.reasoning ||
    'A fresh summary will appear here after your next search.';

  summaryTextEl.textContent = fallbackSummary;
  summaryTextEl.classList.toggle('summary-text--muted', !aiSummary && !highlighted?.description);

  const linkHref = highlighted?.url || null;
  if (linkHref) {
    summaryLinkEl.href = linkHref;
    summaryLinkEl.classList.remove('hidden');
  } else {
    summaryLinkEl.removeAttribute('href');
    summaryLinkEl.classList.add('hidden');
  }

  const sourceLabel = formatHostname(highlighted?.url) || highlighted?.source || latestSearch.query;
  summarySourceEl.textContent = sourceLabel ? `Source: ${sourceLabel}` : latestSearch.query || '';
  summaryLinkEl.textContent = sourceLabel || 'open source';

  const confidenceLabel = formatConfidence(aiConfidence);
  if (confidenceLabel) {
    summaryConfidenceEl.textContent = confidenceLabel;
    summaryConfidenceEl.classList.remove('hidden');
  } else {
    summaryConfidenceEl.textContent = '';
    summaryConfidenceEl.classList.add('hidden');
  }

  summaryContainer.classList.remove('hidden');
  summaryBanner.classList.remove('hidden');
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
    const badgeEl = clone.querySelector('.result-badge');
    const sourceEl = clone.querySelector('.result-source');
    const confidenceEl = clone.querySelector('.result-confidence');
    const timestampEl = clone.querySelector('.result-timestamp');
    const summaryEl = clone.querySelector('.result-ai-summary');
    const snippetEl = clone.querySelector('.result-snippet');
    const reasonEl = clone.querySelector('.result-reason');
    const excerptPre = clone.querySelector('.result-details summary + pre') || clone.querySelector('pre');
    const resultItems = clone.querySelector('.result-items');
    const deleteBtn = clone.querySelector('.delete-btn');

    const created = search.created_at ? new Date(search.created_at) : null;
    timestampEl.textContent = created ? created.toLocaleString() : 'timestamp unavailable';

    const { items, aiSummary, aiBestIndex, aiConfidence } = extractResultsPayload(search);
    const highlightedIndex =
      aiBestIndex !== null && aiBestIndex >= 0 && aiBestIndex < items.length ? aiBestIndex : 0;
    const primary = items[highlightedIndex] || items[0] || null;

    const hostname = formatHostname(primary?.url);
    if (primary?.url) {
      titleEl.textContent = primary.title || search.query;
      titleEl.href = primary.url;
      titleEl.classList.remove('result-title--no-link');

      sourceEl.textContent = hostname || primary.source || search.query;
      sourceEl.classList.remove('hidden');

      snippetEl.textContent =
        primary?.description ||
        search.reasoning ||
        'Search captured from your recent conversation.';
    } else {
      titleEl.textContent = search.query;
      titleEl.href = '#';
      titleEl.classList.add('result-title--no-link');
      sourceEl.textContent = search.query;
      sourceEl.classList.add('hidden');
      snippetEl.textContent =
        search.reasoning || 'No web results stored for this suggestion.';
    }

    if (badgeEl) {
      const isAiPick = highlightedIndex === aiBestIndex && primary;
      badgeEl.classList.toggle('hidden', !isAiPick);
    }

    if (summaryEl) {
      summaryEl.textContent =
        aiSummary ||
        primary?.description ||
        search.reasoning ||
        'No AI summary available for this search result.';
      summaryEl.classList.toggle('summary-ai--muted', !aiSummary);
    }

    if (confidenceEl) {
      const confidenceLabel = formatConfidence(aiConfidence);
      if (confidenceLabel) {
        confidenceEl.textContent = confidenceLabel;
        confidenceEl.classList.remove('hidden');
      } else {
        confidenceEl.textContent = '';
        confidenceEl.classList.add('hidden');
      }
    }

    reasonEl.textContent = search.reasoning || 'Suggested from your recent conversation.';
    if (excerptPre) {
      excerptPre.textContent = search.transcript_excerpt || 'No excerpt saved for this search.';
    }

    if (resultItems) {
      resultItems.innerHTML = '';
      if (items.length === 0) {
        const li = document.createElement('li');
        li.textContent = 'No web results saved.';
        resultItems.appendChild(li);
      } else {
        items.forEach((result, index) => {
          const li = document.createElement('li');
          if (index === highlightedIndex) {
            li.classList.add('result-item--pick');
          }
          if (result.url) {
            const link = document.createElement('a');
            link.href = result.url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = result.title || result.url;
            li.appendChild(link);
          } else {
            li.textContent = result?.title || result?.source || search.query;
          }

          if (result?.description) {
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
  const searches = Array.isArray(data.searches) ? data.searches : [];
  renderHistory(searches);
  updateSummaryBanner(searches[0] || null);
}

async function wipeHistory() {
  if (!wipeHistoryBtn) return;

  const confirmed = window.confirm(
    'Delete all saved search suggestions for this UID? This action cannot be undone.'
  );
  if (!confirmed) {
    return;
  }

  wipeHistoryBtn.disabled = true;
  try {
    await apiDelete('/api/history');
    showToast('All saved search data deleted.');
    await loadHistory();
  } catch (error) {
    console.error('[dashboard] wipe history failed', error);
    showToast('Failed to delete saved data.');
  } finally {
    wipeHistoryBtn.disabled = false;
  }
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
if (wipeHistoryBtn) {
  wipeHistoryBtn.addEventListener('click', wipeHistory);
}

document.addEventListener('DOMContentLoaded', async () => {
  await Promise.all([loadSettings(), loadHistory()]);
});