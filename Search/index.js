/*
 * Copyright (c) 2025 Neo (github.com/neooriginal)
 * All rights reserved.
 */

require('dotenv').config();

const express = require('express');
const path = require('path');
const axios = require('axios');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');
const { OpenAI } = require('openai');
const { body, validationResult, query } = require('express-validator');

const PORT = process.env.PORT || 5100;
const app = express();

const supabaseConfigured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
const supabase = supabaseConfigured
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
  : null;

const openAiApiKey = process.env.OPENAI_API_KEY;
const openAiBaseUrl = process.env.OPENAI_BASE_URL || undefined;

const openai = openAiApiKey
  ? new OpenAI({
      apiKey: openAiApiKey,
      baseURL: openAiBaseUrl
    })
  : null;

if (!openai) {
  console.warn('[Search] No OpenAI API key detected. Topic detection is disabled.');
}

const braveApiKey = process.env.BRAVE_API_KEY;

const USER_SENTENCE_THRESHOLD = 2;
const ANALYSIS_COOLDOWN_SECONDS = 60;
const MIN_COOLDOWN_AFTER_SEARCH_SECONDS = 120;
const BUFFER_RETENTION_SECONDS = 10 * 60;
const BUFFER_MAX_MESSAGES = 24;
const HISTORY_DEFAULT_LIMIT = 25;
const USER_WORD_FLUSH_THRESHOLD = 8;
const USER_FLUSH_TIMEOUT_SECONDS = 5;
const MIN_ACCUMULATION_WINDOW_SECONDS = 15;
const MIN_SILENCE_AFTER_USER_SECONDS = 3;
const SENTENCE_END_REGEX = /[.!?]["')\]]?$/;
const RECENT_SUMMARY_LIMIT = 14;
const EARLIER_HIGHLIGHTS_LIMIT = 3;
const EARLIER_SNIPPET_MAX_CHARS = 120;

const ENABLE_DEBUG_LOGS = process.env.SEARCH_DEBUG_LOGS === 'true';

function debugLog(...args) {
  if (ENABLE_DEBUG_LOGS) {
    console.log(...args);
  }
}

app.set('trust proxy', 1);

app.use(helmet());
app.use(express.json({ limit: '5mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '5mb' }));
app.use(cookieParser());
app.use('/static', express.static(path.join(__dirname, 'public')));

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false
});

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Webhook rate limit exceeded.' }
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 150,
  standardHeaders: true,
  legacyHeaders: false
});

app.use(generalLimiter);

const transcriptBuffers = new Map();
const deferredAnalysisTimers = new Map();

function cancelDeferredAnalysis(sessionId) {
  const timer = deferredAnalysisTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    deferredAnalysisTimers.delete(sessionId);
  }
}

function scheduleDeferredAnalysis(buffer, sessionId) {
  if (!buffer) {
    return;
  }
  const effectiveSessionId = sessionId || buffer.sessionId;
  if (!effectiveSessionId) {
    return;
  }
  if (!buffer.nextAnalysisEarliestAt) {
    cancelDeferredAnalysis(effectiveSessionId);
    return;
  }
  const delay = buffer.nextAnalysisEarliestAt - Date.now();
  if (delay <= 0) {
    cancelDeferredAnalysis(effectiveSessionId);
    setTimeout(async () => {
      const latestBuffer = transcriptBuffers.get(effectiveSessionId);
      if (!latestBuffer) {
        return;
      }
      latestBuffer.nextAnalysisEarliestAt = null;
      try {
        await maybeRunSearch(latestBuffer, effectiveSessionId);
      } catch (err) {
        console.error('[Search] Deferred analysis failed:', err.message);
      }
    }, 0);
    return;
  }
  cancelDeferredAnalysis(effectiveSessionId);
  const timer = setTimeout(async () => {
    deferredAnalysisTimers.delete(effectiveSessionId);
    const latestBuffer = transcriptBuffers.get(effectiveSessionId);
    if (!latestBuffer) {
      return;
    }
    latestBuffer.nextAnalysisEarliestAt = null;
    try {
      await maybeRunSearch(latestBuffer, effectiveSessionId);
    } catch (err) {
      console.error('[Search] Deferred analysis failed:', err.message);
    }
  }, delay);
  deferredAnalysisTimers.set(effectiveSessionId, timer);
}

function updateNextAnalysisEarliestAt(buffer, sessionId, timestamp) {
  if (!buffer) {
    return;
  }
  const effectiveSessionId = sessionId || buffer.sessionId;
  buffer.nextAnalysisEarliestAt = typeof timestamp === 'number' ? timestamp : null;
  scheduleDeferredAnalysis(buffer, effectiveSessionId);
}

function cleanupBuffers() {
  const now = Date.now();
  for (const [sessionId, data] of transcriptBuffers.entries()) {
    if (now - data.lastActivity > BUFFER_RETENTION_SECONDS * 1000) {
      cancelDeferredAnalysis(sessionId);
      transcriptBuffers.delete(sessionId);
    }
  }
}

setInterval(cleanupBuffers, 5 * 60 * 1000);

function getOrCreateBuffer(sessionId, uid) {
  const now = Date.now();
  if (!transcriptBuffers.has(sessionId)) {
    transcriptBuffers.set(sessionId, {
      uid,
      sessionId,
      messages: [],
      userSentenceCount: 0,
      lastAnalysis: now - ANALYSIS_COOLDOWN_SECONDS * 1000,
      lastSearch: now - MIN_COOLDOWN_AFTER_SEARCH_SECONDS * 1000,
      lastActivity: now,
      currentUserChunk: null,
      currentUserWordCount: 0,
      lastUserChunkTimestamp: null,
      accumulationStartedAt: null,
      lastUserSpeechAt: null,
      nextAnalysisEarliestAt: null
    });
  } else {
    const buffer = transcriptBuffers.get(sessionId);
    buffer.lastActivity = now;
    buffer.sessionId = sessionId;
    if (buffer.uid !== uid) {
      buffer.uid = uid;
    }
    if (buffer.lastUserSpeechAt === undefined) {
      buffer.lastUserSpeechAt = null;
    }
    if (buffer.nextAnalysisEarliestAt === undefined) {
      buffer.nextAnalysisEarliestAt = null;
    }
    if (!buffer.accumulationStartedAt) {
      refreshAccumulationStart(buffer);
    }
  }
  return transcriptBuffers.get(sessionId);
}

function sanitizeText(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function countSentences(text) {
  if (!text) return 0;
  const segments = text.split(/[.!?]+/).map(segment => segment.trim()).filter(Boolean);
  return segments.length;
}

function countWords(text) {
  if (!text || typeof text !== 'string') {
    return 0;
  }
  return text.split(/\s+/).filter(Boolean).length;
}

function trimBufferMessages(buffer) {
  if (buffer.messages.length > BUFFER_MAX_MESSAGES) {
    buffer.messages = buffer.messages.slice(-BUFFER_MAX_MESSAGES);
  }
}

function recalcUserSentenceCount(buffer) {
  buffer.userSentenceCount = buffer.messages.reduce((count, message) => {
    if (message.speaker !== 'user') {
      return count;
    }
    return count + countSentences(message.text);
  }, 0);
}

function refreshAccumulationStart(buffer) {
  const firstUserMessage = buffer.messages.find((message) => message.speaker === 'user');
  buffer.accumulationStartedAt = firstUserMessage ? firstUserMessage.timestamp : null;
  updateNextAnalysisEarliestAt(buffer, buffer.sessionId, null);
}

function flushUserChunk(buffer, reason) {
  if (!buffer.currentUserChunk || !buffer.currentUserChunk.text?.trim()) {
    return;
  }
  const text = buffer.currentUserChunk.text.trim();
  const chunkTimestamp = buffer.currentUserChunk.timestamp;
  buffer.messages.push({
    speaker: 'user',
    text,
    timestamp: chunkTimestamp
  });
  if (!buffer.accumulationStartedAt) {
    buffer.accumulationStartedAt = chunkTimestamp;
  }
  buffer.lastUserSpeechAt = chunkTimestamp;
  trimBufferMessages(buffer);
  recalcUserSentenceCount(buffer);
  if (reason) {
    debugLog('[Search] flushed user chunk', {
      uid: buffer.uid,
      sessionId: buffer.sessionId,
      reason,
      text
    });
  }
  buffer.currentUserChunk = null;
  buffer.currentUserWordCount = 0;
  buffer.lastUserChunkTimestamp = null;
  updateNextAnalysisEarliestAt(buffer, buffer.sessionId, null);
}

function resolveUid(req) {
  const candidates = [
    req.query?.uid,
    req.body?.uid,
    req.cookies?.search_uid
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length >= 3 && candidate.trim().length <= 50) {
      return candidate.trim().replace(/[^a-zA-Z0-9-_]/g, '');
    }
  }
  return null;
}

function requireUid(req, res, next) {
  const uid = resolveUid(req);
  if (!uid) {
    return res.status(400).json({ error: 'UID missing. Append ?uid=YOUR_ID to the URL or supply it in the request.' });
  }
  req.uid = uid;
  next();
}

function buildConversationSummary(messages, limit = 20) {
  const recent = messages.slice(-limit);
  return recent
    .map(({ speaker, text }) => `${speaker}: ${text}`)
    .join('\n');
}

function buildPromptContext(messages) {
  const recentSummary = buildConversationSummary(messages, RECENT_SUMMARY_LIMIT);
  const earlierMessages = messages.slice(0, -RECENT_SUMMARY_LIMIT);

  if (!earlierMessages.length) {
    return { recentSummary, earlierHighlights: null };
  }

  const highlights = [];
  const seen = new Set();

  for (let i = earlierMessages.length - 1; i >= 0; i -= 1) {
    const message = earlierMessages[i];
    if (message.speaker !== 'user') {
      continue;
    }
    const snippet = message.text?.trim();
    if (!snippet) {
      continue;
    }
    const normalized = snippet.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }
    let truncated = snippet;
    if (truncated.length > EARLIER_SNIPPET_MAX_CHARS) {
      truncated = `${truncated.slice(0, EARLIER_SNIPPET_MAX_CHARS).trim()}…`;
    }
    highlights.push(`- ${truncated}`);
    seen.add(normalized);
    if (highlights.length >= EARLIER_HIGHLIGHTS_LIMIT) {
      break;
    }
  }

  highlights.reverse();

  return {
    recentSummary,
    earlierHighlights: highlights.length ? highlights.join('\n') : null
  };
}

async function fetchUserSettings(uid) {
  if (!supabaseConfigured) {
    return {
      cooldown_seconds: MIN_COOLDOWN_AFTER_SEARCH_SECONDS,
      min_sentences: USER_SENTENCE_THRESHOLD
    };
  }
  try {
    const { data, error } = await supabase
      .from('search_settings')
      .select('cooldown_seconds, min_sentences')
      .eq('uid', uid)
      .maybeSingle();

    if (error) {
      throw error;
    }
    if (!data) {
      return {
        cooldown_seconds: MIN_COOLDOWN_AFTER_SEARCH_SECONDS,
        min_sentences: USER_SENTENCE_THRESHOLD
      };
    }
    return {
      cooldown_seconds: data.cooldown_seconds || MIN_COOLDOWN_AFTER_SEARCH_SECONDS,
      min_sentences: data.min_sentences || USER_SENTENCE_THRESHOLD
    };
  } catch (err) {
    console.error('[Search] Failed to fetch settings for', uid, err.message);
    return {
      cooldown_seconds: MIN_COOLDOWN_AFTER_SEARCH_SECONDS,
      min_sentences: USER_SENTENCE_THRESHOLD
    };
  }
}

async function persistSearchResult(record) {
  if (!supabaseConfigured) {
    return { success: true, id: null };
  }
  try {
    const { data, error } = await supabase
      .from('search_queries')
      .insert([record])
      .select('id')
      .single();

    if (error) {
      throw error;
    }
    return { success: true, id: data.id };
  } catch (err) {
    console.error('[Search] Failed to persist search result:', err.message);
    return { success: false, error: err.message };
  }
}

async function performBraveSearch(queryText) {
  if (!braveApiKey) {
    console.warn('[Search] BRAVE_API_KEY not configured. Skipping search for:', queryText);
    return [];
  }
  try {
    const response = await axios.get('https://api.search.brave.com/res/v1/web/search', {
      params: {
        q: queryText,
        count: 5,
        text_decorations: 0,
        safesearch: 'moderate'
      },
      headers: {
        'Accept': 'application/json',
        'X-Subscription-Token': braveApiKey
      },
      timeout: 7000
    });

    const webResults = response.data?.web?.results || [];
    return webResults.map(result => ({
      title: result.title,
      url: result.url,
      description: result.description,
      source: result.source
    }));
  } catch (err) {
    console.error('[Search] Brave search error:', err.message);
    return [];
  }
}

async function evaluateSearchResults({ query, focus, transcriptExcerpt, results }) {
  if (!openai || !Array.isArray(results) || results.length === 0) {
    return null;
  }

  const limitedResults = results.slice(0, 5);
  const formattedResults = limitedResults
    .map((result, index) => {
      const title = result.title ? result.title.trim() : 'Untitled';
      const description = result.description ? result.description.trim() : 'No description provided.';
      const url = result.url ? result.url.trim() : 'No URL available.';
      const source = result.source ? result.source.trim() : null;
      const sourceLine = source ? `Source: ${source}` : '';
      return `Result ${index}:
Title: ${title}
Description: ${description}
URL: ${url}
${sourceLine}`.trim();
    })
    .join('\n\n');

  const contextSections = [
    focus ? `Search intent: ${focus}` : null,
    transcriptExcerpt ? `Conversation excerpt:\n${transcriptExcerpt}` : null,
    query ? `Original query: ${query}` : null,
    `Candidate results:\n${formattedResults}`
  ]
    .filter(Boolean)
    .join('\n\n');

  const systemPrompt = `
You are assisting an AI agent by selecting the single most relevant web search result and drafting a concise answer based on the provided candidates.
Return strict JSON with the following shape:
{
  "best_index": number (0-based index of the chosen result),
  "answer_summary": string (<= 80 words, actionable and specific, incorporate key facts),
  "confidence": number (0.0-1.0, optional)
}

Rules:
- Consider the conversation focus and query to determine relevance.
- Prefer up-to-date, authoritative sources.
- If information is insufficient, provide the best effort answer but avoid fabricating details.
- Do not include any additional keys beyond those specified.
`.trim();

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-5-nano',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: contextSections }
      ],
      response_format: { type: 'json_object' }
    });

    const raw = completion.choices?.[0]?.message?.content;
    if (!raw) {
      return null;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (parseError) {
      console.error('[Search] Failed to parse selection JSON:', parseError.message);
      return null;
    }

    const bestIndex = Number.isInteger(parsed?.best_index) ? parsed.best_index : null;
    const answerSummary =
      typeof parsed?.answer_summary === 'string' ? parsed.answer_summary.trim() : null;
    const confidence =
      typeof parsed?.confidence === 'number' && !Number.isNaN(parsed.confidence)
        ? parsed.confidence
        : null;

    if (bestIndex === null) {
      return {
        best_index: 0,
        answer_summary: answerSummary,
        confidence
      };
    }

    return {
      best_index: bestIndex,
      answer_summary: answerSummary,
      confidence
    };
  } catch (err) {
    console.error('[Search] Failed to evaluate search results:', err.message);
    return null;
  }
}

async function analyzeConversation(messages) {
  if (!openai) {
    console.warn('[Search] OpenAI client unavailable, skipping analysis.');
    return { should_search: false };
  }

  const { recentSummary, earlierHighlights } = buildPromptContext(messages);
  const systemPrompt = `
You evaluate live conversation transcripts to decide if an internet search is useful.
Return only valid JSON with the shape:
{
  "should_search": boolean,
  "reason": "short explanation",
  "queries": [
    {
      "query": "search phrase",
      "focus": "what information we hope to find"
    }
  ]
}

Guidelines:
- Only set should_search true when the conversation contains a concrete topic that benefits from current or factual lookup.
- Avoid sensitive personal data and medical/legal diagnosis queries.
- Prefer actionable, newsworthy, or informational topics.
- Limit queries to at most 2 per evaluation.
- If unsure, respond with should_search false.
`;

  const contextPrefix = earlierHighlights
    ? `Earlier user context:\n${earlierHighlights}\n\n`
    : '';
  const userPrompt = `${contextPrefix}Conversation (most recent first):
${recentSummary}

Respond with JSON only.`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-5-nano',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      response_format: { type: 'json_object' }
    });

    const raw = completion.choices?.[0]?.message?.content;
    if (!raw) {
      return { should_search: false };
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return { should_search: false };
    }
    parsed.queries = Array.isArray(parsed.queries)
      ? parsed.queries.filter(item => item?.query && typeof item.query === 'string').slice(0, 2)
      : [];
    return parsed;
  } catch (err) {
    console.error('[Search] Topic analysis failed:', err.message);
    return { should_search: false };
  }
}

async function maybeRunSearch(buffer, sessionId) {
  const now = Date.now();
  const settings = await fetchUserSettings(buffer.uid);
  const minSentences = settings.min_sentences || USER_SENTENCE_THRESHOLD;
  const cooldownMs = (settings.cooldown_seconds || MIN_COOLDOWN_AFTER_SEARCH_SECONDS) * 1000;
  const nowSeconds = now / 1000;
  const accumulationAgeSeconds = buffer.accumulationStartedAt
    ? nowSeconds - buffer.accumulationStartedAt
    : null;
  const silenceAgeSeconds = buffer.lastUserSpeechAt
    ? nowSeconds - buffer.lastUserSpeechAt
    : null;

  if (buffer.nextAnalysisEarliestAt && now < buffer.nextAnalysisEarliestAt) {
    debugLog('[Search] skip: analysis deferred until eligibility window', {
      sessionId,
      waitMs: buffer.nextAnalysisEarliestAt - now
    });
    return null;
  }

  debugLog('[Search] maybeRunSearch start', {
    sessionId,
    uid: buffer.uid,
    messages: buffer.messages.length,
    userSentenceCount: buffer.userSentenceCount,
    minSentences,
    accumulationAgeSeconds,
    silenceAgeSeconds,
    sinceLastAnalysisMs: now - buffer.lastAnalysis,
    sinceLastSearchMs: now - buffer.lastSearch
  });

  if (accumulationAgeSeconds === null || accumulationAgeSeconds < MIN_ACCUMULATION_WINDOW_SECONDS) {
    const waitSeconds = accumulationAgeSeconds === null
      ? MIN_ACCUMULATION_WINDOW_SECONDS
      : Math.max(0, MIN_ACCUMULATION_WINDOW_SECONDS - accumulationAgeSeconds);
    const nextEligibleAt = Math.max(
      buffer.nextAnalysisEarliestAt || 0,
      now + waitSeconds * 1000
    );
    updateNextAnalysisEarliestAt(buffer, sessionId, nextEligibleAt);
    debugLog('[Search] skip: accumulation window too short', {
      sessionId,
      accumulationAgeSeconds,
      requiredSeconds: MIN_ACCUMULATION_WINDOW_SECONDS,
      waitSeconds
    });
    return null;
  }

  if (buffer.userSentenceCount < minSentences) {
    debugLog('[Search] skip: not enough user sentences', {
      sessionId,
      userSentenceCount: buffer.userSentenceCount,
      minSentences,
      accumulationAgeSeconds
    });
    return null;
  }

  if (silenceAgeSeconds === null || silenceAgeSeconds < MIN_SILENCE_AFTER_USER_SECONDS) {
    const waitSeconds = silenceAgeSeconds === null
      ? MIN_SILENCE_AFTER_USER_SECONDS
      : Math.max(0, MIN_SILENCE_AFTER_USER_SECONDS - silenceAgeSeconds);
    const nextEligibleAt = Math.max(
      buffer.nextAnalysisEarliestAt || 0,
      now + waitSeconds * 1000
    );
    updateNextAnalysisEarliestAt(buffer, sessionId, nextEligibleAt);
    debugLog('[Search] skip: awaiting post-speech silence', {
      sessionId,
      silenceAgeSeconds,
      requiredSeconds: MIN_SILENCE_AFTER_USER_SECONDS,
      waitSeconds
    });
    return null;
  }

  if (now - buffer.lastAnalysis < ANALYSIS_COOLDOWN_SECONDS * 1000) {
    const waitMs = ANALYSIS_COOLDOWN_SECONDS * 1000 - (now - buffer.lastAnalysis);
    const nextEligibleAt = Math.max(buffer.nextAnalysisEarliestAt || 0, now + waitMs);
    updateNextAnalysisEarliestAt(buffer, sessionId, nextEligibleAt);
    debugLog('[Search] skip: analysis cooldown active', {
      sessionId,
      waitMs
    });
    return null;
  }

  if (now - buffer.lastSearch < cooldownMs) {
    const waitMs = cooldownMs - (now - buffer.lastSearch);
    debugLog('[Search] skip: search cooldown active', {
      sessionId,
      waitMs
    });
    buffer.lastAnalysis = now;
    buffer.userSentenceCount = 0;
    buffer.messages = buffer.messages.slice(-BUFFER_MAX_MESSAGES);
    refreshAccumulationStart(buffer);
    const nextEligibleAt = Math.max(buffer.nextAnalysisEarliestAt || 0, now + waitMs);
    updateNextAnalysisEarliestAt(buffer, sessionId, nextEligibleAt);
    return null;
  }

  buffer.lastAnalysis = now;
  const analysis = await analyzeConversation(buffer.messages);
  debugLog('[Search] analysis result', { sessionId, analysis });
  if (!analysis?.should_search || !Array.isArray(analysis.queries) || analysis.queries.length === 0) {
    debugLog('[Search] skip: analysis opted out of searching', { sessionId });
    buffer.userSentenceCount = 0;
    buffer.messages = buffer.messages.slice(-BUFFER_MAX_MESSAGES);
    refreshAccumulationStart(buffer);
    const nextEligibleAt = Math.max(
      buffer.nextAnalysisEarliestAt || 0,
      now + ANALYSIS_COOLDOWN_SECONDS * 1000
    );
    updateNextAnalysisEarliestAt(buffer, sessionId, nextEligibleAt);
    return null;
  }

  const executed = [];
  let lastSearchTimestamp = null;
  for (const queryInfo of analysis.queries) {
    debugLog('[Search] executing Brave search', {
      sessionId,
      query: queryInfo.query,
      focus: queryInfo.focus || analysis.reason
    });
    const searchResults = await performBraveSearch(queryInfo.query);

    const transcriptExcerpt = buildConversationSummary(buffer.messages, 6);
    const selection = searchResults.length
      ? await evaluateSearchResults({
          query: queryInfo.query,
          focus: queryInfo.focus || analysis.reason || null,
          transcriptExcerpt,
          results: searchResults
        })
      : null;

    let aiBestIndex =
      typeof selection?.best_index === 'number' && Number.isInteger(selection.best_index)
        ? selection.best_index
        : null;

    if (aiBestIndex !== null) {
      if (aiBestIndex < 0 || aiBestIndex >= searchResults.length) {
        aiBestIndex = 0;
      }
    } else if (searchResults.length > 0) {
      aiBestIndex = 0;
    }

    const annotatedResults = searchResults.map((result, index) => ({
      ...result,
      ai_is_pick: aiBestIndex === index
    }));

    const aiSummary =
      typeof selection?.answer_summary === 'string' && selection.answer_summary.trim().length
        ? selection.answer_summary.trim()
        : typeof selection?.summary === 'string' && selection.summary.trim().length
          ? selection.summary.trim()
          : aiBestIndex !== null && annotatedResults[aiBestIndex]?.description
            ? annotatedResults[aiBestIndex].description
            : null;

    const storedResults = {
      items: annotatedResults,
      ai_summary: aiSummary,
      ai_best_index: aiBestIndex,
      ai_confidence:
        typeof selection?.confidence === 'number'
          ? Math.max(0, Math.min(1, selection.confidence))
          : null
    };

    const record = {
      uid: buffer.uid,
      session_id: sessionId,
      query: queryInfo.query,
      reasoning: queryInfo.focus || analysis.reason || null,
      results: storedResults,
      transcript_excerpt: transcriptExcerpt
    };

    await persistSearchResult(record);
    executed.push({
      query: record.query,
      focus: record.reasoning,
      ai_summary: storedResults.ai_summary,
      ai_best_index: storedResults.ai_best_index,
      results: storedResults.items
    });
    lastSearchTimestamp = Date.now();
    buffer.lastSearch = lastSearchTimestamp;
    break;
  }

  const retainedMessages = buffer.messages.slice(-BUFFER_MAX_MESSAGES);
  buffer.messages = retainedMessages;
  buffer.userSentenceCount = retainedMessages.reduce((count, message) => {
    if (message.speaker !== 'user') {
      return count;
    }
    return count + countSentences(message.text);
  }, 0);

  refreshAccumulationStart(buffer);
  if (lastSearchTimestamp) {
    updateNextAnalysisEarliestAt(buffer, sessionId, lastSearchTimestamp + cooldownMs);
  } else {
    const nextEligibleAt = Math.max(
      buffer.nextAnalysisEarliestAt || 0,
      now + ANALYSIS_COOLDOWN_SECONDS * 1000
    );
    updateNextAnalysisEarliestAt(buffer, sessionId, nextEligibleAt);
  }

  debugLog('[Search] search execution complete', {
    sessionId,
    executedCount: executed.length,
    remainingMessages: buffer.messages.length,
    remainingUserSentenceCount: buffer.userSentenceCount
  });

  return {
    reason: analysis.reason,
    executed
  };
}

app.get('/', (req, res) => {
  const uid = typeof req.query.uid === 'string' ? req.query.uid.trim() : null;
  if (!uid) {
    return res.sendFile(path.join(__dirname, 'public', 'enter_uid.html'));
  }
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    supabaseConfigured,
    braveConfigured: Boolean(braveApiKey),
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY)
  });
});

app.get('/privacy', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'privacy.html'));
});

app.post('/api/settings', apiLimiter, requireUid, [
  body('cooldown_seconds').optional().isInt({ min: 30, max: 900 }),
  body('min_sentences').optional().isInt({ min: 1, max: 10 })
], async (req, res) => {
  if (!supabaseConfigured) {
    return res.status(503).json({ error: 'Supabase not configured for persistence.' });
  }
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Invalid settings payload.' });
  }

  const { cooldown_seconds, min_sentences } = req.body;

  try {
    const updatePayload = {
      uid: req.uid
    };
    if (cooldown_seconds !== undefined) {
      updatePayload.cooldown_seconds = cooldown_seconds;
    }
    if (min_sentences !== undefined) {
      updatePayload.min_sentences = min_sentences;
    }

    const { error } = await supabase
      .from('search_settings')
      .upsert([updatePayload], { onConflict: 'uid' });

    if (error) {
      throw error;
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[Search] Failed to save settings:', err.message);
    res.status(500).json({ error: 'Failed to save settings.' });
  }
});

app.get('/api/settings', apiLimiter, requireUid, async (req, res) => {
  const settings = await fetchUserSettings(req.uid);
  res.json(settings);
});

app.get('/api/history', apiLimiter, requireUid, [
  query('limit').optional().isInt({ min: 1, max: 100 })
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Invalid query parameters.' });
  }
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : HISTORY_DEFAULT_LIMIT;

  if (!supabaseConfigured) {
    return res.json({ searches: [] });
  }

  try {
    const { data, error } = await supabase
      .from('search_queries')
      .select('id, query, reasoning, results, transcript_excerpt, created_at')
      .eq('uid', req.uid)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw error;
    }

    res.json({ searches: data || [] });
  } catch (err) {
    console.error('[Search] Failed to fetch history:', err.message);
    res.status(500).json({ error: 'Failed to fetch history.' });
  }
});

app.delete('/api/history/:id', apiLimiter, requireUid, async (req, res) => {
  if (!supabaseConfigured) {
    return res.status(503).json({ error: 'Supabase not configured.' });
  }
  try {
    const { error } = await supabase
      .from('search_queries')
      .delete()
      .eq('uid', req.uid)
      .eq('id', req.params.id);

    if (error) {
      throw error;
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[Search] Failed to delete history entry:', err.message);
    res.status(500).json({ error: 'Failed to delete entry.' });
  }
});

app.post('/webhook', webhookLimiter, [
  body('segments').optional().isArray({ max: 200 }),
  body('segments.*.text').optional().isString().isLength({ max: 2000 }),
  body('segments.*.is_user').optional().isBoolean(),
  body('segments.*.speaker').optional().isString().isLength({ max: 50 }),
  body('segments.*.timestamp').optional().isNumeric()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Invalid webhook payload.' });
  }

  const uid = resolveUid(req);
  if (!uid) {
    return res.status(400).json({ error: 'UID missing in request. Include uid in query, body, or cookie.' });
  }

  const sessionId = sanitizeText(req.query.session_id || req.body.session_id || uid);
  if (!sessionId) {
    return res.status(400).json({ error: 'Missing session identifier.' });
  }

  const buffer = getOrCreateBuffer(sessionId, uid);

  const segments = Array.isArray(req.body.segments) ? req.body.segments : [];
  for (const segment of segments) {
    if (!segment?.text) {
      continue;
    }
    const text = sanitizeText(segment.text);
    if (!text) {
      continue;
    }
    const speaker = segment.is_user ? 'user' : (segment.speaker || 'other');
    const timestamp = segment.timestamp || Date.now() / 1000;
if (speaker === 'user') {
  if (!buffer.accumulationStartedAt) {
    buffer.accumulationStartedAt = timestamp;
    updateNextAnalysisEarliestAt(buffer, buffer.sessionId, null);
  }

  if (
    !buffer.currentUserChunk ||
    (buffer.lastUserChunkTimestamp &&
      timestamp - buffer.lastUserChunkTimestamp > USER_FLUSH_TIMEOUT_SECONDS)
  ) {
    flushUserChunk(buffer, 'timeout');
    buffer.currentUserChunk = { text: text, timestamp };
    buffer.currentUserWordCount = countWords(text);
    buffer.lastUserChunkTimestamp = timestamp;
  } else {
    buffer.currentUserChunk.text += ` ${text}`;
    buffer.currentUserWordCount += countWords(text);
    buffer.lastUserChunkTimestamp = timestamp;
  }


      if (buffer.currentUserWordCount >= USER_WORD_FLUSH_THRESHOLD) {
        flushUserChunk(buffer, 'word-threshold');
      } else if (SENTENCE_END_REGEX.test(text)) {
        flushUserChunk(buffer, 'sentence-complete');
      }
    } else {
      buffer.messages.push({
        speaker,
        text,
        timestamp
      });
      trimBufferMessages(buffer);
    }
  }

  if (
    buffer.currentUserChunk &&
    buffer.lastUserChunkTimestamp &&
    Date.now() / 1000 - buffer.lastUserChunkTimestamp > USER_FLUSH_TIMEOUT_SECONDS
  ) {
    flushUserChunk(buffer, 'post-timeout');
  }

  try {
    const searchOutcome = await maybeRunSearch(buffer, sessionId);
    if (searchOutcome && searchOutcome.executed.length > 0) {
      return res.status(200).json({
        searches: searchOutcome.executed,
        reason: searchOutcome.reason
      });
    }
    return res.status(202).json({});
  } catch (err) {
    console.error('[Search] Error during webhook processing:', err.message);
    return res.status(500).json({ error: 'Internal processing error.' });
  }
});

app.use((err, _req, res, _next) => {
  console.error('[Search] Uncaught error:', err);
  res.status(500).json({ error: 'Internal server error.' });
});

app.listen(PORT, () => {
  console.log(`Search app listening on port ${PORT}`);
});

module.exports = app;