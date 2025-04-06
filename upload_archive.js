const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// ===================== CONFIGURATION =====================
const CONFIG = {
    serverUrl: 'http://77.239.97.85:8088/api/files/upload',
    archiveFileName: 'Stable.zip', 
    apiKey: 'tJz4uRVCwl2eEwyPTudYP9iGRfgq', 
    retryDelay: 5000,              // 5 seconds between retry attempts
    maxRetries: 5,                 // Maximum reconnection attempts
    timeout: 120000                // 2 minutes timeout (увеличенный таймаут)
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
        fs.appendFileSync('detailed_upload.log', `${logMessage}\n`);
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

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ===================== FILE UPLOAD FUNCTION =====================
async function uploadFile(retryCount = 0) {
    try {
        const filePath = path.join(process.cwd(), CONFIG.archiveFileName);
        
        // Проверяем существование файла
        if (!fs.existsSync(filePath)) {
            log(`КРИТИЧЕСКАЯ ОШИБКА: Файл не найден: ${filePath}`, true);
            log(`Текущая директория: ${process.cwd()}`, true);
            log(`Содержимое директории: ${fs.readdirSync(process.cwd()).join(', ')}`, true);
            return false;
        }

        // Получаем статистику файла
        const fileStats = fs.statSync(filePath);
        const fileSize = fileStats.size;
        log(`Размер файла: ${fileSize} байт (${formatFileSize(fileSize)})`);
        
        if (fileSize === 0) {
            log(`ОШИБКА: Файл ${CONFIG.archiveFileName} имеет нулевой размер!`, true);
            return false;
        }

        // Создаем FormData
        const formData = new FormData();
        formData.append('file', fs.createReadStream(filePath), {
            filename: path.basename(filePath),
            contentType: 'application/zip',
            knownLength: fileSize // Явно указываем размер файла
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
        log(`URL сервера: ${CONFIG.serverUrl}`);
        
        // Отправляем файл с мониторингом прогресса загрузки
        const startTime = Date.now();
        log(`Отправка началась в: ${new Date(startTime).toISOString()}`);
        
        // Отправляем файл
        const response = await axios.post(CONFIG.serverUrl, formData, {
            headers: {
                ...formData.getHeaders(),
                'X-Client-Info': JSON.stringify(systemInfo),
                'Content-Length': formData.getLengthSync() // Устанавливаем точный Content-Length
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            timeout: CONFIG.timeout,
            onUploadProgress: (progressEvent) => {
                const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                log(`Прогресс загрузки: ${percentCompleted}% (${formatFileSize(progressEvent.loaded)}/${formatFileSize(progressEvent.total)})`);
            }
        });

        const endTime = Date.now();
        const duration = (endTime - startTime) / 1000; // в секундах
        const speed = fileSize / duration / 1024; // KB/s
        
        log(`Загрузка завершена за ${duration.toFixed(1)} секунд (${speed.toFixed(2)} KB/s)`);
        log(`Статус ответа: ${response.status}`);
        log(`Ответ сервера: ${JSON.stringify(response.data)}`);
        
        return response.data.success;
    } catch (error) {
        // Детальное логирование ошибок
        log(`ОШИБКА ПРИ ЗАГРУЗКЕ (попытка ${retryCount + 1}/${CONFIG.maxRetries}):`, true);
        
        if (error.response) {
            // Сервер ответил с ошибкой
            log(`Статус ошибки: ${error.response.status}`, true);
            log(`Данные ошибки: ${JSON.stringify(error.response.data)}`, true);
        } else if (error.request) {
            // Запрос был сделан, но нет ответа
            log('Нет ответа от сервера', true);
            log(`Тип ошибки: ${error.code}`, true);
        } else {
            // Что-то пошло не так при настройке запроса
            log(`Ошибка настройки: ${error.message}`, true);
        }
        
        // Попробуем повторить запрос, если не превышено максимальное количество попыток
        if (retryCount < CONFIG.maxRetries) {
            log(`Повторная попытка через ${CONFIG.retryDelay / 1000} секунд...`);
            await new Promise(resolve => setTimeout(resolve, CONFIG.retryDelay));
            return uploadFile(retryCount + 1);
        }
        
        log(`Превышено максимальное количество попыток (${CONFIG.maxRetries})`, true);
        return false;
    }
}

// ===================== MAIN FUNCTION =====================
async function main() {
    try {
        log('========== НАЧАЛО ПРОЦЕССА ЗАГРУЗКИ АРХИВА ==========');
        log(`Версия Node.js: ${process.version}`);
        log(`Платформа: ${process.platform}`);
        log(`Директория запуска: ${process.cwd()}`);
        
        // Проверка наличия необходимых пакетов
        try {
            if (!fs.existsSync('./node_modules/axios') || !fs.existsSync('./node_modules/form-data')) {
                log('Установка необходимых зависимостей...');
                require('child_process').execSync('npm install axios form-data');
                log('Зависимости успешно установлены');
            }
        } catch (error) {
            log(`Предупреждение: Не удалось проверить/установить зависимости: ${error.message}`);
        }
        
        const success = await uploadFile();
        
        if (success) {
            log('========== АРХИВ УСПЕШНО ЗАГРУЖЕН ==========');
            process.exit(0);
        } else {
            log('========== НЕ УДАЛОСЬ ЗАГРУЗИТЬ АРХИВ ==========', true);
            process.exit(1);
        }
    } catch (error) {
        log(`ФАТАЛЬНАЯ ОШИБКА: ${error.message}`, true);
        log(`Стек ошибки: ${error.stack}`, true);
        process.exit(1);
    }
}

// Запускаем основную функцию
main();
