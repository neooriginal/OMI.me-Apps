#!/usr/bin/env node

/**
 * Test JARVIS with proper timing to trigger notification
 * The app requires 30+ seconds between analysis intervals
 */

const https = require('https');

const WEBHOOK_URL = 'https://jarvis-app-k4xoe.ondigitalocean.app/webhook';
const SESSION_ID = `enhanced-test-${Date.now()}`;

function sendRequest(segments) {
    const data = JSON.stringify({
        session_id: SESSION_ID,
        segments: segments
    });

    return new Promise((resolve, reject) => {
        const url = new URL(WEBHOOK_URL);
        const options = {
            hostname: url.hostname,
            port: 443,
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        };

        const req = https.request(options, (res) => {
            let responseBody = '';
            res.on('data', (chunk) => responseBody += chunk);
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    body: responseBody ? JSON.parse(responseBody) : {}
                });
            });
        });

        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

async function testWithProperTiming() {
    console.log('🚀 Testing JARVIS Enhanced Features\n');
    console.log('Session:', SESSION_ID);
    console.log('=' .repeat(60));

    // Send message with "jarvis" keyword and timestamp that simulates 35+ seconds elapsed
    console.log('\n📤 Sending message with JARVIS trigger...');
    console.log('   (Using timestamp to simulate 35 seconds elapsed)\n');
    
    const segments = [
        { 
            text: "Jarvis, I need your assistance with analyzing my memory patterns", 
            is_user: true, 
            start: 35  // This simulates 35 seconds since session start
        }
    ];
    
    const response = await sendRequest(segments);
    
    console.log('📨 Response Status:', response.statusCode);
    
    if (response.body && response.body.notification) {
        console.log('\n✅ NOTIFICATION GENERATED!\n');
        
        const { notification } = response.body;
        
        // Check parameters
        if (notification.params) {
            console.log('📋 Context Variables Used:');
            console.log('=' .repeat(40));
            
            const expectedParams = {
                'user_name': '👤 User identity',
                'user_facts': '📝 User facts/preferences',
                'user_conversations': '💬 Previous conversations (NEW!)',
                'user_chat': '🗨️ Recent chat history (NEW!)'
            };
            
            for (const [param, description] of Object.entries(expectedParams)) {
                const isPresent = notification.params.includes(param);
                console.log(`${isPresent ? '✅' : '❌'} ${description}`);
                console.log(`   Variable: ${param}`);
            }
            
            console.log('\n📊 Summary:');
            console.log(`   Total variables: ${notification.params.length}`);
            console.log(`   Expected: 4`);
            
            if (notification.params.length === 4) {
                console.log('\n🎉 SUCCESS! All 4 context variables are active!');
                console.log('   The enhancement is working correctly.');
            } else if (notification.params.length === 2) {
                console.log('\n⚠️  WARNING: Only 2 variables detected');
                console.log('   The enhancement may not be deployed yet.');
                console.log('   Current variables:', notification.params.join(', '));
            }
        }
        
        // Check prompt for new placeholders
        if (notification.prompt) {
            console.log('\n🔍 Checking Prompt Template:');
            console.log('=' .repeat(40));
            
            const checks = [
                ['{{user_name}}', 'User name placeholder'],
                ['{{user_facts}}', 'User facts placeholder'],
                ['{{user_conversations}}', 'Conversations placeholder (NEW!)'],
                ['{{user_chat}}', 'Chat history placeholder (NEW!)']
            ];
            
            for (const [placeholder, description] of checks) {
                const hasPlaceholder = notification.prompt.includes(placeholder);
                console.log(`${hasPlaceholder ? '✅' : '❌'} ${description}`);
            }
            
            // Show sections of prompt that mention context
            const contextLines = notification.prompt.split('\n')
                .filter(line => line.includes('conversation') || line.includes('chat') || line.includes('context'))
                .slice(0, 3);
                
            if (contextLines.length > 0) {
                console.log('\n📝 Context-related prompt sections found:');
                contextLines.forEach(line => {
                    console.log('   >', line.trim().substring(0, 60) + '...');
                });
            }
        }
    } else {
        console.log('\n⏳ No notification generated');
        console.log('   Status:', response.statusCode);
        console.log('   Body:', JSON.stringify(response.body));
        
        if (response.statusCode === 202) {
            console.log('\n💡 Tip: This usually means:');
            console.log('   - The 30-second analysis interval hasn\'t passed');
            console.log('   - Or "jarvis" keyword wasn\'t detected');
        }
    }
    
    console.log('\n' + '=' .repeat(60));
    console.log('Test complete!\n');
}

testWithProperTiming().catch(console.error);