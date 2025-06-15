/*
 * Copyright (c) 2025 Neo (github.com/neooriginal)
 * All rights reserved.
 */

const express = require("express");
const app = express();
const { createClient } = require('@supabase/supabase-js');
const bodyParser = require("body-parser");
const axios = require("axios");

const dotenv = require("dotenv");
dotenv.config();

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

// Middleware to parse JSON bodies
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

let cooldown = [];
let cooldownTimeCache = [];

// Supabase table initialization
(async () => {
  try {
    console.log('Setting up Friend app table...');
    
    const { error } = await supabase.rpc('exec_sql', {
      sql_query: `
        CREATE TABLE IF NOT EXISTS frienddb (
          id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
          uid TEXT UNIQUE NOT NULL,
          cooldown INTEGER DEFAULT 0,
          responsepercentage INTEGER DEFAULT 10,
          customInstruction TEXT DEFAULT '',
          personality TEXT DEFAULT '100% chill; 35% friendly; 55% teasing; 10% thoughtful; 20% humorous; 5% deep; 20% nik',
          logs JSONB DEFAULT '[]',
          listenedTo INTEGER DEFAULT 0,
          rating INTEGER DEFAULT 100,
          goals JSONB DEFAULT '[]',
          analytics JSONB DEFAULT '{}',
          word_counts JSONB DEFAULT '{}',
          time_distribution JSONB DEFAULT '{"morning":0,"afternoon":0,"evening":0,"night":0}',
          total_words INTEGER DEFAULT 0,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `
    });

    if (error) {
      console.log("Table may already exist or exec_sql function not found.");
      console.log("Please run the setup-supabase.sql script in your Supabase SQL editor.");
    } else {
      console.log("Friend app table created successfully!");
    }
  } catch (err) {
    console.log("Auto-table creation failed. Please run setup-supabase.sql manually.");
    console.log("Error:", err.message);
  }
})();

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

  res.sendFile(__dirname + "/public/index.html");
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
  next();
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
      .select('listenedTo, rating')
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
        listenedto: parseInt(userData.listenedTo) || 0,
        rating: parseInt(userData.rating) || 100
      });
    }
  } catch (err) {
    next(err);
  }
});

// Add error handling middleware at the end
app.use(errorHandler);

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
  let uid = req.query.uid;
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

app.post("/save", validateUID, validateSaveInput, async (req, res, next) => {
  try {
    const uid = req.body.uid;
    const responsepercentage = parseInt(req.body.responsepercentage) || 10;
    const customInstruction = req.body.customInstruction || "";
    const personality = req.body.personality;
    const cooldown = parseInt(req.body.cooldown) || 5;

    let updateData = {
      uid,
      responsepercentage,
      customInstruction,
      cooldown
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

    await supabase
      .from('frienddb')
      .upsert([updateData]);
    
    cooldownTimeCache[uid] = cooldown;
    
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
      .select('responsepercentage, customInstruction, personality, cooldown')
      .eq('uid', uid)
      .single();
    
    if (!rows) {
      await supabase
        .from('frienddb')
        .upsert([{ uid }]);
      
      const defaultData = {
        responsepercentage: 10,
        customInstruction: "",
        personality: "100% chill; 35% friendly; 55% teasing; 10% thoughtful; 20% humorous; 5% deep; 20% nik",
        cooldown: 5
      };
      cooldownTimeCache[uid] = defaultData.cooldown;
      res.json(defaultData);
    } else {
      const data = {
        responsepercentage: parseInt(rows.responsepercentage) || 10,
        customInstruction: rows.customInstruction || "",
        personality: rows.personality || "100% chill; 35% friendly; 55% teasing; 10% thoughtful; 20% humorous; 5% deep; 20% nik",
        cooldown: parseInt(rows.cooldown) || 5
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

async function createNotificationPrompt(messages, uid, probabilitytorespond = 50) {
  let customInstruction = "";
  let personality = "100% chill; 35% friendly; 55% teasing; 10% thoughtful; 20% humorous; 5% deep; 20% nik";
  let goals = "[]";

  try {
    const { data: result } = await supabase
      .from('frienddb')
      .select('customInstruction, personality, goals, listenedTo')
      .eq('uid', uid)
      .single();
    
    if (result) {
      customInstruction = result.customInstruction || "";
      personality = result.personality || "100% chill; 35% friendly; 55% teasing; 10% thoughtful; 20% humorous; 5% deep; 20% nik";
      goals = result.goals || "[]";
      
      // Update listenedTo counter
      const currentlyListenedTo = parseInt(result.listenedTo) || 0;
      await supabase
        .from('frienddb')
        .update({ listenedTo: currentlyListenedTo + 1 })
        .eq('uid', uid);
    } else {
      // Create user if doesn't exist
      await supabase
        .from('frienddb')
        .upsert([{ uid, listenedTo: 1 }]);
    }
  } catch (err) {
    console.error("Failed to get user data from database:", err.message);
  }

  // Format the discussion with speaker labels
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

  //let the AI rate the discussion every 100 discussions
  if (previousDiscusstionsFull[uid].length - lastRating[uid] >= 100) {
    rateConversations(uid);
  }

  let prePrompt = `
    You are supposed to be a close friend to the user and provide personalized comments on the conversation.
    The user has set the frequency to ${probabilitytorespond}%. Interpret this and decide whether to respond or not based on this probability and the guidelines below. If 100% is set, you should always respond with true. If 0% is set, you should always respond with false.
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
    model: "openai/gpt-3.5-turbo",
    messages: [{ role: "user", content: prePrompt }],
  };

  const response = await axios.post(
    "https://openrouter.ai/api/v1/chat/completions",
    body,
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
    },
  );

  let respond = response.data.choices[0].message.content;

  if (respond.startsWith("true")) {
    respond = "true";
  } else if (respond.startsWith("false")) {
    respond = "false";
  } else {
    respond = "true";
  }

  if (respond === "true") {
    let systemPrompt = `
    You are a loyal friend to the user. You care deeply about their well-being and are always there to support them. You have access to information about the user's personality, goals, and previous conversations to provide personalized responses.

    User's Custom Instructions: ${customInstruction}
    User's Personality Traits: ${personality}
    User's Goals: ${goals}

    Based on the conversation below, provide a supportive, engaging, and personalized response that reflects your understanding of the user and maintains the friendship dynamic.

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
    };
  } else {
    return {};
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
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "openai/gpt-3.5-turbo",
        messages: [{ role: "user", content: ratingPrompt }],
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
      },
    );

    const newRating = parseInt(response.data.choices[0].message.content.trim());
    
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

app.post("/webhook", async (req, res) => {
  const data = req.body;
  const sessionId = data.session_id;
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

    const text = segment.text.trim();
    if (text) {
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

    // Update analytics in database
    try {
      const uid = sessionId;
      const { data: currentData } = await supabase
        .from('frienddb')
        .select('logs, word_counts, time_distribution, total_words')
        .eq('uid', uid)
        .single();

      if (currentData) {
        const existingLogs = currentData.logs || [];
        const newLogEntry = {
          timestamp: currentTime,
          messages: sortedMessages,
        };
        
        const updatedLogs = [...existingLogs, newLogEntry];
        
        // Calculate analytics
        const wordCounts = calculateTopWords(updatedLogs);
        const timeDistribution = calculateTimeDistribution(updatedLogs);
        const totalWords = calculateTotalWords(updatedLogs);
        
        await supabase
          .from('frienddb')
          .update({
            logs: updatedLogs,
            word_counts: wordCounts,
            time_distribution: timeDistribution,
            total_words: totalWords
          })
          .eq('uid', uid);
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
    );

    bufferData.lastAnalysisTime = currentTime;
    bufferData.messages = [];

    console.log(`Notification generated for session ${sessionId}`);
    console.log(notification);

    return res.status(200).json(notification);
  }

  return res.status(202).json({});
});

app.get("/analytics", async (req, res) => {
  const uid = req.query.uid;
  try {
    const { data: rows } = await supabase
      .from('frienddb')
      .select('logs, rating, listenedTo, word_counts, time_distribution, total_words')
      .eq('uid', uid)
      .single();
    
    if (!rows) {
      return res.status(404).json({ error: "User not found" });
    }

    const logs = rows.logs || [];
    const rating = rows.rating || 100;
    const listenedTo = rows.listenedTo || 0;
    const wordCounts = rows.word_counts || {};
    const timeDistribution = rows.time_distribution || {};
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

app.get("/goals", async (req, res) => {
  const uid = req.query.uid;
  try {
    const { data: result } = await supabase
      .from('frienddb')
      .select('goals')
      .eq('uid', uid)
      .single();
    
    const goals = JSON.parse(result?.goals || "[]");
    res.json({ goals });
  } catch (err) {
    console.error("Error getting goals:", err);
    res.status(500).json({ error: "Failed to get goals" });
  }
});

app.post("/goals", async (req, res) => {
  const { uid, type, target } = req.body;
  try {
    const { data: result } = await supabase
      .from('frienddb')
      .select('goals')
      .eq('uid', uid)
      .single();

    const goals = JSON.parse(result?.goals || "[]");
    const newGoal = {
      id: Date.now().toString(),
      type,
      target,
      progress: 0,
      createdAt: new Date().toISOString(),
    };

    goals.push(newGoal);
    
    await supabase
      .from('frienddb')
      .update({ goals: JSON.stringify(goals) })
      .eq('uid', uid);

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

    const goals = JSON.parse(result?.goals || "[]");
    const updatedGoals = goals.filter((goal) => goal.id !== req.params.goalId);
    
    await supabase
      .from('frienddb')
      .update({ goals: JSON.stringify(updatedGoals) })
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

app.get("/insights", async (req, res) => {
  const uid = req.query.uid;
  try {
    const { data: result } = await supabase
      .from('frienddb')
      .select('logs')
      .eq('uid', uid)
      .single();
    
    const logs = JSON.parse(result?.logs || "[]");
    
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

    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "openai/gpt-3.5-turbo",
        messages: [{ role: "user", content: prompt }],
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
      },
    );

    const sentiment = response.data.choices[0].message.content.trim().toLowerCase();
    
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
    .sort(([,a], [,b]) => b - a)
    .slice(0, 20)
    .reduce((obj, [word, count]) => {
      obj[word] = count;
      return obj;
    }, {});
}

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Friend app listening at http://localhost:${PORT}`);
});

module.exports = app;
