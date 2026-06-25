const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');
const fs = require('fs');

app.use(express.json());
app.use(express.static(__dirname));

// データベースの代わりに、テキストファイル(json)に保存する
const USERS_FILE = path.join(__dirname, 'users.json');

// 起動時にファイルがなければ空のオブジェクトで作る
if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify({}), 'utf8');
}

// ユーザーデータを読み込む関数
function loadUsers() {
    try {
        const data = fs.readFileSync(USERS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        return {};
    }
}

// ユーザーデータを保存する関数
function saveUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// アカウント作成画面の処理
app.post('/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.json({ success: false, message: 'ユーザー名とパスワードを入力してね' });
    }

    const users = loadUsers();
    if (users[username]) {
        return res.json({ success: false, message: 'そのユーザー名はもう使われているよ' });
    }

    users[username] = { password: password };
    saveUsers(users);

    res.json({ success: true });
});

// ログイン画面の処理
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const users = loadUsers();

    if (users[username] && users[username].password === password) {
        res.json({ success: true, token: username });
    } else {
        res.json({ success: false, message: 'ユーザー名かパスワードが違うよ' });
    }
});

// チャットのリアルタイム通信（Socket.IO）
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (token) {
        socket.username = token;
        return next();
    }
    next(new Error("authentication error"));
});

io.on('connection', (socket) => {
    socket.on('chat message', (msg) => {
        io.emit('chat message', { username: socket.username, msg: msg });
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log('同盟 Link 起動完了！');
});