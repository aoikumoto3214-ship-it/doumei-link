const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');
const fs = require('fs');

app.use(express.json());
app.use(express.static(__dirname));

// データ保存用ファイルの定義
const USERS_FILE = path.join(__dirname, 'users.json');
const MSGS_FILE = path.join(__dirname, 'messages.json');

// 起動時にファイルが存在しなければ生成する
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, JSON.stringify({}), 'utf8');
if (!fs.existsSync(MSGS_FILE)) fs.writeFileSync(MSGS_FILE, JSON.stringify([]), 'utf8');

// ファイル読み書き関数
function loadUsers() { try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch(e) { return {}; } }
function saveUsers(users) { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8'); }
function loadMessages() { try { return JSON.parse(fs.readFileSync(MSGS_FILE, 'utf8')); } catch(e) { return []; } }
function saveMessages(msgs) { fs.writeFileSync(MSGS_FILE, JSON.stringify(msgs, null, 2), 'utf8'); }

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

// アカウント作成（アイコン情報も一緒に保存）
app.post('/register', (req, res) => {
    const { username, password, avatar } = req.body;
    if (!username || !password) return res.json({ success: false, message: '入力情報が足りないよ' });
    const users = loadUsers();
    if (users[username]) return res.json({ success: false, message: 'そのユーザー名はもう使われているよ' });
    
    users[username] = { password: password, avatar: avatar || '👾' };
    saveUsers(users);
    res.json({ success: true });
});

// ログイン（アイコン情報も返す）
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const users = loadUsers();
    if (users[username] && users[username].password === password) {
        res.json({ success: true, token: username, avatar: users[username].avatar });
    } else {
        res.json({ success: false, message: '名前かパスワードが違うよ' });
    }
});

// 登録されているユーザー一覧を取得するAPI（サイドバー用）
app.get('/users', (req, res) => {
    const users = loadUsers();
    const list = Object.keys(users).map(name => ({ username: name, avatar: users[name].avatar }));
    res.json(list);
});

// 全過去ログを取得するAPI
app.get('/messages', (req, res) => {
    res.json(loadMessages());
});

// リアルタイム通信（Socket.IO）
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (token) {
        socket.username = token;
        const users = loadUsers();
        socket.avatar = users[token] ? users[token].avatar : '👾';
        return next();
    }
    next(new Error("auth error"));
});

io.on('connection', (socket) => {
    // 自身のユーザー名のルームに参加（DMを狙い撃ちで受け取るため）
    socket.join(socket.username);

    socket.on('chat message', (data) => {
        // data = { to: 'all' または 'ユーザー名', msg: '本文' }
        const msgs = loadMessages();
        const time = new Date().toISOString(); // サーバー側の正確な標準時
        
        const newMsg = {
            from: socket.username,
            avatar: socket.avatar,
            to: data.to,
            msg: data.msg,
            time: time
        };
        
        msgs.push(newMsg);
        saveMessages(msgs);

        if (data.to === 'all') {
            io.emit('chat message', newMsg); // 全員に配信
        } else {
            // ダイレクトメッセージ：送信者と受信者のルームにのみ限定配信
            io.to(data.to).to(socket.username).emit('chat message', newMsg);
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => { console.log('同盟 Link 起動完了！'); });
