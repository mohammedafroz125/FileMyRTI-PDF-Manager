# Use official Node.js runtime (Debian slim image for Ghostscript & LibreOffice support)
FROM node:20-slim

# Install Ghostscript, LibreOffice, and standard system fonts
RUN apt-get update && apt-get install -y --no-install-recommends \
    ghostscript \
    libreoffice \
    fonts-dejavu \
    fonts-liberation \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package definition and install all dependencies
COPY package*.json ./
RUN npm ci

# Copy tsconfig and source code
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript into dist/
RUN npm run build

# Default environment settings
ENV NODE_ENV=production
ENV PORT=5000

EXPOSE 5000

# Launch Express server
CMD ["npm", "start"]
