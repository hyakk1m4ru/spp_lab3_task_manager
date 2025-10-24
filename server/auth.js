const jwt = require('jsonwebtoken');

const SECRET = 'MY_SUPER_SECRET_KEY'; // В реальном проекте хранить в env

function authMiddleware(req, res, next) {
    console.log("token = ", token);
    const token = req.cookies?.token; // читаем из HttpOnly cookie

    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const payload = jwt.verify(token, SECRET);
        req.user = payload; // сохраняем данные пользователя в req
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid token' });
    }
}

module.exports = { authMiddleware, SECRET };
