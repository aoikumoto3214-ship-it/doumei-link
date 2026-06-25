const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');

const SECRET_KEY = 'doumei-link-secret-key'; // スタンプを作るための秘密の合言葉

app.use(express.json()); // 本文を読み込むための設定

// パソコンの中に「金庫（database.db）」という名前のファイルを作る
const db = new sqlite3.Database('./database.db');

// 金庫の中に「ユーザー情報」を保存するテーブル（引き出し）を作る
db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS users (username TEXT UNIQUE, password TEXT)");
});

// 画面（index.html）を表示させる
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// 【アカウント作成】の命令を受け付ける場所
app.post('/register', (req, res) => {
    const { username, password } = req.body;
    db.run("INSERT INTO users (username, password) VALUES (?, ?)", [username, password], (err) => {
        if (err) {
            return res.json({ success: false, message: 'その名前はすでに使われています' });
        }
        res.json({ success: true });
    });
});

// 【ログイン】の命令を受け付ける場所
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM users WHERE username = ? AND password = ?", [username, password], (err, row) => {
        if (row) {
            // パスワードが合ってたら、秘密のスタンプ（トークン）を発行してあげる
            const token = jwt.sign({ username: username }, SECRET_KEY);
            res.json({ success: true, token: token, username: username });
        } else {
            res.json({ success: false, message: '名前かパスワードが違います' });
        }
    });
});

// チャットのリアルタイム通信（スタンプを持ってる人だけ通す）
io.on('connection', (socket) => {
    // 画面を開いた人から送られてきたスタンプをチェック
    const token = socket.handshake.auth.token;
    let username = '名無し';

    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        username = decoded.username; // スタンプから名前を取り出す
        console.log(`${username}がオンラインになったよ！`);
    } catch (e) {
        // スタンプが無効なら切断する
        return socket.disconnect();
    }

    // メッセージが送られてきたら、[名前] メッセージ の形にして全員に配る
    socket.on('chat message', (msg) => {
        io.emit('chat message', { username: username, msg: msg });
    });
});

http.listen(3000, () => {
    console.log('同盟 Link 起動完了！ http://localhost:3000 を開いてね');
});