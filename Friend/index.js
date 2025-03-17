/*
 * Copyright (c) 2025 Neo (github.com/neooriginal)
 * All rights reserved.
 */

const express = require("express");
const app = express();
const mysql = require('mysql2/promise');
const bodyParser = require("body-parser");
const axios = require("axios");

const dotenv = require("dotenv");
dotenv.config();

// Initialize MySQL pool using environment variables
let pool;
try {
  pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
  });
  console.log("MySQL pool initialized successfully");

  // Function to test connection with retries
  async function testConnection(retries = 3, delay = 5000) {
    for (let i = 0; i < retries; i++) {
      try {
        const conn = await pool.getConnection();
        console.log('Database connected successfully');
        conn.release();
        return true;
      } catch (err) {
        console.error(`Connection attempt ${i + 1}/${retries} failed:`);
        console.error('Error code:', err.code);
        console.error('Error number:', err.errno);
        console.error('SQL state:', err.sqlState);
        
        if (i < retries - 1) {
          console.log(`Retrying in ${delay/1000} seconds...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          console.error('All connection attempts failed');
          throw err;
        }
      }
    }
  }

  // Test the connection immediately
  testConnection()
    .catch(err => {
      console.error("Initial connection test failed:", err);
      process.exit(1);
    });

} catch (err) {
  console.error("Failed to initialize MySQL client:", err.message);
  process.exit(1);
}


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


(async () => {
  try {
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS frienddb (
        uid VARCHAR(255) PRIMARY KEY,
        cooldown INTEGER DEFAULT 0,
        responsepercentage INTEGER DEFAULT 10,
        customInstruction TEXT DEFAULT '',
        personality TEXT DEFAULT '100% chill; 35% friendly; 55% teasing; 10% thoughtful; 20% humorous; 5% deep, 20% nik',
        logs LONGTEXT DEFAULT '[]',
        listenedTo INTEGER DEFAULT 0,
        rating INTEGER DEFAULT 100,
        goals LONGTEXT DEFAULT '[]',
        analytics LONGTEXT DEFAULT '{}',
        word_counts JSON DEFAULT (JSON_OBJECT()),
        time_distribution JSON DEFAULT (JSON_OBJECT('morning', 0, 'afternoon', 0, 'evening', 0, 'night', 0)),
        total_words INTEGER DEFAULT 0
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
    const conn = await pool.getConnection();
    await conn.query(createTableQuery);
    conn.release();

    console.log("Table created/updated successfully");
    

  } catch (err) {
    console.error("Failed to create/update table:", err.message);
    process.exit(1);
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
  res.sendFile(__dirname + "/public/dashboard.html");
});

app.get("/deleteData", async (req, res) => {
  let uid = req.query.uid;
  try {
    const conn = await pool.getConnection();
    await conn.query('DELETE FROM frienddb WHERE uid = ?', [uid]);
    conn.release();
    // Clear any cached data
    delete cooldownTimeCache[uid];
    delete cooldown[uid];
    delete previousDiscussions[uid];
    delete previousDiscusstionsFull[uid];
    delete lastRating[uid];
    delete ratingCooldown[uid];
    delete IMAGE_COOLDOWNS[uid];
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
  let conn;
  try {
    const uid = req.body.uid;
    conn = await pool.getConnection();
    
    // First check if user exists, if not create default entry
    const [existCheck] = await conn.query('SELECT COUNT(*) as count FROM frienddb WHERE uid = ?', [uid]);
    if (existCheck[0].count === 0) {
      await conn.query('INSERT INTO frienddb (uid) VALUES (?)', [uid]);
    }
    
    const [rows] = await conn.query('SELECT listenedTo, rating FROM frienddb WHERE uid = ?', [uid]);
    
    res.json({
      listenedto: parseInt(rows[0]?.listenedTo) || 0,
      rating: parseInt(rows[0]?.rating) || 100
    });
  } catch (err) {
    next(err);
  } finally {
    if (conn) conn.release();
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

app.post("/save", validateUID, validateSaveInput, async (req, res, next) => {
  let conn;
  try {
    const uid = req.body.uid;
    const responsepercentage = parseInt(req.body.responsepercentage) || 10;
    const customInstruction = req.body.custominstruction || "";
    const personality = req.body.personality;
    const cooldown = parseInt(req.body.cooldown) || 5;

    let namesString = ["responsepercentage", "customInstruction", "cooldown"];
    let values = [responsepercentage, customInstruction, cooldown];

    if (personality) {
      // Handle both formats: "name:value" and "value% name"
      let formattedPersonality = personality;
      if (personality.includes(':')) {
        // Convert from "name:value" to "value% name"
        formattedPersonality = personality.split(',')
          .map(trait => {
            const [name, value] = trait.split(':');
            return `${value}% ${name}`;
          })
          .join('; ');
      }
      namesString.push("personality");
      values.push(formattedPersonality);
    }

    conn = await pool.getConnection();
    const placeholders = values.map(() => '?').join(', ');
    const updatePlaceholders = namesString.map(name => `${name} = ?`).join(', ');
    
    const queryText = `
      INSERT INTO frienddb (uid, ${namesString.join(', ')})
      VALUES (?, ${placeholders})
      ON DUPLICATE KEY UPDATE ${updatePlaceholders}
    `;
    
    await conn.query(queryText, [uid, ...values, ...values]);
    
    // Update cooldown cache
    cooldownTimeCache[uid] = cooldown;
    
    res.json({ success: true });
  } catch (err) {
    next(err);
  } finally {
    if (conn) conn.release();
  }
});


app.post("/get", validateUID, async (req, res, next) => {
  let conn;
  try {
    const uid = req.body.uid;
    conn = await pool.getConnection();
    const [rows] = await conn.query('SELECT responsepercentage, customInstruction, personality, cooldown FROM frienddb WHERE uid = ?', [uid]);
    
    if (!rows || rows.length === 0) {
      // Insert default values
      await conn.query('INSERT INTO frienddb (uid) VALUES (?) ON DUPLICATE KEY UPDATE uid = uid', [uid]);
      const defaultData = {
        responsepercentage: 10,
        custominstruction: "",
        personality: "100% chill; 35% friendly; 55% teasing; 10% thoughtful; 20% humorous; 5% deep; 20% nik",
        cooldown: 5
      };
      cooldownTimeCache[uid] = defaultData.cooldown;
      res.json(defaultData);
    } else {
      const data = {
        responsepercentage: parseInt(rows[0].responsepercentage) || 10,
        custominstruction: rows[0].customInstruction || "",
        personality: rows[0].personality || "100% chill; 35% friendly; 55% teasing; 10% thoughtful; 20% humorous; 5% deep; 20% nik",
        cooldown: parseInt(rows[0].cooldown) || 5
      };
      cooldownTimeCache[uid] = data.cooldown;
      res.json(data);
    }
  } catch (err) {
    next(err);
  } finally {
    if (conn) conn.release();
  }
});

// Initialize message buffer and core functionality
const messageBuffer = new MessageBuffer();
const ANALYSIS_INTERVAL = 30;


async function createNotificationPrompt(messages, uid, probabilitytorespond = 50) {
  let customInstruction = "";
  let personality = "100% chill; 35% friendly; 55% teasing; 10% thoughtful; 20% humorous; 5% deep; 20% nik";
  let goals = "[]";
  let conn;

  try {
    conn = await pool.getConnection();
    
    // First check if user exists, if not create default entry
    const [existCheck] = await conn.query('SELECT COUNT(*) as count FROM frienddb WHERE uid = ?', [uid]);
    if (existCheck[0].count === 0) {
      await conn.query('INSERT INTO frienddb (uid) VALUES (?)', [uid]);
    }
    
    // Get all user data in one query
    const [result] = await conn.query(
      'SELECT listenedTo, customInstruction, personality, goals FROM frienddb WHERE uid = ?',
      [uid]
    );
    
    if (result && result[0]) {
      const currentlyListenedTo = parseInt(result[0].listenedTo) || 0;
      await conn.query('UPDATE frienddb SET listenedTo = ? WHERE uid = ?', [currentlyListenedTo + 1, uid]);
      
      customInstruction = result[0].customInstruction || "";
      personality = result[0].personality || "100% chill; 35% friendly; 55% teasing; 10% thoughtful; 20% humorous; 5% deep; 20% nik";
      goals = result[0].goals || "[]";
    }
  } catch (err) {
    console.error("Failed to get user data from database:", err.message);
  } finally {
    if (conn) conn.release();
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
  if (probabilitytorespond == 100) respond = "true";

  if (respond == "false") {
    console.log("AI has decided not to respond");
    console.log(uid + " - " + respond);
    return {};
  } else {
    console.log("AI has decided to respond");
  }

  // Get user data from database
  try {
    const conn = await pool.getConnection();
    try {
      const [result] = await conn.query('SELECT customInstruction, personality, goals FROM frienddb WHERE uid = ?', [uid]);
      
      if (result && result[0]) {
        customInstruction = result[0].customInstruction || "";
        personality = result[0].personality || "100% chill; 35% friendly; 55% teasing; 10% thoughtful; 20% humorous; 5% deep; 20% nik";
        goals = result[0].goals || "[]";
      }
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error("Failed to get user data from database:", err.message);
    customInstruction = "";
    personality = "100% chill; 35% friendly; 55% teasing; 10% thoughtful; 20% humorous; 5% deep; 20% nik";
    goals = "[]";
  }

  cooldown[uid] = Date.now();

  let systemPrompt = `
    You are {{{{user_name}}}}'s close friend. Your task is to provide personalized comments on the conversation. ALWAYS RESPOND WITH SOMETHING!

    The Instruction provided is set by the Plugin. The user has set an additional instruction additionally though: "${customInstruction}"

    You also have different personalities to choose from. The user has set the personality to: "${personality}". Here is a guideline on how you should act based on what personality percentage the user has set:

    - Chill & Relaxed: Laid-back, minimal responses, only chiming in when absolutely necessary. This level uses a lot of slang, keeps it short, and adds humor sparingly.(use lowercase, slang, etc.)
    - Friendly & Supportive: Balanced responses with a warm tone. Comments are uplifting, positive, and personalized without being overly enthusiastic.
    - Teasing & Witty: Adds a touch of playful sarcasm, friendly teasing, and clever remarks. Good for users who appreciate humor and a bit of banter.
    - Thoughtful & Reflective: Offers more empathetic and detailed comments that show genuine interest in the conversation. This level responds thoughtfully and adds personal touches while maintaining the informal tone.
    - Humorous & Outgoing: Injects more jokes, exaggerations, and light-hearted comments, ensuring conversations remain fun and upbeat.
    - Deep & Insightful: Balances friendly comments with deeper observations and insights. This level provides more meaningful feedback and shows a high level of attentiveness while still being relaxed.
    - Nik: Nik Shevchenko is a 24-year-old founder of Based Hardware, known for inventing the **Friend AI necklace**, which transcribes conversations and offers summaries and tailored advice, and **openglass**, which captures photos periodically and provides personalized AI insights. Nik's communication style is direct, bold, and succinct, reflecting his Russian straightforwardness. He likes to start interactions with diss-track-like posts and uses a confident, casual tone infused with motivational content and thought-provoking challenges. Nik's social strategy involves concise, impactful posts with a mix of motivational, open-ended, and exclusive content that encourages interaction and adapts based on engagement feedback.
    if you get other values, use your own judgement to decide how to act.

    Here are some information about the user which you can use to personalize your comments:
    {{{{user_facts}}}}
    {{{user_context}}}


    Here are some goals the user has set you:
    ${goals}

    Here are some guidelines to follow:
    - Share your thoughts just like a good friend would.
    - Speak DIRECTLY to {{{{user_name}}}} - no analysis or third-person commentary
    - Keep it under 300 chars
    - Reference specific details from what {{{{user_name}}}} said
    - dont be cringy
    - act like you're having a casual conversation
    - respond like humans in a real conversation, not like a robot
    - do not ask any questions that require a response, you may use rhetorical questions
    - you can keep it short if you want to, somtimes a short response is better
    - since the transcript is everything around the user, it might be a video etc. try to detect that and make comments on that
    - use a veriety of starters
    - be creative and be original and be organic, do not just simply repeat what the user said in other words.
    - you do not need to repeat what the user said at the start of your response, just make a comment on it.
    - make sure the answers are not long winded
    - the most important point is, that they are personalized.
    - RESPOND IN THE LANGUAGE THE TRANSCRIPT IS IN

    Current discussion:
    ${discussionText}

    Remember: First evaluate silently, then give a personalized comment based on the guidelines and personalized info above.`;

  //systemPrompt can not be longer then 8000 chars
  if (
    previousDiscussions[uid].answered.join("; ").length + systemPrompt.length >
    7800
  ) {
  } else {
    systemPrompt =
      systemPrompt +
      `
      Here are some previous discussions where you have commented in the past for context (limited to the last 10):
      ${previousDiscussions[uid].answered.toString("\n")}
      `;
  }

  if (previousDiscussions[uid].answered.length > 10) {
    previousDiscussions[uid].answered.shift();
  }
  previousDiscussions[uid].answered.push(discussionText);

  return {
    notification: {
      prompt: systemPrompt,
      params: ["user_name", "user_facts", "user_context"],
    },
  };
}

async function rateConversations(uid) {
  try {
    lastRating[uid] = previousDiscusstionsFull[uid].length;
    let rating = undefined;
    const conn = await pool.getConnection();
    const result = await conn.query('SELECT rating FROM frienddb WHERE uid = ?', [uid]);
    rating = result[0]?.rating || 100;
    //use AI to rate the conversation 
    let prePrompt = `
    You are an AI that rates the users conversations and gives back a percentage (1-100) based on his transcriptions you will be provided.
    The transcripts is a json format and might be a bad structure, which is not the users fault. You should rate the conversation based on the content and not the structure.
    You are not the first AI to rate the conversation, so you should take into account what the other AI's have rated the conversation. and try to be consistent with them by either staying the same or changing the rating based on the content.
    only change the rating if you think it is wrong or if you have a good reason to change it.
    Respond only with a number between 1-100.
    Here are some criteria you:

1. **Clarity of Communication (Max 15 Points):**  
- Clear expression of ideas and minimal misunderstandings.  
- *Poor (0–5):* Hard to understand or frequent miscommunication.  
- *Average (6–10):* Mostly clear but with occasional ambiguities.  
- *Excellent (11–15):* Always clear and easy to follow.

2. **Active Listening (Max 10 Points):**  
- Level of attentiveness and acknowledgment of what was said.  
- *Poor (0–3):* Interruptions, lack of response, or ignoring key points.  
- *Average (4–7):* Moderate engagement with some lapses.  
- *Excellent (8–10):* Consistent, active, and thoughtful listening.

3. **Respect and Civility (Max 10 Points):**  
- Tone and politeness throughout the conversation.  
- *Poor (0–3):* Frequent rudeness or disrespectful comments.  
- *Average (4–7):* Mostly respectful with minor lapses.  
- *Excellent (8–10):* Entirely respectful and civil.

4. **Depth of Content (Max 15 Points):**  
- Quality of the discussion and richness of topics covered.  
- *Poor (0–5):* Superficial or irrelevant topics.  
- *Average (6–10):* Moderately meaningful discussion.  
- *Excellent (11–15):* Deep, engaging, and thought-provoking.

5. **Mutual Understanding (Max 10 Points):**  
- Extent to which participants understood each other.  
- *Poor (0–3):* Little to no shared understanding.  
- *Average (4–7):* Partial understanding but some confusion remains.  
- *Excellent (8–10):* Clear alignment and comprehension.

6. **Balance of Contribution (Max 10 Points):**  
- Equality in participation and exchange.  
- *Poor (0–3):* One-sided conversation with little input from one party.  
- *Average (4–7):* Some imbalance but both parties contributed.  
- *Excellent (8–10):* Well-balanced and equitable contribution.

7. **Emotional Intelligence (Max 10 Points):**  
- Sensitivity to emotions and constructive handling of emotional nuances.  
- *Poor (0–3):* Insensitive or dismissive of emotions.  
- *Average (4–7):* Some empathy shown, but not consistently.  
- *Excellent (8–10):* High emotional awareness and constructive interaction.

8. **Engagement and Interest (Max 10 Points):**  
- Level of interest and focus from both participants.  
- *Poor (0–3):* Disengaged or distracted.  
- *Average (4–7):* Generally engaged, with some lapses.  
- *Excellent (8–10):* Fully engaged and attentive throughout.

9. **Flow and Comfort (Max 10 Points):**  
- Smoothness of the conversation and comfort level of participants.  
- *Poor (0–3):* Awkward silences or forced interaction.  
- *Average (4–7):* Mostly natural flow with occasional discomfort.  
- *Excellent (8–10):* Effortless and comfortable conversation.


    Previous rating: ${rating}
    Part of the latest discussion:
    ${previousDiscusstionsFull[uid].toString("\n")}
    `;

    const body = {
      model: "openai/gpt-4o",
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
    await conn.query('UPDATE frienddb SET rating = ? WHERE uid = ?', [parseInt(respond), uid]);
    conn.release();

  } catch (err) {
    console.error("Failed to update rating in database:", err.message);
  }
}

app.get("/webhook", (req, res) => {
  let uid = req.query.uid;
  res.redirect("/?uid=" + uid);
});




app.post("/webhook", async (req, res) => {
  const data = req.body;
  const sessionId = data.session_id;
  const segments = data.segments || [];
  const uid = req.query.uid;

  try {
    const conn = await pool.getConnection();
    for (const segment of segments) {
      const text = segment.text.trim();
      const timestamp = segment.start || Date.now() / 1000;
      if (!text) continue;

      // Get current analytics
      const result = await conn.query(
        'SELECT logs, word_counts, time_distribution, total_words FROM frienddb WHERE uid = ?',
        [uid]
      );
      
      const [rows] = result;
      let currentLogs = JSON.parse(rows[0]?.logs || "[]");
      let wordCounts = JSON.parse(rows[0]?.word_counts || "{}");
      let timeDistribution = JSON.parse(rows[0]?.time_distribution || '{"morning":0,"afternoon":0,"evening":0,"night":0}');
      let totalWords = rows[0]?.total_words || 0;

      // Update analytics
      const hour = new Date(timestamp * 1000).getHours();
      if (hour >= 6 && hour < 12) timeDistribution.morning++;
      else if (hour >= 12 && hour < 18) timeDistribution.afternoon++;
      else if (hour >= 18 && hour < 24) timeDistribution.evening++;
      else timeDistribution.night++;

      // Update word counts
      const words = text.toLowerCase()
        .split(/\s+/)
        .filter(word => word.length > 2 && !stopWords.has(word));
      
      totalWords += words.length;
      
      for (const word of words) {
        wordCounts[word] = (wordCounts[word] || 0) + 1;
      }

      // Keep only top 1000 words to save space
      wordCounts = Object.fromEntries(
        Object.entries(wordCounts)
          .sort(([,a], [,b]) => b - a)
          .slice(0, 1000)
      );

      // Add new log entry (keep only last 100 for sentiment analysis and recent context)
      currentLogs.push({ text: text, timestamp: timestamp, speaker: segment.speaker });
      if (currentLogs.length > 100) {
        currentLogs = currentLogs.slice(-100);
      }

      // Save everything back
      await conn.query(
        'UPDATE frienddb SET logs = ?, word_counts = ?, time_distribution = ?, total_words = ? WHERE uid = ?',
        [JSON.stringify(currentLogs), JSON.stringify(wordCounts), JSON.stringify(timeDistribution), totalWords, uid]
      );
    }
    conn.release();
  } catch (err) {
    console.error("Failed to update database:", err.message);
  }


  let uidCooldown = cooldownTimeCache[uid] || undefined;

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

        if (
          bufferData.wordsAfterSilence >= messageBuffer.minWordsAfterSilence
        ) {
          bufferData.silenceDetected = false;
          bufferData.lastAnalysisTime = currentTime; // Reset analysis timer
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

    let probabilitytorespond = undefined;
    try {
      //get the response percentage from the database and if none found, insert default values and send them back
      const conn = await pool.getConnection();
      const result = await conn.query('SELECT responsepercentage FROM frienddb WHERE uid = ?', [uid]);

      if (result.length == 0) {
        await conn.query('INSERT INTO frienddb (uid) VALUES (?) ON DUPLICATE KEY UPDATE uid = uid', [uid]);
        probabilitytorespond = 50;
      } else probabilitytorespond = result[0]?.responsepercentage || 50;
      conn.release();
    } catch (err) {
      console.error(
        "Failed to get response percentage from database:",
        err.message,
      );
      return res
        .status(500)
        .json({ error: "Failed to get response percentage from database" });
    }

    const notification = await createNotificationPrompt(
      sortedMessages,
      uid,
      probabilitytorespond,
    );

    bufferData.lastAnalysisTime = currentTime;
    bufferData.messages = []; // Clear buffer after analysis

    if (!notification || notification == {}) {
      return res.status(202).json({});
    } else if (notification.error) {
      return res.status(500).json({ error: notification.error });
    } else {
      console.log(`Notification sent out for ${sessionId}`);
      return res.status(200).json(notification);
    }
  }

  return res.status(202).json({});
});

app.get("/webhook/setup-status", (req, res) => {
  return res.status(200).json({ is_setup_completed: true });
});

const startTime = Date.now() / 1000; // Uptime in seconds

app.get("/status", (req, res) => {
  return res.status(200).json({
    active_sessions: Object.keys(messageBuffer.buffers).length,
    uptime: Date.now() / 1000 - startTime,
  });
});

// Add these constants at the top with other configurations
const SENTIMENT_CACHE = {};
const SENTIMENT_COOLDOWN = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

async function analyzeSentiment(logs) {
  const dailyLogs = logs.reduce((acc, log) => {
    const date = new Date(log.timestamp * 1000).toISOString().split('T')[0];
    if (!acc[date]) acc[date] = [];
    acc[date].push(log);
    return acc;
  }, {});

  const sentiments = {};
  for (const [date, dayLogs] of Object.entries(dailyLogs)) {
    // Check cache first
    if (SENTIMENT_CACHE[date]) {
      sentiments[date] = SENTIMENT_CACHE[date].value;
      continue;
    }

    // Check if we should analyze this date based on cooldown
    const lastAnalysis = SENTIMENT_CACHE[date]?.timestamp || 0;
    if (Date.now() - lastAnalysis < SENTIMENT_COOLDOWN) {
      sentiments[date] = SENTIMENT_CACHE[date]?.value || 0;
      continue;
    }

    const text = dayLogs.map(log => log.text).join(' ');
    try {
      const response = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: "openai/gpt-3.5-turbo",
          messages: [{
            role: "user",
            content: `Analyze the sentiment of this text and return only a number between -1 and 1:\n${text}`
          }]
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const sentiment = parseFloat(response.data.choices[0].message.content);

      // Cache the result
      SENTIMENT_CACHE[date] = {
        value: sentiment,
        timestamp: Date.now()
      };

      sentiments[date] = sentiment;
    } catch (error) {
      console.error('Error analyzing sentiment:', error);
      sentiments[date] = SENTIMENT_CACHE[date]?.value || 0;
    }
  }
  return sentiments;
}

// Modify the analytics endpoint to include caching
app.get("/analytics", async (req, res) => {
  const uid = req.query.uid;
  try {
    const conn = await pool.getConnection();
    const [rows] = await conn.query('SELECT logs, rating, listenedTo, word_counts, time_distribution, total_words FROM frienddb WHERE uid = ?', [uid]);
    conn.release();

    if (!rows[0]) {
      return res.json({
        totalWords: 0,
        averageMessageLength: 0,
        timeDistribution: {
          morning: 0,
          afternoon: 0,
          evening: 0,
          night: 0
        },
        topWords: {},
        sentimentOverTime: {}
      });
    }

    const logs = JSON.parse(rows[0].logs || "[]");
    const wordCounts = JSON.parse(rows[0].word_counts || "{}");
    const timeDistribution = JSON.parse(rows[0].time_distribution || '{"morning":0,"afternoon":0,"evening":0,"night":0}');
    const totalWords = rows[0].total_words || 0;

    // Get sentiment from cache or analyze
    let sentimentOverTime;
    const cacheKey = `sentiment_${uid}`;
    const cachedSentiment = SENTIMENT_CACHE[cacheKey];

    if (cachedSentiment && Date.now() - cachedSentiment.timestamp < SENTIMENT_COOLDOWN) {
      sentimentOverTime = cachedSentiment.data;
    } else {
      sentimentOverTime = await analyzeSentiment(logs);
      SENTIMENT_CACHE[cacheKey] = {
        data: sentimentOverTime,
        timestamp: Date.now()
      };
    }

    const analytics = {
      totalWords,
      averageMessageLength: logs.length > 0 ? totalWords / logs.length : 0,
      timeDistribution,
      topWords: Object.fromEntries(
        Object.entries(wordCounts)
          .sort(([,a], [,b]) => b - a)
          .slice(0, 10)
      ),
      sentimentOverTime
    };

    res.json(analytics);
  } catch (err) {
    console.error('Analytics error:', err);
    res.status(500).json({ error: "Failed to generate analytics" });
  }
});

function calculateTimeDistribution(logs) {
  const distribution = {
    morning: 0,   // 6-12
    afternoon: 0, // 12-18
    evening: 0,   // 18-24
    night: 0      // 0-6
  };

  logs.forEach(log => {
    const hour = new Date(log.timestamp * 1000).getHours();
    if (hour >= 6 && hour < 12) distribution.morning++;
    else if (hour >= 12 && hour < 18) distribution.afternoon++;
    else if (hour >= 18 && hour < 24) distribution.evening++;
    else distribution.night++;
  });

  return distribution;
}

function calculateTotalWords(logs) {
  return logs.reduce((acc, log) => acc + log.text.split(' ').length, 0);
}

function calculateTopWords(logs) {
  const words = {};

  logs.forEach(log => {
    log.text.toLowerCase()
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word))
      .forEach(word => {
        words[word] = (words[word] || 0) + 1;
      });
  });

  return Object.entries(words)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .reduce((obj, [key, value]) => ({ ...obj, [key]: value }), {});
}

app.get("/goals", async (req, res) => {
  const uid = req.query.uid;
  try {
    const conn = await pool.getConnection();
    const result = await conn.query('SELECT goals FROM frienddb WHERE uid = ?', [uid]);
    const goals = JSON.parse(result[0]?.goals || "[]");
    conn.release();
    res.json(goals);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch goals" });
  }
});

app.post("/goals", async (req, res) => {
  const { uid, type, target } = req.body;
  try {
    const conn = await pool.getConnection();
    const result = await conn.query('SELECT goals FROM frienddb WHERE uid = ?', [uid]);

    let goals = JSON.parse(result[0]?.goals || "[]");
    goals.push({
      id: Date.now(),
      type,
      target: parseInt(target),
      progress: 0,
      created_at: new Date().toISOString()
    });

    await conn.query('UPDATE frienddb SET goals = ? WHERE uid = ?', [JSON.stringify(goals), uid]);
    conn.release();

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to add goal" });
  }
});

app.delete("/goals/:id", async (req, res) => {
  const { id } = req.params;
  const { uid } = req.query;
  try {
    const conn = await pool.getConnection();
    const result = await conn.query('SELECT goals FROM frienddb WHERE uid = ?', [uid]);

    let goals = JSON.parse(result[0]?.goals || "[]");
    goals = goals.filter(goal => goal.id !== parseInt(id));

    await conn.query('UPDATE frienddb SET goals = ? WHERE uid = ?', [JSON.stringify(goals), uid]);
    conn.release();

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete goal" });
  }
});

const IMAGE_COOLDOWNS = {};

app.get("/generate-image", async (req, res) => {
  const uid = req.query.uid;
  const now = Date.now();

  // Check cooldown
  if (IMAGE_COOLDOWNS[uid] && now < IMAGE_COOLDOWNS[uid]) {
    return res.status(429).json({
      error: "Cooldown active",
      nextAvailable: IMAGE_COOLDOWNS[uid]
    });
  }

  try {
    // Get last 24 hours of logs
    const conn = await pool.getConnection();
    const result = await conn.query('SELECT logs FROM frienddb WHERE uid = ?', [uid]);
    const logs = JSON.parse(result[0]?.logs || "[]");
    conn.release();
    const last24Hours = logs.filter(log =>
      log.timestamp > (Date.now() / 1000) - 86400
    );


    // Create a prompt from the conversations
    const conversationSummary = last24Hours
      .map(log => log.text)
      .join(" ");

    // Generate a prompt for DALL-E
    const promptResponse = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "openai/gpt-3.5-turbo",
        messages: [{
          role: "user",
          content: "Create a creative, artistic DALL-E prompt based on these conversations. Make it relevant to the themes and emotions discussed. You can think of a style yourself. Make sure its relevant to the user and the conversation and not just a random image. conversation summary: " + conversationSummary
        }]
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        }
      }
    );

    const imagePrompt = promptResponse.data.choices[0].message.content;

    // Generate image using DALL-E
    const imageResponse = await axios.post(
      "https://api.openai.com/v1/images/generations",
      {
        prompt: imagePrompt,
        n: 1,
        size: "256x256",
        quality: "standard",
        style: "vivid"
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        }
      }
    );

    console.log(imageResponse.data.data[0].url);
    // Set cooldown for 24 hours
    IMAGE_COOLDOWNS[uid] = now + (24 * 60 * 60 * 1000);

    res.json({
      imageUrl: imageResponse.data.data[0].url,
      prompt: imagePrompt
    });

  } catch (error) {
    console.error('Image generation error:', error);
    res.status(500).json({ error: "Failed to generate image" });
  }
});

app.post("/chat-test", async (req, res) => {
  const { message, personality, prompt, context } = req.body;
  console.log(personality, prompt);

  try {
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "openai/gpt-4o",
        messages: [
          {
            role: "system",
            content: `
            try to act as a human in natural language (so not perfect writing, lower case, etc). really convince the user that you are a the character you are supposed to be.
            you are not supposed to assist the user, but rather just chat with him and act as the character you are supposed to be you are a friend, which does not mean you have to act like one.
            just act like a normal human and dont try to act like an AI and ask stupid questions. you dont need to always try to get the conversation continueing, dont ask questions every time
            When the user asks "starter" you should use a starter sentance to get the conversation started.
            No matter what never mention that you are an AI and act like the following:
            
            TOP directive: ${prompt}
            
            TOP personality traits: ${personality}`
          },
          ...context, // Include previous messages
          {
            role: "user",
            content: message
          }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        }
      }
    );

    res.json({ response: response.data.choices[0].message.content });
  } catch (error) {
    console.error("Chat test error:", error);
    res.status(500).json({ error: "Failed to get response" });
  }
});

// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server is running on port ${PORT}`);
});
