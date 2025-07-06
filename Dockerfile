# Tailored Resume Service Dockerfile
FROM node:18-alpine

# Install TinyTeX and dependencies
RUN apk add --no-cache \
    curl \
    bash \
    perl \
    wget \
    fontconfig \
    && rm -rf /var/cache/apk/*

# Install TinyTeX with proper permissions
RUN cd /tmp && \
    sudo wget -qO- "https://yihui.org/tinytex/install-bin-unix.sh" > install-tinytex.sh && \
    sudo chmod +x install-tinytex.sh && \
    sudo ./install-tinytex.sh && \
    sudo rm install-tinytex.sh

ENV PATH="/root/.TinyTeX/bin/x86_64-linux:$PATH"

# Install required LaTeX packages
RUN sudo tlmgr install \
    geometry \
    parskip \
    array \
    ifthen \
    hyperref

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm ci --only=production

# Copy app source
COPY . .

# Create temp directory
RUN mkdir -p /tmp/resume-generation

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Start the application
CMD ["npm", "start"]
