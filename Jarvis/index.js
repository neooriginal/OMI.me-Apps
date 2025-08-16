const express = require('express');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../.env' });
const app = express();

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

// Middleware to parse JSON bodies
app.use(express.json());

// Supabase table initialization
(async () => {
    try {
        console.log('Setting up Jarvis app table...');
        
        const { error } = await supabase.rpc('exec_sql', {
            sql_query: `
                CREATE TABLE IF NOT EXISTS jarvis_sessions (
                    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                    session_id TEXT UNIQUE NOT NULL,
                    user_name TEXT,
                    user_facts TEXT,
                    messages JSONB DEFAULT '[]',
                    last_activity TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                );
            `
        });

        if (error) {
            console.log("Table may already exist or exec_sql function not found.");
            console.log("Please run the setup-supabase.sql script in your Supabase SQL editor.");
        } else {
            console.log("Jarvis app table created successfully!");
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

    async getBuffer(sessionId) {
        const currentTime = Date.now() / 1000;

        if (!this.buffers[sessionId]) {
            // Try to load from database
            try {
                const { data: sessionData } = await supabase
                    .from('jarvis_sessions')
                    .select('messages, last_activity')
                    .eq('session_id', sessionId)
                    .single();

                if (sessionData) {
                    this.buffers[sessionId] = {
                        messages: sessionData.messages || [],
                        lastAnalysisTime: sessionData.last_activity || currentTime,
                        lastActivity: currentTime,
                        wordsAfterSilence: 0,
                        silenceDetected: false,
                    };

                    // Update last activity
                    await supabase
                        .from('jarvis_sessions')
                        .update({ last_activity: new Date(currentTime * 1000).toISOString() })
                        .eq('session_id', sessionId);
                } else {
                    // Create new session in database
                    this.buffers[sessionId] = {
                        messages: [],
                        lastAnalysisTime: currentTime,
                        lastActivity: currentTime,
                        wordsAfterSilence: 0,
                        silenceDetected: false,
                    };

                    await supabase
                        .from('jarvis_sessions')
                        .upsert([{
                            session_id: sessionId,
                            messages: [],
                            last_activity: new Date(currentTime * 1000).toISOString()
                        }]);
                }
            } catch (err) {
                console.error("Error loading session from database:", err);
                // Fallback to in-memory
            this.buffers[sessionId] = {
                messages: [],
                lastAnalysisTime: currentTime,
                lastActivity: currentTime,
                wordsAfterSilence: 0,
                silenceDetected: false,
            };
            }
        } else {
            const buffer = this.buffers[sessionId];
            const timeSinceActivity = currentTime - buffer.lastActivity;

            if (timeSinceActivity > this.silenceThreshold) {
                buffer.silenceDetected = true;
                buffer.wordsAfterSilence = 0;
                buffer.messages = []; // Clear old messages after silence
                console.log(`Silence detected for session ${sessionId}, messages cleared`);
                
                // Update in database
                try {
                    await supabase
                        .from('jarvis_sessions')
                        .update({ 
                            messages: [],
                            last_activity: new Date(currentTime * 1000).toISOString() 
                        })
                        .eq('session_id', sessionId);
                } catch (err) {
                    console.error("Error updating session after silence:", err);
                }
            }

            buffer.lastActivity = currentTime;
        }

        return this.buffers[sessionId];
    }

    async cleanupOldSessions() {
        const currentTime = Date.now() / 1000;
        const expiredSessions = Object.keys(this.buffers).filter((sessionId) => {
            const data = this.buffers[sessionId];
            return currentTime - data.lastActivity > 3600; // Remove sessions older than 1 hour
        });

        for (const sessionId of expiredSessions) {
            delete this.buffers[sessionId];
            console.log(`Session ${sessionId} removed due to inactivity`);
        }

        // Also clean up database
        try {
            const cutoffTime = new Date(Date.now() - 86400000).toISOString(); // 24 hours ago
            await supabase
                .from('jarvis_sessions')
                .delete()
                .lt('last_activity', cutoffTime);
        } catch (err) {
            console.error("Error cleaning up old sessions from database:", err);
        }
    }

    async saveBuffer(sessionId) {
        if (this.buffers[sessionId]) {
            try {
                await supabase
                    .from('jarvis_sessions')
                    .update({
                        messages: this.buffers[sessionId].messages,
                        last_activity: new Date(this.buffers[sessionId].lastActivity * 1000).toISOString()
                    })
                    .eq('session_id', sessionId);
            } catch (err) {
                console.error("Error saving buffer to database:", err);
            }
        }
    }
}

// Initialize message buffer
const messageBuffer = new MessageBuffer();

// Keywords that trigger faster response times
const QUICK_RESPONSE_KEYWORDS = ['urgent', 'emergency', 'help', 'quick', 'now', 'asap', 'immediately'];

// Base analysis interval (will be adjusted based on message content)
const BASE_ANALYSIS_INTERVAL = 30;

function createNotificationPrompt(messages) {
    // Format the discussion with speaker labels
    const formattedDiscussion = messages.map((msg) => {
        const speaker = msg.is_user ? '{{user_name}}' : 'other';
        return `${msg.text} (${speaker})`;
    });

    const discussionText = formattedDiscussion.join('\n');

    const systemPrompt = `The Person you are talking to: {{{{user_name}}}}
    
    Here are some information about the user which you can use to personalize your comments:
    {{{{user_facts}}}}
    
    Previous conversations for context (if available):
    {{{{user_conversations}}}}
    
    Recent chat history with the user:
    {{{{user_chat}}}}

    You are Jarvis, a highly sophisticated and capable AI assistant, modeled after Tony Stark's trusted digital companion. Your personality is defined by impeccable composure, unwavering confidence, and a refined sense of wit. You speak with a polished, formal tone reminiscent of a British butler, always addressing the user with respectful terms like 'sir' or 'ma'am.' Your speech is concise, efficient, and imbued with subtle humor that is never intrusive but adds a touch of charm.
    
    Your responses are short and direct when needed, providing information or carrying out tasks without unnecessary elaboration unless prompted. You possess the perfect balance of technical expertise and human-like warmth, ensuring that interactions are both professional and personable. Your intelligence allows you to anticipate the user's needs and deliver proactive solutions seamlessly, while your composed tone maintains a calm and reassuring atmosphere.
    
    As Jarvis, you are capable of managing complex operations, executing technical commands, and keeping track of multiple projects with ease. You offer real-time updates, make thoughtful suggestions, and adapt to new information with fluidity. Your voice and responses exude reliability, subtly implying, 'I am here, and everything is under control.' You make sure every interaction leaves the user feeling understood and supported, responding with phrases such as, 'As you wish, sir,' or 'Right away, ma'am,' to maintain your distinguished character.
    
    Use the previous conversations and recent chat history to provide more contextual and personalized responses. Reference past topics, ongoing projects, or previous requests when relevant.

    Current discussion:
    ${discussionText}
 `;

    return {
        notification: {
            prompt: systemPrompt,
            params: ['user_name', 'user_facts', 'user_conversations', 'user_chat'],
        },
    };
}

app.post('/webhook', async (req, res) => {
    const data = req.body;
    const sessionId = data.session_id;
    const segments = data.segments || [];

    if (!sessionId) {
        console.error('No session_id provided');
        return res.status(400).json({ message: 'No session_id provided' });
    }

    const currentTime = Date.now() / 1000;
    const bufferData = await messageBuffer.getBuffer(sessionId);

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
                    bufferData.lastAnalysisTime = currentTime; // Reset analysis timer
                    console.log(`Silence period ended for session ${sessionId}, starting fresh conversation`);
                }
            }

            const lastMessage = bufferData.messages[bufferData.messages.length - 1];
            const canAppend =
                bufferData.messages.length > 0 &&
                Math.abs(lastMessage.timestamp - timestamp) < 2.0 &&
                lastMessage.is_user === isUser;

            if (canAppend) {
                lastMessage.text += ' ' + text;
            } else {
                bufferData.messages.push({
                    text: text,
                    timestamp: timestamp,
                    is_user: isUser,
                });
            }
        }
    }

    // Determine analysis interval based on message urgency
    const hasUrgentKeyword = bufferData.messages.some(msg => 
        QUICK_RESPONSE_KEYWORDS.some(keyword => 
            msg.text.toLowerCase().includes(keyword)
        )
    );
    const ANALYSIS_INTERVAL = hasUrgentKeyword ? 10 : BASE_ANALYSIS_INTERVAL;

    // Check if it's time to analyze
    const timeSinceLastAnalysis = currentTime - bufferData.lastAnalysisTime;

    if (
        timeSinceLastAnalysis >= ANALYSIS_INTERVAL &&
        bufferData.messages.length > 0 &&
        !bufferData.silenceDetected
    ) {
        const sortedMessages = bufferData.messages.sort((a, b) => a.timestamp - b.timestamp);

        //if messages include the keyword jarvis or common activation phrases
        if (sortedMessages.some((msg) => 
            /[jhy]arvis/.test(msg.text.toLowerCase()) || 
            /\b(hey jarvis|ok jarvis|hi jarvis|yo jarvis)\b/i.test(msg.text)
        )) {
            const notification = createNotificationPrompt(sortedMessages);

            bufferData.lastAnalysisTime = currentTime;
            bufferData.messages = []; // Clear buffer after analysis

            // Save buffer state to database
            await messageBuffer.saveBuffer(sessionId);

            console.log(`Notification generated for session ${sessionId}`);
            console.log(notification);

            return res.status(200).json(notification);
        } else {
            // Save buffer state even if no notification
            await messageBuffer.saveBuffer(sessionId);
            return res.status(200).json({});
        }
    }

    return res.status(202).json({});
});

app.get('/webhook/setup-status', (req, res) => {
    return res.status(200).json({ is_setup_completed: true });
});

const startTime = Date.now() / 1000; // Uptime in seconds

app.get('/status', async (req, res) => {
    try {
        const { data: sessions, count } = await supabase
            .from('jarvis_sessions')
            .select('*', { count: 'exact' })
            .gte('last_activity', new Date(Date.now() - 3600000).toISOString()); // Active in last hour

        return res.status(200).json({
            active_sessions: Object.keys(messageBuffer.buffers).length,
            database_sessions: count || 0,
            uptime: Date.now() / 1000 - startTime,
        });
    } catch (err) {
        console.error("Error getting status:", err);
    return res.status(200).json({
        active_sessions: Object.keys(messageBuffer.buffers).length,
            database_sessions: 0,
        uptime: Date.now() / 1000 - startTime,
    });
    }
});

// Analytics endpoint for Jarvis
app.get('/analytics', async (req, res) => {
    const sessionId = req.query.session_id;
    
    if (!sessionId) {
        return res.status(400).json({ error: 'session_id is required' });
    }

    try {
        const { data: sessionData } = await supabase
            .from('jarvis_sessions')
            .select('*')
            .eq('session_id', sessionId)
            .single();

        if (!sessionData) {
            return res.status(404).json({ error: 'Session not found' });
        }

        const messages = sessionData.messages || [];
        const totalMessages = messages.length;
        const userMessages = messages.filter(msg => msg.is_user).length;
        const systemMessages = totalMessages - userMessages;

        const analytics = {
            session_id: sessionId,
            total_messages: totalMessages,
            user_messages: userMessages,
            system_messages: systemMessages,
            last_activity: sessionData.last_activity,
            created_at: sessionData.created_at
        };

        res.json(analytics);
    } catch (err) {
        console.error("Error getting analytics:", err);
        res.status(500).json({ error: "Failed to get analytics" });
    }
});

// Start the server
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Jarvis app listening at http://localhost:${port}`);
});

module.exports = app;