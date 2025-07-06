// Tailored Resume Service - Express App
require('dotenv').config();

const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const AWS = require('aws-sdk');

const app = express();

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Multer configuration for file uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'text/plain' || file.originalname.endsWith('.tex')) {
            cb(null, true);
        } else {
            cb(new Error('Only .txt and .tex files are allowed'), false);
        }
    }
});

// Configuration
const config = {
    s3BucketName: process.env.S3_BUCKET_NAME || 'tailored-resume-bucket',
    awsRegion: process.env.AWS_REGION || 'us-east-2',
    tinytexPath: process.env.TINYTEX_PATH || `${process.env.HOME}/.TinyTeX/bin/x86_64-linux/pdflatex`,
    tempDir: process.env.TEMP_DIR || '/tmp/resume-generation',
    port: process.env.PORT || 3000
};

// AWS S3 Setup
AWS.config.update({ region: config.awsRegion });
const s3 = new AWS.S3();

// Ensure temp directory exists
if (!fs.existsSync(config.tempDir)) {
    fs.mkdirSync(config.tempDir, { recursive: true });
}

// Resume Class Manager
class ResumeClassManager {
    constructor() {
        this.resumeClsPath = path.join(__dirname, 'resume.cls');
    }

    getResumeClass() {
        try {
            if (fs.existsSync(this.resumeClsPath)) {
                return fs.readFileSync(this.resumeClsPath, 'utf8');
            } else {
                throw new Error('resume.cls file not found');
            }
        } catch (error) {
            console.error('Error reading resume.cls:', error.message);
            throw error;
        }
    }

    copyToTempDir(tempDir) {
        const resumeClass = this.getResumeClass();
        const tempClsPath = path.join(tempDir, 'resume.cls');
        fs.writeFileSync(tempClsPath, resumeClass);
        return tempClsPath;
    }
}

// S3 Manager
class S3Manager {
    constructor(bucketName) {
        this.bucketName = bucketName;
    }

    async uploadFile(filePath, s3Key, metadata = {}) {
        const fileContent = fs.readFileSync(filePath);
        
        const params = {
            Bucket: this.bucketName,
            Key: s3Key,
            Body: fileContent,
            ContentType: 'application/pdf',
            Metadata: metadata
        };

        try {
            const result = await s3.upload(params).promise();
            console.log(`✅ File uploaded to S3: ${result.Location}`);
            return result;
        } catch (error) {
            console.error(`❌ S3 upload error: ${error.message}`);
            throw error;
        }
    }

    async listFiles(prefix = 'resumes/') {
        const params = {
            Bucket: this.bucketName,
            Prefix: prefix
        };

        try {
            const data = await s3.listObjectsV2(params).promise();
            return data.Contents || [];
        } catch (error) {
            console.error(`❌ S3 list error: ${error.message}`);
            throw error;
        }
    }

    generatePresignedUrl(s3Key, expiresIn = 3600) {
        const params = {
            Bucket: this.bucketName,
            Key: s3Key,
            Expires: expiresIn
        };

        return s3.getSignedUrl('getObject', params);
    }
}

// PDF Generator
class PDFGenerator {
    constructor(s3Manager, resumeClassManager) {
        this.s3Manager = s3Manager;
        this.resumeClassManager = resumeClassManager;
    }

    async generatePDF(resumeContent, jobTitle = 'resume', userId = 'default') {
        const timestamp = Date.now();
        const filename = `${jobTitle.replace(/[^a-zA-Z0-9]/g, '-')}-${timestamp}`;
        
        const texPath = path.join(config.tempDir, `${filename}.tex`);
        const pdfPath = path.join(config.tempDir, `${filename}.pdf`);
        const s3Key = `resumes/${userId}/${filename}.pdf`;
        
        console.log(`📄 Starting PDF generation: ${filename}`);
        
        try {
            // Copy resume.cls to temp directory
            this.resumeClassManager.copyToTempDir(config.tempDir);
            
            // Write LaTeX content
            fs.writeFileSync(texPath, resumeContent);
            
            // Generate PDF
            const result = await this.compilePDF(filename, texPath, pdfPath, s3Key, {
                'job-title': jobTitle,
                'user-id': userId,
                'generated-at': new Date().toISOString()
            });
            
            return result;
            
        } catch (error) {
            console.error(`❌ PDF generation failed: ${error.message}`);
            throw error;
        }
    }

    compilePDF(filename, texPath, pdfPath, s3Key, metadata) {
        return new Promise((resolve, reject) => {
            const command = `cd ${config.tempDir} && ${config.tinytexPath} -interaction=nonstopmode ${filename}.tex`;
            
            exec(command, async (error, stdout, stderr) => {
                if (error) {
                    reject(new Error(`LaTeX compilation failed: ${error.message}`));
                    return;
                }
                
                if (!fs.existsSync(pdfPath)) {
                    reject(new Error('PDF file was not created'));
                    return;
                }
                
                try {
                    // Upload to S3
                    const uploadResult = await this.s3Manager.uploadFile(pdfPath, s3Key, metadata);
                    
                    // Generate presigned URL
                    const presignedUrl = this.s3Manager.generatePresignedUrl(s3Key);
                    
                    // Cleanup temp files
                    this.cleanupTempFiles(filename);
                    
                    resolve({
                        filename: `${filename}.pdf`,
                        s3Key: s3Key,
                        s3Url: uploadResult.Location,
                        presignedUrl: presignedUrl,
                        success: true
                    });
                    
                } catch (uploadError) {
                    reject(new Error(`S3 upload failed: ${uploadError.message}`));
                }
            });
        });
    }

    cleanupTempFiles(filename) {
        const extensions = ['.tex', '.pdf', '.aux', '.log', '.out'];
        extensions.forEach(ext => {
            const filePath = path.join(config.tempDir, `${filename}${ext}`);
            if (fs.existsSync(filePath)) {
                try {
                    fs.unlinkSync(filePath);
                } catch (error) {
                    console.warn(`⚠️  Cleanup warning: ${error.message}`);
                }
            }
        });
    }
}

// Initialize managers
const resumeClassManager = new ResumeClassManager();
const s3Manager = new S3Manager(config.s3BucketName);
const pdfGenerator = new PDFGenerator(s3Manager, resumeClassManager);

// Routes

// Home page
app.get('/', (req, res) => {
    res.json({
        message: 'Tailored Resume Service',
        version: '1.0.0',
        bucket: config.s3BucketName,
        endpoints: {
            health: '/health',
            generate: 'POST /api/generate-pdf (text input)',
            generateFile: 'POST /api/generate-pdf-file (file upload)',
            files: '/api/files'
        }
    });
});

// Generate PDF endpoint (text input)
app.post('/api/generate-pdf', async (req, res) => {
    try {
        const { resumeContent, jobTitle = 'resume', userId = 'default' } = req.body;
        
        if (!resumeContent) {
            return res.status(400).json({ 
                error: 'resumeContent is required',
                success: false 
            });
        }
        
        console.log(`📋 PDF generation request - Job: ${jobTitle}, User: ${userId}`);
        
        const result = await pdfGenerator.generatePDF(resumeContent, jobTitle, userId);
        
        res.json(result);
        
    } catch (error) {
        console.error(`❌ API Error: ${error.message}`);
        res.status(500).json({ 
            error: error.message,
            success: false 
        });
    }
});

// Generate PDF endpoint (file upload)
app.post('/api/generate-pdf-file', upload.single('resumeFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ 
                error: 'resumeFile is required',
                success: false 
            });
        }
        
        const { jobTitle = 'resume', userId = 'default' } = req.body;
        const resumeContent = req.file.buffer.toString('utf8');
        
        console.log(`📋 PDF generation request from file - Job: ${jobTitle}, User: ${userId}, File: ${req.file.originalname}`);
        
        const result = await pdfGenerator.generatePDF(resumeContent, jobTitle, userId);
        
        res.json(result);
        
    } catch (error) {
        console.error(`❌ File Upload API Error: ${error.message}`);
        res.status(500).json({ 
            error: error.message,
            success: false 
        });
    }
});

// List files endpoint
app.get('/api/files', async (req, res) => {
    try {
        const files = await s3Manager.listFiles('resumes/');
        
        const fileList = files.map(file => ({
            key: file.Key,
            name: path.basename(file.Key),
            size: file.Size,
            lastModified: file.LastModified,
            url: s3Manager.generatePresignedUrl(file.Key)
        }));
        
        res.json({
            files: fileList,
            count: fileList.length,
            success: true
        });
        
    } catch (error) {
        console.error(`❌ Files API Error: ${error.message}`);
        res.status(500).json({ 
            error: error.message,
            success: false 
        });
    }
});

// Health check
app.get('/health', async (req, res) => {
    const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        config: {
            bucket: config.s3BucketName,
            region: config.awsRegion,
            port: config.port
        },
        checks: {
            tinytex: fs.existsSync(config.tinytexPath),
            resumeClass: fs.existsSync(path.join(__dirname, 'resume.cls')),
            tempDir: fs.existsSync(config.tempDir)
        }
    };
    
    // Test S3 access
    try {
        await s3.headBucket({ Bucket: config.s3BucketName }).promise();
        health.checks.s3 = true;
    } catch (error) {
        health.checks.s3 = false;
        health.s3Error = error.message;
    }
    
    const allChecksPass = Object.values(health.checks).every(check => check === true);
    
    res.status(allChecksPass ? 200 : 500).json(health);
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({ 
        error: 'Internal server error',
        success: false 
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ 
        error: 'Endpoint not found',
        success: false 
    });
});

// Start server
app.listen(config.port, () => {
    console.log(`🚀 Tailored Resume Service running on port ${config.port}`);
    console.log(`📦 S3 Bucket: ${config.s3BucketName}`);
    console.log(`🌍 Region: ${config.awsRegion}`);
    console.log(`🔧 TinyTeX: ${config.tinytexPath}`);
    console.log(`📁 Temp Dir: ${config.tempDir}`);
    console.log(`🌐 Health Check: http://localhost:${config.port}/health`);
});

module.exports = app;