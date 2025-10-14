# Use official Node.js 18 LTS image
FROM node:18-alpine

WORKDIR /app

# Install curl for healthchecks
RUN apk add --no-cache curl

# Copy package files first for caching
COPY package*.json ./

# Install dependencies
RUN npm install --production && npm cache clean --force

# Copy application code
COPY . .

# Expose web server port
EXPOSE 5100

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:5100/health || exit 1

CMD ["npm", "start"]