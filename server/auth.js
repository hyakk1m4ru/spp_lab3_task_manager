const jwt = require('jsonwebtoken');
const SECRET = 'MY_SUPER_SECRET_KEY';

function socketAuthMiddleware(socket, next) {
    try {
        // 1. Пытаемся взять токен из handshake.auth или из cookie
        const token = socket.handshake.auth?.token
            || (socket.handshake.headers.cookie || '')
                .split('; ')
                .find(c => c.startsWith('token='))
                ?.split('=')[1];

        if (!token) return next(new Error('Unauthorized'));

        // 2. Проверяем токен
        const payload = jwt.verify(token, SECRET);

        // 3. Сохраняем пользователя в сокет для последующего использования
        socket.user = payload;
        next();
    } catch {
        next(new Error('Unauthorized'));
    }
}

module.exports = { socketAuthMiddleware, SECRET };
