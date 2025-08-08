# OMI Apps Collection 🧠🤖✨

**Three powerful AI applications designed to enhance your digital life** - all powered by modern cloud infrastructure for reliable performance.

Originally created for [OMI.me](https://omi.me)

## What You Get

### 🧠 **Brain** - Your AI Memory Assistant

Transform conversations and text into an intelligent, searchable memory network. Brain remembers everything and helps you connect the dots.

**What it does:**

- Automatically extracts people, places, and concepts from your conversations
- Creates visual memory maps showing how everything connects
- Enriches memories with images and detailed descriptions
- Lets you explore your thoughts like never before

<img width="1355" alt="Brain App Interface" src="https://github.com/user-attachments/assets/8f1c25ae-bb36-48d1-aeaf-7891d41c9b32" />

### 👥 **Friend** - Your AI Companion

An intelligent conversation partner that remembers your interactions and provides meaningful responses.

**What it does:**

- Maintains natural, context-aware conversations
- Remembers your preferences and conversation history
- Provides personalized responses based on your interactions
- Tracks engagement and conversation insights

![Friend App Interface](https://github.com/user-attachments/assets/ba3846fd-a6b0-4c0a-855d-97195b28adfe)

### 🎯 **Jarvis** - Your AI Assistant

A focused assistant that responds to specific triggers and helps with targeted tasks.

**What it does:**

- Responds to voice commands and text triggers
- Processes requests efficiently and accurately
- Maintains message history for context
- Provides quick, precise assistance

---

## 🚀 Quick Start (5 Minutes)

**Prerequisites:** You'll need:

- A [Supabase](https://supabase.com) account (free)
- An [OpenRouter](https://openrouter.ai) API key (for AI features)
- Docker installed on your computer

> **Note:** This setup uses pre-built Docker images from GitHub Container Registry for fastest deployment.

### Step 1: Get Your Accounts Ready

1. **Create a Supabase project** at [supabase.com](https://supabase.com)
   - Note your project URL and API key
2. **Get an OpenRouter API key** at [openrouter.ai](https://openrouter.ai)
   - Sign up and generate an API key

### Step 2: Set Up the Database

1. In your Supabase dashboard, go to the SQL Editor
2. Copy and paste the contents of `setup-supabase.sql` (from this repository)
3. Run the script - this creates all the necessary tables

### Step 3: Launch the Apps

```bash
# Download the apps
git clone https://github.com/neooriginal/OMI.me-Apps.git
cd "OMI.me-Apps"

# Configure your settings
cp docker.env.example .env
```

Edit the `.env` file with your information:

```env
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_api_key
OPENROUTER_API_KEY=your_openrouter_api_key
SESSION_SECRET=any_random_string_here
FRONTEND_URL_BRAIN=http://localhost:3000
```

```bash
# Start everything (pulls pre-built images automatically)
docker-compose up -d
```

**That's it!** Docker will automatically download the pre-built images and start your apps:

- **Brain:** http://localhost:3000
- **Friend:** http://localhost:5000
- **Jarvis:** http://localhost:8000

---

## 📱 Submit app in OMI App Store

1. Open OMI App
2. Navigate to the "Explore" (or Apps) Tab
3. Press "Create your own" at the top
4. Press "Create an App"
5. Enter Image, Name, Category, Description, Preview
6. Select External Integration Capability

### Brain App

7.  Select Conversation Creation as "Trigger Event"

- **Webhook URL:** `your_server_url/api/process-text`

### Friend App

6.5. Also select Notification as Capability 7. Select Transcript Processed as "Trigger Event"

- **Webhook URL:** `your_server_url/webhook`

### Jarvis App

6.5. Also select Notification as Capability 7. Select Transcript Processed as "Trigger Event"

- **Webhook URL:** `your_server_url/webhook`

8. Put your server url as "App Home URL"
9. Agree to ToS and Privacy Policy
10. Submit and install the app

---

## 🛠️ Managing Your Apps

### View Status

```bash
docker-compose ps
```

### View Logs

```bash
# All apps
docker-compose logs -f

# Specific app
docker-compose logs brain
```

### Update Apps

```bash
# Pull latest pre-built images and restart
docker-compose pull && docker-compose up -d
```

### Stop Everything

```bash
docker-compose down
```

---

## 🔧 Advanced Options

<details>
<summary>Manual Installation (Not Recommended)</summary>

If you prefer not to use Docker, you can build and install each app manually (requires more setup):

**Requirements:** Node.js v16+, npm

```bash
# For each app (Brain, Friend, Jarvis)
cd Brain  # or Friend, or Jarvis
npm install

# Create .env file with your settings
SUPABASE_URL=your_url
SUPABASE_ANON_KEY=your_key
OPENROUTER_API_KEY=your_key
PORT=3000  # 5000 for Friend, 8000 for Jarvis

# Start the app
npm start
```

</details>

<details>
<summary>Run Individual Apps (Alternative Method)</summary>

You can also run individual apps directly using pre-built images:

```bash
# Run individual apps with pre-built images
docker run -d -p 3000:3000 --env-file .env ghcr.io/neooriginal/omi.me-apps/brain:latest
docker run -d -p 5000:5000 --env-file .env ghcr.io/neooriginal/omi.me-apps/friend:latest
docker run -d -p 8000:8000 --env-file .env ghcr.io/neooriginal/omi.me-apps/jarvis:latest
```

This method gives you more control over individual services but Docker Compose is recommended for most users.

</details>

---

## 📄 License & Credits

Created by **Neo** ([@neooriginal](https://github.com/neooriginal)) © 2025

**MIT License with Attribution** - You're free to use, modify, and distribute these apps. Just give credit where it's due!

---

## ⚠️ Important Notes

- These apps use external AI services (OpenRouter) - usage may incur costs
- You're responsible for securing your own deployments
- Always keep your API keys private and secure
- Review privacy settings in Supabase for your use case

**Support the Project:** If you find these apps useful, consider starring the repository and sharing with others!

---

## 📋 Disclaimer & Liability

**THIS SOFTWARE IS PROVIDED "AS IS"** without any warranty of any kind. The author(s) are not responsible for:

- **Data Loss or Corruption** - Always backup your important data
- **Security Vulnerabilities** - You are responsible for securing your deployment
- **Service Costs** - API usage fees from external services (OpenRouter, Supabase, etc.)
- **Downtime or Outages** - No guarantee of uptime or availability
- **Compliance Issues** - Ensure compliance with your local laws and regulations
- **Third-party Services** - Issues with external APIs or services used by these apps

**BY USING THESE APPLICATIONS, YOU ACKNOWLEDGE THAT:**

- You understand the risks involved in running self-hosted software
- You are solely responsible for your deployment and its security
- You will not hold the author(s) liable for any damages or losses
- You are responsible for obtaining proper licenses and API keys
- You will comply with all applicable terms of service and regulations

**EXTERNAL SERVICES:** These applications integrate with third-party services (OpenRouter, Supabase, etc.). You are responsible for:

- Reading and accepting their terms of service
- Managing your own accounts and API keys
- Monitoring and controlling your usage and costs
- Ensuring compliance with their policies and your local regulations

**SECURITY NOTICE:** While these applications include security measures, no software is 100% secure. You should:

- Keep your system and dependencies updated
- Use strong, unique passwords and API keys
- Regularly monitor your deployments for unusual activity
- Implement additional security measures as needed for your environment

Use at your own risk. The author(s) provide this software as-is for educational and personal use.
