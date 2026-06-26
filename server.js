const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');
const fs = require('fs');

app.use(express.json());
app.use(express.static(__dirname));

// データ永続化用のファイルパス定義
const USERS_FILE = path.join(__dirname, 'users.json');
const MSGS_FILE = path.join(__dirname, 'messages.json');

// 起動時にファイルが存在しない場合は空のデータで生成する
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, JSON.stringify({}), 'utf8');
if (!fs.existsSync(MSGS_FILE)) fs.writeFileSync(MSGS_FILE, JSON.stringify([]), 'utf8');

function loadUsers() { try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch(e) { return {}; } }
function saveUsers(users) { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8'); }
function loadMessages() { try { return JSON.parse(fs.readFileSync(MSGS_FILE, 'utf8')); } catch(e) { return []; } }
function saveMessages(msgs) { fs.writeFileSync(MSGS_FILE, JSON.stringify(msgs, null, 2), 'utf8'); }

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

// アカウント作成処理
app.post('/register', (req, res) => {
    const { username, password, avatar } = req.body;
    if (!username || !password) return res.json({ success: false, message: '入力情報が足りないよ' });
    const users = loadUsers();
    if (users[username]) return res.json({ success: false, message: 'その名前はもう使われているよ' });
    
    users[username] = { password: password, avatar: avatar || '👾' };
    saveUsers(users);
    res.json({ success: true });
});

// ログイン処理
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const users = loadUsers();
    if (users[username] && users[username].password === password) {
        res.json({ success: true, token: username, avatar: users[username].avatar });
    } else {
        res.json({ success: false, message: '名前かパスワードが違うよ' });
    }
});

// プロフィール（名前・アイコン）変更の処理
app.post('/update-profile', (req, res) => {
    const { oldUsername, newUsername, newAvatar } = req.body;
    const users = loadUsers();
    
    if (!users[oldUsername]) return res.json({ success: false, message: 'ユーザーが見つからないよ' });

    // 名前が変更された場合の移行処理
    if (oldUsername !== newUsername) {
        if (users[newUsername]) return res.json({ success: false, message: 'その名前はすでに他の人が使っているよ' });
        
        // ユーザーデータを新しい名前に移し、古いデータを削除
        users[newUsername] = { password: users[oldUsername].password, avatar: newAvatar };
        delete users[oldUsername];

        // 過去のメッセージデータ内の名前とアイコンも新しいものに連動書き換え
        const msgs = loadMessages();
        msgs.forEach(msg => {
            if (msg.from === oldUsername) { msg.from = newUsername; msg.avatar = newAvatar; }
            if (msg.to === oldUsername) msg.to = newUsername;
        });
        saveMessages(msgs);
    } else {
        // アイコンのみ変更の場合の処理
        users[oldUsername].avatar = newAvatar;
        
        const msgs = loadMessages();
        msgs.forEach(msg => {
            if (msg.from === oldUsername) msg.avatar = newAvatar;
        });
        saveMessages(msgs);
    }

    saveUsers(users);
    res.json({ success: true, token: newUsername, avatar: newAvatar });
});

// サイドバー表示用のユーザー一覧取得処理
app.get('/users', (req, res) => {
    const users = loadUsers();
    const list = Object.keys(users).map(name => ({ username: name, avatar: users[name].avatar }));
    res.json(list);
});

// 過去の全チャットメッセージ取得処理
app.get('/messages', (req, res) => {
    res.json(loadMessages());
});

// Socket.IOを用いたリアルタイム通信および認証の制御
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
    // 自身のユーザー名の個室（ルーム）に自動参加。これによりDMの狙い撃ち配信を可能にする
    socket.join(socket.username);

    socket.on('chat message', (data) => {
        const msgs = loadMessages();
        const time = new Date().toISOString(); 
        
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
            io.emit('chat message', newMsg); // 全体に配信
        } else {
            // 送信先ユーザーの部屋と、送信元（自分）の部屋の2箇所だけに限定配信（DM）
            io.to(data.to).to(socket.username).emit('chat message', newMsg);
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => { console.log('同盟 Link 起動完了！'); });
