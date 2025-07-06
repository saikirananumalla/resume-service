# Tailored Resume Service

A Node.js service that generates tailored PDF resumes using LaTeX and stores them in AWS S3.

## Features

- Generate PDF resumes from LaTeX source
- Upload to AWS S3 with organized folder structure
- RESTful API endpoints
- Health monitoring
- Configurable resume template via `resume.cls`

## Quick Start

### 1. Clone and Install
```bash
git clone <your-repo-url>
cd tailored-resume-service
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env with your settings
```

### 3. Start Service
```bash
npm start
```

### 4. Test
```bash
curl http://localhost:3000/health
```

## API Endpoints

### Generate PDF
```bash
POST /api/generate-pdf
Content-Type: application/json

{
    "resumeContent": "\\documentclass{resume}...",
    "jobTitle": "Software Engineer",
    "userId": "john-doe"
}
```

### List Files
```bash
GET /api/files
```

### Health Check
```bash
GET /health
```

## Configuration

Required environment variables:
- `S3_BUCKET_NAME` - Your S3 bucket name
- `AWS_REGION` - AWS region
- `TINYTEX_PATH` - Path to pdflatex binary

## S3 Structure

Files are stored as:
```
your-bucket/
├── resumes/
│   ├── user1/
│   │   └── Software-Engineer-1234567890.pdf
│   └── user2/
│       └── Data-Scientist-1234567891.pdf
```

## Requirements

- Node.js 14+
- TinyTeX or LaTeX installation
- AWS S3 bucket with appropriate permissions
- AWS credentials configured

## Development

```bash
npm run dev  # Start with nodemon
npm test     # Run health check
```