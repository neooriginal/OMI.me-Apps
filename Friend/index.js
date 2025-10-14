/*
 * Copyright (c) 2025 Neo (github.com/neooriginal)
 * All rights reserved.
 */

const express = require("express");
const app = express();
const { createClient } = require('@supabase/supabase-js');
const bodyParser = require("body-parser");
const axios = require("axios");
const { OpenAI } = require("openai");
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { body, validationResult, query } = require('express-validator');

const dotenv = require("dotenv");
dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Rate limiting
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // limit webhook to 30 requests per minute
  message: { error: 'Webhook rate limit exceeded.' },
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // limit API calls to 50 per 15 minutes
  message: { error: 'API rate limit exceeded.' },
});

//app.use(generalLimiter);

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

let previousDiscussions = [];
let previousDiscusstionsFull = [];
let lastRating = [];
let ratingCooldown = [];

// Common stop words for text analysis
const stopWords = new Set([
  'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i', 'it', 'for', 'you', 'he',
  'she', 'we', 'they', 'me', 'him', 'her', 'us', 'them', 'his', 'her', 'its', 'our',
  'their', 'this', 'these', 'those', 'am', 'is', 'are', 'was', 'were', 'will', 'shall',
  'can', 'could', 'may', 'might', 'do', 'does', 'did', 'doing', 'done', 'an', 'if', 'or',
  'so', 'but', 'because', 'as', 'until', 'while', 'of', 'on', 'at', 'by', 'with', 'about',
  'against', 'between', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'to', 'from', 'up', 'down', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
  'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'any', 'both', 'each',
  'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
  'same', 'so', 'than', 'too', 'very', 's', 't', 'can', 'just', 'don', 'should', 'now',
  'd', 'll', 'm', 'o', 're', 've', 'y', 'ain', 'aren', 'couldn', 'didn', 'doesn', 'hadn',
  'hasn', 'haven', 'isn', 'ma', 'mightn', 'mustn', 'needn', 'shan', 'shouldn', 'wasn',
  'weren', 'won', 'wouldn', "has", "i'm", "you're", "he's", "she's", "it's", "we're", "they're",
  "rather", "every", "both", "follow", "along", "going", "much", "something", "nothing", "everything", "nowhere", "somewhere", "anywhere", "everywhere", "whatever", "whichever", "whoever", "whomsoever", "whosoever", "whoso", "been", "what", "being", "way", "had", "which"
]);

const POSITIVE_SENTIMENT_TERMS = new Set([
  'great',
  'amazing',
  'awesome',
  'good',
  'love',
  'happy',
  'excited',
  'grateful',
  'thanks',
  'appreciate',
  'fantastic',
  'wonderful'
]);

const NEGATIVE_SENTIMENT_TERMS = new Set([
  'bad',
  'sad',
  'angry',
  'upset',
  'hate',
  'terrible',
  'frustrated',
  'worried',
  'anxious',
  'annoyed',
  'stressed',
  'overwhelmed'
]);

const BASE_TIME_DISTRIBUTION = Object.freeze({
  morning: 0,
  afternoon: 0,
  evening: 0,
  night: 0,
});

const BASE_SENTIMENT = Object.freeze({
  overall: 'neutral',
  confidence: 0.5,
});

const WORD_COUNT_STORAGE_LIMIT = 200;
const RECENT_ACTIVITY_LIMIT = 200;
const SENTIMENT_HISTORY_LIMIT = 50;
const LOG_HISTORY_LIMIT = 500;
const DEFAULT_PERSONALITY = "100% chill; 35% friendly; 55% teasing; 10% thoughtful; 20% humorous; 5% deep; 20% nik";

function createDefaultTimeDistribution() {
  return { ...BASE_TIME_DISTRIBUTION };
}

function createDefaultAnalyticsState() {
  return {
    totalConversations: 0,
    sentiment: { ...BASE_SENTIMENT },
    sentimentHistory: [],
    recentActivity: [],
  };
}
function parseJsonObject(raw, fallbackFactory) {
  const baseValue = fallbackFactory();
  if (raw === null || raw === undefined) {
    return baseValue;
  }

  if (typeof raw === 'string') {
    if (!raw.trim()) {
      return baseValue;
    }
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { ...baseValue, ...parsed };
      }
      return baseValue;
    } catch {
      return baseValue;
    }
  }

  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return { ...baseValue, ...raw };
  }

  return baseValue;
}

function parseWordCounts(raw) {
  const parsed = parseJsonObject(raw, () => ({}));
  const sanitized = {};

  for (const [word, count] of Object.entries(parsed)) {
    if (typeof word === 'string' && Number.isFinite(count) && count > 0) {
      sanitized[word] = count;
    }
  }

  return sanitized;
}

function mergeWordCounts(baseCounts, deltaCounts) {
  const merged = { ...baseCounts };

  for (const [word, count] of Object.entries(deltaCounts)) {
    merged[word] = (merged[word] || 0) + count;
  }

  return merged;
}

function pruneWordCounts(wordCounts, limit = WORD_COUNT_STORAGE_LIMIT) {
  const entries = Object.entries(wordCounts)
    .filter(([, value]) => Number.isFinite(value) && value > 0)
    .sort(([, a], [, b]) => b - a);

  if (entries.length <= limit) {
    return Object.fromEntries(entries);
  }

  return Object.fromEntries(entries.slice(0, limit));
}

function countWords(text) {
  if (!text || typeof text !== 'string') {
    return 0;
  }
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .length;
}

function sanitizeWordForCounting(word) {
  if (!word) {
    return '';
  }
  return word.replace(/[^\w']/g, '').toLowerCase();
}

function buildWordCountsFromMessages(messages) {
  const counts = {};

  for (const message of messages) {
    if (!message?.is_user || typeof message.text !== 'string') {
      continue;
    }

    const words = message.text.toLowerCase().split(/\s+/);
    for (const rawWord of words) {
      const sanitized = sanitizeWordForCounting(rawWord);
      if (
        sanitized.length > 2 &&
        !stopWords.has(sanitized) &&
        /^[a-z0-9']+$/.test(sanitized)
      ) {
        counts[sanitized] = (counts[sanitized] || 0) + 1;
      }
    }
  }

  return counts;
}

function countWordsInMessages(messages) {
  return messages.reduce((total, message) => total + countWords(message?.text ?? ''), 0);
}

function getConversationTimestamp(messages, fallbackSeconds) {
  const lastMessage = messages[messages.length - 1];
  const timestampSeconds = Number(lastMessage?.timestamp);
  if (Number.isFinite(timestampSeconds) && timestampSeconds > 0) {
    return timestampSeconds;
  }
  return fallbackSeconds;
}

function buildSentimentText(messages) {
  const userMessages = messages
    .filter((message) => message?.is_user && typeof message.text === 'string')
    .map((message) => message.text.trim())
    .filter(Boolean);

  return userMessages.join('\n');
}

function parseTimeDistribution(raw) {
  const parsed = parseJsonObject(raw, createDefaultTimeDistribution);
  const distribution = createDefaultTimeDistribution();

  for (const key of Object.keys(distribution)) {
    const value = Number(parsed[key]);
    distribution[key] = Number.isFinite(value) && value >= 0 ? value : 0;
  }

  return distribution;
}

function parseAnalytics(raw) {
  const parsed = parseJsonObject(raw, createDefaultAnalyticsState);

  const sentimentRaw = parsed.sentiment;
  const sentiment =
    sentimentRaw && typeof sentimentRaw === 'object'
      ? {
          overall:
            typeof sentimentRaw.overall === 'string'
              ? sentimentRaw.overall
              : BASE_SENTIMENT.overall,
          confidence: Number.isFinite(Number(sentimentRaw.confidence))
            ? Number(sentimentRaw.confidence)
            : BASE_SENTIMENT.confidence,
        }
      : { ...BASE_SENTIMENT };

  const sanitizeHistoryEntry = (entry) => {
    if (!entry || typeof entry !== 'object') {
      return null;
    }
    const timestamp = Number(entry.timestamp);
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      return null;
    }
    const overall =
      typeof entry.overall === 'string' ? entry.overall : sentiment.overall;
    const confidence = Number(entry.confidence);
    return {
      timestamp,
      overall,
      confidence: Number.isFinite(confidence) ? confidence : sentiment.confidence,
    };
  };

  const sentimentHistory = Array.isArray(parsed.sentimentHistory)
    ? parsed.sentimentHistory
        .map(sanitizeHistoryEntry)
        .filter(Boolean)
        .slice(-SENTIMENT_HISTORY_LIMIT)
    : [];

  const recentActivity = Array.isArray(parsed.recentActivity)
    ? parsed.recentActivity
        .map((entry) => {
          if (!entry || typeof entry !== 'object') {
            return null;
          }
          const timestamp = Number(entry.timestamp);
          const userMessages = Number(entry.userMessages);
          const friendMessages = Number(entry.friendMessages);
          if (!Number.isFinite(timestamp) || timestamp <= 0) {
            return null;
          }
          return {
            timestamp,
            userMessages: Number.isFinite(userMessages) ? userMessages : 0,
            friendMessages: Number.isFinite(friendMessages) ? friendMessages : 0,
          };
        })
        .filter(Boolean)
        .slice(-RECENT_ACTIVITY_LIMIT)
    : [];

  return {
    totalConversations: Number.isFinite(Number(parsed.totalConversations))
      ? Number(parsed.totalConversations)
      : 0,
    sentiment,
    sentimentHistory,
    recentActivity,
  };
}

function incrementTimeDistribution(distribution, timestampSeconds) {
  const updated = parseTimeDistribution(distribution);
  const date = new Date(
    Number.isFinite(timestampSeconds)
      ? timestampSeconds * 1000
      : Date.now(),
  );
  const hour = date.getHours();

  if (hour >= 6 && hour < 12) {
    updated.morning += 1;
  } else if (hour >= 12 && hour < 18) {
    updated.afternoon += 1;
  } else if (hour >= 18 && hour < 22) {
    updated.evening += 1;
  } else {
    updated.night += 1;
  }

  return updated;
}

function trimArrayToLimit(array, limit) {
  if (!Array.isArray(array) || array.length <= limit) {
    return Array.isArray(array) ? array : [];
  }
  return array.slice(-limit);
}

function parseLogs(raw) {
  if (Array.isArray(raw)) {
    return raw.filter(entry => entry && typeof entry === 'object');
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) {
      return [];
    }
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed.filter(entry => entry && typeof entry === 'object') : [];
    } catch {
      return [];
    }
  }

  return [];
}

function normalizeGoalsForPrompt(raw) {
  if (!raw) {
    return '[]';
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) {
      return '[]';
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed) || (parsed && typeof parsed === 'object')) {
        return JSON.stringify(parsed);
      }
    } catch {
      // Not JSON, fall through to return trimmed string
    }
    return trimmed;
  }

  if (Array.isArray(raw) || typeof raw === 'object') {
    try {
      return JSON.stringify(raw);
    } catch {
      return '[]';
    }
  }

  return '[]';
}

function appendLogEntry(existingLogs, newEntry, limit = LOG_HISTORY_LIMIT) {
  const baseLogs = Array.isArray(existingLogs) ? existingLogs : [];
  return trimArrayToLimit([...baseLogs, newEntry], limit);
}

function deriveSentimentFromMessages(messages) {
  const text = buildSentimentText(messages).toLowerCase();
  if (!text) {
    return { overall: BASE_SENTIMENT.overall, confidence: BASE_SENTIMENT.confidence };
  }

  let positiveScore = 0;
  let negativeScore = 0;

  POSITIVE_SENTIMENT_TERMS.forEach((term) => {
    const matches = text.match(new RegExp(`\\b${term}\\b`, 'g'));
    if (matches) {
      positiveScore += matches.length;
    }
  });

  NEGATIVE_SENTIMENT_TERMS.forEach((term) => {
    const matches = text.match(new RegExp(`\\b${term}\\b`, 'g'));
    if (matches) {
      negativeScore += matches.length;
    }
  });

  let overall = BASE_SENTIMENT.overall;
  if (positiveScore > negativeScore) {
    overall = 'positive';
  } else if (negativeScore > positiveScore) {
    overall = 'negative';
  }

  const confidenceDelta = Math.min(0.4, Math.abs(positiveScore - negativeScore) * 0.1);
  const confidence = Math.min(0.9, BASE_SENTIMENT.confidence + confidenceDelta);

  return { overall, confidence };
}

function updateAnalyticsState(existingAnalyticsRaw, logEntry) {
  const analytics = parseAnalytics(existingAnalyticsRaw);
  const timestamp = Number(logEntry?.timestamp) || Math.floor(Date.now() / 1000);
  const userMessages = Array.isArray(logEntry?.messages)
    ? logEntry.messages.filter((msg) => msg?.is_user).length
    : 0;
  const friendMessages = Array.isArray(logEntry?.messages)
    ? logEntry.messages.length - userMessages
    : 0;

  analytics.totalConversations += 1;

  analytics.recentActivity = trimArrayToLimit([
    ...analytics.recentActivity,
    {
      timestamp,
      userMessages,
      friendMessages
    }
  ], RECENT_ACTIVITY_LIMIT);

  const sentimentSummary = deriveSentimentFromMessages(logEntry?.messages || []);
  analytics.sentiment = sentimentSummary;
  analytics.sentimentHistory = trimArrayToLimit([
    ...analytics.sentimentHistory,
    {
      timestamp,
      overall: sentimentSummary.overall,
      confidence: sentimentSummary.confidence
    }
  ], SENTIMENT_HISTORY_LIMIT);

  return analytics;
}

// Middleware to parse JSON bodies with size limits
app.use(express.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use('/css', express.static(path.join(__dirname, 'public', 'css')));
app.use('/js', express.static(path.join(__dirname, 'public', 'js')));
app.use('/images', express.static(path.join(__dirname, 'public', 'images')));
app.use(express.static(path.join(__dirname, 'public')));

let cooldown = [];
let cooldownTimeCache = [];

// Supabase table initialization (only when env is configured)

class MessageBuffer {
  constructor() {
    this.buffers = {};
    this.cleanupInterval = 300; // 5 minutes in seconds
    this.silenceThreshold = 120; // 2 minutes silence threshold
    this.minWordsAfterSilence = 5; // Minimum words needed after silence

    // Start periodic cleanup
    setInterval(() => {
      this.cleanupOldSessions();
    }, this.cleanupInterval * 1000);
  }

  getBuffer(sessionId) {
    const currentTime = Date.now() / 1000;

    if (!this.buffers[sessionId]) {
      this.buffers[sessionId] = {
        messages: [],
        lastAnalysisTime: currentTime,
        lastActivity: currentTime,
        wordsAfterSilence: 0,
        silenceDetected: false,
      };
    } else {
      const buffer = this.buffers[sessionId];
      const timeSinceActivity = currentTime - buffer.lastActivity;

      if (timeSinceActivity > this.silenceThreshold) {
        buffer.silenceDetected = true;
        buffer.wordsAfterSilence = 0;
        buffer.messages = []; // Clear old messages after silence
        console.log(
          `Silence detected for session ${sessionId}, messages cleared`,
        );
      }

      buffer.lastActivity = currentTime;
    }

    return this.buffers[sessionId];
  }

  cleanupOldSessions() {
    const currentTime = Date.now() / 1000;
    const expiredSessions = Object.keys(this.buffers).filter((sessionId) => {
      const data = this.buffers[sessionId];
      return currentTime - data.lastActivity > 3600; // Remove sessions older than 1 hour
    });

    for (const sessionId of expiredSessions) {
      delete this.buffers[sessionId];
      console.log(`Session ${sessionId} removed due to inactivity`);
    }
  }
}

app.get("/", (req, res) => {
  if (!req.query.uid) {
    return res.sendFile(__dirname + "/public/enter_uid.html");
  }
  // Check if there's a returnTo parameter and redirect if present
  const returnTo = req.query.returnTo;
  if (returnTo) {
    return res.redirect(`${returnTo}?uid=${req.query.uid}`);
  }

  res.sendFile(__dirname + "/public/dashboard.html");
});

app.get("/deleteData", async (req, res) => {
  let uid = req.query.uid;
  try {
    await supabase
      .from('frienddb')
      .delete()
      .eq('uid', uid);

    res.redirect("/?deleted=true");
  } catch (err) {
    console.error("Failed to delete data:", err.message);
    res.status(500).json({ error: "Failed to delete data" });
  }
});

app.get("/reRate", async (req, res) => {
  let uid = req.query.uid;
  if (ratingCooldown[uid] && Date.now() - ratingCooldown[uid] < 60000) {
    rateConversations(uid);
    ratingCooldown[uid] = Date.now();
    res.status(200).json({ success: true });
  } else {
    res.status(202).json({ success: false });
  }
})
app.get("/settings", (req, res) => {
  if (!req.query.uid) {
    return res.status(400).json({ error: "Missing UID" });
  }
  res.sendFile(__dirname + "/public/settings.html");
})
app.get("/privacyPolicy", (req, res) => {
  res.sendFile(__dirname + "/public/privacy.html");
})

// Input validation middleware
const validateUID = (req, res, next) => {
  const uid = req.body.uid || req.query.uid;
  if (!uid) {
    return res.status(400).json({ error: "Missing UID" });
  }

  // Basic UID validation
  if (typeof uid !== 'string' || uid.length > 50 || uid.trim() !== uid) {
    return res.status(400).json({ error: "Invalid UID format" });
  }

  next();
};

// Input sanitization helper
const sanitizeInput = (input) => {
  if (typeof input !== 'string') return input;
  return input.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<[^>]*>?/gm, '')
    .trim();
};

// Error handling middleware
const errorHandler = (err, req, res, next) => {
  console.error("Error:", err);
  res.status(500).json({ error: "Internal server error" });
};

app.post("/dashboardData", validateUID, async (req, res, next) => {
  try {
    const uid = req.body.uid;

    const { data: userData } = await supabase
      .from('frienddb')
      .select('listenedto, rating')
      .eq('uid', uid)
      .single();

    if (!userData) {
      // Create user if doesn't exist
      await supabase
        .from('frienddb')
        .upsert([{ uid }]);

      res.json({
        listenedto: 0,
        rating: 100
      });
    } else {
      res.json({
        listenedto: parseInt(userData.listenedto) || 0,
        rating: parseInt(userData.rating) || 100
      });
    }
  } catch (err) {
    next(err);
  }
});

// Add error handling middleware at the end
app.use(errorHandler);

// 404 handler for unmatched routes and static files
app.use((req, res, next) => {
  // If the request is for a static asset (CSS, JS, images), return 404
  if (req.path.startsWith('/css/') || req.path.startsWith('/js/') || req.path.startsWith('/images/')) {
    return res.status(404).send('File not found');
  }

  // For other routes, continue to next middleware
  next();
});

// Validation middleware for save endpoint
const validateSaveInput = (req, res, next) => {
  const { responsepercentage, cooldown } = req.body;

  if (responsepercentage !== undefined && (isNaN(responsepercentage) || responsepercentage < 0 || responsepercentage > 100)) {
    return res.status(400).json({ error: "Response percentage must be between 0 and 100" });
  }

  if (cooldown !== undefined && (isNaN(cooldown) || cooldown < 1 || cooldown > 60)) {
    return res.status(400).json({ error: "Cooldown must be between 1 and 60 minutes" });
  }

  next();
};

app.post("/deleteuser", validateUID, async (req, res, next) => {
  const uid = req.body.uid;
  try {
    await supabase
      .from('frienddb')
      .delete()
      .eq('uid', uid);

    res.json({ success: true, message: "User data deleted successfully" });
  } catch (err) {
    next(err);
  }
});

app.post("/save", apiLimiter, validateUID, validateSaveInput, [
  body('customInstruction').optional().isString().isLength({ max: 2000 }),
  body('custominstruction').optional().isString().isLength({ max: 2000 }),
  body('personality').optional().isString().isLength({ max: 500 }),
], async (req, res, next) => {
  // Check validation results
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: "Invalid input data" });
  }

  try {
    const uid = sanitizeInput(req.body.uid);
    const responsepercentageRaw = parseInt(req.body.responsepercentage, 10);
    const customInstructionValue = sanitizeInput(
      (req.body.customInstruction ?? req.body.custominstruction ?? "")
    );
    const personality = sanitizeInput(req.body.personality);
    const cooldownRaw = parseInt(req.body.cooldown, 10);

    const normalizedResponsepercentage = Number.isFinite(responsepercentageRaw) ? responsepercentageRaw : 10;
    const normalizedCooldown = Number.isFinite(cooldownRaw) ? cooldownRaw : 5;

    const updateData = {
      uid,
      responsepercentage: normalizedResponsepercentage,
      custominstruction: customInstructionValue,
      cooldown: normalizedCooldown
    };

    if (personality) {
      let formattedPersonality = personality;
      if (personality.includes(':')) {
        formattedPersonality = personality.split(',')
          .map(trait => {
            const [name, value] = trait.split(':');
            return `${value}% ${name}`;
          })
          .join('; ');
      }
      updateData.personality = formattedPersonality;
    }

    const { error: upsertError } = await supabase
      .from('frienddb')
      .upsert([updateData], { onConflict: 'uid' });

    if (upsertError) {
      console.error("Failed to save settings:", upsertError);
      return res.status(500).json({ error: "Failed to save settings" });
    }

    cooldownTimeCache[uid] = normalizedCooldown;

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

app.post("/get", validateUID, async (req, res, next) => {
  try {
    const uid = req.body.uid;
    const { data: rows } = await supabase
      .from('frienddb')
      .select('responsepercentage, custominstruction, personality, cooldown')
      .eq('uid', uid)
      .single();

    if (!rows) {
      await supabase
        .from('frienddb')
        .upsert([{ uid }]);

      const defaultData = {
        responsepercentage: 10,
        customInstruction: "",
        custominstruction: "",
        personality: "100% chill; 35% friendly; 55% teasing; 10% thoughtful; 20% humorous; 5% deep; 20% nik",
        cooldown: 5
      };
      cooldownTimeCache[uid] = defaultData.cooldown;
      res.json(defaultData);
    } else {
      const parsedResponsepercentage = parseInt(rows.responsepercentage, 10);
      const parsedCooldown = parseInt(rows.cooldown, 10);
      const storedCustomInstruction =
        rows.customInstruction ??
        rows.custominstruction ??
        "";

      const data = {
        responsepercentage: Number.isFinite(parsedResponsepercentage) ? parsedResponsepercentage : 10,
        customInstruction: storedCustomInstruction,
        custominstruction: storedCustomInstruction,
        personality: rows.personality || "100% chill; 35% friendly; 55% teasing; 10% thoughtful; 20% humorous; 5% deep; 20% nik",
        cooldown: Number.isFinite(parsedCooldown) ? parsedCooldown : 5
      };
      cooldownTimeCache[uid] = data.cooldown;
      res.json(data);
    }
  } catch (err) {
    next(err);
  }
});

// Initialize message buffer and core functionality
const messageBuffer = new MessageBuffer();
const ANALYSIS_INTERVAL = 30;

async function createNotificationPrompt(messages, uid, probabilityToRespond = 50, userContext) {
  let customInstruction = "";
  let personality = DEFAULT_PERSONALITY;
  let goalsRaw = '[]';
  let listenedTo = null;

  if (userContext && typeof userContext === 'object') {

    if (typeof userContext.customInstruction === 'string') {
      customInstruction = userContext.customInstruction;
      console.log("[Friend] Using provided custom instruction");
    }
    if (typeof userContext.personality === 'string' && userContext.personality.trim()) {
      personality = userContext.personality;
    }
    if (userContext.goals !== undefined) {
      goalsRaw = userContext.goals;
    }
    if (Number.isFinite(Number(userContext.listenedTo))) {
      listenedTo = Number(userContext.listenedTo);
    }
  } else {
    try {
      const { data: result } = await supabase
        .from('frienddb')
        .select('custominstruction, customInstruction:custominstruction, personality, goals, listenedto')
        .eq('uid', uid)
        .single();

      if (result) {
        const storedInstruction =
          result.custominstruction ??
          result.customInstruction ??
          "";
        customInstruction = storedInstruction;
        personality = result.personality || DEFAULT_PERSONALITY;
        goalsRaw = result.goals ?? '[]';

        const listenedCandidate = result.listenedto ?? result.listenedTo;
        if (Number.isFinite(Number(listenedCandidate))) {
          listenedTo = Number(listenedCandidate);
        }
      }
    } catch (err) {
      console.error("Failed to get user data from database:", err.message);
    }
  }

  const goals = normalizeGoalsForPrompt(goalsRaw);
  const profileMetadata = {
    customInstruction,
    personality,
    goals,
    listenedTo
  };

  const formattedDiscussion = messages.map((msg) => {
    const speaker = msg.is_user ? "{{user_name}}" : "other";
    return `${msg.text} (${speaker})`;
  });

  const discussionText = formattedDiscussion.join("\n");

  if (!previousDiscussions[uid])
    previousDiscussions[uid] = { all: [], answered: [] };
  previousDiscussions[uid].all.push(discussionText);
  if (previousDiscussions[uid].all.length > 10) {
    previousDiscussions[uid].all.shift();
  }

  if (!previousDiscusstionsFull[uid]) previousDiscusstionsFull[uid] = [];
  previousDiscusstionsFull[uid].push(discussionText);

  if (previousDiscusstionsFull[uid].length - lastRating[uid] >= 100) {
    rateConversations(uid);
  }

  let prePrompt = `
    You are supposed to be a close friend to the user and provide personalized comments on the conversation.
    The user has set the frequency to ${probabilityToRespond}%. Interpret this and decide whether to respond or not based on this probability and the guidelines below. If 100% is set, you should always respond with true. If 0% is set, you should always respond with false.
    If the user especially asks you to respond (eg. Friend please respond to me), you should respond always regardless of the probability.
    Make sure to really think about, if its worth to send a notification to the user, since the user gets a phone notification every time you respond and it could get annoying if its not useful. Make sure not to respond to some random stuff. Also make sure not to respond to things that are not worth mentioning.
    Your task is to either respond with true or false based on if you would send a notification to the user based on the conversation below.
    Here are some previous discussions where you have commented in the past for context (limited to the last 10). Make sure to use this context to decide if you should respond or not also that you dont repeat yourself.
    ${previousDiscussions[uid].answered.toString("\n")}

    start with either saying true or false
    The Format you should respond with is:
    true/false;
    Reasoning: YOUR REASONING HERE

    use your best judgement to decide when to respond and when not to. if you are unsure, it is better to not respond than to say something that is not good.

    Conversation:
    ${discussionText}
    `;

  const body = {
    model: "gpt-5-nano",
    messages: [{ role: "user", content: prePrompt }],
  };

  const response = await openai.chat.completions.create(body);

  const rawDecision = response?.choices?.[0]?.message?.content || "";
  const normalizedDecision = rawDecision.trim().toLowerCase();
  const decisionMatch = normalizedDecision.match(/^(true|false)/);
  const respond = decisionMatch ? decisionMatch[1] : "true";
  const reasonText =
    rawDecision.split(/reasoning\s*:/i)[1]?.trim() || null;

  console.log("[Friend] notification decision", {
    uid,
    probabilityToRespond,
    decision: respond,
    reason: reasonText || rawDecision.trim(),
  });

  if (!decisionMatch) {
    console.warn("Notification decision in unexpected format:", rawDecision);
  }

  if (respond === "true") {
    let systemPrompt = `
    You are a friend to the user. You care about their well-being and are always there to support them. You have access to information about the user's personality, goals, and previous conversations to provide personalized responses.

    User's Custom Instructions. Do your best to follow the instructions, even if they go against the other prompt guidelines: ${customInstruction}
    User's Personality Traits (less priority then custom instruction): ${personality}
    User's Goals: ${goals}

    keep answers short and try to interpret what was said as the transcript may be incorrect

    Based on the conversation below, provide a personalized response that reflects your understanding of the user and maintains the instructions and personality traits provided.

    Current conversation:
    ${discussionText}
    `;

    previousDiscussions[uid].answered.push(discussionText);
    if (previousDiscussions[uid].answered.length > 10) {
      previousDiscussions[uid].answered.shift();
    }

    return {
      notification: {
        prompt: systemPrompt,
        params: ["user_name", "user_facts"],
      },
      profile: profileMetadata
    };
  } else {
    return { profile: profileMetadata };
  }
}

async function rateConversations(uid) {
  if (!lastRating[uid]) lastRating[uid] = 0;
  if (!ratingCooldown[uid]) ratingCooldown[uid] = 0;
  if (Date.now() - ratingCooldown[uid] < 3600000) return;

  ratingCooldown[uid] = Date.now();
  lastRating[uid] = previousDiscusstionsFull[uid].length;
  let rating = undefined;

  try {
    const { data: result } = await supabase
      .from('frienddb')
      .select('rating')
      .eq('uid', uid)
      .single();

    rating = result?.rating || 100;
  } catch (err) {
    console.error("Error getting rating:", err);
    rating = 100;
  }

  const recentDiscussions = previousDiscusstionsFull[uid]
    .slice(-100)
    .join("\n\n");

  const ratingPrompt = `
    Rate the quality of these recent conversations on a scale of 1-100, where:
    - 100: Excellent conversations with great engagement, meaningful exchanges, and positive interactions
    - 80-99: Good conversations with solid engagement and mostly positive interactions
    - 60-79: Average conversations with moderate engagement
    - 40-59: Below average conversations with limited engagement
    - 20-39: Poor conversations with minimal meaningful exchange
    - 1-19: Very poor conversations with almost no value

    Current rating: ${rating}
    
    Recent conversations:
    ${recentDiscussions}
    
    Provide only a number between 1-100 as your response.
  `;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5-nano",
      messages: [{ role: "user", content: ratingPrompt }],
    });

    const newRating = parseInt(response.choices[0].message.content.trim());

    if (newRating >= 1 && newRating <= 100) {
      await supabase
        .from('frienddb')
        .update({ rating: newRating })
        .eq('uid', uid);
    }
  } catch (err) {
    console.error("Error rating conversations:", err);
  }
}

app.post("/webhook", webhookLimiter, [
  body('session_id').isString().isLength({ min: 1, max: 50 }).trim(),
  body('segments').optional().isArray({ max: 100 }),
  body('segments.*.text').optional().isString().isLength({ max: 1000 }),
  body('segments.*.is_user').optional().isBoolean(),
], async (req, res) => {
  // Check validation results
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: "Invalid input data" });
  }

  const data = req.body;
  const sessionId = sanitizeInput(data.session_id);
  const segments = data.segments || [];

  if (!sessionId) {
    console.error("No session_id provided");
    return res.status(400).json({ message: "No session_id provided" });
  }

  const currentTime = Date.now() / 1000;
  const bufferData = messageBuffer.getBuffer(sessionId);

  // Process new messages
  for (const segment of segments) {
    if (!segment.text) continue;

    const text = sanitizeInput(segment.text.trim());
    if (text && text.length <= 1000) {  // Limit text length
      const timestamp = segment.start || currentTime;
      const isUser = segment.is_user || false;

      // Count words after silence
      if (bufferData.silenceDetected) {
        const wordsInSegment = text.split(/\s+/).length;
        bufferData.wordsAfterSilence += wordsInSegment;

        if (bufferData.wordsAfterSilence >= messageBuffer.minWordsAfterSilence) {
          bufferData.silenceDetected = false;
          bufferData.lastAnalysisTime = currentTime;
          console.log(
            `Silence period ended for session ${sessionId}, starting fresh conversation`,
          );
        }
      }

      const lastMessage = bufferData.messages[bufferData.messages.length - 1];
      const canAppend =
        bufferData.messages.length > 0 &&
        Math.abs(lastMessage.timestamp - timestamp) < 2.0 &&
        lastMessage.is_user === isUser;

      if (canAppend) {
        lastMessage.text += " " + text;
      } else {
        bufferData.messages.push({
          text: text,
          timestamp: timestamp,
          is_user: isUser,
        });
      }
    }
  }

  // Check if it's time to analyze
  const timeSinceLastAnalysis = currentTime - bufferData.lastAnalysisTime;

  if (
    timeSinceLastAnalysis >= ANALYSIS_INTERVAL &&
    bufferData.messages.length > 0 &&
    !bufferData.silenceDetected
  ) {
    const sortedMessages = bufferData.messages.sort(
      (a, b) => a.timestamp - b.timestamp,
    );

    let userProfileContext = null;

    // Update analytics in database
    try {
      const uid = sessionId;

      const { data: selectData, error: selectError } = await supabase
        .from('frienddb')
        .select('logs, word_counts, time_distribution, total_words, analytics, listenedto, custominstruction, customInstruction:custominstruction, personality, goals')
        .eq('uid', uid)
        .single();

      if (selectError && selectError.code !== 'PGRST116') {
        console.error('Error selecting analytics row:', selectError);
      }

      let rowData = selectData;
      if (!rowData) {
        rowData = {
          uid,
          logs: [],
          word_counts: {},
          time_distribution: createDefaultTimeDistribution(),
          total_words: 0,
          analytics: createDefaultAnalyticsState(),
          listenedto: 0,
          custominstruction: '',
          personality: DEFAULT_PERSONALITY,
          goals: []
        };

        const { error: upsertInitError } = await supabase
          .from('frienddb')
          .upsert([rowData], { onConflict: 'uid' });

        if (upsertInitError && upsertInitError.code !== '23505') {
          console.error('Error initializing analytics row:', upsertInitError);
        }
      }

      const existingLogs = parseLogs(rowData.logs);
      const existingWordCounts = parseWordCounts(rowData.word_counts);
      const existingTimeDistribution = parseTimeDistribution(rowData.time_distribution);
      const existingTotalWords = Number(rowData.total_words) || 0;
      const existingAnalyticsRaw = rowData.analytics ?? createDefaultAnalyticsState();
      const existingListenedTo = Number(rowData.listenedto ?? rowData.listenedTo ?? 0);
      const storedInstruction = rowData.custominstruction ?? rowData.customInstruction ?? '';
      const storedPersonality = rowData.personality || DEFAULT_PERSONALITY;
      const storedGoals = rowData.goals ?? [];

      const newLogEntry = {
        timestamp: currentTime,
        messages: sortedMessages,
      };

      const updatedLogs = appendLogEntry(existingLogs, newLogEntry);
      const updatedWordCounts = pruneWordCounts(
        mergeWordCounts(existingWordCounts, buildWordCountsFromMessages(newLogEntry.messages))
      );
      const updatedTotalWords = existingTotalWords + countWordsInMessages(newLogEntry.messages);
      const updatedTimeDistribution = incrementTimeDistribution(existingTimeDistribution, newLogEntry.timestamp);
      const updatedAnalytics = updateAnalyticsState(existingAnalyticsRaw, newLogEntry);
      const updatedListenedTo = existingListenedTo + 1;

      userProfileContext = {
        customInstruction: storedInstruction,
        personality: storedPersonality,
        goals: storedGoals,
        listenedTo: updatedListenedTo
      };

      const { error: updateError } = await supabase
        .from('frienddb')
        .update({
          logs: updatedLogs,
          word_counts: updatedWordCounts,
          time_distribution: updatedTimeDistribution,
          total_words: updatedTotalWords,
          analytics: updatedAnalytics,
          listenedto: updatedListenedTo
        })
        .eq('uid', uid);

      if (updateError) {
        console.error('Error updating analytics:', updateError);
      }
    } catch (err) {
      console.error("Error updating analytics:", err);
    }

    // Determine response probability
    let probabilityToRespond = 50;
    try {
      const { data: userData } = await supabase
        .from('frienddb')
        .select('responsepercentage')
        .eq('uid', sessionId)
        .single();

      if (userData) {
        probabilityToRespond = userData.responsepercentage || 10;
      } else {
        await supabase
          .from('frienddb')
          .upsert([{ uid: sessionId, responsepercentage: 10 }]);
        probabilityToRespond = 10;
      }
    } catch (err) {
      console.error("Error getting response percentage:", err);
    }

    const notification = await createNotificationPrompt(
      sortedMessages,
      sessionId,
      probabilityToRespond,
      userProfileContext
    );

    bufferData.lastAnalysisTime = currentTime;
    bufferData.messages = [];

    if (notification?.notification) {
      console.log(`Notification generated for session ${sessionId}`);
      console.log(notification);
      return res.status(200).json(notification);
    }

    const fallbackPayload = notification?.profile ? { profile: notification.profile } : {};
    console.log(`No notification generated for session ${sessionId}`);
    return res.status(200).json(fallbackPayload);
  }

  return res.status(202).json({});
});

app.get("/analytics", apiLimiter, [
  query('uid').isString().isLength({ min: 1, max: 50 }).trim(),
], async (req, res) => {
  // Check validation results
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: "Invalid UID" });
  }

  const uid = sanitizeInput(req.query.uid);
  try {
    const { data: rows } = await supabase
      .from('frienddb')
      .select('logs, rating, listenedto, word_counts, time_distribution, total_words')
      .eq('uid', uid)
      .single();

    if (!rows) {
      // Create user with default data if doesn't exist
      await supabase
        .from('frienddb')
        .upsert([{ uid }]);

      // Return default analytics data
      return res.json({
        rating: 100,
        listenedTo: 0,
        totalConversations: 0,
        totalWords: 0,
        wordCounts: {},
        timeDistribution: { morning: 0, afternoon: 0, evening: 0, night: 0 },
        sentiment: { overall: 'neutral', confidence: 0.5 },
      });
    }

    const logs = rows.logs || [];
    const rating = rows.rating || 100;
    const listenedTo = Number(rows.listenedto ?? rows.listenedTo ?? 0);
    const wordCounts = rows.word_counts || {};
    const timeDistribution = rows.time_distribution || { morning: 0, afternoon: 0, evening: 0, night: 0 };
    const totalWords = rows.total_words || 0;

    const sentiment = await analyzeSentiment(logs);

    res.json({
      rating,
      listenedTo,
      totalConversations: logs.length,
      totalWords,
      wordCounts,
      timeDistribution,
      sentiment,
    });
  } catch (err) {
    console.error("Error getting analytics:", err);
    res.status(500).json({ error: "Failed to get analytics" });
  }
});

app.get("/goals", apiLimiter, [
  query('uid').isString().isLength({ min: 1, max: 50 }).trim(),
], async (req, res) => {
  // Check validation results
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: "Invalid UID" });
  }

  const uid = sanitizeInput(req.query.uid);
  try {
    const { data: result, error } = await supabase
      .from('frienddb')
      .select('goals')
      .eq('uid', uid)
      .single();

    if (error || !result) {
      // Create user if doesn't exist
      await supabase
        .from('frienddb')
        .upsert([{ uid, goals: '[]' }]);
      return res.json({ goals: [] });
    }

    const goalsValue = result?.goals;
    let goals = [];
    if (Array.isArray(goalsValue)) {
      goals = goalsValue;
    } else if (typeof goalsValue === 'string') {
      try {
        goals = goalsValue.trim() ? JSON.parse(goalsValue) : [];
      } catch (_) {
        goals = [];
      }
    } else if (goalsValue && typeof goalsValue === 'object') {
      // If stored as object map, convert to array values
      goals = Object.values(goalsValue);
    }
    res.json({ goals });
  } catch (err) {
    console.error("Error getting goals:", err);
    // Return empty goals instead of error for better UX
    res.json({ goals: [] });
  }
});

app.post("/goals", apiLimiter, [
  body('uid').isString().isLength({ min: 1, max: 50 }).trim(),
  body('type').isString().isLength({ min: 1, max: 50 }).trim(),
  body('target').isString().isLength({ min: 1, max: 200 }).trim(),
], async (req, res) => {
  // Check validation results
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: "Invalid input data" });
  }

  const { uid, type, target } = req.body;
  const sanitizedUid = sanitizeInput(uid);
  const sanitizedType = sanitizeInput(type);
  const sanitizedTarget = sanitizeInput(target);

  try {
    const { data: result } = await supabase
      .from('frienddb')
      .select('goals')
      .eq('uid', sanitizedUid)
      .single();

    let goals;
    if (Array.isArray(result?.goals)) {
      goals = result.goals;
    } else if (typeof result?.goals === 'string') {
      try {
        goals = JSON.parse(result.goals || "[]");
      } catch (_) {
        goals = [];
      }
    } else if (result?.goals && typeof result.goals === 'object') {
      goals = Object.values(result.goals);
    } else {
      goals = [];
    }
    const newGoal = {
      id: Date.now().toString(),
      type: sanitizedType,
      target: sanitizedTarget,
      progress: 0,
      createdAt: new Date().toISOString(),
    };

    goals.push(newGoal);

    await supabase
      .from('frienddb')
      .update({ goals })
      .eq('uid', sanitizedUid);

    res.json({ success: true, goal: newGoal });
  } catch (err) {
    console.error("Error adding goal:", err);
    res.status(500).json({ error: "Failed to add goal" });
  }
});

app.delete("/goals/:goalId", async (req, res) => {
  const { uid } = req.query;
  try {
    const { data: result } = await supabase
      .from('frienddb')
      .select('goals')
      .eq('uid', uid)
      .single();

    let goals;
    if (Array.isArray(result?.goals)) {
      goals = result.goals;
    } else if (typeof result?.goals === 'string') {
      try {
        goals = JSON.parse(result.goals || "[]");
      } catch (_) {
        goals = [];
      }
    } else if (result?.goals && typeof result.goals === 'object') {
      goals = Object.values(result.goals);
    } else {
      goals = [];
    }
    const updatedGoals = goals.filter((goal) => goal.id !== req.params.goalId);

    await supabase
      .from('frienddb')
      .update({ goals: updatedGoals })
      .eq('uid', uid);

    res.json({ success: true });
  } catch (err) {
    console.error("Error deleting goal:", err);
    res.status(500).json({ error: "Failed to delete goal" });
  }
});

app.get("/webhook/setup-status", (req, res) => {
  return res.status(200).json({ is_setup_completed: true });
});

// Basic health endpoint for monitoring
app.get('/health', (_req, res) => {
  const supabaseConfigured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
  return res.status(200).json({ status: 'ok', supabaseConfigured });
});

// Simple chat test endpoint used by dashboard persona chat
app.post('/chat-test', [
  body('message').isString().isLength({ min: 1, max: 1000 }),
  body('personality').optional().isString().isLength({ max: 500 }),
  body('prompt').optional().isString().isLength({ max: 2000 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Invalid input data' });
  }

  const { message, personality = '', prompt = '' } = req.body;
  const systemPrompt = `You are a friendly conversational companion.
Personality traits: ${personality}
Custom instruction: ${prompt}
Respond concisely and helpfully in 1-3 sentences.`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-5-nano',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
    });
    const reply = completion.choices?.[0]?.message?.content?.trim() || 'Okay.';
    return res.json({ response: reply });
  } catch (err) {
    console.error('chat-test error:', err);
    return res.status(500).json({ response: 'Sorry, something went wrong.' });
  }
});

// Daily image generation cooldown per uid (in-memory for local use)
const imageCooldowns = new Map();

app.get('/generate-image', [
  query('uid').isString().isLength({ min: 1, max: 50 }).trim(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Invalid UID' });
  }
  const uid = sanitizeInput(req.query.uid);

  const now = Date.now();
  const last = imageCooldowns.get(uid) || 0;
  const dayMs = 24 * 60 * 60 * 1000;
  if (now - last < dayMs) {
    const nextAvailable = new Date(last + dayMs).toISOString();
    return res.status(429).json({ nextAvailable });
  }

  // For local/dev, return a placeholder image URL seeded by uid+date
  const seed = encodeURIComponent(uid + '-' + new Date().toDateString());
  const imageUrl = `https://picsum.photos/seed/${seed}/1024/640`;
  imageCooldowns.set(uid, now);
  return res.json({ imageUrl });
});

app.get("/insights", apiLimiter, [
  query('uid').isString().isLength({ min: 1, max: 50 }).trim(),
], async (req, res) => {
  // Check validation results
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: "Invalid UID" });
  }

  const uid = sanitizeInput(req.query.uid);
  try {
    const { data: result } = await supabase
      .from('frienddb')
      .select('logs')
      .eq('uid', uid)
      .single();

    const logsValue = result?.logs;
    const logs = Array.isArray(logsValue)
      ? logsValue
      : (typeof logsValue === 'string'
        ? (logsValue.trim() ? JSON.parse(logsValue) : [])
        : []);

    const last24Hours = logs.filter(log => {
      const logTime = new Date(log.timestamp * 1000);
      const now = new Date();
      return (now - logTime) <= 24 * 60 * 60 * 1000;
    });

    let insights = [];

    if (last24Hours.length > 0) {
      const totalMessages = last24Hours.reduce((sum, log) => sum + log.messages.length, 0);
      const userMessages = last24Hours.reduce((sum, log) =>
        sum + log.messages.filter(msg => msg.is_user).length, 0
      );

      insights.push(`You had ${totalMessages} messages in the last 24 hours`);
      insights.push(`${userMessages} were from you`);
    }

    res.json({ insights });
  } catch (err) {
    console.error("Error getting insights:", err);
    res.status(500).json({ error: "Failed to get insights" });
  }
});

async function analyzeSentiment(logs) {
  try {
    const recentMessages = logs
      .slice(-20)
      .flatMap(log => log.messages)
      .filter(msg => msg.is_user)
      .map(msg => msg.text)
      .join(' ');

    if (!recentMessages) {
      return { overall: 'neutral', confidence: 0.5 };
    }

    const prompt = `Analyze the sentiment of this text and respond with just one word: positive, negative, or neutral.\n\nText: ${recentMessages}`;

    const response = await openai.chat.completions.create({
      model: "gpt-5-nano",
      messages: [{ role: "user", content: prompt }],
    });

    const sentiment = response.choices[0].message.content.trim().toLowerCase();

    return {
      overall: ['positive', 'negative', 'neutral'].includes(sentiment) ? sentiment : 'neutral',
      confidence: 0.8
    };
  } catch (err) {
    console.error("Error analyzing sentiment:", err);
    return { overall: 'neutral', confidence: 0.5 };
  }
}

function calculateTimeDistribution(logs) {
  const distribution = { morning: 0, afternoon: 0, evening: 0, night: 0 };

  logs.forEach(log => {
    const hour = new Date(log.timestamp * 1000).getHours();
    if (hour >= 6 && hour < 12) distribution.morning++;
    else if (hour >= 12 && hour < 18) distribution.afternoon++;
    else if (hour >= 18 && hour < 22) distribution.evening++;
    else distribution.night++;
  });

  return distribution;
}

function calculateTotalWords(logs) {
  return logs.reduce((total, log) =>
    total + log.messages.reduce((sum, msg) => sum + msg.text.split(/\s+/).length, 0), 0
  );
}

function calculateTopWords(logs) {
  const wordCount = {};

  logs.forEach(log => {
    log.messages.forEach(msg => {
      if (msg.is_user) {
        const words = msg.text.toLowerCase().split(/\s+/);
        words.forEach(word => {
          const cleanWord = word.replace(/[^\w]/g, '');
          if (cleanWord.length > 2 && !stopWords.has(cleanWord)) {
            wordCount[cleanWord] = (wordCount[cleanWord] || 0) + 1;
          }
        });
      }
    });
  });

  return Object.entries(wordCount)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 20)
    .reduce((obj, [word, count]) => {
      obj[word] = count;
      return obj;
    }, {});
}

// Start the server only when executed directly (not when imported)
if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Friend app listening at http://localhost:${PORT}`);
  });
}

module.exports = app;
