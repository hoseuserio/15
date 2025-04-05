const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const path = require('path');

// Токен администратора
const ADMIN_TOKEN = 'tJz4uRVCwl2eEwyPTudYP9iGRfgq';

async function uploadFile(filePath, serverUrl, token) {
    try {
        // Проверяем существование файла
        if (!fs.existsSync(filePath)) {
            console.error(`Файл не найден: ${filePath}`);
            return false;
        }

        // Создаем FormData
        const formData = new FormData();
        formData.append('file', fs.createReadStream(filePath), {
            filename: path.basename(filePath),
            contentType: 'application/zip'
        });

        // Отправляем файл с помощью axios
        const response = await axios.post(serverUrl, formData, {
            headers: {
                'Authorization': `Bearer ${token}`,
                ...formData.getHeaders()
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });

        console.log('Ответ сервера:', response.data);
        return response.data.success;
    } catch (error) {
        console.error('Ошибка при загрузке файла:', 
            error.response ? error.response.data : error.message
        );
        return false;
    }
}

// Пример использования
async function main() {
    const filePath = path.join(process.cwd(), 'Stable.zip');
    const serverUrl = 'http://92.246.137.44:8080/api/files/upload';

    console.log(`Начало загрузки файла: ${filePath}`);
    console.log(`URL сервера: ${serverUrl}`);

    const result = await uploadFile(filePath, serverUrl, ADMIN_TOKEN);
    
    if (result) {
        console.log('✅ Файл успешно загружен');
        process.exit(0);
    } else {
        console.error('❌ Не удалось загрузить файл');
        process.exit(1);
    }
}

main();
